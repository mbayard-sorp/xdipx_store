/**
 * `/discount/<code>?redirect=<path>` on xdipx.com: put an allowed discount
 * code on the visitor's cart, then send them on. The paid-lead funnel's
 * "Shop with your code" button lands here, so the code is already in the cart
 * when they reach checkout (Shopify's own /discount/ link only exists on the
 * Online Store theme, which this headless store does not run).
 *
 * Only codes in ALLOWED_CODES are applied, so this cannot be used to probe
 * arbitrary codes. `redirect` must be a same-site path. Failure never blocks
 * the visitor: they land on the destination either way and can type the code
 * at checkout.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { getCartIdFromCookie, setCartCookie } from '~/lib/cart.server'
import { LEAD_OFFER } from '~/lib/lead-interests'
import { applyCartDiscountCodes, createCart } from '~/lib/shopify.server'

const ALLOWED_CODES = new Set<string>([LEAD_OFFER.code])

/** A same-site path, or '/'. Rejects absolute and protocol-relative URLs. */
export function safeRedirectPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  return raw
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const code = (params['code'] ?? '').trim().toUpperCase()
  const target = safeRedirectPath(new URL(request.url).searchParams.get('redirect'))
  if (!ALLOWED_CODES.has(code)) return redirect(target)

  try {
    let cartId = getCartIdFromCookie(request)
    let cart = cartId ? await applyCartDiscountCodes(cartId, [code]) : null
    if (!cart) {
      cartId = (await createCart()).id
      cart = await applyCartDiscountCodes(cartId, [code])
    }
    if (cart) return redirect(target, { headers: { 'Set-Cookie': setCartCookie(cart.id) } })
  } catch (err) {
    console.error('[discount] could not apply code', code, err)
  }
  return redirect(target)
}
