/**
 * app/lib/api-web-sms-optin-route.test.ts
 *
 * Ticket #3916 QA bounce: the `reply` strings the api.web-sms-optin route
 * sends back to the web chat widget are Emma-voice prose shown directly to
 * the customer, and two of them shipped with a banned em-dash (U+2014). This
 * test drives every `reply` branch through the real action and asserts none
 * of them contain one, mirroring the em-dash guard pattern in
 * app/lib/sms-v2/__tests__/upsell-voice-charter.test.ts.
 *
 * Lives in app/lib/, not app/routes/, so flatRoutes() doesn't try to treat
 * it as a route module (see app/lib/twilio-sms-route.test.ts for the same
 * convention).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const EM_DASH = '—'

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  rateLimited: vi.fn(),
  rejectIfBot: vi.fn(),
  linkWebSessionToSms: vi.fn(),
  normalizePhoneToE164: vi.fn(),
}))

vi.mock('~/lib/rate-limit.server', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimited: mocks.rateLimited,
}))
vi.mock('~/lib/botid.server', () => ({ rejectIfBot: mocks.rejectIfBot }))
vi.mock('~/lib/sms-v2/web-sms-link.server', () => ({
  linkWebSessionToSms: mocks.linkWebSessionToSms,
  normalizePhoneToE164: mocks.normalizePhoneToE164,
}))

import { action } from '~/routes/api.web-sms-optin'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('https://xdipx.com/api/web-sms-optin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://xdipx.com' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

const ORIG_NODE_ENV = process.env['NODE_ENV']

beforeEach(() => {
  process.env['NODE_ENV'] = 'production' // exercise the real origin check
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.rejectIfBot.mockResolvedValue(null)
  mocks.checkRateLimit.mockResolvedValue({ ok: true })
  mocks.normalizePhoneToE164.mockReturnValue('+15550001111')
})

afterEach(() => {
  if (ORIG_NODE_ENV === undefined) delete process.env['NODE_ENV']
  else process.env['NODE_ENV'] = ORIG_NODE_ENV
})

const validPayload = { phone: '555 000 1111', sessionId: 'sess-1', consent: true }

describe('api.web-sms-optin reply copy (#3916) — no em-dashes', () => {
  it('opted_out reply has no em-dash', async () => {
    mocks.linkWebSessionToSms.mockResolvedValue({ ok: false, reason: 'opted_out' })
    const res = await post(validPayload)
    const json = await res.json()
    expect(json.error).toBe('opted_out')
    expect(json.reply).not.toContain(EM_DASH)
  })

  it('send_failed reply has no em-dash', async () => {
    mocks.linkWebSessionToSms.mockResolvedValue({
      ok: true,
      sent: false,
      alreadyConsented: false,
      customerGidLinked: false,
    })
    const res = await post(validPayload)
    const json = await res.json()
    expect(json.error).toBe('send_failed')
    expect(json.reply).not.toContain(EM_DASH)
  })

  it('success reply (already consented) has no em-dash', async () => {
    mocks.linkWebSessionToSms.mockResolvedValue({
      ok: true,
      sent: true,
      alreadyConsented: true,
      customerGidLinked: true,
    })
    const res = await post(validPayload)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.reply).not.toContain(EM_DASH)
  })

  it('success reply (not yet consented) has no em-dash', async () => {
    mocks.linkWebSessionToSms.mockResolvedValue({
      ok: true,
      sent: true,
      alreadyConsented: false,
      customerGidLinked: false,
    })
    const res = await post(validPayload)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.reply).not.toContain(EM_DASH)
  })

  it('server_error reply (thrown error) has no em-dash', async () => {
    mocks.linkWebSessionToSms.mockRejectedValue(new Error('db down'))
    const res = await post(validPayload)
    const json = await res.json()
    expect(json.error).toBe('server_error')
    expect(json.reply).not.toContain(EM_DASH)
  })
})
