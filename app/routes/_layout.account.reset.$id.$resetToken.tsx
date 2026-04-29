import type { ActionFunctionArgs, MetaFunction, LoaderFunctionArgs } from 'react-router'
import { Link, useActionData, useFetcher, redirect } from 'react-router'
import { customerReset } from '~/lib/shopify.server'
import { getCustomerToken, loginCustomerSession } from '~/lib/customer-session.server'
import { getCartIdFromCookie, linkCartToCustomer } from '~/lib/cart.server'

export const meta: MetaFunction = () => [{ title: 'Reset password — xdipx' }, { name: 'robots', content: 'noindex, nofollow' }]

export async function loader({ request, params }: LoaderFunctionArgs) {
  const existing = await getCustomerToken(request)
  if (existing) throw redirect('/account')
  return {
    id:         params['id'] ?? '',
    resetToken: params['resetToken'] ?? '',
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const form            = await request.formData()
  const password        = (form.get('password')        as string) ?? ''
  const passwordConfirm = (form.get('passwordConfirm') as string) ?? ''

  if (!password || !passwordConfirm) {
    return { error: 'Please fill in both password fields.' }
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }
  if (password !== passwordConfirm) {
    return { error: 'Passwords do not match.' }
  }

  const id         = params['id'] ?? ''
  const resetToken = params['resetToken'] ?? ''

  if (!id || !resetToken) {
    return { error: 'This reset link is invalid or expired.' }
  }

  // Shopify expects the decoded customer GID
  const decodedId = decodeURIComponent(id)

  const result = await customerReset(decodedId, resetToken, password)
  if ('error' in result) return { error: result.error }

  const headers = await loginCustomerSession(request, result.accessToken, 'storefront')

  try {
    const cartId = getCartIdFromCookie(request)
    if (cartId) {
      await linkCartToCustomer(cartId, result.accessToken)
    }
  } catch (err) {
    console.error('[reset] cart link failed:', err)
  }

  throw redirect('/account', { headers })
}

export default function AccountResetPage() {
  const actionData = useActionData<typeof action>()
  const fetcher    = useFetcher()
  const isLoading  = fetcher.state !== 'idle'

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-black text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Choose a new password
          </h1>
          <p className="text-ink/60 mt-2 text-sm">
            Pick something you'll remember.
          </p>
        </div>

        {actionData && 'error' in actionData && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {actionData.error}
          </div>
        )}

        <fetcher.Form method="post" className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-ink mb-1" htmlFor="password">
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="w-full border border-cream-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sage/50"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink mb-1" htmlFor="passwordConfirm">
              Confirm new password
            </label>
            <input
              id="passwordConfirm"
              name="passwordConfirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="w-full border border-cream-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sage/50"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-coral text-white font-bold py-3 rounded-full hover:opacity-90 transition-opacity disabled:opacity-60"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {isLoading ? 'Resetting…' : 'Reset password'}
          </button>
        </fetcher.Form>

        <p className="text-center text-xs text-ink/40 mt-6">
          <Link to="/account/login" className="text-sage hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
