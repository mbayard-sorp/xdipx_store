/**
 * POST /api/emma-discovery-chat
 *
 * Accepts a user message, reads/sets the anonymous session cookie,
 * persists the message to emma_chat_messages, and returns { threadId, sessionId }.
 *
 * The client then opens an EventSource on
 * /api/emma-discovery-chat/stream/:threadId to receive the SSE stream.
 */
import type { ActionFunctionArgs } from 'react-router'
import { appendUserMessage } from '~/lib/emma-chat.server'
import { getOrCreatePublicThread } from '~/lib/emma-discovery-chat.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'

const COOKIE_NAME = 'xdipx_emma_sid'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90 // 90 days in seconds

const ALLOWED_ORIGINS = new Set([
  'https://xdipx.com',
  'https://www.xdipx.com',
])

function isAllowedOrigin(origin: string | null): boolean {
  if (process.env['NODE_ENV'] !== 'production') return true
  if (!origin) return false
  if (ALLOWED_ORIGINS.has(origin)) return true
  try {
    const host = new URL(origin).hostname
    return host.endsWith('.vercel.app') && host.includes('xdipx')
  } catch {
    return false
  }
}

function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('Cookie') ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key?.trim() === COOKIE_NAME) {
      const val = rest.join('=').trim()
      return val || null
    }
  }
  return null
}

function buildSetCookie(sessionId: string): string {
  return [
    `${COOKIE_NAME}=${sessionId}`,
    `Max-Age=${COOKIE_MAX_AGE}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    process.env['NODE_ENV'] === 'production' ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }

  if (!isAllowedOrigin(request.headers.get('origin'))) {
    return Response.json({ error: 'forbidden_origin' }, { status: 403 })
  }

  // IP rate limit: 60 req / 5 min in prod, generous in dev.
  const limit = process.env['NODE_ENV'] === 'production' ? 60 : 500
  const rl = await checkRateLimit(request, 'emma-discovery-chat', limit, 300)
  if (!rl.ok) return rateLimited()

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const body = (payload ?? {}) as { message?: unknown }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return Response.json({ error: 'empty_message' }, { status: 400 })
  if (message.length > 1000) {
    return Response.json({ error: 'message_too_long' }, { status: 400 })
  }

  // Read or mint the anonymous session id.
  let sessionId = readSessionCookie(request)
  let isNewSession = false
  if (!sessionId) {
    sessionId = crypto.randomUUID()
    isNewSession = true
  }

  // Find or create the discovery thread for this session.
  const { threadId } = await getOrCreatePublicThread(sessionId)

  // Persist the user message.
  await appendUserMessage(threadId, message)

  const headers = new Headers({ 'Content-Type': 'application/json' })
  // Rolling 90-day cookie: always refresh on activity.
  if (isNewSession) {
    headers.append('Set-Cookie', buildSetCookie(sessionId))
  }

  return new Response(
    JSON.stringify({ threadId, sessionId }),
    { status: 200, headers },
  )
}
