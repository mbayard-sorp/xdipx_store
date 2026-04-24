import type { ActionFunctionArgs } from 'react-router'
import { parse as parseCookie, serialize as serializeCookie } from 'cookie'
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { chatSessions } from '../../db/schema'
import { kvDel } from '~/lib/kv.server'

const SESSION_COOKIE = '__xdipx_chat'

export async function loader() {
  return Response.json(null)
}

export async function action({ request }: ActionFunctionArgs) {
  const cookies = parseCookie(request.headers.get('Cookie') ?? '')
  const sessionId = cookies[SESSION_COOKIE]

  if (sessionId) {
    try {
      await db
        .update(chatSessions)
        .set({ status: 'closed', closedAt: new Date() })
        .where(eq(chatSessions.id, sessionId))
    } catch (err) {
      console.warn('[chat.close] db update failed', err)
    }
    await kvDel(`chat:session:${sessionId}`).catch(() => {})
  }

  const clear = serializeCookie(SESSION_COOKIE, '', {
    httpOnly: true,
    path:     '/',
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   0,
  })

  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clear } })
}
