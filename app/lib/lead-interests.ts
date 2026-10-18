/**
 * The paid-lead funnel's interest list (owner decision 2026-10-18).
 *
 * One list, shared by the two-door page on curious.xdipx.com (the "What are
 * you curious about?" chips), the `/start` landing page tiles, the
 * `/api/lead` endpoint (stored as the Klaviyo profile property `interest`)
 * and the welcome series segments. Slugs are stored on profiles, so treat
 * them as permanent: rename a label freely, never a slug.
 *
 * Destinations are xdipx.com paths. Every collection handle here was a
 * published collection on 2026-10-18.
 */

export type LeadInterestSlug =
  | 'curious'
  | 'hands-free'
  | 'wands'
  | 'for-two'
  | 'back-door'
  | 'for-him'
  | 'play'

export interface LeadInterest {
  slug: LeadInterestSlug
  label: string
  /** Path on xdipx.com this interest routes to. */
  destination: string
}

export const LEAD_INTERESTS: readonly LeadInterest[] = [
  { slug: 'curious', label: 'New and curious', destination: '/collections/first-time' },
  { slug: 'hands-free', label: 'Hands-free and suction', destination: '/collections/suction-air-pulse' },
  { slug: 'wands', label: 'Wands', destination: '/collections/wands' },
  { slug: 'for-two', label: 'For two, near or far', destination: '/collections/couples-vibrators' },
  { slug: 'back-door', label: 'Exploring the back door', destination: '/collections/anal' },
  { slug: 'for-him', label: 'For him', destination: '/collections/for-him' },
  { slug: 'play', label: 'Games and play', destination: '/collections/games-romance' },
]

const BY_SLUG = new Map<string, LeadInterest>(LEAD_INTERESTS.map(i => [i.slug, i]))

export function isLeadInterest(v: unknown): v is LeadInterestSlug {
  return typeof v === 'string' && BY_SLUG.has(v)
}

export function getLeadInterest(v: unknown): LeadInterest | null {
  return isLeadInterest(v) ? BY_SLUG.get(v)! : null
}

/** The paid-lead code and its terms. Every surface that offers it states the terms. */
export const LEAD_OFFER = {
  code: 'CURIOUS15',
  percentOff: 15,
  minimumSubtotal: 30,
  terms: '15% off your order of $30 or more. One use per customer. Excludes Lovense and Playground.',
} as const
