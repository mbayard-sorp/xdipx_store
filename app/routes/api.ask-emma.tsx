import type { ActionFunctionArgs } from 'react-router'
import { generateChatReply, type ChatTurn } from '~/lib/ai-agent/chat.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'
import { getOrCreateEmmaSession, logEmmaTurns } from '~/lib/emma-log.server'
import { getCartIdFromCookie, setCartCookie } from '~/lib/cart.server'

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }

  // Dev: generous cap so local testing doesn't hit the wall. Prod: 60 / 5 min / ip.
  const limit = process.env['NODE_ENV'] === 'production' ? 60 : 500
  const rl = await checkRateLimit(request, 'ask-emma', limit, 300)
  if (!rl.ok) return rateLimited()

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const body = (payload ?? {}) as { message?: unknown; history?: unknown; hidden?: unknown }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return Response.json({ error: 'empty_message' }, { status: 400 })
  if (message.length > 1000) {
    return Response.json({ error: 'message_too_long' }, { status: 400 })
  }
  const hidden = body.hidden === true

  const history = sanitizeHistory(body.history)
  const nextHistory: ChatTurn[] = [...history, { role: 'user', text: message }]

  const startedAt = Date.now()
  let sessionHandle: Awaited<ReturnType<typeof getOrCreateEmmaSession>> | null = null
  try {
    sessionHandle = await getOrCreateEmmaSession(request)
  } catch (err) {
    // Logging is best-effort — don't block the reply if Neon is unreachable.
    console.error('[api.ask-emma] session init failed', err)
  }

  const existingCartId = getCartIdFromCookie(request)
  let newCartId: string | null = null

  try {
    const result = await generateChatReply(nextHistory, {
      channel: 'chat',
      cartId: existingCartId,
      onCartCreated: (id: string) => {
        newCartId = id
      },
    })
    const latencyMs = Date.now() - startedAt

    if (sessionHandle) {
      try {
        await logEmmaTurns(sessionHandle.sessionId, [
          { role: 'user', text: message, hidden },
          {
            role: 'assistant',
            text: result.reply,
            products: result.products.map((p) => p.handle),
            quickReply: result.quickReply
              ? { question: result.quickReply.question, options: result.quickReply.options, mode: result.quickReply.mode }
              : null,
            latencyMs,
          },
        ])
      } catch (err) {
        console.error('[api.ask-emma] log turns failed', err)
      }
    }

    const headers = new Headers()
    if (sessionHandle?.setCookieHeader) headers.append('Set-Cookie', sessionHandle.setCookieHeader)
    if (newCartId) headers.append('Set-Cookie', setCartCookie(newCartId))
    return Response.json(result, { headers })
  } catch (err) {
    console.error('[api.ask-emma] generate failed', err)
    return Response.json(
      { error: 'agent_failed', reply: "Sorry — I hit a snag. Try that again?" },
      { status: 500 },
    )
  }
}

function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return []
  const out: ChatTurn[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = (item as { role?: unknown }).role
    const t = (item as { text?: unknown }).text
    if ((r === 'user' || r === 'assistant') && typeof t === 'string' && t.trim()) {
      out.push({ role: r, text: t.slice(0, 2000) })
    }
  }
  return out.slice(-24)
}
