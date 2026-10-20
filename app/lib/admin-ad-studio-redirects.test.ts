/**
 * Ticket #16413: Ad Studio's Live and Spend tabs moved to the ads console.
 * Both old URLs answer 302 with the query string kept, and the live-action
 * and live-undo actions still answer at /admin/ad-studio/live until the
 * action ledger replaces them.
 *
 * Lives in app/lib rather than next to the routes: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('~/lib/session.server', () => ({
  requireAdmin: requireAdminMock,
  getAdminUser: vi.fn(async () => ({ email: 'mike@xdipx.com', role: 'owner' })),
}))

const metrics = vi.hoisted(() => {
  class AdMetricsError extends Error {}
  return {
    AdMetricsError,
    isLiveActionKind: (k: string) => k === 'pause' || k === 'scale' || k === 'refresh',
    recordLiveAction: vi.fn(async () => ({ eventId: 41, message: 'Recorded.' })),
    undoLiveAction: vi.fn(async () => {}),
  }
})
vi.mock('~/lib/ad-metrics.server', () => metrics)

const applyRuleAction = vi.hoisted(() => vi.fn(async () => ({ eventId: 42, message: 'Paused.' })))
vi.mock('~/lib/ad-rules.server', () => ({ applyRuleAction }))

import { loader as spendLoader } from '~/routes/admin.ad-studio.spend'
import { action as liveAction, loader as liveLoader } from '~/routes/admin.ad-studio.live'

function get(url: string) {
  return { request: new Request(url), params: {}, context: {} } as never
}

async function post(fields: Record<string, string>) {
  const body = new FormData()
  for (const [k, v] of Object.entries(fields)) body.append(k, v)
  const request = new Request('https://xdipx.com/admin/ad-studio/live', { method: 'POST', body })
  return liveAction({ request, params: {}, context: {} } as never)
}

beforeEach(() => { vi.clearAllMocks() })

describe('Ad Studio redirects', () => {
  it('sends /admin/ad-studio/spend to /admin/ads/settings with a 302', async () => {
    const res = await spendLoader(get('https://xdipx.com/admin/ad-studio/spend'))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/admin/ads/settings')
    expect(requireAdminMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the query string on the spend redirect', async () => {
    const res = await spendLoader(get('https://xdipx.com/admin/ad-studio/spend?focus=csv'))
    expect(res.headers.get('Location')).toBe('/admin/ads/settings?focus=csv')
  })

  it('sends /admin/ad-studio/live to /admin/ads/tree with a 302 and its query string', async () => {
    const bare = await liveLoader(get('https://xdipx.com/admin/ad-studio/live'))
    expect(bare.status).toBe(302)
    expect(bare.headers.get('Location')).toBe('/admin/ads/tree')

    const res = await liveLoader(get('https://xdipx.com/admin/ad-studio/live?view=all&lane=bridge&source=sample'))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/admin/ads/tree?view=all&lane=bridge&source=sample')
  })
})

describe('live actions stay reachable at /admin/ad-studio/live', () => {
  it('applies a rule action to a real creative', async () => {
    const res = await post({ intent: 'live-action', kind: 'pause', key: '17', ruleId: 'R1' })
    expect(res).toMatchObject({ ok: true, intent: 'live-action', eventId: 42, kind: 'pause' })
    expect(applyRuleAction).toHaveBeenCalledWith(17, 'pause', 'mike@xdipx.com', { ruleId: 'R1' })
  })

  it('records a sample row decision without touching the platform seam', async () => {
    expect(await post({ intent: 'live-action', kind: 'scale', key: 'sample:3' })).toMatchObject({ ok: true, eventId: 41 })
    expect(applyRuleAction).not.toHaveBeenCalled()
  })

  it('undoes an event', async () => {
    expect(await post({ intent: 'live-undo', eventId: '42' })).toMatchObject({ ok: true, message: 'Undone.' })
    expect(metrics.undoLiveAction).toHaveBeenCalledWith(42, 'mike@xdipx.com')
  })

  it('refuses an unknown creative or intent', async () => {
    expect(await post({ intent: 'live-action', kind: 'pause', key: 'abc' })).toMatchObject({ ok: false, error: 'Unknown creative.' })
    expect(await post({ intent: 'nope' })).toMatchObject({ ok: false, error: 'Unknown intent.' })
  })
})
