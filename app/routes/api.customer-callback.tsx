/**
 * OAuth 2.0 callback from Shopify Customer Accounts (Shop login).
 * Shopify redirects here after the customer authenticates.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { getOAuthPending, clearOAuthPending, loginCustomerSession } from '~/lib/customer-session.server'
import { exchangeCodeForToken } from '~/lib/customer-oauth.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const url   = new URL(request.url)
  const code  = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    console.error('[customer-callback] OAuth error:', error, url.searchParams.get('error_description'))
    throw redirect('/account/login?error=shop_login_failed')
  }

  if (!code || !state) {
    throw redirect('/account/login?error=missing_params')
  }

  const pending = await getOAuthPending(request)
  if (!pending || pending.state !== state) {
    throw redirect('/account/login?error=invalid_state')
  }

  const redirectUri = new URL('/api/customer-callback', url.origin).toString()

  const { accessToken } = await exchangeCodeForToken(code, pending.codeVerifier, redirectUri)

  let headers = await loginCustomerSession(request, accessToken, 'account')
  headers = await clearOAuthPending(request, headers)

  throw redirect('/account', { headers })
}

export default function CustomerCallback() {
  return null
}
