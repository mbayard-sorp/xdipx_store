/**
 * POST /api/team/email (ticket #15002). `assertTeamAuth` is deliberately
 * NOT mocked here — unlike the sibling api-team-*.test.ts files — so the
 * real timing-safe credential check runs, proving the route actually
 * refuses an unauthenticated call rather than merely calling a stubbed
 * guard. The op handlers are mocked, so no database or Klaviyo call is
 * ever reached.
 *
 * Lives in app/lib rather than next to the route: anything under app/routes
 * is picked up by flatRoutes/typegen as a route module, tests included.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/api-error.server', () => ({
  apiError: (_scope: string, err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 }),
}))

vi.mock('~/lib/email-daily-draft.server', () => ({
  DailyDraftError: class DailyDraftError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
  previewDailyEmail: vi.fn(() => ({ campaignKey: 'daily-20261103', html: '<html></html>', text: 'text' })),
  draftDailyEmail: vi.fn(async () => ({ campaignKey: 'daily-20261103', pushed: true, reason: 'ok' })),
  getEmailLedger: vi.fn(async () => []),
}))

import { action } from '~/routes/api.team.email'

function post(body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request('http://localhost/api/team/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env['TEAM_TOKEN'] = 'test-team-token'
  delete process.env['HOMEPAGE_TEAM_TOKEN']
  delete process.env['CRON_SECRET']
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.clearAllMocks()
})

describe('auth', () => {
  it('401s an unauthenticated call before touching any op', async () => {
    await expect(post({ op: 'preview' })).rejects.toMatchObject({ status: 401 })
  })

  it('401s a call with the wrong secret', async () => {
    await expect(post({ op: 'preview' }, { 'x-team-secret': 'wrong' })).rejects.toMatchObject({ status: 401 })
  })

  it('accepts the correct secret and dispatches to preview', async () => {
    const res = await post({ op: 'preview' }, { 'x-team-secret': 'test-team-token' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ campaignKey: 'daily-20261103' })
  })
})

describe('op dispatch', () => {
  const auth = { 'x-team-secret': 'test-team-token' }

  it('draft', async () => {
    const res = await post({ op: 'draft' }, auth)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ pushed: true })
  })

  it('ledger', async () => {
    const res = await post({ op: 'ledger' }, auth)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sends: [] })
  })

  it('unknown op is a 400', async () => {
    const res = await post({ op: 'nonsense' }, auth)
    expect(res.status).toBe(400)
  })
})
