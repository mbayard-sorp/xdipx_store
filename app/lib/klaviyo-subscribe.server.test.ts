/**
 * The subscription job endpoint rejects first_name and properties on its
 * profile objects (Klaviyo 400, "not a valid field for the resource
 * 'profile'"), which silently failed every attributed subscribe until the
 * 2026-10-18 lead-funnel audit. These tests pin the two-call shape: profile
 * fields through profile-import, identifiers only on the subscription job.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { path: string; body: Record<string, unknown> }

function mockFetch(): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ path: String(url).replace('https://a.klaviyo.com/api', ''), body: init?.body ? JSON.parse(String(init.body)) : {} })
    return new Response('', { status: 202 })
  }))
  return calls
}

const profileAttrsOf = (c: Call) =>
  ((c.body['data'] as { attributes: { profiles: { data: { attributes: Record<string, unknown> }[] } } }).attributes.profiles.data[0]!.attributes)

describe('Klaviyo subscribe helpers', () => {
  beforeEach(() => {
    process.env['KLAVIYO_API_KEY'] = 'test'
    process.env['KLAVIYO_LIST_ID_PAID_LEADS'] = 'LIST1'
    process.env['KLAVIYO_SMS_LIST_ID'] = 'SMS1'
  })
  afterEach(() => vi.unstubAllGlobals())

  it('subscribeLead writes name, phone and attribution via profile-import, then subscribes by identifier only', async () => {
    const calls = mockFetch()
    const { subscribeLead } = await import('./klaviyo.server')
    await subscribeLead({ email: 'a@b.co', firstName: 'Ann', phone: '+15555550100', properties: { interest: 'wands', utm_source: 'meta' } })

    expect(calls.map(c => c.path)).toEqual(['/profile-import/', '/profile-subscription-bulk-create-jobs/'])
    const imp = (calls[0]!.body['data'] as { attributes: Record<string, unknown> }).attributes
    expect(imp).toEqual({ email: 'a@b.co', phone_number: '+15555550100', first_name: 'Ann', properties: { interest: 'wands', utm_source: 'meta' } })
    const sub = profileAttrsOf(calls[1]!)
    expect(Object.keys(sub).sort()).toEqual(['email', 'phone_number', 'subscriptions'])
    expect(sub).not.toHaveProperty('first_name')
    expect(sub).not.toHaveProperty('properties')
    expect((calls[1]!.body['data'] as { relationships: { list: { data: { id: string } } } }).relationships.list.data.id).toBe('LIST1')
  })

  it('subscribeToList only imports when there is something beyond the email', async () => {
    const calls = mockFetch()
    const { subscribeToList } = await import('./klaviyo.server')
    await subscribeToList('L2', 'x@y.co')
    expect(calls.map(c => c.path)).toEqual(['/profile-subscription-bulk-create-jobs/'])
    await subscribeToList('L2', 'x@y.co', 'Xe', { signup_source: 'footer' })
    expect(calls.map(c => c.path)).toEqual(['/profile-subscription-bulk-create-jobs/', '/profile-import/', '/profile-subscription-bulk-create-jobs/'])
    expect(profileAttrsOf(calls[2]!)).not.toHaveProperty('properties')
  })

  it('subscribeToSms imports the consent properties, then subscribes the number with sms consent only', async () => {
    const calls = mockFetch()
    const { subscribeToSms } = await import('./sms-v2/klaviyo.server')
    const when = new Date('2026-10-18T18:00:00Z')
    await subscribeToSms('+15555550100', { source: 'curious-hello', consentTimestamp: when })
    expect(calls.map(c => c.path)).toEqual(['/profile-import/', '/profile-subscription-bulk-create-jobs/'])
    const imp = (calls[0]!.body['data'] as { attributes: Record<string, unknown> }).attributes
    expect(imp).toEqual({ phone_number: '+15555550100', properties: { sms_source: 'curious-hello', sms_consent_at: when.toISOString() } })
    const sub = profileAttrsOf(calls[1]!)
    expect(Object.keys(sub).sort()).toEqual(['phone_number', 'subscriptions'])
  })
})
