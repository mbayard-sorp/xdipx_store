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
 *
 * A page whose deal is a free gift carries no code (`code: null`). Shopify will
 * not put a second product discount on the line the gift's buy-X-get-Y already
 * uses, so GAWK10 read as not applicable on every kit cart (2026-11-20) and the
 * form was promising 10% it could not give. The form now reminds the visitor of
 * the gift instead, and the page shows it only while the gift is buyable. To go
 * back to a code, set `code` and the code's own terms and text line.
 */

import { parse as parseCookie, serialize as serializeCookie } from 'cookie'
import { GAWK_SALES_SLUG } from '~/lib/gawk-sales-page'

export interface ExitOffer {
  slug: string
  /** Null when the offer is the page's free gift: nothing goes on the cart or in a cookie. */
  code: string | null
  terms: string
  /** Klaviyo list for these signups. Separate so they skip the CURIOUS15 welcome series. */
  listId: string
  /** The welcome text. Keep the body under two GSM-7 segments with the longest name. */
  smsLine: string
}

const OFFERS: Record<string, ExitOffer> = {
  [GAWK_SALES_SLUG]: {
    slug: GAWK_SALES_SLUG,
    code: null,
    terms: 'A free 4 oz bottle of JO H2O water-based lube comes with your Gawk Gawk 3000. No code to enter. Standard US shipping stays free.',
    listId: 'TVq6Jz',
    smsLine: 'your Gawk Gawk 3000 comes with a free 4 oz bottle of JO H2O lube, no code needed. https://curious.xdipx.com/gawk-gawk-3000',
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
  if (!offer?.code) return null
  return parseCookie(request.headers.get('Cookie') ?? '')[COOKIE] === offer.code ? offer.code : null
}
