import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { data, redirect } from 'react-router'
import { requireCustomer, logoutCustomerSession } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { adminCustomerDelete } from '~/lib/shopify.server'
import { unsubscribeAll } from '~/lib/klaviyo.server'

/**
 * Resource route: POST /api/customer/delete
 *
 * Deletes the current customer's Shopify record (Admin API), unsubscribes them
 * from every Klaviyo list we know about, destroys their session cookie, and
 * redirects to /?deleted=1.
 *
 * NOTE: a future home page can surface the ?deleted=1 query param as a toast
 * ("Your account has been deleted ♥"). That UX is intentionally out of scope
 * for this phase.
 *
 * Gated behind tokenType === 'storefront' for now — see the inline comment
 * below for the reasoning.
 */

/**
 * Error response shape. Matches the `useFetcher<{ error?: string }>()`
 * contract in `_layout.account.profile.tsx`. Success doesn't have a body
 * because the action throws a redirect instead.
 */
type ActionResponse = { error: string }

// GET → send the browser back to /account/profile so an accidental direct-GET
// (e.g. someone pasting the URL) never triggers a destructive flow.
export async function loader(_args: LoaderFunctionArgs) {
  throw redirect('/account/profile')
}

export async function action({ request }: ActionFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)

  // Shop-login (Customer Account API) path is gated:
  //   - The Admin delete works on any customer record by GID,
  //   - BUT our current Account API getProfile() does NOT reliably return a
  //     customer GID or email. Klaviyo unsubscribe also needs the email.
  //   - Deleting without the email would leave the Klaviyo profile
  //     subscribed, which we want to avoid.
  //   - Cleaner to gate this behind storefront-login until Phase 7+.
  if (tokenType === 'account') {
    return data<ActionResponse>(
      {
        error:
          "Account deletion isn't available for Shop-login sessions yet. Sign in with email and password to delete your account.",
      },
      { status: 400 },
    )
  }

  const api = customerAPI({ token, tokenType })
  const profile = await api.getProfile()
  if (!profile) {
    return data<ActionResponse>(
      { error: 'Session expired — please sign in again.' },
      { status: 401 },
    )
  }

  // 1. Hard-delete from Shopify via Admin REST.
  try {
    await adminCustomerDelete(profile.id)
  } catch (err) {
    console.error('[api.customer.delete] adminCustomerDelete failed:', err)
    return data<ActionResponse>(
      { error: 'Account delete failed. Please contact support.' },
      { status: 500 },
    )
  }

  // 2. Unsubscribe from every known Klaviyo list — non-blocking; Shopify
  //    delete above is the source of truth for "account gone".
  try {
    await unsubscribeAll(profile.email)
  } catch (err) {
    console.error('[api.customer.delete] unsubscribeAll failed:', err)
  }

  // 3. Destroy the session cookie and redirect home.
  const headers = await logoutCustomerSession(request)
  throw redirect('/?deleted=1', { headers })
}
