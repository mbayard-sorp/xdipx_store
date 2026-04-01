import { parse as parseCookie, serialize as serializeCookie } from 'cookie'

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
