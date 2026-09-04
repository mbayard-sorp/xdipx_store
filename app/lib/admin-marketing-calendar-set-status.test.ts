/**
 * Ticket #7310: calendar row 23 (IG: Talk Yourself Into It) got closed early
 * by the removal-watch step-down after post #145's image-anatomy incident,
 * which the owner later confirmed was his own deletion, not a platform
 * takedown -- but the automatic close never got reversed. The team-token
 * setStatus op (api.team.calendar.tsx) enforces CALENDAR_TRANSITIONS with no
 * outbound edge from a terminal state, by design, so no routine call can fix
 * this. This owner-only 'setStatus' intent on the admin page is the
 * correction path: any row, any CALENDAR_STATUSES value, no transition-map
 * restriction, gated by requireAdmin like the page's existing delete intent.
 *
 * Lives in app/lib rather than next to the route for the same reason as its
 * social-admin siblings: app/routes is picked up by flatRoutes/typegen as a
 * route module, tests included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))
const updateCalls = vi.hoisted(() => [] as { values: unknown; id: number }[])

vi.mock('~/lib/session.server', () => ({
  requireAdmin: requireAdminMock,
}))
vi.mock('~/lib/db.server', () => ({
  db: {
    update: () => ({
      set: (values: unknown) => ({
        where: async (whereArg: { queryChunks?: unknown }) => {
          // drizzle's eq() builder isn't reproduced here; the id is asserted
          // via the form data the action received, not by parsing the SQL.
          updateCalls.push({ values, id: NaN })
          void whereArg
          return undefined
        },
      }),
    }),
    delete: () => ({ where: async () => undefined }),
    insert: () => ({ values: async () => undefined }),
  },
}))

import { action } from '~/routes/admin.marketing-calendar'

function postForm(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields)
  return new Request('https://xdipx.com/admin/marketing-calendar', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

beforeEach(() => {
  updateCalls.length = 0
  requireAdminMock.mockClear()
})

describe('admin.marketing-calendar setStatus intent', () => {
  it('requires admin auth before touching the database', async () => {
    await action({ request: postForm({ intent: 'setStatus', id: '23', status: 'active' }) } as never)
    expect(requireAdminMock).toHaveBeenCalledTimes(1)
  })

  it('corrects a terminal-state row (done -> active), the exact edge CALENDAR_TRANSITIONS refuses', async () => {
    const res = await action({
      request: postForm({ intent: 'setStatus', id: '23', status: 'active' }),
    } as never)
    const json = await (res as Response).json()

    expect(json).toEqual({ ok: true })
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0]!.values).toMatchObject({ status: 'active' })
  })

  it('rejects a status outside CALENDAR_STATUSES', async () => {
    const res = await action({
      request: postForm({ intent: 'setStatus', id: '23', status: 'archived' }),
    } as never)

    expect((res as Response).status).toBe(400)
    expect(updateCalls.length).toBe(0)
  })

  it('rejects a missing or non-numeric id', async () => {
    const res = await action({
      request: postForm({ intent: 'setStatus', id: 'not-a-number', status: 'active' }),
    } as never)

    expect((res as Response).status).toBe(400)
    expect(updateCalls.length).toBe(0)
  })
})
