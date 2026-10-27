/**
 * /api/lead under the lead SMS opt-in kill switch (owner blocker 731).
 *
 * The switch is on by default (the owner's Twilio number is A2P-registered
 * and a sender is being built), so the ON block pins today's behavior. With
 * the switch off, the two-door page renders no phone or SMS fields, and the
 * action must hold the same line against a client that sends them anyway:
 * no phone on the Klaviyo profile, no enrollLeadSms, no consent_log row, and
 * a stray smsConsent must not 400 the signup.
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
  enrollLeadSms: vi.fn(),
  normalizePhoneToE164: vi.fn(),
  isLeadSmsOptinEnabled: vi.fn(),
  recordLeadPostEvent: vi.fn(),
}))

vi.mock('~/lib/rate-limit.server', () => ({ checkRateLimit: mocks.checkRateLimit, rateLimited: mocks.rateLimited }))
vi.mock('~/lib/botid.server', () => ({ rejectIfBot: mocks.rejectIfBot }))
vi.mock('~/lib/attribution.server', () => ({ getStoredUTM: mocks.getStoredUTM }))
vi.mock('~/lib/consent.server', () => ({ logConsent: mocks.logConsent }))
vi.mock('~/lib/klaviyo.server', () => ({ subscribeLead: mocks.subscribeLead }))
vi.mock('~/lib/meta-capi.server', () => ({ sendCapiLead: mocks.sendCapiLead, leadEmailHashCookie: () => null }))
vi.mock('~/lib/lead-sms.server', () => ({ enrollLeadSms: mocks.enrollLeadSms }))
vi.mock('~/lib/sms-v2/web-sms-link.server', () => ({ normalizePhoneToE164: mocks.normalizePhoneToE164 }))
vi.mock('~/lib/lead-sms-optin.server', () => ({ isLeadSmsOptinEnabled: mocks.isLeadSmsOptinEnabled }))
vi.mock('~/lib/ads/health.server', () => ({ recordLeadPostEvent: mocks.recordLeadPostEvent }))

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
  mocks.enrollLeadSms.mockResolvedValue({ outcome: 'pending', id: 1, messageSid: 'SM1' })
  mocks.logConsent.mockResolvedValue(undefined)
  mocks.sendCapiLead.mockResolvedValue('evt-1')
  mocks.normalizePhoneToE164.mockReturnValue(PHONE)
  mocks.recordLeadPostEvent.mockResolvedValue(undefined)
})

afterEach(() => {
  if (ORIG_NODE_ENV === undefined) delete process.env['NODE_ENV']
  else process.env['NODE_ENV'] = ORIG_NODE_ENV
})

describe('/api/lead with lead SMS opt-in OFF (kill switch flipped)', () => {
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
    expect(mocks.enrollLeadSms).not.toHaveBeenCalled()
    expect(mocks.logConsent).not.toHaveBeenCalled()
    expect(mocks.sendCapiLead.mock.calls[0]![1]).toMatchObject({ phone: null })
    // One lead_post_event row for the hourly L3 counter.
    expect(mocks.recordLeadPostEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordLeadPostEvent.mock.calls[0]![0]).toMatchObject({ slug: 'hello' })
    expect(json.smsPending).toBe(false)
  })

  it('does not 400 a stray smsConsent without a phone', async () => {
    const res = await post({ ...lead, phone: '', smsConsent: true })
    expect(res.status).toBe(200)
    expect(mocks.enrollLeadSms).not.toHaveBeenCalled()
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
    // No subscribe, no lead: the L3 counter must not count it.
    expect(mocks.recordLeadPostEvent).not.toHaveBeenCalled()
  })
})

describe('/api/lead with lead SMS opt-in ON (default)', () => {
  beforeEach(() => mocks.isLeadSmsOptinEnabled.mockResolvedValue(true))

  it('enrolls the number in the Twilio double opt-in and logs consent when the box was ticked', async () => {
    const res = await post(lead)
    expect(res.status).toBe(200)
    expect(mocks.subscribeLead.mock.calls[0]![0]).toMatchObject({ phone: PHONE })
    expect(mocks.enrollLeadSms).toHaveBeenCalledTimes(1)
    expect(mocks.enrollLeadSms.mock.calls[0]![0]).toMatchObject({ phone: PHONE, email: 'ann@example.com', firstName: 'Ann', interest: 'wands', source: 'curious-hello' })
    expect(mocks.logConsent).toHaveBeenCalledTimes(1)
    expect(mocks.logConsent.mock.calls[0]![1]).toMatchObject({ consentType: 'all', policyVersion: 'lead-v1' })
  })

  it('reports smsPending true only when enrollLeadSms actually queued a confirmation text', async () => {
    const res = await post(lead)
    expect((await res.json()).smsPending).toBe(true)
  })

  it('reports smsPending false when the number was already opted out', async () => {
    mocks.enrollLeadSms.mockResolvedValue({ outcome: 'opted_out', id: 2 })
    const res = await post(lead)
    expect((await res.json()).smsPending).toBe(false)
  })

  it('reports smsPending false when enrollLeadSms throws', async () => {
    mocks.enrollLeadSms.mockRejectedValue(new Error('twilio down'))
    const res = await post(lead)
    expect(res.status).toBe(200)
    expect((await res.json()).smsPending).toBe(false)
  })

  it('keeps the phone on the profile but skips SMS when the box was not ticked', async () => {
    const res = await post({ ...lead, smsConsent: false })
    expect(res.status).toBe(200)
    expect(mocks.subscribeLead.mock.calls[0]![0]).toMatchObject({ phone: PHONE })
    expect(mocks.enrollLeadSms).not.toHaveBeenCalled()
    expect(mocks.logConsent).not.toHaveBeenCalled()
    expect((await res.json()).smsPending).toBe(false)
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

describe('lead SMS opt-in switch defaults', () => {
  it('env override: 0 forces off, 1 forces on, anything else defers to the valve', async () => {
    vi.doUnmock('~/lib/lead-sms-optin.server')
    vi.doMock('~/lib/team.server', () => ({
      getKillSwitch: vi.fn(async () => true),
      VALVE_KEYS: { leadSmsOptin: 'lead_sms_optin_enabled' },
    }))
    const { isLeadSmsOptinEnabled, leadSmsOptinEnvOverride } = await import('~/lib/lead-sms-optin.server')
    const orig = process.env['LEAD_SMS_OPTIN_ENABLED']
    try {
      process.env['LEAD_SMS_OPTIN_ENABLED'] = '0'
      expect(leadSmsOptinEnvOverride()).toBe(false)
      expect(await isLeadSmsOptinEnabled()).toBe(false)
      process.env['LEAD_SMS_OPTIN_ENABLED'] = '1'
      expect(await isLeadSmsOptinEnabled()).toBe(true)
      delete process.env['LEAD_SMS_OPTIN_ENABLED']
      expect(leadSmsOptinEnvOverride()).toBeNull()
      // Missing row reads as on through getKillSwitch (fail-open): the default is on.
      expect(await isLeadSmsOptinEnabled()).toBe(true)
    } finally {
      if (orig === undefined) delete process.env['LEAD_SMS_OPTIN_ENABLED']
      else process.env['LEAD_SMS_OPTIN_ENABLED'] = orig
      vi.doUnmock('~/lib/team.server')
    }
  })
})
