/**
 * The "don't go yet" code on a sales page (owner direction 2026-11-01).
 *
 * Server-only on purpose. The Gawk sits at MAP, so the owner's rule is that the
 * page names no percent or price before signup: the code and its terms leave
 * the server only in the /api/lead response. Keeping them here also keeps them
 * out of the client bundle and the page source.
 *
 * A page's code is a real Shopify code limited to that page's product, and it
 * combines with the automatic Free Shipping discount, so the page's free
 * shipping claim holds. CURIOUS15 does not combine with it.
 */

import { parse as parseCookie, serialize as serializeCookie } from 'cookie'
import { GAWK_SALES_SLUG } from '~/lib/gawk-sales-page'

export interface ExitOffer {
  slug: string
  code: string
  terms: string
  /** Klaviyo list for these signups. Separate so they skip the CURIOUS15 welcome series. */
  listId: string
  /** The welcome text. Keep the body under two GSM-7 segments with the longest name. */
  smsLine: string
}

const OFFERS: Record<string, ExitOffer> = {
  [GAWK_SALES_SLUG]: {
    slug: GAWK_SALES_SLUG,
    code: 'GAWK10',
    terms: '10% off one Gawk Gawk 3000. One use per customer. Standard US shipping stays free.',
    listId: 'TVq6Jz',
    smsLine: 'your code GAWK10 takes 10% off the Gawk Gawk 3000, one use per customer. https://curious.xdipx.com/gawk-gawk-3000',
  },
}

export function getExitOffer(slug: string): ExitOffer | null {
  return OFFERS[slug.toLowerCase()] ?? null
}

/** `curious-<slug>`, the attribution source a lead row carries, back to its offer. */
export function exitOfferFromSource(source: string | null | undefined): ExitOffer | null {
  return source?.startsWith('curious-') ? getExitOffer(source.slice('curious-'.length)) : null
}

const COOKIE = 'xdipx_exit_code'

/** Every buy button on the page reads this, so they all work before hydration and on a return visit. */
export function setExitOfferCookie(code: string): string {
  return serializeCookie(COOKIE, code, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: 60 * 60 * 24 * 30,
  })
}

/** The code to put on this page's cart, only if the visitor claimed this page's own code. */
export function claimedExitCode(request: Request, slug: string): string | null {
  const offer = getExitOffer(slug)
  if (!offer) return null
  return parseCookie(request.headers.get('Cookie') ?? '')[COOKIE] === offer.code ? offer.code : null
}
