/**
 * Stamp attribution onto a Shopify cart.
 *
 * Checkout happens on Shopify's domain, so cart attributes are the ONLY channel
 * that carries who-sent-this-shopper across the boundary. Shopify copies them
 * into the order's note_attributes, which is where the order webhook reads
 * _fbp / _fbc for the Meta CAPI Purchase, _ga_cid for the GA4 purchase, and the
 * utm/ref values for Klaviyo. Nothing is appended to checkoutUrl, so if these
 * attributes are missing the order is permanently unattributable.
 *
 * This lives here rather than inline in the cart route so every cart-creating
 * path can stamp attribution with one call. The reorder flow and the bundle
 * flow both created carts without it, which made those orders invisible to
 * every downstream analytics consumer.
 */
import {
  getFbCookies,
  getGaClientId,
  getStoredGoogleClickId,
  getStoredRefCode,
  getStoredUTM,
} from './attribution.server'
import { setCartAttributes, getCustomerProfile } from './shopify.server'
import { getCustomerToken } from './customer-session.server'

export interface CartAttr { key: string; value: string }

/**
 * Attribution cart attributes from the request's cookies: `_fbp`, `_fbc`,
 * `_ga_cid`, the `_utm_` set, and `_ref_code`. Only cookies that are actually
 * present produce an attribute, so this can return an empty array.
 */
export function attributionCartAttrs(request: Request): CartAttr[] {
  const { fbp, fbc } = getFbCookies(request)
  const gaCid = getGaClientId(request)
  const gclid = getStoredGoogleClickId(request)
  const utm = getStoredUTM(request)
  const refCode = getStoredRefCode(request)
  const attrs: CartAttr[] = []
  if (fbp) attrs.push({ key: '_fbp', value: fbp })
  if (fbc) attrs.push({ key: '_fbc', value: fbc })
  if (gaCid) attrs.push({ key: '_ga_cid', value: gaCid })
  // Google offline conversion import needs the id AND its type: gbraid/wbraid
  // upload in their own column, not as a gclid. Both ride to the order webhook.
  if (gclid) {
    attrs.push({ key: '_gclid', value: gclid.id })
    attrs.push({ key: '_gclid_type', value: gclid.type })
  }
  if (utm?.source)   attrs.push({ key: '_utm_source',   value: utm.source })
  if (utm?.medium)   attrs.push({ key: '_utm_medium',   value: utm.medium })
  if (utm?.campaign) attrs.push({ key: '_utm_campaign', value: utm.campaign })
  if (utm?.content)  attrs.push({ key: '_utm_content',  value: utm.content })
  if (refCode) attrs.push({ key: '_ref_code', value: refCode })
  return attrs
}

/**
 * The logged-in customer's own email, for account-holder checkouts only
 * (ticket #9329). Uses the same Customer Account API self-auth session
 * already used successfully for trackAddedToCart in api.cart.tsx — a
 * DIFFERENT access grant from the Admin API PII gate that empties
 * order.email/contact_email/customer.email for every order on this store's
 * Basic plan (server/webhooks.ts's PII note on handleOrderFulfilled). No new
 * PII is collected: this relays an email the customer already handed over by
 * authenticating into their own account. Guest checkouts are unaffected and
 * stay unattributable, as before. Never throws, same contract as
 * attributionCartAttrs.
 */
export async function customerEmailCartAttr(request: Request): Promise<CartAttr[]> {
  try {
    const token = await getCustomerToken(request)
    if (token?.tokenType !== 'storefront') return []
    const profile = await getCustomerProfile(token.token).catch(() => null)
    return profile?.email ? [{ key: '_customer_email', value: profile.email }] : []
  } catch {
    return []
  }
}

/**
 * Merge attribution (plus any caller-supplied extras, such as a discount tag)
 * onto a cart.
 *
 * Never throws: losing attribution must not cost the shopper their add to cart.
 * setCartAttributes merges rather than replaces, so calling this repeatedly
 * across a session accumulates rather than overwrites.
 */
export async function applyAttributionAttrs(
  cartId: string,
  request: Request,
  extra: CartAttr[] = [],
): Promise<void> {
  try {
    const attrs = [...attributionCartAttrs(request), ...(await customerEmailCartAttr(request)), ...extra]
    if (attrs.length === 0) return
    await setCartAttributes(cartId, attrs)
  } catch (err) {
    console.error('[attribution-cart] failed to stamp cart attributes', cartId, err)
  }
}
