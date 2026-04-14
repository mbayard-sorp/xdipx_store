import { createCookieSessionStorage, redirect } from 'react-router'
import { eq } from 'drizzle-orm'
import { db } from './db.server'
import { adminRoles } from '../../db/schema'
import { neonAuthSignIn } from './neon-auth.server'
import { requireSecret } from './env.server'

const isProd = process.env['NODE_ENV'] === 'production'

const { getSession, commitSession, destroySession } = createCookieSessionStorage({
  cookie: {
    name: '__xdipx_admin',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secrets: [requireSecret('SESSION_SECRET')],
    secure: isProd,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
})

export { getSession, commitSession, destroySession }

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: number
  neonAuthUserId: string
  email: string
  name: string
  role: 'owner' | 'admin'
}

// ─── Auth Guard (signature unchanged — all call sites still work) ────────────

export async function requireAdmin(request: Request): Promise<void> {
  const session = await getSession(request.headers.get('Cookie'))
  if (!session.get('admin_user_id')) {
    throw redirect('/admin/login')
  }
}

// ─── Get Current Admin User (non-throwing) ───────────────────────────────────

export async function getAdminUser(request: Request): Promise<AdminUser | null> {
  const session = await getSession(request.headers.get('Cookie'))
  const id = session.get('admin_user_id')
  if (!id) return null
  return {
    id,
    neonAuthUserId: session.get('admin_neon_id') ?? '',
    email: session.get('admin_email') ?? '',
    name: session.get('admin_name') ?? '',
    role: session.get('admin_role') ?? 'admin',
  }
}

// ─── Require Owner Role ──────────────────────────────────────────────────────

export async function requireOwner(request: Request): Promise<AdminUser> {
  await requireAdmin(request)
  const user = await getAdminUser(request)
  if (!user || user.role !== 'owner') {
    throw redirect('/admin')
  }
  return user
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function loginAdmin(
  request: Request,
  email: string,
  password: string,
): Promise<Headers | null> {
  // 1. Authenticate with Neon Auth
  const neonUser = await neonAuthSignIn(email, password)
  if (!neonUser) return null

  // 2. Check admin_roles table for authorization
  const [role] = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.neonAuthUserId, neonUser.id))
    .limit(1)

  if (!role) return null // authenticated but not an admin

  // 3. Update last login
  await db
    .update(adminRoles)
    .set({ lastLoginAt: new Date() })
    .where(eq(adminRoles.id, role.id))

  // 4. Set session
  const session = await getSession(request.headers.get('Cookie'))
  session.set('admin_user_id', role.id)
  session.set('admin_neon_id', neonUser.id)
  session.set('admin_email', role.email)
  session.set('admin_name', role.name)
  session.set('admin_role', role.role)

  const headers = new Headers()
  headers.set('Set-Cookie', await commitSession(session))
  return headers
}

// ─── Logout ──────────────────────────────────────────────────────────────────

export async function logoutAdmin(request: Request): Promise<Headers> {
  const session = await getSession(request.headers.get('Cookie'))
  const headers = new Headers()
  headers.set('Set-Cookie', await destroySession(session))
  return headers
}
