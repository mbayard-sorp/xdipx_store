/**
 * The paid-lead funnel's two-door pages on curious.xdipx.com (owner decision
 * 2026-10-18): one question ("What are you curious about?"), then Door A
 * (name, email, optional phone for the CURIOUS15 code) or Door B (just
 * looking, on to /start on xdipx.com).
 *
 * Pages live in code, keyed by slug, so the bridge host gate and the route
 * can recognise them without a Sanity round trip. The copy is a mainstream
 * paid-ad landing surface, so it runs at the Meta lane's register 3 to 4
 * (docs/ads-policy.md M3): what we are, the offer, no act names, no
 * pleasure-outcome claims. Client-safe: no server imports.
 */

import { LEAD_OFFER, getLeadInterest, type LeadInterestSlug } from '~/lib/lead-interests'

export const MAIN_SITE_ORIGIN = 'https://xdipx.com'
export const PRIVACY_URL = `${MAIN_SITE_ORIGIN}/pages/privacy-policy`

export interface LeadFunnelPage {
  slug: string
  headline: string
  intro: string
  question: string
  doorATitle: string
  doorAButton: string
  doorBTitle: string
  doorBButton: string
  successTitle: string
  successButton: string
}

const PAGES: Record<string, LeadFunnelPage> = {
  hello: {
    slug: 'hello',
    headline: 'Curious is a good place to *start*.',
    intro: 'xdipx is a curated sexual wellness store. Every order ships in a plain box, and your statement reads XDIPX.',
    question: 'What are you curious about?',
    doorATitle: 'Leave your email, get a code',
    doorAButton: 'Show me',
    doorBTitle: 'Just looking for now?',
    doorBButton: 'Take a peek →',
    successTitle: 'Your code is ready.',
    successButton: 'Find your fit →',
  },
}

export function getLeadFunnelPage(slug: string): LeadFunnelPage | null {
  return PAGES[slug.toLowerCase()] ?? null
}

export function isLeadFunnelSlug(slug: string): boolean {
  return getLeadFunnelPage(slug) !== null
}

export const SMS_CONSENT_TEXT =
  'Text me offers and picks from xdipx at this number. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help. Agreeing is not required to get the code or to buy.'

export const EMAIL_CONSENT_TEXT = 'You will get emails from xdipx. Unsubscribe anytime.'

/**
 * Shown on the success screen only when the visitor ticked the SMS box and
 * `/api/lead` actually enrolled them (`smsPending: true`). The discount code
 * is already on screen and in the Klaviyo email, so replying buys nothing
 * new; this just tells the visitor the text is real.
 */
export const SMS_PENDING_NOTICE =
  'We just sent a text from this number. Reply YES if you want texts. Skip it and your code and emails stay exactly as they are.'

export interface FunnelUtm {
  source?: string | null
  medium?: string | null
  campaign?: string | null
  content?: string | null
}

function utmQuery(utm: FunnelUtm, slug: string): string {
  const q = new URLSearchParams()
  q.set('utm_source', utm.source || 'curious')
  q.set('utm_medium', utm.medium || 'paid')
  q.set('utm_campaign', utm.campaign || `lead-${slug}`)
  if (utm.content) q.set('utm_content', utm.content)
  return q.toString()
}

/** Door B: the /start page on xdipx.com with the visitor's pick and the ad's UTMs. */
export function buildStartUrl(interest: LeadInterestSlug | null, utm: FunnelUtm, slug: string): string {
  const q = new URLSearchParams(utmQuery(utm, slug))
  if (interest) q.set('interest', interest)
  return `${MAIN_SITE_ORIGIN}/start?${q.toString()}`
}

/**
 * After signup: the interest's destination on xdipx.com, routed through
 * /discount/<code> so the code is already on the cart. Without an interest
 * it lands on /start so the visitor still gets the tiles.
 */
export function buildShopUrl(interest: LeadInterestSlug | null, utm: FunnelUtm, slug: string): string {
  const dest = getLeadInterest(interest)?.destination ?? '/start'
  const target = `${dest}?${utmQuery(utm, slug)}`
  return `${MAIN_SITE_ORIGIN}/discount/${LEAD_OFFER.code}?redirect=${encodeURIComponent(target)}`
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export interface LeadInput {
  firstName: string
  email: string
  phone: string
  smsConsent: boolean
  interest: LeadInterestSlug | null
  slug: string
}

export type LeadValidation = { ok: true; value: LeadInput } | { ok: false; error: string }

/** Shape and bounds checks. Phone normalisation happens server-side. */
export function validateLeadInput(raw: Record<string, unknown>): LeadValidation {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const firstName = str(raw['firstName'], 60)
  const email = str(raw['email'], 254).toLowerCase()
  const phone = str(raw['phone'], 32)
  const smsConsent = raw['smsConsent'] === true || raw['smsConsent'] === 'true' || raw['smsConsent'] === 'on'
  const interestRaw = str(raw['interest'], 32)
  const slug = str(raw['slug'], 60) || 'hello'

  if (!firstName) return { ok: false, error: 'first_name_required' }
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'invalid_email' }
  if (smsConsent && !phone) return { ok: false, error: 'phone_required_for_sms' }
  const interest = getLeadInterest(interestRaw)?.slug ?? null
  return { ok: true, value: { firstName, email, phone, smsConsent, interest, slug } }
}
