import type { ActionFunctionArgs } from 'react-router'
import { checkBotId } from 'botid/server'
import { generateChatReply, type ChatTurn } from '~/lib/ai-agent/chat.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'
import { getOrCreateEmmaSession, logEmmaTurns } from '~/lib/emma-log.server'
import { getCartIdFromCookie, setCartCookie } from '~/lib/cart.server'
import {
  isWithinDailyCeiling,
  recordDailyUsage,
  recordSessionUsage,
  reserveSessionBudget,
} from '~/lib/emma-budget.server'

const ALLOWED_ORIGINS = new Set([
  'https://xdipx.com',
  'https://www.xdipx.com',
])

function isAllowedOrigin(origin: string | null): boolean {
  if (process.env['NODE_ENV'] !== 'production') return true
  if (!origin) return false
  if (ALLOWED_ORIGINS.has(origin)) return true
  // Allow Vercel preview deployments (xdipx-store-*.vercel.app)
  try {
    const host = new URL(origin).hostname
    return host.endsWith('.vercel.app') && host.includes('xdipx')
  } catch {
    return false
  }
}

const NAP_REPLY = "Emma's taking a quick nap. Try again in a bit ♥"
const SESSION_DONE_REPLY =
  "We've covered a lot today. Refresh to start a fresh chat with me ♥"

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }

  // 1. Origin check — kills lazy scrapers that don't bother forging headers.
  if (!isAllowedOrigin(request.headers.get('origin'))) {
    return Response.json({ error: 'forbidden_origin' }, { status: 403 })
  }

  // 2. Vercel BotID — invisible bot block at the request layer.
  if (process.env['NODE_ENV'] === 'production') {
    try {
      const verdict = await checkBotId()
      if (verdict.isBot && !verdict.isVerifiedBot) {
        return Response.json({ error: 'bot_blocked' }, { status: 403 })
      }
    } catch (err) {
      // Fail open on BotID infra errors — IP rate limit + budget are still in front.
      console.error('[api.ask-emma] botid check failed', err)
    }
  }

  // 3. IP-based rate limit (existing).
  const limit = process.env['NODE_ENV'] === 'production' ? 60 : 500
  const rl = await checkRateLimit(request, 'ask-emma', limit, 300)
  if (!rl.ok) return rateLimited()

  // 4. Global daily token ceiling — friendly nap response, no 5xx.
  if (!(await isWithinDailyCeiling())) {
    return Response.json({ reply: NAP_REPLY, products: [], history: [] })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const body = (payload ?? {}) as { message?: unknown; history?: unknown; hidden?: unknown; pageContext?: unknown }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return Response.json({ error: 'empty_message' }, { status: 400 })
  if (message.length > 1000) {
    return Response.json({ error: 'message_too_long' }, { status: 400 })
  }
  const hidden = body.hidden === true
  const pageContext = sanitizePageContext(body.pageContext)

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

  // 5. Per-session budget reservation. Without a session handle (Neon down) we
  // skip the per-session check and rely on IP rate limit + global ceiling.
  if (sessionHandle) {
    const reservation = await reserveSessionBudget(sessionHandle.sessionId)
    if (!reservation.ok) {
      const headers = new Headers()
      if (sessionHandle.setCookieHeader) headers.append('Set-Cookie', sessionHandle.setCookieHeader)
      return Response.json(
        { reply: SESSION_DONE_REPLY, products: [], history: nextHistory },
        { headers },
      )
    }
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
      ...(pageContext ? { pageContext } : {}),
    })
    const latencyMs = Date.now() - startedAt

    // 6. Record actual token usage against session + global counters. Strip
    // `usage` from the client payload — it's a server-side accounting field.
    if (result.usage) {
      const { inputTokens, outputTokens } = result.usage
      await Promise.all([
        sessionHandle ? recordSessionUsage(sessionHandle.sessionId, inputTokens, outputTokens) : Promise.resolve(),
        recordDailyUsage(inputTokens, outputTokens),
      ])
    }

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

    const { usage: _usage, ...clientPayload } = result
    return Response.json(clientPayload, { headers })
  } catch (err) {
    console.error('[api.ask-emma] generate failed', err)
    return Response.json(
      { error: 'agent_failed', reply: "Sorry — I hit a snag. Try that again?" },
      { status: 500 },
    )
  }
}

function sanitizePageContext(raw: unknown): { pathname: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const p = (raw as { pathname?: unknown }).pathname
  if (typeof p !== 'string') return undefined
  // Only accept same-origin paths. No query/hash — the path alone is enough
  // for Emma to pick up context, and stripping keeps the prompt deterministic.
  const clean = p.split('?')[0]?.split('#')[0]?.trim() ?? ''
  if (!clean.startsWith('/') || clean.length > 200) return undefined
  return { pathname: clean }
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
