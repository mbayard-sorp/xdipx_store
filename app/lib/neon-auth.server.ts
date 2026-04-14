/**
 * Server-side helpers for Neon Auth REST API.
 * Write operations (sign-in, sign-up, password change) go through the REST API.
 * Read operations (list users) query neon_auth schema directly via SQL.
 */

import { neon } from '@neondatabase/serverless'

const NEON_AUTH_URL = () => {
  const url = process.env['NEON_AUTH_BASE_URL']
  if (!url) throw new Error('NEON_AUTH_BASE_URL is not set')
  return url.replace(/\/$/, '') // strip trailing slash
}

const ORIGIN = () =>
  process.env['SITE_URL'] ||
  (process.env['NODE_ENV'] === 'production' ? 'https://xdipx.com' : 'http://localhost:3000')

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Origin: ORIGIN(),
})

const sql = () => neon(process.env['DATABASE_URL']!)

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NeonAuthUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
  createdAt: string
}

interface SignInResponse {
  user: NeonAuthUser
  session: { token: string }
}

// ─── Sign In ─────────────────────────────────────────────────────────────────

export async function neonAuthSignIn(
  email: string,
  password: string,
): Promise<NeonAuthUser | null> {
  try {
    const res = await fetch(`${NEON_AUTH_URL()}/sign-in/email`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as SignInResponse
    return data.user ?? null
  } catch {
    return null
  }
}

// ─── Sign Up ─────────────────────────────────────────────────────────────────

export async function neonAuthSignUp(
  email: string,
  password: string,
  name: string,
): Promise<NeonAuthUser | null> {
  try {
    const res = await fetch(`${NEON_AUTH_URL()}/sign-up/email`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, password, name }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Neon Auth sign-up failed: ${err}`)
    }
    const data = (await res.json()) as SignInResponse
    return data.user ?? null
  } catch (e) {
    console.error('[neon-auth] sign-up error:', e)
    return null
  }
}

// ─── Change Password ─────────────────────────────────────────────────────────

export async function neonAuthChangePassword(
  currentPassword: string,
  newPassword: string,
  sessionToken: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${NEON_AUTH_URL()}/change-password`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        Cookie: `__Secure-neonauth.session_token=${sessionToken}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── List Neon Auth Users (direct SQL) ───────────────────────────────────────

export async function neonAuthListUsers(): Promise<NeonAuthUser[]> {
  try {
    const rows = await sql()`
      SELECT id, email, name, "emailVerified", "createdAt"
      FROM neon_auth."user"
      ORDER BY "createdAt" DESC
    `
    return rows as unknown as NeonAuthUser[]
  } catch (e) {
    console.error('[neon-auth] list users error:', e)
    return []
  }
}
