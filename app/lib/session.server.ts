import { createCookieSessionStorage, redirect } from 'react-router'

const { getSession, commitSession, destroySession } = createCookieSessionStorage({
  cookie: {
    name: '__xdipx_admin',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secrets: [process.env['SESSION_SECRET'] ?? 'dev-secret-change-me'],
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
})

export { getSession, commitSession, destroySession }

export async function requireAdmin(request: Request): Promise<void> {
  const session = await getSession(request.headers.get('Cookie'))
  if (!session.get('admin_authed')) {
    throw redirect('/admin/login')
  }
}

export async function loginAdmin(request: Request, password: string): Promise<Headers | null> {
  if (password !== process.env['ADMIN_PASSWORD']) return null
  const session = await getSession(request.headers.get('Cookie'))
  session.set('admin_authed', true)
  const headers = new Headers()
  headers.set('Set-Cookie', await commitSession(session))
  return headers
}

export async function logoutAdmin(request: Request): Promise<Headers> {
  const session = await getSession(request.headers.get('Cookie'))
  const headers = new Headers()
  headers.set('Set-Cookie', await destroySession(session))
  return headers
}
