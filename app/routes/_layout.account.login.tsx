import type { ActionFunctionArgs, MetaFunction, LoaderFunctionArgs } from 'react-router'
import { useActionData, useLoaderData, useFetcher, redirect } from 'react-router'
import { createCustomerAccessToken } from '~/lib/shopify.server'
import {
  loginCustomerSession,
  getCustomerToken,
  setOAuthPending,
} from '~/lib/customer-session.server'
import {
  SHOP_OAUTH_ENABLED,
  getShopLoginUrl,
  generateState,
  generateCodeVerifier,
} from '~/lib/customer-oauth.server'

export const meta: MetaFunction = () => [{ title: 'Sign in — xdipx' }]

// Already logged in → go to account
export async function loader({ request }: LoaderFunctionArgs) {
  const existing = await getCustomerToken(request)
  if (existing) throw redirect('/account')
  // Pass as loader data so client never imports the server module directly
  return { shopOAuthEnabled: SHOP_OAUTH_ENABLED }
}

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent') as string

  // ── Shop OAuth: redirect to Shopify's login ──────────────────────────────
  if (intent === 'shop-login') {
    if (!SHOP_OAUTH_ENABLED) return { error: 'Shop login is not configured.' }

    const state        = generateState()
    const codeVerifier = generateCodeVerifier()
    const redirectUri  = new URL('/api/customer-callback', new URL(request.url).origin).toString()
    const loginUrl     = await getShopLoginUrl(redirectUri, state, codeVerifier)

    const headers = await setOAuthPending(request, state, codeVerifier)
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
  throw redirect('/account', { headers })
}

export default function AccountLoginPage() {
  const { shopOAuthEnabled } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const fetcher    = useFetcher()
  const isLoading  = fetcher.state !== 'idle'

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-black text-brand-charcoal"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Welcome back ♥
          </h1>
          <p className="text-brand-charcoal/60 mt-2 text-sm">Sign in to see your orders.</p>
        </div>

        {/* Shop accelerated login */}
        {shopOAuthEnabled && (
          <>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="shop-login" />
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

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-brand-mist" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-brand-cream px-3 text-xs text-brand-charcoal/40 uppercase tracking-widest">
                  or
                </span>
              </div>
            </div>
          </>
        )}

        {/* Error from action */}
        {actionData && 'error' in actionData && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {actionData.error}
          </div>
        )}

        {/* Email / password form */}
        <fetcher.Form method="post" className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-brand-charcoal mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full border border-brand-mist rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-brand-charcoal mb-1" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full border border-brand-mist rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-brand-gradient text-white font-bold py-3 rounded-full hover:opacity-90 transition-opacity disabled:opacity-60"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </fetcher.Form>

        <p className="text-center text-xs text-brand-charcoal/40 mt-6">
          Don't have an account?{' '}
          <a
            href={`https://${process.env['SHOPIFY_STORE_DOMAIN'] ?? ''}/account/register`}
            className="text-brand-purple hover:underline"
          >
            Create one at checkout
          </a>
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
