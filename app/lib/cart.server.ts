import { parse as parseCookie, serialize as serializeCookie } from 'cookie'
import { cartBuyerIdentityUpdate } from './shopify.server'

const CART_COOKIE = '__xdipx_cart'

export function getCartIdFromCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie') ?? ''
  const cookies = parseCookie(cookieHeader)
  return cookies[CART_COOKIE] ?? null
}

export function setCartCookie(cartId: string): string {
  return serializeCookie(CART_COOKIE, cartId, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
}

export function clearCartCookie(): string {
  return serializeCookie(CART_COOKIE, '', {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 0,
  })
}

/**
 * Link (or unlink) a cart to a Shopify customer's buyer identity.
 * Pass token=null to strip customer from the cart on logout.
 * Silent on failure — never blocks login/logout.
 */
export async function linkCartToCustomer(
  cartId: string,
  token: string | null,
  opts: { email?: string | null; countryCode?: string | null } = {},
): Promise<void> {
  try {
    await cartBuyerIdentityUpdate(cartId, {
      customerAccessToken: token,
      email: opts.email ?? null,
      countryCode: opts.countryCode ?? null,
    })
  } catch (err) {
    console.error('[cart] linkCartToCustomer failed:', err)
  }
}
