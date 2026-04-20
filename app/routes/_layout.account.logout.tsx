import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { logoutCustomerSession } from '~/lib/customer-session.server'
import { getCartIdFromCookie, linkCartToCustomer } from '~/lib/cart.server'

// GET /account/logout — just redirect home
export async function loader({ request }: LoaderFunctionArgs) {
  // Strip the customer from the cart BEFORE destroying the session cookie,
  // so the next sign-in doesn't inherit a stale buyerIdentity link.
  try {
    const cartId = getCartIdFromCookie(request)
    if (cartId) {
      await linkCartToCustomer(cartId, null)
    }
  } catch (err) {
    console.error('[logout] cart unlink failed:', err)
  }

  const headers = await logoutCustomerSession(request)
  throw redirect('/?from=logout', { headers })
}

export default function Logout() {
  return null
}
