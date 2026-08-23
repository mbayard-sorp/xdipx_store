/**
 * Guard test for GET /api/team/pr (#5062): the response must include the raw
 * PR `body` text. Cloud QA is egress-restricted to xdipx.com, so this endpoint
 * is the only sanctioned source of the PR description — routine-qa-daily.md
 * Step 6 protected-path checklist item 1 ("the PR body opens with a
 * Protected-path diff section") cannot be verified without it.
 *
 * github.server / release-engine.server / qa-preview.server are mocked at
 * import time. Lives in app/lib so flatRoutes/typegen does not treat it as a
 * route module.
 */

import { describe, expect, it, vi } from 'vitest'

const PR_BODY = '## Protected-path diff\n\nThis PR touches db/migrations/** (additive only).'

vi.mock('~/lib/github.server', () => ({
  isGithubConfigured: () => true,
  getPullRequest: async () => ({
    ok: true,
    status: 200,
    data: {
      number: 884, title: 'ticket #5051: fix', body: PR_BODY, state: 'open', nodeId: 'n',
      draft: false, merged: false, mergeable: true, mergeableState: 'clean',
      headSha: 'abc1234', headRef: 'ticket/5051', baseRef: 'main',
      htmlUrl: 'https://github.com/o/r/pull/884', labels: [], user: 'someone', updatedAt: '2026-08-23T00:00:00Z',
    },
  }),
  listPullRequestFiles: async () => ({ ok: true, status: 200, data: [] }),
  getChecksForRef: async () => ({
    ok: true,
    data: { checks: [], pending: [], failing: [], succeeded: [], allGreen: true },
  }),
  findPreviewUrl: async () => ({ ok: true, data: null }),
  classifyChangedFiles: () => ({ protected: false, matched: [] }),
  refineMigrationProtection: async (c: unknown) => ({ classification: c, refined: false, reason: 'n/a' }),
  sanitizePreviewPath: (p: unknown) => (typeof p === 'string' ? p : null),
}))

vi.mock('~/lib/release-engine.server', () => ({ MIGRATION_DRY_RUN_CHECK: 'migration-dry-run' }))
vi.mock('~/lib/qa-preview.server', () => ({ QA_AGE_BYPASS_HEADER: 'x-qa-age-bypass', qaAgeBypassToken: () => null }))
vi.mock('~/lib/team.server', () => ({ assertTeamAuth: vi.fn() }))

import { loader } from '~/routes/api.team.pr'

function get(number: number): Promise<Response> {
  const request = new Request(`http://localhost/api/team/pr?number=${number}`)
  return loader({ request, params: {}, context: {} } as never) as Promise<Response>
}

describe('GET /api/team/pr includes the PR body (#5062)', () => {
  it('surfaces the raw PR description text under pr.body', async () => {
    const res = await get(884)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; pr: { number: number; body: string } }
    expect(json.ok).toBe(true)
    expect(json.pr.number).toBe(884)
    expect(json.pr.body).toBe(PR_BODY)
  })
})
