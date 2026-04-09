import type { LoaderFunctionArgs } from 'react-router'
import { Outlet, redirect, useLoaderData } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import type { CustomerProfile } from '~/lib/shopify.server'
import { AccountShell } from '~/components/account/AccountShell'

/**
 * Outlet context shape exposed to every authenticated `/account/*` child
 * route. Phase 3+ pages (orders/addresses/profile/preferences/subscriptions)
 * should read their customer via `useOutletContext<AccountOutletContext>()`.
 */
export type AccountOutletContext = {
  customer: CustomerProfile
  tokenType: 'storefront' | 'account'
}

type ShellData =
  | { mode: 'auth' }
  | {
      mode: 'authenticated'
      customer: CustomerProfile
      tokenType: 'storefront' | 'account'
    }

// Paths that should bypass requireCustomer and render without the shell chrome.
const AUTH_EXACT = new Set([
  '/account/login',
  '/account/register',
  '/account/recover',
  '/account/logout',
])

const AUTH_PREFIXES = ['/account/reset/', '/account/activate/'] as const

function isAuthPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  return (
    AUTH_EXACT.has(normalized) ||
    AUTH_PREFIXES.some((p) => pathname.startsWith(p))
  )
}

export async function loader({ request }: LoaderFunctionArgs): Promise<ShellData> {
  const { pathname } = new URL(request.url)

  // Auth routes (login / register / recover / reset / activate / logout)
  // must NOT run requireCustomer and must NOT render the account shell —
  // they render inside the root `_layout.tsx` chrome as-is.
  if (isAuthPath(pathname)) {
    return { mode: 'auth' }
  }

  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })
  const customer = await api.getProfile()

  if (!customer) {
    // Token expired or revoked — boot back to login.
    throw redirect('/account/login')
  }

  return { mode: 'authenticated', customer, tokenType }
}

export default function AccountLayout() {
  const data = useLoaderData<typeof loader>()

  if (data.mode === 'auth') {
    // Render the auth child routes bare — no sidebar, no mobile header.
    // They provide their own centered card styling inside _layout.tsx.
    return (
      <div className="flex-1">
        <Outlet />
      </div>
    )
  }

  const context: AccountOutletContext = {
    customer: data.customer,
    tokenType: data.tokenType,
  }

  return (
    <AccountShell customer={data.customer}>
      <Outlet context={context} />
    </AccountShell>
  )
}
