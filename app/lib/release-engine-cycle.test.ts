/**
 * Cycle-level tests for the release engine: what a whole cycle DOES, not what
 * the pure gate decides (that lives in release-engine.test.ts).
 *
 * The database here is PRODUCTION and the tokens are real, so this file
 * reaches neither: db.server, kv.server, github.server's network functions,
 * and every side-effect module are mocked at import time. The only real code
 * exercised is the engine itself plus github.server's pure classifiers.
 *
 * What is asserted:
 *   1. A capped cycle still lists, evaluates, labels, escalates, autofiles,
 *      and undrafts; only the merge is withheld (regression: 2026-08-04, a
 *      protected-path PR got no needs-owner label all day because the cap
 *      check returned before listOpenPullRequests).
 *   2. The self-check makes a REAL Vercel API call: a 401/403 is a config
 *      error on the once-daily owner email path, and can never reach the
 *      merge/rollback path. A transient failure changes nothing.
 *   3. The orphan sweep closes approved/blocked tickets only when GitHub
 *      itself reports the linked PR merged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (before importing the module under test)
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const state = {
    /** FIFO of results handed to successive db.select() chains. */
    selects: [] as unknown[][],
    /** kvGet handler, replaced per test. */
    kvGet: ((_k: string) => null) as (k: string) => unknown,
    /** pipeline_settings handler, replaced per test. */
    settings: ((_k: string) => null) as (k: string) => string | null,
  }

  /** A thenable proxy: any method returns itself, awaiting it yields result(). */
  function chain(result: () => unknown) {
    const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(ok, err)
        }
        return () => proxy
      },
    }) as Record<string, unknown>
    return proxy
  }

  const db = {
    select: () => chain(() => state.selects.shift() ?? []),
    update: () => chain(() => []),
    insert: () => chain(() => []),
    execute: async () => ({ rows: [] }),
  }
  return { state, db }
})

vi.mock('~/lib/db.server', () => ({ db: h.db }))
vi.mock('~/lib/kv.server', () => ({
  KV_KEYS: { liveDealHandle: 'live-deal:handle' },
  kvGet: vi.fn(async (k: string) => h.state.kvGet(k)),
  kvSet: vi.fn(async () => undefined),
  kvSetNX: vi.fn(async () => true),
  kvDel: vi.fn(async () => undefined),
  kvIncr: vi.fn(async () => 1),
}))
vi.mock('~/lib/homepage-healthcheck.server', () => ({
  checkPageOnce: vi.fn(),
  renderTruth: vi.fn(),
}))
vi.mock('~/lib/checkout-probe.server', () => ({ checkUrl: vi.fn(), runCheckoutProbe: vi.fn() }))
vi.mock('~/lib/feed-processor.server', () => ({
  getPipelineSetting: vi.fn(async (k: string) => h.state.settings(k)),
}))
vi.mock('~/lib/owner-alerts.server', () => ({
  sendOwnerEmail: vi.fn(async () => ({ sent: true })),
  escapeHtml: (s: string) => s,
}))
vi.mock('~/lib/team.server', () => ({
  transitionSuggestion: vi.fn(async () => ({ attemptCount: 1 })),
  getTicket: vi.fn(async () => null),
  // Pass-through: the fence itself is exercised for real in team-tickets.test.ts;
  // here the mock just lets the engine's sweep wrapping run.
  runWithOutOfBandReconcile: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))
vi.mock('~/lib/release-ticket-autofile.server', () => ({
  autoFileTicketForPr: vi.fn(async () => null),
  dismissTicketsForClosedUnmergedPrs: vi.fn(async () => ({ checked: 0, dismissed: 0, errors: [] })),
}))
// Network functions mocked; the pure classifiers stay real so the protected
// decision in these tests is the production one.
vi.mock('~/lib/github.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/github.server')>()
  return {
    ...actual,
    isGithubConfigured: vi.fn(() => true),
    githubRequest: vi.fn(),
    listOpenPullRequests: vi.fn(),
    getPullRequest: vi.fn(),
    listPullRequestFiles: vi.fn(),
    getChecksForRef: vi.fn(),
    addLabels: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    markPullRequestReadyForReview: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
    squashMergePullRequest: vi.fn(),
    openPullRequest: vi.fn(),
    createRevertBranch: vi.fn(),
  }
})

import {
  addLabels,
  getChecksForRef,
  getPullRequest,
  githubRequest,
  listOpenPullRequests,
  listPullRequestFiles,
  markPullRequestReadyForReview,
  squashMergePullRequest,
  type PullRequestSummary,
} from '~/lib/github.server'
import { sendOwnerEmail } from '~/lib/owner-alerts.server'
import { transitionSuggestion } from '~/lib/team.server'
import { autoFileTicketForPr } from '~/lib/release-ticket-autofile.server'
import {
  NEEDS_OWNER_LABEL,
  checkVercelCredentials,
  runReleaseEngineCycle,
  runSelfCheck,
  sweepOrphanedMergedPrTickets,
} from '~/lib/release-engine.server'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function pr(number: number, headRef: string, over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number,
    title: `pr ${number}`,
    state: 'open',
    nodeId: `node-${number}`,
    draft: false,
    merged: false,
    mergeable: true,
    mergeableState: 'clean',
    headSha: `sha-${number}`,
    headRef,
    baseRef: 'main',
    htmlUrl: `https://github.com/o/r/pull/${number}`,
    labels: [],
    body: '',
    user: 'agent',
    updatedAt: new Date(Date.now() - 3600_000).toISOString(),
    ...over,
  }
}

const currentHour = () => new Date().toISOString().slice(0, 13)

/** KV state for a healthy engine that has already spent its daily cap. */
function cappedKv(k: string): unknown {
  if (k === 'release-engine:self-check-ok') return { ok: true, at: Date.now() }
  if (k.startsWith('release-engine:merges:')) return 6
  // Hour markers set so the hourly sweeps do not run inside these tests.
  if (k === 'release-engine:sweep-hour') return currentHour()
  if (k === 'release-engine:exhausted-sweep-hour') return currentHour()
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.selects = []
  h.state.kvGet = () => null
  h.state.settings = (k) =>
    k === 'release_engine_enabled' ? 'true'
    : k === 'release_engine_max_merges_per_day' ? '6'
    : null
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// 1. A capped cycle still sees, labels, escalates, autofiles, and undrafts
// ---------------------------------------------------------------------------

describe('daily cap decoupling', () => {
  it('withholds only the merge: every side action still runs while capped', async () => {
    h.state.kvGet = cappedKv

    const merge_ready = pr(10, 'ticket/41')
    const protected_pr = pr(11, 'claude/settings-tweak')
    const machine_draft = pr(12, 'ticket/9', { draft: true })
    const ticketless = pr(13, 'fix/pricing-tweak')
    const byNumber = new Map([[10, merge_ready], [11, protected_pr], [12, machine_draft], [13, ticketless]])

    vi.mocked(listOpenPullRequests).mockResolvedValue({
      ok: true, status: 200, data: [merge_ready, protected_pr, machine_draft, ticketless],
    } as never)
    vi.mocked(getPullRequest).mockImplementation(async (n: number) =>
      ({ ok: true, status: 200, data: byNumber.get(n) }) as never)
    vi.mocked(listPullRequestFiles).mockImplementation(async (n: number) =>
      ({
        ok: true, status: 200,
        data: n === 11
          ? [{ filename: 'app/lib/team.server.ts' }]
          : [{ filename: 'app/lib/storefront-home.server.ts' }],
      }) as never)
    vi.mocked(getChecksForRef).mockResolvedValue({
      ok: true, status: 200,
      data: { checks: [{ name: 'check', status: 'completed', conclusion: 'success' }] },
    } as never)

    // db reads, in PR order: PR #10 resolves ticket #41 (link row + facts row),
    // the other three resolve nothing.
    h.state.selects = [
      [{ suggestionId: 41, ref: 'https://github.com/o/r/pull/10' }],
      [{ id: 41, status: 'verified', kind: 'code', attemptCount: 0 }],
      [], [], [],
    ]

    const res = await runReleaseEngineCycle()

    // The cycle evaluated everything and reported the cap, not blindness.
    expect(res.phase).toBe('daily-cap')
    expect(res.message).toContain('daily cap reached (6/6)')
    expect(res.decisions).toHaveLength(4)

    // The merge-ready PR was fully evaluated and found ready, then withheld.
    const ready = res.decisions.find((d) => d.prNumber === 10)
    expect(ready?.action).toBe('merge')
    expect(vi.mocked(squashMergePullRequest)).not.toHaveBeenCalled()

    // The protected PR was labelled and escalated the same day it appeared.
    const prot = res.decisions.find((d) => d.prNumber === 11)
    expect(prot?.action).toBe('escalate-protected')
    expect(vi.mocked(addLabels)).toHaveBeenCalledWith(11, [NEEDS_OWNER_LABEL], 'release-engine')
    expect(vi.mocked(sendOwnerEmail)).toHaveBeenCalledTimes(1)

    // The machine-lane draft was still taken out of draft.
    expect(vi.mocked(markPullRequestReadyForReview)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(markPullRequestReadyForReview)).toHaveBeenCalledWith('node-12', 'release-engine')

    // The ticket-less PR was still autofiled.
    expect(vi.mocked(autoFileTicketForPr)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(autoFileTicketForPr).mock.calls[0]![0]).toMatchObject({ number: 13 })
  })

  it('still merges normally when under the cap, so the decoupling changed nothing else', async () => {
    h.state.kvGet = (k) => (k.startsWith('release-engine:merges:') ? 0 : cappedKv(k))

    const merge_ready = pr(10, 'ticket/41')
    vi.mocked(listOpenPullRequests).mockResolvedValue({ ok: true, status: 200, data: [merge_ready] } as never)
    vi.mocked(getPullRequest).mockResolvedValue({ ok: true, status: 200, data: merge_ready } as never)
    vi.mocked(listPullRequestFiles).mockResolvedValue({
      ok: true, status: 200, data: [{ filename: 'app/lib/storefront-home.server.ts' }],
    } as never)
    vi.mocked(getChecksForRef).mockResolvedValue({
      ok: true, status: 200,
      data: { checks: [{ name: 'check', status: 'completed', conclusion: 'success' }] },
    } as never)
    vi.mocked(squashMergePullRequest).mockResolvedValue({
      ok: true, status: 200, data: { sha: 'deadbeef' },
    } as never)
    h.state.selects = [
      [{ suggestionId: 41, ref: 'https://github.com/o/r/pull/10' }],
      [{ id: 41, status: 'verified', kind: 'code', attemptCount: 0 }],
    ]

    const res = await runReleaseEngineCycle()
    expect(res.phase).toBe('merged')
    expect(vi.mocked(squashMergePullRequest)).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 1b. Migration PRs: cleared by content, or not at all
// ---------------------------------------------------------------------------

/**
 * End-to-end through the real classifier and the real refinement, with only the
 * network mocked. The point is that the merge decision and the build-time apply
 * decision come from the same rules: a migration the build step would apply
 * unattended no longer waits on the owner, and one it would refuse still does.
 */
describe('migration PRs are cleared by content, not by filename', () => {
  // The refinement's content read goes through the module's own githubRequest,
  // which the module-level mock does not intercept (an internal call keeps the
  // original binding). So this stubs the layer below it: fetch itself.
  const fetchMock = vi.fn()

  const GREEN_CHECKS = [
    { name: 'check', status: 'completed', conclusion: 'success' },
    { name: 'migration-dry-run', status: 'completed', conclusion: 'success' },
  ]

  /** Set up one migration PR whose body the contents endpoint answers with. */
  const migrationCycle = async (contents: Response, checks: unknown[] = GREEN_CHECKS) => {
    h.state.kvGet = (k) => (k.startsWith('release-engine:merges:') ? 0 : cappedKv(k))
    vi.stubEnv('GITHUB_TOKEN', 'test-token')
    vi.stubEnv('GITHUB_OWNER', 'test-owner')
    vi.stubEnv('GITHUB_REPO', 'test-repo')
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(contents)
    vi.stubGlobal('fetch', fetchMock)

    const migration_pr = pr(20, 'ticket/77')
    vi.mocked(listOpenPullRequests).mockResolvedValue({ ok: true, status: 200, data: [migration_pr] } as never)
    vi.mocked(getPullRequest).mockResolvedValue({ ok: true, status: 200, data: migration_pr } as never)
    vi.mocked(listPullRequestFiles).mockResolvedValue({
      ok: true, status: 200, data: [{ filename: 'db/migrations/081_add_column.sql', status: 'added' }],
    } as never)
    vi.mocked(getChecksForRef).mockResolvedValue({ ok: true, status: 200, data: { checks } } as never)
    vi.mocked(squashMergePullRequest).mockResolvedValue({ ok: true, status: 200, data: { sha: 'deadbeef' } } as never)
    h.state.selects = [
      [{ suggestionId: 77, ref: 'https://github.com/o/r/pull/20' }],
      [{ id: 77, status: 'verified', kind: 'code', attemptCount: 0 }],
    ]

    return runReleaseEngineCycle()
  }

  const sqlResponse = (sql: string) =>
    new Response(
      JSON.stringify({ type: 'file', encoding: 'base64', content: Buffer.from(sql, 'utf8').toString('base64') }),
      { status: 200 },
    )

  it('merges an additive migration instead of escalating it', async () => {
    const res = await migrationCycle(
      sqlResponse('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS shipped_at timestamptz;'),
    )

    expect(res.decisions.find((d) => d.prNumber === 20)?.action).toBe('merge')
    expect(vi.mocked(squashMergePullRequest)).toHaveBeenCalledTimes(1)
    // Read at the head sha, never at a branch ref that could move under it.
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('ref=sha-20')
  })

  it('still escalates a migration with a destructive statement in it', async () => {
    const res = await migrationCycle(sqlResponse('DROP TABLE tickets;'))

    expect(res.decisions.find((d) => d.prNumber === 20)?.action).toBe('escalate-protected')
    expect(vi.mocked(squashMergePullRequest)).not.toHaveBeenCalled()
    expect(vi.mocked(addLabels)).toHaveBeenCalledWith(20, [NEEDS_OWNER_LABEL], 'release-engine')
  })

  it('still escalates when the migration body cannot be read', async () => {
    const res = await migrationCycle(new Response('Not Found', { status: 404 }))

    expect(res.decisions.find((d) => d.prNumber === 20)?.action).toBe('escalate-protected')
    expect(vi.mocked(squashMergePullRequest)).not.toHaveBeenCalled()
  })

  // `check` compiles the app and executes no SQL, so it cannot stand in for the
  // dry-run. Without this the shape-additive-but-broken migration (bad type,
  // missing table) would auto-merge on a green typecheck.
  it('does not clear an additive migration while the real-Postgres dry-run is red', async () => {
    const res = await migrationCycle(
      sqlResponse('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS shipped_at timestamptz;'),
      [
        { name: 'check', status: 'completed', conclusion: 'success' },
        { name: 'migration-dry-run', status: 'completed', conclusion: 'failure' },
      ],
    )

    expect(res.decisions.find((d) => d.prNumber === 20)?.action).toBe('escalate-protected')
    expect(vi.mocked(squashMergePullRequest)).not.toHaveBeenCalled()
  })

  it('does not clear an additive migration while the dry-run is still pending', async () => {
    const res = await migrationCycle(
      sqlResponse('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS shipped_at timestamptz;'),
      [
        { name: 'check', status: 'completed', conclusion: 'success' },
        { name: 'migration-dry-run', status: 'in_progress', conclusion: null },
      ],
    )

    expect(res.decisions.find((d) => d.prNumber === 20)?.action).toBe('escalate-protected')
    expect(vi.mocked(squashMergePullRequest)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 2. Self-check makes a real Vercel call
// ---------------------------------------------------------------------------

/** GitHub half of the self-check: everything healthy. */
function healthyGithubSelfCheck() {
  vi.mocked(githubRequest).mockImplementation(async (path: string) => {
    if (path === '/repos/{owner}/{repo}') {
      return {
        ok: true, status: 200,
        data: { allow_squash_merge: true, default_branch: 'main', permissions: { push: true } },
      } as never
    }
    return { ok: true, status: 200, data: { object: { sha: 'abc123' } } } as never
  })
  vi.mocked(getChecksForRef).mockResolvedValue({ ok: true, status: 200, data: { checks: [] } } as never)
}

describe('self-check verifies the Vercel token, not merely its presence', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_TOKEN', 'stale-token')
    vi.stubEnv('VERCEL_PROJECT_ID', 'prj_test')
    vi.stubEnv('VERCEL_TEAM_ID', '')
    healthyGithubSelfCheck()
  })

  it('treats a 401 as a config error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    const res = await runSelfCheck({ force: true })
    expect(res.ok).toBe(false)
    expect(res.problems.join(' ')).toContain('HTTP 401')
    expect(res.problems.join(' ')).toContain('VERCEL_TOKEN')
  })

  it('treats a 403 as a config error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    expect(await checkVercelCredentials()).toContain('HTTP 403')
  })

  it('reports missing credentials as before', async () => {
    vi.stubEnv('VERCEL_TOKEN', '')
    expect(await checkVercelCredentials()).toContain('not set')
  })

  it('lets a transient failure pass: a network blip must not stop releases', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    expect(await checkVercelCredentials()).toBeNull()
    const res = await runSelfCheck({ force: true })
    expect(res.ok).toBe(true)
  })

  it('lets a 5xx pass too: Vercel being down is not a bad token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })))
    expect(await checkVercelCredentials()).toBeNull()
  })

  it('routes a 401 through config-error and the owner email, never near a merge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    // No cached self-check pass, so the cycle runs the real one.
    h.state.kvGet = (k) =>
      k === 'release-engine:exhausted-sweep-hour' ? currentHour() : null

    const res = await runReleaseEngineCycle()
    expect(res.phase).toBe('config-error')
    expect(res.ok).toBe(false)
    // The once-daily owner email went out, and the cycle never touched a PR.
    expect(vi.mocked(sendOwnerEmail)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendOwnerEmail).mock.calls[0]![0]).toContain('config error')
    expect(vi.mocked(listOpenPullRequests)).not.toHaveBeenCalled()
    expect(vi.mocked(squashMergePullRequest)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 3. Orphan sweep (approved/blocked tickets whose PR merged out of band)
// ---------------------------------------------------------------------------

describe('sweepOrphanedMergedPrTickets', () => {
  it('applies approved and blocked tickets whose PR GitHub reports merged', async () => {
    h.state.selects = [[
      { ticketId: 120, status: 'approved', ref: 'https://github.com/o/r/pull/436' },
      { ticketId: 455, status: 'blocked', ref: 'https://github.com/o/r/pull/508' },
      { ticketId: 900, status: 'approved', ref: 'https://github.com/o/r/pull/700' },
      // A second, older link on an already-seen ticket is ignored.
      { ticketId: 120, status: 'approved', ref: 'https://github.com/o/r/pull/9' },
    ]]
    vi.mocked(getPullRequest).mockImplementation(async (n: number) =>
      ({
        ok: true, status: 200,
        data: pr(n, 'ticket/x', { merged: n !== 700, state: 'closed' }),
      }) as never)

    const res = await sweepOrphanedMergedPrTickets()

    expect(res.checked).toBe(3)
    expect(res.applied).toEqual([120, 455])
    expect(res.errors).toEqual([])
    expect(vi.mocked(transitionSuggestion)).toHaveBeenCalledTimes(2)
    // Every reconcile transition must carry the declaration that unlocks the
    // fenced approved/blocked -> applied edges; without it the map 409s.
    expect(vi.mocked(transitionSuggestion)).toHaveBeenCalledWith(
      120, 'applied', 'system', expect.objectContaining({ viaOutOfBandReconcile: true }),
    )
    expect(vi.mocked(transitionSuggestion)).toHaveBeenCalledWith(
      455, 'applied', 'system', expect.objectContaining({ viaOutOfBandReconcile: true }),
    )
    // The unmerged PR's ticket was left exactly where it was.
    expect(vi.mocked(transitionSuggestion)).not.toHaveBeenCalledWith(900, 'applied', 'system', expect.anything())
  })

  it('records the stranded status in the reconcile note', async () => {
    h.state.selects = [[{ ticketId: 455, status: 'blocked', ref: 'https://github.com/o/r/pull/508' }]]
    vi.mocked(getPullRequest).mockResolvedValue({
      ok: true, status: 200, data: pr(508, 'ticket/x', { merged: true, state: 'closed' }),
    } as never)

    await sweepOrphanedMergedPrTickets()
    const opts = vi.mocked(transitionSuggestion).mock.calls[0]![3] as { note?: string }
    expect(opts.note).toContain("while 'blocked'")
    expect(opts.note).toContain('PR #508')
  })

  it('swallows a 409 (the row moved first) without reporting an error', async () => {
    h.state.selects = [[{ ticketId: 120, status: 'approved', ref: 'https://github.com/o/r/pull/436' }]]
    vi.mocked(getPullRequest).mockResolvedValue({
      ok: true, status: 200, data: pr(436, 'ticket/x', { merged: true, state: 'closed' }),
    } as never)
    vi.mocked(transitionSuggestion).mockRejectedValueOnce(new Response('conflict', { status: 409 }))

    const res = await sweepOrphanedMergedPrTickets()
    expect(res.applied).toEqual([])
    expect(res.errors).toEqual([])
  })

  it('skips an unparseable link ref without spending budget on it', async () => {
    h.state.selects = [[
      { ticketId: 5, status: 'approved', ref: 'not a pr ref' },
      { ticketId: 120, status: 'approved', ref: 'https://github.com/o/r/pull/436' },
    ]]
    vi.mocked(getPullRequest).mockResolvedValue({
      ok: true, status: 200, data: pr(436, 'ticket/x', { merged: true, state: 'closed' }),
    } as never)

    const res = await sweepOrphanedMergedPrTickets()
    expect(res.checked).toBe(1)
    expect(res.applied).toEqual([120])
  })

  it('collects a GitHub read failure and keeps going', async () => {
    h.state.selects = [[
      { ticketId: 1, status: 'approved', ref: 'https://github.com/o/r/pull/2' },
      { ticketId: 120, status: 'blocked', ref: 'https://github.com/o/r/pull/436' },
    ]]
    vi.mocked(getPullRequest).mockImplementation(async (n: number) =>
      (n === 2
        ? { ok: false, status: 500, error: 'boom' }
        : { ok: true, status: 200, data: pr(n, 'ticket/x', { merged: true, state: 'closed' }) }) as never)

    const res = await sweepOrphanedMergedPrTickets()
    expect(res.errors).toHaveLength(1)
    expect(res.applied).toEqual([120])
  })

  it('never throws on a dead candidate query', async () => {
    const orig = h.db.select
    h.db.select = () => { throw new Error('db down') }
    try {
      const res = await sweepOrphanedMergedPrTickets()
      expect(res.applied).toEqual([])
      expect(res.errors.join(' ')).toContain('orphan candidate query failed')
    } finally {
      h.db.select = orig
    }
  })
})
