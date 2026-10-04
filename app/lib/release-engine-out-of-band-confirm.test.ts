/**
 * Coverage for `confirmOutOfBandMerge` (ticket #13441): the confirmation step
 * that gives a PR merged OUTSIDE the engine (almost always the owner merging
 * a protected-path PR by hand) the same bar the engine already holds its own
 * merges to before writing `applied` -- a READY production deployment and a
 * clean `runReleaseSmoke`, not `merged: true` alone.
 *
 * Same mocking shape as release-engine-no-deploy-record.test.ts: db.server,
 * kv.server, team.server, github.server's network functions, and every
 * side-effect module are mocked at import time; only the function under test
 * (and the real deployment/smoke helpers it calls in the same file) run for
 * real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (before importing the module under test)
// ---------------------------------------------------------------------------

vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/kv.server', () => ({
  KV_KEYS: { liveDealHandle: 'live-deal:handle' },
  kvGet: vi.fn(async () => null),
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
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn(async () => 'true') }))
vi.mock('~/lib/owner-alerts.server', () => ({
  sendOwnerEmail: vi.fn(async () => ({ sent: true })),
  escapeHtml: (s: string) => s,
}))
vi.mock('~/lib/settings.server', () => ({
  setPipelineSettingAudited: vi.fn(async () => undefined),
}))
vi.mock('~/lib/team.server', () => ({
  transitionSuggestion: vi.fn(async () => ({ attemptCount: 1 })),
  getTicket: vi.fn(async () => null),
  runWithOutOfBandReconcile: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  isMissingConflictTarget: vi.fn((err: unknown) => (err as { code?: string } | null)?.code === '42P10'),
}))
vi.mock('~/lib/release-ticket-autofile.server', () => ({
  autoFileTicketForPr: vi.fn(async () => null),
  dismissTicketsForClosedUnmergedPrs: vi.fn(async () => ({ checked: 0, dismissed: 0, errors: [] })),
}))
vi.mock('~/lib/github.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/github.server')>()
  return {
    ...actual,
    isGithubConfigured: vi.fn(() => true),
    githubRequest: vi.fn(),
  }
})

import { checkPageOnce, renderTruth } from '~/lib/homepage-healthcheck.server'
import { checkUrl, runCheckoutProbe } from '~/lib/checkout-probe.server'
import { githubRequest } from '~/lib/github.server'
import { confirmOutOfBandMerge } from '~/lib/release-engine.server'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MERGE_SHA = 'abcdef0123456789abcdef0123456789abcdef01'
const MERGED_AT = '2026-09-30T12:00:00.000Z'

/** A Vercel `/v6/deployments` response body. */
function deploymentsResponse(deployments: Array<Record<string, unknown>>): Response {
  return new Response(JSON.stringify({ deployments }), { status: 200 })
}

/** A GitHub `merged` smoke-happy path: checkPageOnce ok, renderTruth ok, probe ok. */
function stubCleanSmoke(): void {
  vi.mocked(checkPageOnce).mockResolvedValue({ ok: true, status: 200, problems: [], html: '<html></html>' } as never)
  vi.mocked(renderTruth).mockResolvedValue({ ok: true, missing: [], fallbacks: [], skipped: 'test' } as never)
  vi.mocked(checkUrl).mockResolvedValue({ ok: true } as never)
  vi.mocked(runCheckoutProbe).mockResolvedValue({ ok: true } as never)
}

/** A failing `home` smoke check, which fails the whole summarized result. */
function stubFailingSmoke(): void {
  vi.mocked(checkPageOnce).mockResolvedValue({ ok: false, status: 500, problems: ['boom'], html: '' } as never)
  vi.mocked(renderTruth).mockResolvedValue({ ok: true, missing: [], fallbacks: [], skipped: 'test' } as never)
  vi.mocked(checkUrl).mockResolvedValue({ ok: true } as never)
  vi.mocked(runCheckoutProbe).mockResolvedValue({ ok: true } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VERCEL_TOKEN', 'test-token')
  vi.stubEnv('VERCEL_PROJECT_ID', 'prj_test')
  vi.stubEnv('VERCEL_TEAM_ID', '')
  vi.stubEnv('PROBE_PRODUCT_HANDLE', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// 1. Not merged at all -- the floor nothing here may cross.
// ---------------------------------------------------------------------------

describe('confirmOutOfBandMerge: not merged', () => {
  it('returns merged:false when GitHub reports the PR is not merged', async () => {
    vi.mocked(githubRequest).mockResolvedValue({
      ok: true,
      status: 200,
      data: { merged: false },
    } as never)

    const res = await confirmOutOfBandMerge(1430)

    expect(res).toEqual({ merged: false, deployed: false })
  })

  it('returns merged:false when the GitHub call itself fails', async () => {
    vi.mocked(githubRequest).mockResolvedValue({ ok: false, status: 404, error: 'not found' } as never)

    const res = await confirmOutOfBandMerge(1430)

    expect(res).toEqual({ merged: false, deployed: false })
  })

  it('returns merged:false when GitHub says merged but reports no merge_commit_sha', async () => {
    vi.mocked(githubRequest).mockResolvedValue({
      ok: true,
      status: 200,
      data: { merged: true, merge_commit_sha: null, merged_at: MERGED_AT },
    } as never)

    const res = await confirmOutOfBandMerge(1430)

    expect(res).toEqual({ merged: false, deployed: false })
  })
})

// ---------------------------------------------------------------------------
// 2. Merged, but not yet confirmed deployed -- must wait, not apply early.
// ---------------------------------------------------------------------------

describe('confirmOutOfBandMerge: merged but not yet deployed', () => {
  it('reports deployed:false when no deployment matches and nothing supersedes it', async () => {
    vi.mocked(githubRequest).mockResolvedValue({
      ok: true,
      status: 200,
      data: { merged: true, merge_commit_sha: MERGE_SHA, merged_at: MERGED_AT },
    } as never)
    vi.stubGlobal('fetch', vi.fn(async () => deploymentsResponse([])))

    const res = await confirmOutOfBandMerge(1430)

    expect(res.merged).toBe(true)
    expect(res.mergeSha).toBe(MERGE_SHA)
    expect(res.deployed).toBe(false)
    expect(res.smoke).toBeUndefined()
    // Never runs smoke before a deployment is confirmed.
    expect(checkPageOnce).not.toHaveBeenCalled()
  })

  it('does not mark deployed when the matching deployment exists but has not gone READY', async () => {
    vi.mocked(githubRequest).mockResolvedValue({
      ok: true,
      status: 200,
      data: { merged: true, merge_commit_sha: MERGE_SHA, merged_at: MERGED_AT },
    } as never)
    vi.stubGlobal('fetch', vi.fn(async () =>
      deploymentsResponse([
        { uid: 'dpl_1', readyState: 'BUILDING', url: 'x.vercel.app', meta: { githubCommitSha: MERGE_SHA } },
      ]),
    ))

    const res = await confirmOutOfBandMerge(1430)

    expect(res.deployed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. Merged, deployed, and smoke-clean -- the happy path this ticket exists
//    for: the owner-merged PR earns `applied` at the exact bar the engine's
//    own merges earn it.
// ---------------------------------------------------------------------------

describe('confirmOutOfBandMerge: merged, deployed, and smoke-clean', () => {
  it('confirms deployed + smoke.ok when the exact merge sha has a READY deployment', async () => {
    vi.mocked(githubRequest).mockResolvedValue({
      ok: true,
      status: 200,
      data: { merged: true, merge_commit_sha: MERGE_SHA, merged_at: MERGED_AT },
    } as never)
    vi.stubGlobal('fetch', vi.fn(async () =>
      deploymentsResponse([
        { uid: 'dpl_1', readyState: 'READY', url: 'x.vercel.app', meta: { githubCommitSha: MERGE_SHA } },
      ]),
    ))
    stubCleanSmoke()

    const res = await confirmOutOfBandMerge(1430)

    expect(res.merged).toBe(true)
    expect(res.mergeSha).toBe(MERGE_SHA)
    expect(res.deployed).toBe(true)
    expect(res.smoke?.ok).toBe(true)
  })

  it('confirms deployed via a LATER superseding deployment when the merge is old enough to have rolled off the recent-20 list', async () => {
    // This is the motivating regression: a PR merged days/weeks ago, whose own
    // deployment record no longer appears in Vercel's most-recent-20 list,
    // must still be confirmed live rather than stuck at deployed:false forever.
    vi.mocked(githubRequest).mockResolvedValue({
      ok: true,
      status: 200,
      data: { merged: true, merge_commit_sha: MERGE_SHA, merged_at: MERGED_AT },
    } as never)
    const mergedAtMs = Date.parse(MERGED_AT)
    vi.stubGlobal('fetch', vi.fn(async () =>
      deploymentsResponse([
        {
          uid: 'dpl_later',
          readyState: 'READY',
          url: 'later.vercel.app',
          created: mergedAtMs + 60_000,
          meta: { githubCommitSha: 'ffffffffffffffffffffffffffffffffffffffff' },
        },
      ]),
    ))
    stubCleanSmoke()

    const res = await confirmOutOfBandMerge(1430)

    expect(res.deployed).toBe(true)
    expect(res.smoke?.ok).toBe(true)
  })

  it('reports smoke.ok:false (not applied-ready) when the deploy is READY but smoke fails', async () => {
    vi.mocked(githubRequest).mockResolvedValue({
      ok: true,
      status: 200,
      data: { merged: true, merge_commit_sha: MERGE_SHA, merged_at: MERGED_AT },
    } as never)
    vi.stubGlobal('fetch', vi.fn(async () =>
      deploymentsResponse([
        { uid: 'dpl_1', readyState: 'READY', url: 'x.vercel.app', meta: { githubCommitSha: MERGE_SHA } },
      ]),
    ))
    stubFailingSmoke()

    const res = await confirmOutOfBandMerge(1430)

    expect(res.deployed).toBe(true)
    expect(res.smoke?.ok).toBe(false)
  })
})
