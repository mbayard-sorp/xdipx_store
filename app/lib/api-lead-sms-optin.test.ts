/**
 * /api/lead under the lead SMS opt-in switch (owner blocker 731).
 *
 * With the switch off, the two-door page renders no phone or SMS fields, and
 * the action must hold the same line against a client that sends them anyway:
 * no phone on the Klaviyo profile, no subscribeToSms, no consent_log row, and
 * a stray smsConsent must not 400 the signup. With the switch on, the
 * pre-switch behavior holds unchanged.
 *
 * Lives in app/lib/ so flatRoutes() does not treat it as a route module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  rateLimited: vi.fn(),
  rejectIfBot: vi.fn(),
  getStoredUTM: vi.fn(),
  logConsent: vi.fn(),
  subscribeLead: vi.fn(),
  sendCapiLead: vi.fn(),
  subscribeToSms: vi.fn(),
  normalizePhoneToE164: vi.fn(),
  isLeadSmsOptinEnabled: vi.fn(),
}))

vi.mock('~/lib/rate-limit.server', () => ({ checkRateLimit: mocks.checkRateLimit, rateLimited: mocks.rateLimited }))
vi.mock('~/lib/botid.server', () => ({ rejectIfBot: mocks.rejectIfBot }))
vi.mock('~/lib/attribution.server', () => ({ getStoredUTM: mocks.getStoredUTM }))
vi.mock('~/lib/consent.server', () => ({ logConsent: mocks.logConsent }))
vi.mock('~/lib/klaviyo.server', () => ({ subscribeLead: mocks.subscribeLead }))
vi.mock('~/lib/meta-capi.server', () => ({ sendCapiLead: mocks.sendCapiLead }))
vi.mock('~/lib/sms-v2/klaviyo.server', () => ({ subscribeToSms: mocks.subscribeToSms }))
vi.mock('~/lib/sms-v2/web-sms-link.server', () => ({ normalizePhoneToE164: mocks.normalizePhoneToE164 }))
vi.mock('~/lib/lead-sms-optin.server', () => ({ isLeadSmsOptinEnabled: mocks.isLeadSmsOptinEnabled }))

import { action } from '~/routes/api.lead'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('https://curious.xdipx.com/api/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://curious.xdipx.com' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

const ORIG_NODE_ENV = process.env['NODE_ENV']
const PHONE = '+15550001111'
const lead = { firstName: 'Ann', email: 'ann@example.com', phone: '555 000 1111', smsConsent: true, interest: 'wands', slug: 'hello' }

beforeEach(() => {
  process.env['NODE_ENV'] = 'production'
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.rejectIfBot.mockResolvedValue(null)
  mocks.checkRateLimit.mockResolvedValue({ ok: true })
  mocks.getStoredUTM.mockReturnValue(null)
  mocks.subscribeLead.mockResolvedValue(undefined)
  mocks.subscribeToSms.mockResolvedValue(undefined)
  mocks.logConsent.mockResolvedValue(undefined)
  mocks.sendCapiLead.mockResolvedValue('evt-1')
  mocks.normalizePhoneToE164.mockReturnValue(PHONE)
})

afterEach(() => {
  if (ORIG_NODE_ENV === undefined) delete process.env['NODE_ENV']
  else process.env['NODE_ENV'] = ORIG_NODE_ENV
})

describe('/api/lead with lead SMS opt-in OFF (default)', () => {
  beforeEach(() => mocks.isLeadSmsOptinEnabled.mockResolvedValue(false))

  it('drops phone and smsConsent even when the client sends both', async () => {
    const res = await post(lead)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.code).toBe('CURIOUS15')

    expect(mocks.subscribeLead).toHaveBeenCalledTimes(1)
    expect(mocks.subscribeLead.mock.calls[0]![0]).toMatchObject({ email: 'ann@example.com', firstName: 'Ann', phone: null })
    expect(mocks.normalizePhoneToE164).not.toHaveBeenCalled()
    expect(mocks.subscribeToSms).not.toHaveBeenCalled()
    expect(mocks.logConsent).not.toHaveBeenCalled()
    expect(mocks.sendCapiLead.mock.calls[0]![1]).toMatchObject({ phone: null })
  })

  it('does not 400 a stray smsConsent without a phone', async () => {
    const res = await post({ ...lead, phone: '', smsConsent: true })
    expect(res.status).toBe(200)
    expect(mocks.subscribeToSms).not.toHaveBeenCalled()
  })

  it('does not reject a malformed phone, because it never looks at it', async () => {
    mocks.normalizePhoneToE164.mockReturnValue(null)
    const res = await post({ ...lead, phone: 'not a number' })
    expect(res.status).toBe(200)
    expect(mocks.normalizePhoneToE164).not.toHaveBeenCalled()
  })

  it('keeps the email path as it was: Klaviyo failure is still the hard failure', async () => {
    mocks.subscribeLead.mockRejectedValue(new Error('klaviyo down'))
    const res = await post(lead)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('subscribe_failed')
  })
})

describe('/api/lead with lead SMS opt-in ON', () => {
  beforeEach(() => mocks.isLeadSmsOptinEnabled.mockResolvedValue(true))

  it('subscribes SMS and logs consent when the box was ticked', async () => {
    const res = await post(lead)
    expect(res.status).toBe(200)
    expect(mocks.subscribeLead.mock.calls[0]![0]).toMatchObject({ phone: PHONE })
    expect(mocks.subscribeToSms).toHaveBeenCalledTimes(1)
    expect(mocks.subscribeToSms.mock.calls[0]![0]).toBe(PHONE)
    expect(mocks.subscribeToSms.mock.calls[0]![1]).toMatchObject({ source: 'curious-hello' })
    expect(mocks.logConsent).toHaveBeenCalledTimes(1)
    expect(mocks.logConsent.mock.calls[0]![1]).toMatchObject({ consentType: 'all', policyVersion: 'lead-v1' })
  })

  it('keeps the phone on the profile but skips SMS when the box was not ticked', async () => {
    const res = await post({ ...lead, smsConsent: false })
    expect(res.status).toBe(200)
    expect(mocks.subscribeLead.mock.calls[0]![0]).toMatchObject({ phone: PHONE })
    expect(mocks.subscribeToSms).not.toHaveBeenCalled()
    expect(mocks.logConsent).not.toHaveBeenCalled()
  })

  it('still 400s smsConsent without a phone, and a phone that will not normalise', async () => {
    expect((await post({ ...lead, phone: '' })).status).toBe(400)
    expect((await (await post({ ...lead, phone: '' })).json()).error).toBe('phone_required_for_sms')
    mocks.normalizePhoneToE164.mockReturnValue(null)
    const bad = await post(lead)
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('invalid_phone')
  })
})
