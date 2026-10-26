import { describe, it, expect } from 'vitest'
import { buildShopUrl, buildStartUrl, getLeadFunnelPage, isLeadFunnelSlug, SMS_PENDING_NOTICE, validateLeadInput } from './lead-funnel'
import { LEAD_INTERESTS, LEAD_OFFER, getLeadInterest, isLeadInterest } from './lead-interests'
import { safeRedirectPath } from '~/routes/discount.$code'
import { bridgeSlugFromPath } from './bridge-host.server'

describe('lead interests', () => {
  it('has the seven owner-approved slugs, each routing to a site path', () => {
    expect(LEAD_INTERESTS.map(i => i.slug)).toEqual(['curious', 'hands-free', 'wands', 'for-two', 'back-door', 'for-him', 'play'])
    for (const i of LEAD_INTERESTS) expect(i.destination.startsWith('/')).toBe(true)
  })
  it('rejects unknown slugs', () => {
    expect(isLeadInterest('wands')).toBe(true)
    expect(isLeadInterest('nope')).toBe(false)
    expect(getLeadInterest(undefined)).toBeNull()
  })
  it('states the $30 minimum and the brand exclusions in the offer terms', () => {
    expect(LEAD_OFFER.terms).toContain('$30')
    expect(LEAD_OFFER.terms).toContain('Lovense')
    expect(LEAD_OFFER.terms).toContain('Playground')
    expect(LEAD_OFFER.terms).not.toMatch(/first order/i)
  })
})

describe('funnel pages', () => {
  it('serves hello, and its slug passes the bridge host path shape', () => {
    expect(isLeadFunnelSlug('hello')).toBe(true)
    expect(isLeadFunnelSlug('HELLO')).toBe(true)
    expect(isLeadFunnelSlug('about')).toBe(false)
    expect(bridgeSlugFromPath('/hello')).toBe('hello')
  })
  it('keeps the page copy free of em dashes and on the CTA whitelist', () => {
    const page = getLeadFunnelPage('hello')!
    expect(JSON.stringify(page)).not.toContain('—')
    const whitelist = ['Take a peek →', 'Show me', 'Find your fit →', "I'll take it ♥"]
    for (const cta of [page.doorAButton, page.doorBButton, page.successButton]) expect(whitelist).toContain(cta)
  })
})

describe('SMS_PENDING_NOTICE', () => {
  it('is calm support-register copy with no em dash and no urgency language', () => {
    expect(SMS_PENDING_NOTICE).not.toContain('—')
    expect(SMS_PENDING_NOTICE).not.toMatch(/\b(now|today only|hurry|limited)\b/i)
    expect(SMS_PENDING_NOTICE).toContain('YES')
  })
})

describe('validateLeadInput', () => {
  const base = { firstName: ' Sam ', email: 'Sam@Example.com ', interest: 'wands', slug: 'hello' }
  it('trims, lowercases the email, and keeps a valid interest', () => {
    const r = validateLeadInput(base)
    expect(r).toEqual({ ok: true, value: { firstName: 'Sam', email: 'sam@example.com', phone: '', smsConsent: false, interest: 'wands', slug: 'hello' } })
  })
  it('drops an unknown interest instead of failing', () => {
    const r = validateLeadInput({ ...base, interest: 'bogus' })
    expect(r.ok && r.value.interest).toBeNull()
  })
  it('requires a first name and a plausible email', () => {
    expect(validateLeadInput({ ...base, firstName: '' })).toEqual({ ok: false, error: 'first_name_required' })
    expect(validateLeadInput({ ...base, email: 'not-an-email' })).toEqual({ ok: false, error: 'invalid_email' })
  })
  it('needs a phone when SMS consent is ticked', () => {
    expect(validateLeadInput({ ...base, smsConsent: true })).toEqual({ ok: false, error: 'phone_required_for_sms' })
    const r = validateLeadInput({ ...base, smsConsent: true, phone: '602 555 0100' })
    expect(r.ok && r.value.smsConsent).toBe(true)
  })
})

describe('funnel links', () => {
  const utm = { source: 'meta', medium: 'paid', campaign: 'lead-test', content: 'xdipx-2026-10-17-34' }
  it('routes the shop link through /discount with the interest destination and UTMs', () => {
    const url = new URL(buildShopUrl('wands', utm, 'hello'))
    expect(url.origin).toBe('https://xdipx.com')
    expect(url.pathname).toBe(`/discount/${LEAD_OFFER.code}`)
    const target = url.searchParams.get('redirect')!
    expect(target.startsWith('/collections/wands?')).toBe(true)
    expect(target).toContain('utm_content=xdipx-2026-10-17-34')
    expect(safeRedirectPath(target)).toBe(target)
  })
  it('falls back to /start with default UTMs when nothing is known', () => {
    const target = new URL(buildShopUrl(null, {}, 'hello')).searchParams.get('redirect')!
    expect(target).toBe('/start?utm_source=curious&utm_medium=paid&utm_campaign=lead-hello')
  })
  it('sends Door B to /start with the pick and UTMs', () => {
    const url = new URL(buildStartUrl('for-two', utm, 'hello'))
    expect(url.pathname).toBe('/start')
    expect(url.searchParams.get('interest')).toBe('for-two')
    expect(url.searchParams.get('utm_source')).toBe('meta')
  })
})

describe('safeRedirectPath', () => {
  it('only allows same-site paths', () => {
    expect(safeRedirectPath('/collections/wands')).toBe('/collections/wands')
    expect(safeRedirectPath('https://evil.example')).toBe('/')
    expect(safeRedirectPath('//evil.example')).toBe('/')
    expect(safeRedirectPath('/\\evil.example')).toBe('/')
    expect(safeRedirectPath(null)).toBe('/')
  })
})
