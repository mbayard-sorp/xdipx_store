import type { ActionFunctionArgs, MetaFunction, LoaderFunctionArgs } from 'react-router'
import { Link, useActionData, useFetcher, redirect } from 'react-router'
import { customerRecover } from '~/lib/shopify.server'
import { getCustomerToken } from '~/lib/customer-session.server'

export const meta: MetaFunction = () => [{ title: 'Reset password — xdipx' }, { name: 'robots', content: 'noindex, nofollow' }]

// Already logged in → go to account
export async function loader({ request }: LoaderFunctionArgs) {
  const existing = await getCustomerToken(request)
  if (existing) throw redirect('/account')
  return null
}

export async function action({ request }: ActionFunctionArgs) {
  const form  = await request.formData()
  const email = ((form.get('email') as string) ?? '').trim()

  if (!email) return { error: 'Email is required.' }

  // Always returns { ok: true } — prevents account enumeration
  await customerRecover(email)
  return { sent: true as const }
}

export default function AccountRecoverPage() {
  const actionData = useActionData<typeof action>()
  const fetcher    = useFetcher()
  const isLoading  = fetcher.state !== 'idle'

  const sent = actionData && 'sent' in actionData && actionData.sent

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-black text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Reset your password
          </h1>
          <p className="text-ink/60 mt-2 text-sm">
            Enter your email and we'll send you a link.
          </p>
        </div>

        {sent ? (
          <div className="rounded-2xl border border-coral/30 bg-cream px-6 py-6 text-center">
            <h2
              className="text-xl font-black text-ink mb-2"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Check your email ♥
            </h2>
            <p className="text-sm text-ink/70">
              If an account exists for that email, we just sent a reset link. It should arrive
              within a couple minutes.
            </p>
            <p className="text-center text-xs text-ink/40 mt-6">
              <Link to="/account/login" className="text-sage hover:underline">
                Back to sign in
              </Link>
            </p>
          </div>
        ) : (
          <>
            {/* Error from action */}
            {actionData && 'error' in actionData && (
              <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {actionData.error}
              </div>
            )}

            <fetcher.Form method="post" className="space-y-4">
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

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-coral text-white font-bold py-3 rounded-full hover:opacity-90 transition-opacity disabled:opacity-60"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {isLoading ? 'Sending…' : 'Send reset link'}
              </button>
            </fetcher.Form>

            <p className="text-center text-xs text-ink/40 mt-6">
              <Link to="/account/login" className="text-sage hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
