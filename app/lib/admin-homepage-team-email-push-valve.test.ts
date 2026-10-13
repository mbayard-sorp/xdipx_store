/**
 * Ticket #15007: the owner had no control for `email_campaign_push_enabled`
 * at all — the key is read by klaviyo-campaigns.server.ts but nothing
 * rendered or allowlisted it, so the only way to flip it was a raw form post.
 *
 * Covers the action's write path (toggle -> the audited settings write, with
 * the key allowlisted). The loader's "missing row reads OFF" half of the
 * DONE WHEN needs no dedicated test: it reads `rows[0]?.value === 'true'`,
 * the exact same ON-value check `campaignPushEnabled()` makes (and that
 * function's own `campaignPushEnabled(null) === false` test in
 * klaviyo-campaigns.server.test.ts already proves this check reads a missing
 * value as OFF) — duplicated as a plain boolean expression rather than
 * imported so the loader never pulls that `.server.ts` module into the
 * client bundle (the route's own `EMAIL_CAMPAIGN_PUSH_VALVE` const explains
 * why). Same composition every other non-VALVE_KEYS boolean on this page
 * already uses (frame review, render review, end card), none with a
 * dedicated loader test either.
 *
 * Lives in app/lib rather than next to the route for the same reason as its
 * admin-* siblings: app/routes is picked up by flatRoutes/typegen as a route
 * module, tests included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))
const setPipelineSettingAuditedMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('~/lib/session.server', () => ({
  requireAdmin: requireAdminMock,
}))
vi.mock('~/lib/settings.server', () => ({
  setPipelineSettingAudited: setPipelineSettingAuditedMock,
}))

import { action } from '~/routes/admin.homepage-team'
// The literal key string, not imported from the route (a plain local const
// there, deliberately not re-exported — see its own comment) or from
// klaviyo-campaigns.server.ts (a .server.ts module this test file need not
// pull in just to assert against its own well-known key).
const EMAIL_CAMPAIGN_PUSH_VALVE = 'email_campaign_push_enabled'

function postForm(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields)
  return new Request('https://xdipx.com/admin/homepage-team', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

beforeEach(() => {
  requireAdminMock.mockClear()
  setPipelineSettingAuditedMock.mockClear()
})

describe('admin.homepage-team: email draft push valve toggle (ticket #15007)', () => {
  it('requires admin auth before writing', async () => {
    await action({ request: postForm({ intent: 'toggle', key: EMAIL_CAMPAIGN_PUSH_VALVE, next: 'true' }) } as never)
    expect(requireAdminMock).toHaveBeenCalledTimes(1)
  })

  it('writes the valve through the audited path with actor owner and this page as source', async () => {
    const res = await action({
      request: postForm({ intent: 'toggle', key: EMAIL_CAMPAIGN_PUSH_VALVE, next: 'true' }),
    } as never)
    expect(await (res as Response).json()).toEqual({ ok: true })
    expect(setPipelineSettingAuditedMock).toHaveBeenCalledWith(
      EMAIL_CAMPAIGN_PUSH_VALVE, 'true', 'owner', 'admin.homepage-team',
    )
  })

  it('turns the valve off the same way', async () => {
    await action({ request: postForm({ intent: 'toggle', key: EMAIL_CAMPAIGN_PUSH_VALVE, next: 'false' }) } as never)
    expect(setPipelineSettingAuditedMock).toHaveBeenCalledWith(
      EMAIL_CAMPAIGN_PUSH_VALVE, 'false', 'owner', 'admin.homepage-team',
    )
  })

  it('is on the write allowlist, not rejected as a bad key', async () => {
    const res = await action({
      request: postForm({ intent: 'toggle', key: EMAIL_CAMPAIGN_PUSH_VALVE, next: 'true' }),
    } as never)
    expect((res as Response).status).toBe(200)
  })
})
