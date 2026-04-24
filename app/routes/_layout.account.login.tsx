import type { ActionFunctionArgs, MetaFunction, LoaderFunctionArgs } from 'react-router'
import { Link, useLoaderData, useFetcher, useSearchParams, redirect } from 'react-router'
import { createCustomerAccessToken } from '~/lib/shopify.server'
import {
  loginCustomerSession,
  getCustomerToken,
  setOAuthPending,
  setSocialOAuthPending,
  safeRedirectTo,
} from '~/lib/customer-session.server'
import {
  SHOP_OAUTH_ENABLED,
  getShopLoginUrl,
  generateState,
  generateCodeVerifier,
} from '~/lib/customer-oauth.server'
import {
  GOOGLE_OAUTH_ENABLED,
  getGoogleLoginUrl,
  generateState as genState,
  generateCodeVerifier as genVerifier,
} from '~/lib/google-oauth.server'
import {
  FACEBOOK_OAUTH_ENABLED,
  getFacebookLoginUrl,
} from '~/lib/facebook-oauth.server'
import { getCartIdFromCookie, linkCartToCustomer } from '~/lib/cart.server'

export const meta: MetaFunction = () => [{ title: 'Sign in — xdipx' }]

/**
 * Combines a validated `redirectTo` with an optional `pendingVote` param,
 * producing a single safe path we can stash in the OAuth session or use
 * after email/password login. Returns null if `redirectTo` is unsafe.
 */
function buildPostLoginTarget(redirectTo: string | null, pendingVote: string | null): string | null {
  const safe = safeRedirectTo(redirectTo)
  if (!safe) return null
  if (pendingVote !== '1' && pendingVote !== '-1') return safe
  const sep = safe.includes('?') ? '&' : '?'
  return `${safe}${sep}pendingVote=${pendingVote}`
}

// Already logged in → follow redirectTo if present, else /account
export async function loader({ request }: LoaderFunctionArgs) {
  const url         = new URL(request.url)
  const redirectTo  = url.searchParams.get('redirectTo')
  const pendingVote = url.searchParams.get('pendingVote')
  const existing    = await getCustomerToken(request)
  if (existing) {
    const target = buildPostLoginTarget(redirectTo, pendingVote) ?? '/account'
    throw redirect(target)
  }
  return {
    shopOAuthEnabled:     SHOP_OAUTH_ENABLED,
    googleOAuthEnabled:   GOOGLE_OAUTH_ENABLED,
    facebookOAuthEnabled: FACEBOOK_OAUTH_ENABLED,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent') as string

  const redirectTo  = (form.get('redirectTo')  as string | null) ?? null
  const pendingVote = (form.get('pendingVote') as string | null) ?? null
  const postLogin   = buildPostLoginTarget(redirectTo, pendingVote)

  // ── Shop OAuth ───────────────────────────────────────────────────────────
  if (intent === 'shop-login') {
    if (!SHOP_OAUTH_ENABLED) return { error: 'Shop login is not configured.' }

    const state        = generateState()
    const codeVerifier = generateCodeVerifier()
    const redirectUri  = new URL('/api/customer-callback', new URL(request.url).origin).toString()
    const loginUrl     = await getShopLoginUrl(redirectUri, state, codeVerifier)

    const headers = await setOAuthPending(request, state, codeVerifier, postLogin)
    headers.set('Location', loginUrl)
    return new Response(null, { status: 302, headers })
  }

  // ── Google OAuth ─────────────────────────────────────────────────────────
  if (intent === 'google-login') {
    if (!GOOGLE_OAUTH_ENABLED) return { error: 'Google login is not configured.' }

    const state        = genState()
    const codeVerifier = genVerifier()
    const redirectUri  = new URL('/api/google-callback', new URL(request.url).origin).toString()
    const loginUrl     = await getGoogleLoginUrl(redirectUri, state, codeVerifier)

    const headers = await setSocialOAuthPending(request, state, codeVerifier, postLogin)
    headers.set('Location', loginUrl)
    return new Response(null, { status: 302, headers })
  }

  // ── Facebook OAuth ───────────────────────────────────────────────────────
  if (intent === 'facebook-login') {
    if (!FACEBOOK_OAUTH_ENABLED) return { error: 'Facebook login is not configured.' }

    const state       = genState()
    const redirectUri = new URL('/api/facebook-callback', new URL(request.url).origin).toString()
    const loginUrl    = getFacebookLoginUrl(redirectUri, state)

    const headers = await setSocialOAuthPending(request, state, undefined, postLogin)
    headers.set('Location', loginUrl)
    return new Response(null, { status: 302, headers })
  }

  // ── Email / password ─────────────────────────────────────────────────────
  const email    = (form.get('email')    as string).trim()
  const password = form.get('password')  as string

  if (!email || !password) return { error: 'Email and password are required.' }

  const result = await createCustomerAccessToken(email, password)

  if ('error' in result) return { error: result.error }

  const headers = await loginCustomerSession(request, result.accessToken, 'storefront')

  // Best-effort cart link — do NOT block the redirect on failure
  try {
    const cartId = getCartIdFromCookie(request)
    if (cartId) {
      await linkCartToCustomer(cartId, result.accessToken)
    }
  } catch (err) {
    console.error('[login] cart link failed:', err)
  }

  throw redirect(postLogin ?? '/account?from=login', { headers })
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  google_login_failed:   'Google sign-in failed. Please try again.',
  facebook_login_failed: 'Facebook sign-in failed. Please try again.',
  shop_login_failed:     'Shop sign-in failed. Please try again.',
}

export default function AccountLoginPage() {
  const { shopOAuthEnabled, googleOAuthEnabled, facebookOAuthEnabled } = useLoaderData<typeof loader>()
  const fetcher    = useFetcher<typeof action>()
  const isLoading  = fetcher.state !== 'idle'
  const [searchParams] = useSearchParams()

  const fetcherError = fetcher.data && 'error' in fetcher.data ? fetcher.data.error : null
  const oauthError = searchParams.get('error')
  const errorMessage =
    fetcherError ??
    (oauthError ? OAUTH_ERROR_MESSAGES[oauthError] ?? 'Sign-in failed. Please try again.' : null)

  const redirectToParam  = searchParams.get('redirectTo')  ?? ''
  const pendingVoteParam = searchParams.get('pendingVote') ?? ''

  const hasSocialButtons = shopOAuthEnabled || googleOAuthEnabled || facebookOAuthEnabled

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-black text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Welcome back ♥
          </h1>
          <p className="text-ink/60 mt-2 text-sm">Sign in to see your orders.</p>
        </div>

        {/* Shop accelerated login */}
        {shopOAuthEnabled && (
          <fetcher.Form method="post" className="mb-3">
            <input type="hidden" name="intent" value="shop-login" />
            <input type="hidden" name="redirectTo" value={redirectToParam} />
            <input type="hidden" name="pendingVote" value={pendingVoteParam} />
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 bg-[#5A31F4] hover:bg-[#4B25D6] text-white font-semibold py-3 px-4 rounded-full transition-colors disabled:opacity-60"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <ShopIcon />
              Continue with Shop
            </button>
          </fetcher.Form>
        )}

        {/* Google login */}
        {googleOAuthEnabled && (
          <fetcher.Form method="post" className="mb-3">
            <input type="hidden" name="intent" value="google-login" />
            <input type="hidden" name="redirectTo" value={redirectToParam} />
            <input type="hidden" name="pendingVote" value={pendingVoteParam} />
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 bg-white border border-cream-2 hover:bg-gray-50 text-ink font-semibold py-3 px-4 rounded-full transition-colors disabled:opacity-60"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <GoogleIcon />
              Continue with Google
            </button>
          </fetcher.Form>
        )}

        {/* Facebook login */}
        {facebookOAuthEnabled && (
          <fetcher.Form method="post" className="mb-3">
            <input type="hidden" name="intent" value="facebook-login" />
            <input type="hidden" name="redirectTo" value={redirectToParam} />
            <input type="hidden" name="pendingVote" value={pendingVoteParam} />
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 bg-[#1877F2] hover:bg-[#166FE5] text-white font-semibold py-3 px-4 rounded-full transition-colors disabled:opacity-60"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <FacebookIcon />
              Continue with Facebook
            </button>
          </fetcher.Form>
        )}

        {hasSocialButtons && (
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-cream-2" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-cream px-3 text-xs text-ink/40 uppercase tracking-widest">
                or
              </span>
            </div>
          </div>
        )}

        {/* Error */}
        {errorMessage && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {/* Email / password form */}
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="redirectTo" value={redirectToParam} />
          <input type="hidden" name="pendingVote" value={pendingVoteParam} />
          <div>
            <label className="block text-sm font-semibold text-ink mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full border border-cream-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sage/50"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink mb-1" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full border border-cream-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sage/50"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-coral text-white font-bold py-3 rounded-full hover:opacity-90 transition-opacity disabled:opacity-60"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </fetcher.Form>

        <p className="text-center text-xs text-ink/40 mt-6">
          Don't have an account?{' '}
          <Link to="/account/register" className="text-sage hover:underline">
            Create one
          </Link>
        </p>
        <p className="text-center text-xs text-ink/40 mt-2">
          <Link to="/account/recover" className="text-sage hover:underline">
            Forgot password?
          </Link>
        </p>
      </div>
    </div>
  )
}

function ShopIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect width="40" height="40" rx="8" fill="white" />
      <path
        d="M28.5 13.5c-.4-1.2-1.4-2-2.6-2h-1.4c-.2-1.7-1.6-3-3.3-3H18.8c-1.7 0-3.1 1.3-3.3 3h-1.4c-1.2 0-2.2.8-2.6 2L9 27.5c-.3 1 .5 2 1.5 2h19c1 0 1.8-1 1.5-2L28.5 13.5zm-9.7-3.5h1.4c.9 0 1.6.6 1.8 1.5H17c.2-.9.9-1.5 1.8-1.5z"
        fill="#5A31F4"
      />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.268h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
    </svg>
  )
}
