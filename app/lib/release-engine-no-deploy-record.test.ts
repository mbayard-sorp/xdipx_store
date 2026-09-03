/**
 * Regression coverage for ticket #2221: a merge with NO Vercel deployment
 * record at all (not queued, not building, not errored, simply absent) must
 * never be treated the same as a deployment that shipped and then failed.
 *
 * Evidence (2026-08-08): merge commits 2fd28c7 (PR #560, ticket #619) and
 * 7d30082 (PR #569, ticket #2015) had no Vercel deployment record in any
 * state for their SHA. The old `resolvePending` fell through to
 * `failAndRollback` for both, opening a revert PR for good, unshipped work;
 * the second rollback tripped `release-engine:rollbacks:<day>` and took the
 * merge lane down for a day.
 *
 * Same mocking shape as release-engine-cycle.test.ts: db.server, kv.server,
 * team.server, github.server's network functions, and every side-effect
 * module are mocked at import time. `handleMissingDeploymentRecord` and
 * `resolvePending` are exercised directly (not through the full cycle) so
 * these tests do not have to fake the self-check / daily-cap machinery.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (before importing the module under test)
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const state = {
    kvStore: new Map<string, unknown>(),
  }
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
    select: () => chain(() => []),
    update: () => chain(() => []),
    insert: () => chain(() => []),
    execute: async () => ({ rows: [] }),
  }
  return { state, db }
})

vi.mock('~/lib/db.server', () => ({ db: h.db }))
vi.mock('~/lib/kv.server', () => ({
  KV_KEYS: { liveDealHandle: 'live-deal:handle' },
  kvGet: vi.fn(async (k: string) => h.state.kvStore.get(k) ?? null),
  kvSet: vi.fn(async (k: string, v: unknown) => { h.state.kvStore.set(k, v) }),
  kvSetNX: vi.fn(async (k: string, v: unknown) => {
    if (h.state.kvStore.has(k)) return false
    h.state.kvStore.set(k, v)
    return true
  }),
  kvDel: vi.fn(async (k: string) => { h.state.kvStore.delete(k) }),
  kvIncr: vi.fn(async (k: string) => {
    const next = (Number(h.state.kvStore.get(k)) || 0) + 1
    h.state.kvStore.set(k, next)
    return next
  }),
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
    listOpenPullRequests: vi.fn(),
    getPullRequest: vi.fn(),
    listPullRequestFiles: vi.fn(),
    getChecksForRef: vi.fn(),
    addLabels: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    markPullRequestReadyForReview: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
    squashMergePullRequest: vi.fn(),
    openPullRequest: vi.fn(async () => ({ ok: true, status: 201, data: { htmlUrl: 'https://github.com/o/r/pull/999' } })),
    createRevertBranch: vi.fn(async () => ({ ok: true, status: 201, data: {} })),
  }
})

import { sendOwnerEmail } from '~/lib/owner-alerts.server'
import { kvDel } from '~/lib/kv.server'
import { createRevertBranch, openPullRequest } from '~/lib/github.server'
import {
  DEPLOY_TIMEOUT_MS,
  findSupersedingDeployment,
  handleMissingDeploymentRecord,
  resolvePending,
  type PendingMerge,
  type VercelDeployment,
} from '~/lib/release-engine.server'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Regression SHAs from the 2026-08-08 incident (ticket #2221 evidence). */
const EVIDENCE_SHAS = [
  { sha: '2fd28c7d1a9e4b3c8f2a1d6e5b4c3a2f1e0d9c8b', pr: 560, ticket: 619 },
  { sha: '7d300824f1b3e6c9a2d5f8e1c4b7a0d3f6e9c2b5', pr: 569, ticket: 2015 },
]

function pending(over: Partial<PendingMerge> = {}): PendingMerge {
  return {
    prNumber: 560,
    prUrl: 'https://github.com/o/r/pull/560',
    headRef: 'ticket/619',
    mergeSha: '2fd28c7d1a9e4b3c8f2a1d6e5b4c3a2f1e0d9c8b',
    mergedAt: Date.now() - (DEPLOY_TIMEOUT_MS + 5 * 60_000),
    ticketId: 619,
    ...over,
  }
}

/** Vercel deployments list response with no entry matching any SHA. */
function emptyDeploymentsResponse(): Response {
  return new Response(JSON.stringify({ deployments: [] }), { status: 200 })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.kvStore = new Map()
  vi.stubEnv('VERCEL_TOKEN', 'test-token')
  vi.stubEnv('VERCEL_PROJECT_ID', 'prj_test')
  vi.stubEnv('VERCEL_TEAM_ID', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// 1. No deployment record at all -- must never roll back
// ---------------------------------------------------------------------------

describe('handleMissingDeploymentRecord: no Vercel deployment record for the SHA', () => {
  for (const evidence of EVIDENCE_SHAS) {
    it(`regression PR #${evidence.pr} (ticket #${evidence.ticket}, sha ${evidence.sha.slice(0, 7)}): does not roll back`, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => emptyDeploymentsResponse()))
      const p = pending({
        prNumber: evidence.pr,
        prUrl: `https://github.com/o/r/pull/${evidence.pr}`,
        mergeSha: evidence.sha,
        ticketId: evidence.ticket,
      })

      const res = await handleMissingDeploymentRecord(p, false)

      expect(res.phase).toBe('no-deploy-record')
      expect(res.resolved?.outcome).toBe('no-deploy-record')
      // The core regression: no revert PR, no rollback-counter increment.
      expect(vi.mocked(createRevertBranch)).not.toHaveBeenCalled()
      expect(vi.mocked(openPullRequest)).not.toHaveBeenCalled()
      expect(h.state.kvStore.has(`release-engine:rollbacks:${new Date().toISOString().slice(0, 10)}`)).toBe(false)
      // The pending merge is left in place: this branch never clears it.
      expect(vi.mocked(kvDel)).not.toHaveBeenCalledWith('release-engine:pending')
      // Escalated to the owner exactly once.
      expect(vi.mocked(sendOwnerEmail)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(sendOwnerEmail).mock.calls[0]![0]).toContain(`#${evidence.pr}`)
    })
  }

  it('retries the lookup once before giving up (does not escalate on the first empty result alone)', async () => {
    const fetchMock = vi.fn(async () => emptyDeploymentsResponse())
    vi.stubGlobal('fetch', fetchMock)

    await handleMissingDeploymentRecord(pending(), false)

    // One retry lookup = one more Vercel deployments-list call.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recovers if the retry finds a (still building) record: keeps waiting, does not escalate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        deployments: [{ uid: 'dpl_1', readyState: 'BUILDING', url: 'x.vercel.app', meta: { githubCommitSha: pending().mergeSha } }],
      }), { status: 200 }),
    ))

    const res = await handleMissingDeploymentRecord(pending(), false)

    expect(res.phase).toBe('awaiting-deploy')
    expect(vi.mocked(sendOwnerEmail)).not.toHaveBeenCalled()
    expect(vi.mocked(createRevertBranch)).not.toHaveBeenCalled()
  })

  it('dry run does not send an email but still reports no-deploy-record', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => emptyDeploymentsResponse()))
    const res = await handleMissingDeploymentRecord(pending(), true)
    expect(res.phase).toBe('no-deploy-record')
    expect(vi.mocked(sendOwnerEmail)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 1b. Ticket #7241 (split from #7140): a pending SHA that never got its own
//     deployment record, but a LATER commit already deployed READY, is
//     superseded rather than stuck -- self-clear instead of blocking the
//     engine forever. #7140 evidenced this halting the engine for hours on
//     PR #1030 (de5353d) while 14 later commits deployed fine.
// ---------------------------------------------------------------------------

describe('findSupersedingDeployment (pure)', () => {
  const dep = (over: Partial<VercelDeployment> = {}): VercelDeployment => ({
    uid: 'dpl_x', readyState: 'READY', url: 'x.vercel.app', sha: 'aaaa', createdAt: 1_000, ...over,
  })

  it('finds a READY deployment created after the cutoff for a different sha', () => {
    const list = [dep({ sha: 'bbbb', createdAt: 2_000 })]
    expect(findSupersedingDeployment(list, 1_000, 'aaaa')?.sha).toBe('bbbb')
  })

  it('ignores one created before the cutoff', () => {
    const list = [dep({ sha: 'bbbb', createdAt: 500 })]
    expect(findSupersedingDeployment(list, 1_000, 'aaaa')).toBeNull()
  })

  it('ignores a later deployment that is not READY', () => {
    const list = [dep({ sha: 'bbbb', createdAt: 2_000, readyState: 'BUILDING' })]
    expect(findSupersedingDeployment(list, 1_000, 'aaaa')).toBeNull()
  })

  it('ignores the excluded sha itself even if later and READY', () => {
    const list = [dep({ sha: 'aaaa', createdAt: 2_000 })]
    expect(findSupersedingDeployment(list, 1_000, 'aaaa')).toBeNull()
  })

  it('returns null on an empty list', () => {
    expect(findSupersedingDeployment([], 1_000, 'aaaa')).toBeNull()
  })

  it('ignores a later READY deployment with no recorded sha (cannot confirm it differs from the excluded sha)', () => {
    const list = [dep({ sha: null, createdAt: 2_000 })]
    expect(findSupersedingDeployment(list, 1_000, 'aaaa')).toBeNull()
  })
})

describe('handleMissingDeploymentRecord: pending SHA superseded by a later successful deploy', () => {
  it('self-clears the pending row instead of escalating, when a later deployment is READY', async () => {
    const p = pending() // mergedAt is DEPLOY_TIMEOUT_MS + 5min in the past
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        deployments: [
          {
            uid: 'dpl_later',
            readyState: 'READY',
            url: 'later.vercel.app',
            created: p.mergedAt + 5 * 60_000, // deployed after this merge
            meta: { githubCommitSha: 'ffffffffffffffffffffffffffffffffffffffff' },
          },
        ],
      }), { status: 200 }),
    ))

    const res = await handleMissingDeploymentRecord(p, false)

    expect(res.phase).toBe('superseded-self-cleared')
    expect(res.resolved?.prNumber).toBe(p.prNumber)
    // The core behavior: the pending row is cleared so the next cycle
    // resumes merges and the out-of-band sweep, rather than sitting stuck.
    expect(vi.mocked(kvDel)).toHaveBeenCalledWith('release-engine:pending')
    // Not treated as a real failure: no revert, no rollback, no owner email.
    expect(vi.mocked(createRevertBranch)).not.toHaveBeenCalled()
    expect(vi.mocked(sendOwnerEmail)).not.toHaveBeenCalled()
  })

  it('does NOT self-clear when no later deployment has gone READY -- falls through to escalate as before', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => emptyDeploymentsResponse()))

    const res = await handleMissingDeploymentRecord(pending(), false)

    expect(res.phase).toBe('no-deploy-record')
    expect(vi.mocked(kvDel)).not.toHaveBeenCalledWith('release-engine:pending')
    expect(vi.mocked(sendOwnerEmail)).toHaveBeenCalledTimes(1)
  })

  it('dry run self-clears in-memory but never calls kvDel', async () => {
    const p = pending()
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        deployments: [{
          uid: 'dpl_later',
          readyState: 'READY',
          created: p.mergedAt + 5 * 60_000,
          meta: { githubCommitSha: 'ffffffffffffffffffffffffffffffffffffffff' },
        }],
      }), { status: 200 }),
    ))

    const res = await handleMissingDeploymentRecord(p, true)

    expect(res.phase).toBe('superseded-self-cleared')
    expect(vi.mocked(kvDel)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 2. A deployment record that exists and is a terminal failure: still rolls
//    back. This is the branch handleMissingDeploymentRecord must NOT touch.
// ---------------------------------------------------------------------------

describe('resolvePending: a deployment record that exists and failed still rolls back', () => {
  it('ERROR readyState -> failAndRollback runs (revert PR opened, rollback counter incremented)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v6/deployments')) {
        return new Response(JSON.stringify({
          deployments: [{ uid: 'dpl_bad', readyState: 'ERROR', url: 'x.vercel.app', meta: { githubCommitSha: pending().mergeSha } }],
        }), { status: 200 })
      }
      // promote/rollback endpoints: no previous READY deployment in this fixture,
      // so these should not even be reached, but return ok defensively.
      return new Response('{}', { status: 200 })
    }))

    const res = await resolvePending(pending(), false)

    expect(res.phase).toBe('rolled-back')
    expect(vi.mocked(createRevertBranch)).toHaveBeenCalledTimes(1)
    const day = new Date().toISOString().slice(0, 10)
    expect(h.state.kvStore.get(`release-engine:rollbacks:${day}`)).toBe(1)
    expect(vi.mocked(sendOwnerEmail)).not.toHaveBeenCalled() // below the circuit-breaker limit
  })
})
