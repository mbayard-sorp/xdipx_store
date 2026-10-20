/**
 * Ticket #16432: GET /admin/ads/approve, the digest's one-tap link.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 *
 * Both checks or nothing: a valid signature without an admin session is
 * refused, and an admin session with a bad signature is refused.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

const session = vi.hoisted(() => ({ signedIn: true }))
const requireAdminMock = vi.hoisted(() => vi.fn(async () => {
  if (!session.signedIn) {
    throw new Response(null, { status: 302, headers: { Location: '/admin/login' } })
  }
}))
const getAdminUserMock = vi.hoisted(() => vi.fn(async () => ({ id: 'u1', neonAuthUserId: '', email: 'mike@xdipx.com', name: 'Mike', role: 'owner' })))
vi.mock('~/lib/session.server', () => ({ requireAdmin: requireAdminMock, getAdminUser: getAdminUserMock }))

const approveActionMock = vi.hoisted(() => vi.fn(async (id: number) => ({ ok: true as const, id, status: 'approved' as const })))
vi.mock('~/lib/ads/actions-view.server', () => ({ approveAction: approveActionMock }))

import { loader } from '~/routes/admin.ads.approve'
import { buildApproveLink } from '~/lib/ads/approve-link.server'

const SECRET = 'route-test-secret'

function call(url: string) {
  return loader({ request: new Request(url), params: {}, context: {} } as unknown as Parameters<typeof loader>[0])
}

async function settle(p: Promise<unknown>): Promise<{ thrown: boolean; value: unknown }> {
  try {
    return { thrown: false, value: await p }
  } catch (value) {
    return { thrown: true, value }
  }
}

function statusOf(v: unknown): number | undefined {
  if (v instanceof Response) return v.status
  return (v as { init?: { status?: number } } | null)?.init?.status
}

describe('admin.ads.approve loader', () => {
  beforeEach(() => {
    process.env['CRON_SECRET'] = SECRET
    session.signedIn = true
    approveActionMock.mockClear()
    requireAdminMock.mockClear()
  })

  it('a valid link with an admin session approves through approveAction and redirects to the actions page', async () => {
    const link = buildApproveLink(7, { secret: SECRET, baseUrl: 'https://xdipx.com' })!
    const r = await settle(call(link))
    expect(r.thrown).toBe(true)
    const res = r.value as Response
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/admin/ads/actions?tab=applied')
    expect(approveActionMock).toHaveBeenCalledWith(7, 'mike@xdipx.com')
  })

  it('a valid signature without an admin session is refused and approves nothing', async () => {
    session.signedIn = false
    const link = buildApproveLink(7, { secret: SECRET, baseUrl: 'https://xdipx.com' })!
    const r = await settle(call(link))
    expect(r.thrown).toBe(true)
    expect((r.value as Response).headers.get('Location')).toBe('/admin/login')
    expect(approveActionMock).not.toHaveBeenCalled()
  })

  it('an admin session with a tampered signature is refused with a plain sentence', async () => {
    const link = buildApproveLink(7, { secret: SECRET, baseUrl: 'https://xdipx.com' })!.replace('id=7', 'id=8')
    const r = await settle(call(link))
    expect(r.thrown).toBe(false)
    expect(statusOf(r.value)).toBe(403)
    expect(JSON.stringify(r.value)).toMatch(/does not match its signature, so nothing was approved/)
    expect(approveActionMock).not.toHaveBeenCalled()
  })

  it('an admin session with an expired link is refused', async () => {
    const link = buildApproveLink(7, { secret: SECRET, baseUrl: 'https://xdipx.com', now: new Date(Date.now() - 25 * 3_600_000) })!
    const r = await settle(call(link))
    expect(statusOf(r.value)).toBe(403)
    expect(JSON.stringify(r.value)).toMatch(/more than a day old/)
    expect(approveActionMock).not.toHaveBeenCalled()
  })

  it('a row that can no longer be approved says why', async () => {
    approveActionMock.mockResolvedValueOnce({ ok: false, id: 7, code: 'expired', error: 'This action expired, so it can no longer be approved.' } as never)
    const link = buildApproveLink(7, { secret: SECRET, baseUrl: 'https://xdipx.com' })!
    const r = await settle(call(link))
    expect(statusOf(r.value)).toBe(409)
    expect(JSON.stringify(r.value)).toMatch(/can no longer be approved/)
  })
})
