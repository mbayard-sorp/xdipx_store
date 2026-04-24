import { createCookieSessionStorage, redirect } from 'react-router'
import { requireSecret } from './env.server'

const { getSession, commitSession, destroySession } = createCookieSessionStorage({
  cookie: {
    name: '__xdipx_customer',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secrets: [requireSecret('SESSION_SECRET')],
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

/**
 * Re-issues the customer cookie with a new access token.
 * Used after customerUpdate rotates the token (email or password change).
 */
export async function refreshCustomerSession(
  request: Request,
  newToken: string,
  tokenType: 'storefront' | 'account' = 'storefront',
): Promise<Headers> {
  const session = await getSession(request.headers.get('Cookie'))
  session.set('customerAccessToken', newToken)
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

// ── Redirect-target safety ────────────────────────────────────────────────────

/**
 * Returns `candidate` if it's a safe same-origin path, else null.
 * Rejects protocol-relative URLs (`//evil.com`), absolute URLs
 * (`http://...`), and backslash tricks (`/\evil.com`) to prevent open
 * redirects after login.
 */
export function safeRedirectTo(candidate: string | null | undefined): string | null {
  if (!candidate) return null
  if (typeof candidate !== 'string') return null
  if (!candidate.startsWith('/')) return null
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return null
  // Extra guard: reject any control character or embedded scheme
  if (/[\x00-\x1f]/.test(candidate)) return null
  return candidate
}

// ── OAuth PKCE helpers (used during Shop login flow) ──────────────────────────

export async function setOAuthPending(
  request: Request,
  state: string,
  codeVerifier: string,
  redirectTo?: string | null,
): Promise<Headers> {
  const session = await getSession(request.headers.get('Cookie'))
  session.set('oauthState', state)
  session.set('oauthCodeVerifier', codeVerifier)
  const safe = safeRedirectTo(redirectTo)
  if (safe) session.set('oauthRedirectTo', safe)
  else      session.unset('oauthRedirectTo')
  const headers = new Headers()
  headers.set('Set-Cookie', await commitSession(session))
  return headers
}

export async function getOAuthPending(request: Request): Promise<{
  state: string
  codeVerifier: string
  redirectTo: string | null
} | null> {
  const session = await getSession(request.headers.get('Cookie'))
  const state = session.get('oauthState') as string | undefined
  const codeVerifier = session.get('oauthCodeVerifier') as string | undefined
  if (!state || !codeVerifier) return null
  const redirectTo = safeRedirectTo(session.get('oauthRedirectTo') as string | undefined)
  return { state, codeVerifier, redirectTo }
}

export async function clearOAuthPending(request: Request, baseHeaders?: Headers): Promise<Headers> {
  const session = await getSession(request.headers.get('Cookie'))
  session.unset('oauthState')
  session.unset('oauthCodeVerifier')
  session.unset('oauthRedirectTo')
  const headers = baseHeaders ?? new Headers()
  headers.set('Set-Cookie', await commitSession(session))
  return headers
}

/** Returns true if the customer cookie exists (for navbar — no token validation). */
export async function isCustomerLoggedIn(request: Request): Promise<boolean> {
  const session = await getSession(request.headers.get('Cookie'))
  return !!session.get('customerAccessToken')
}

// ── Social OAuth helpers (Google / Facebook) ──────────────────────────────────

export async function setSocialOAuthPending(
  request: Request,
  state: string,
  codeVerifier?: string,
  redirectTo?: string | null,
): Promise<Headers> {
  const session = await getSession(request.headers.get('Cookie'))
  session.set('socialOAuthState', state)
  if (codeVerifier) session.set('socialOAuthCodeVerifier', codeVerifier)
  else session.unset('socialOAuthCodeVerifier')
  const safe = safeRedirectTo(redirectTo)
  if (safe) session.set('socialOAuthRedirectTo', safe)
  else      session.unset('socialOAuthRedirectTo')
  const headers = new Headers()
  headers.set('Set-Cookie', await commitSession(session))
  return headers
}

export async function getSocialOAuthPending(request: Request): Promise<{
  state: string
  codeVerifier: string | null
  redirectTo: string | null
} | null> {
  const session = await getSession(request.headers.get('Cookie'))
  const state = session.get('socialOAuthState') as string | undefined
  if (!state) return null
  const codeVerifier = (session.get('socialOAuthCodeVerifier') as string | undefined) ?? null
  const redirectTo   = safeRedirectTo(session.get('socialOAuthRedirectTo') as string | undefined)
  return { state, codeVerifier, redirectTo }
}

export async function clearSocialOAuthPending(request: Request, baseHeaders?: Headers): Promise<Headers> {
  const session = await getSession(request.headers.get('Cookie'))
  session.unset('socialOAuthState')
  session.unset('socialOAuthCodeVerifier')
  session.unset('socialOAuthRedirectTo')
  const headers = baseHeaders ?? new Headers()
  headers.set('Set-Cookie', await commitSession(session))
  return headers
}
