import { createCookieSessionStorage, redirect } from 'react-router'

const { getSession, commitSession, destroySession } = createCookieSessionStorage({
  cookie: {
    name: '__xdipx_customer',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secrets: [process.env['SESSION_SECRET'] ?? 'dev-secret-change-me'],
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
})

export { getSession, commitSession, destroySession }

/** Returns the stored customer access token, or null if not logged in. */
export async function getCustomerToken(request: Request): Promise<{
  token: string
  tokenType: 'storefront' | 'account'
} | null> {
  const session = await getSession(request.headers.get('Cookie'))
  const token = session.get('customerAccessToken') as string | undefined
  const tokenType = (session.get('tokenType') as 'storefront' | 'account') ?? 'storefront'
  if (!token) return null
  return { token, tokenType }
}

/** Throws a redirect to /account/login if the customer is not logged in. */
export async function requireCustomer(request: Request): Promise<{
  token: string
  tokenType: 'storefront' | 'account'
}> {
  const customer = await getCustomerToken(request)
  if (!customer) throw redirect('/account/login')
  return customer
}

/** Builds Set-Cookie headers that log the customer in. */
export async function loginCustomerSession(
  request: Request,
  token: string,
  tokenType: 'storefront' | 'account' = 'storefront',
): Promise<Headers> {
  const session = await getSession(request.headers.get('Cookie'))
  session.set('customerAccessToken', token)
  session.set('tokenType', tokenType)
  const headers = new Headers()
  headers.set('Set-Cookie', await commitSession(session))
  return headers
}

/** Builds Set-Cookie headers that log the customer out. */
export async function logoutCustomerSession(request: Request): Promise<Headers> {
  const session = await getSession(request.headers.get('Cookie'))
  const headers = new Headers()
  headers.set('Set-Cookie', await destroySession(session))
  return headers
}

// ── OAuth PKCE helpers (used during Shop login flow) ──────────────────────────

export async function setOAuthPending(
  request: Request,
  state: string,
  codeVerifier: string,
): Promise<Headers> {
  const session = await getSession(request.headers.get('Cookie'))
  session.set('oauthState', state)
  session.set('oauthCodeVerifier', codeVerifier)
  const headers = new Headers()
  headers.set('Set-Cookie', await commitSession(session))
  return headers
}

export async function getOAuthPending(request: Request): Promise<{
  state: string
  codeVerifier: string
} | null> {
  const session = await getSession(request.headers.get('Cookie'))
  const state = session.get('oauthState') as string | undefined
  const codeVerifier = session.get('oauthCodeVerifier') as string | undefined
  if (!state || !codeVerifier) return null
  return { state, codeVerifier }
}

export async function clearOAuthPending(request: Request, baseHeaders?: Headers): Promise<Headers> {
  const session = await getSession(request.headers.get('Cookie'))
  session.unset('oauthState')
  session.unset('oauthCodeVerifier')
  const headers = baseHeaders ?? new Headers()
  headers.set('Set-Cookie', await commitSession(session))
  return headers
}

/** Returns true if the customer cookie exists (for navbar — no token validation). */
export async function isCustomerLoggedIn(request: Request): Promise<boolean> {
  const session = await getSession(request.headers.get('Cookie'))
  return !!session.get('customerAccessToken')
}
