import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import {
  getSocialOAuthPending,
  clearSocialOAuthPending,
  loginCustomerSession,
} from '~/lib/customer-session.server'
import { exchangeGoogleCode } from '~/lib/google-oauth.server'
import { loginWithSocialIdentity } from '~/lib/shopify.server'
import { getCartIdFromCookie, linkCartToCustomer } from '~/lib/cart.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const url   = new URL(request.url)
  const code  = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) throw redirect('/account/login?error=google_login_failed')
  if (!code || !state) throw redirect('/account/login?error=google_login_failed')

  const pending = await getSocialOAuthPending(request)
  if (!pending || pending.state !== state || !pending.codeVerifier) {
    throw redirect('/account/login?error=google_login_failed')
  }

  const redirectUri = new URL('/api/google-callback', url.origin).toString()

  let identity: { email: string; firstName: string; lastName: string; sub: string }
  try {
    identity = await exchangeGoogleCode(code, pending.codeVerifier, redirectUri)
  } catch (err) {
    console.error('[google-callback] exchange failed:', err)
    throw redirect('/account/login?error=google_login_failed')
  }

  const result = await loginWithSocialIdentity({
    email:      identity.email,
    firstName:  identity.firstName,
    lastName:   identity.lastName,
    provider:   'google',
    providerId: identity.sub,
  })

  if ('error' in result) {
    console.error('[google-callback] shopify login failed:', result.error)
    throw redirect('/account/login?error=google_login_failed')
  }

  let headers = await loginCustomerSession(request, result.accessToken, 'storefront')
  headers = await clearSocialOAuthPending(request, headers)

  try {
    const cartId = getCartIdFromCookie(request)
    if (cartId) await linkCartToCustomer(cartId, result.accessToken, { email: identity.email })
  } catch (err) {
    console.error('[google-callback] cart link failed:', err)
  }

  throw redirect(pending.redirectTo ?? '/account', { headers })
}

export default function GoogleCallback() { return null }
