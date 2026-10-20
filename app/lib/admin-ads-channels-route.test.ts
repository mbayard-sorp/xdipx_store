/**
 * Ticket #16438: the /admin/ads/channels loader and action.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 *
 * The session module is the real one, so the auth check here is the same
 * cookie check production runs. Only the database is stubbed, and the
 * checklist write is a spy, so the test proves which requests can reach it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))

const toggleMock = vi.hoisted(() => vi.fn(async () => ({})))
const loadMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/ads/channels-page.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/ads/channels-page.server')>('~/lib/ads/channels-page.server')
  return { ...actual, toggleChecklistItem: toggleMock, loadChannels: loadMock }
})

import { action, loader } from '~/routes/admin.ads.channels'
import { commitSession, getSession } from '~/lib/session.server'
import { ChecklistInputError } from '~/lib/ads/channels-page.server'
import { listChannels } from '~/lib/ads/channels/registry.server'

type ActionArgs = Parameters<typeof action>[0]
type LoaderArgs = Parameters<typeof loader>[0]

async function adminCookie(): Promise<string> {
  const session = await getSession(null)
  session.set('admin_user_id', 7)
  session.set('admin_email', 'mike@xdipx.com')
  session.set('admin_role', 'owner')
  return (await commitSession(session)).split(';')[0]!
}

function post(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request('https://xdipx.com/admin/ads/channels', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  })
}

const TOGGLE = { intent: 'toggle-check', channel: 'meta', item: 'spend_cap', checked: 'on', evidence: '$20 a day' }

async function thrown(p: Promise<unknown>): Promise<Response> {
  try {
    await p
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
  throw new Error('expected a thrown Response')
}

function body(r: unknown): { data: unknown; init: { status?: number } | null } {
  return r as { data: unknown; init: { status?: number } | null }
}

beforeEach(() => {
  toggleMock.mockReset()
  toggleMock.mockResolvedValue({})
  loadMock.mockReset()
})

describe('admin.ads.channels loader', () => {
  it('redirects to login without an admin session', async () => {
    const res = await thrown(loader({ request: new Request('https://xdipx.com/admin/ads/channels'), params: {}, context: {} } as unknown as LoaderArgs))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/admin/login')
    expect(loadMock).not.toHaveBeenCalled()
  })

  it('returns every channel with prohibited ones carrying no checklist', async () => {
    const actual = await vi.importActual<typeof import('~/lib/ads/channels-page.server')>('~/lib/ads/channels-page.server')
    loadMock.mockImplementation(() => actual.loadChannels({
      channels: listChannels,
      health: async () => [],
      lastEntitySync: async () => [],
      lastInsightsPull: async () => [],
      checklist: async () => [],
    }))
    const request = new Request('https://xdipx.com/admin/ads/channels', { headers: { Cookie: await adminCookie() } })
    const { page, now } = await loader({ request, params: {}, context: {} } as unknown as LoaderArgs)
    expect(typeof now).toBe('string')
    expect(page.channels.length).toBe(listChannels().length)
    const x = page.channels.find(c => c.id === 'x')!
    expect(x.checklist).toBeNull()
    expect(x.mutate.reasons).toEqual(['policy: prohibited, no adapter'])
  })
})

describe('admin.ads.channels action', () => {
  it('refuses a request with no session', async () => {
    const res = await thrown(action({ request: post(TOGGLE) } as unknown as ActionArgs))
    expect(res.status).toBe(302)
    expect(toggleMock).not.toHaveBeenCalled()
  })

  it('refuses a team-token request: a bearer token is not an admin session', async () => {
    const res = await thrown(action({ request: post(TOGGLE, { Authorization: 'Bearer some-team-or-cron-token' }) } as unknown as ActionArgs))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/admin/login')
    expect(toggleMock).not.toHaveBeenCalled()
  })

  it('refuses a forged cookie', async () => {
    const res = await thrown(action({ request: post(TOGGLE, { Cookie: '__xdipx_admin=eyJhZG1pbl91c2VyX2lkIjo3fQ%3D%3D.forged' }) } as unknown as ActionArgs))
    expect(res.status).toBe(302)
    expect(toggleMock).not.toHaveBeenCalled()
  })

  it('writes for an admin session, stamped with the admin', async () => {
    const r = body(await action({ request: post(TOGGLE, { Cookie: await adminCookie() }) } as unknown as ActionArgs))
    expect(toggleMock).toHaveBeenCalledWith('meta', 'spend_cap', true, 'admin:mike@xdipx.com', '$20 a day')
    expect(r.data).toEqual({ ok: true, channel: 'meta', item: 'spend_cap', checked: true })
  })

  it('passes an unchecked box as false', async () => {
    const { checked: _c, ...unchecked } = TOGGLE
    await action({ request: post(unchecked, { Cookie: await adminCookie() }) } as unknown as ActionArgs)
    expect(toggleMock).toHaveBeenCalledWith('meta', 'spend_cap', false, 'admin:mike@xdipx.com', '$20 a day')
  })

  it('answers 400 with the message when the input is refused', async () => {
    toggleMock.mockRejectedValueOnce(new ChecklistInputError('Write down the evidence before checking this item.'))
    const r = body(await action({ request: post({ ...TOGGLE, evidence: '' }, { Cookie: await adminCookie() }) } as unknown as ActionArgs))
    expect(r.init?.status).toBe(400)
    expect(r.data).toMatchObject({ ok: false, error: 'Write down the evidence before checking this item.' })
  })

  it('answers 400 for an unknown intent without writing', async () => {
    const r = body(await action({ request: post({ ...TOGGLE, intent: 'enable-mutate' }, { Cookie: await adminCookie() }) } as unknown as ActionArgs))
    expect(r.init?.status).toBe(400)
    expect(toggleMock).not.toHaveBeenCalled()
  })
})
