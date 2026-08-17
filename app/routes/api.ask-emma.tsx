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
import { pickWebPipelineVersion } from '~/lib/sms-v2/web-pipeline-flag.server'
import { getKillSwitch } from '~/lib/team.server'
import { VALVE_KEYS } from '~/lib/team-keys'
import { processWebMessageV2 } from '~/lib/sms-v2/adapters/web.server'
import { logWebFallbackTurn } from '~/lib/sms-v2/web-turn-logger.server'
import { Sentry } from '~/lib/sentry.server'
import { kvGet, kvSet } from '~/lib/kv.server'

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
  // Gated behind BOTID_BLOCK_ENABLED because the project-level BotID config
  // isn't onboarded yet (dashboard shows "Get Started"), so checkBotId()
  // returns isBot:true for real users. Until the dashboard is configured,
  // we run the check in shadow mode (log-only). Origin allowlist + IP rate
  // limit + daily token ceiling + per-session budget remain in front.
  if (process.env['NODE_ENV'] === 'production') {
    try {
      const verdict = await checkBotId()
      const shouldBlock = verdict.isBot && !verdict.isVerifiedBot
      if (shouldBlock && process.env['BOTID_BLOCK_ENABLED'] === 'true') {
        return Response.json({ error: 'bot_blocked' }, { status: 403 })
      }
      if (shouldBlock) {
        console.warn('[api.ask-emma] botid shadow-mode allow', { isBot: verdict.isBot, isVerifiedBot: verdict.isVerifiedBot })
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

  // 4.5. Owner kill switch (076): chat_enabled='false' in pipeline_settings
  // turns the widget's replies off instantly, no redeploy. Fail-open read —
  // a missing row or slow DB keeps chat live. Same friendly copy as the
  // budget nap; never a 5xx.
  if (!(await getKillSwitch(VALVE_KEYS.chatEnabled))) {
    return Response.json({ reply: NAP_REPLY, products: [], history: [] })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const body = (payload ?? {}) as { message?: unknown; history?: unknown; hidden?: unknown; pageContext?: unknown; sessionId?: unknown }
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

  // ADR-003 Sub-decision E (Part 2, server): if the HttpOnly session cookie was
  // lost during navigation in preview environments, the client sends back the
  // cookieId it persisted in localStorage as `sessionId` in the request body.
  // We inject it as a synthetic Cookie header so getOrCreateEmmaSession can find
  // the existing row instead of minting a new session every request.
  // Only used when the real cookie header is absent (defense-in-depth).
  const existingCookieHeader = request.headers.get('Cookie')
  const bodyCookieId = typeof body.sessionId === 'string' && body.sessionId.length > 0
    ? body.sessionId.trim()
    : null
  const requestForSession = (bodyCookieId && !existingCookieHeader?.includes('xdipx_emma_sid'))
    ? new Request(request.url, {
        headers: new Headers({
          ...Object.fromEntries(request.headers.entries()),
          Cookie: `xdipx_emma_sid=${encodeURIComponent(bodyCookieId)}${existingCookieHeader ? `; ${existingCookieHeader}` : ''}`,
        }),
        method: request.method,
      })
    : request

  let sessionHandle: Awaited<ReturnType<typeof getOrCreateEmmaSession>> | null = null
  try {
    sessionHandle = await getOrCreateEmmaSession(requestForSession)
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

  // 6. Version pick — uses the stable cookie UUID (cookieId) as the session key
  // for the web pipeline flag allowlist. All pre-flights above run regardless
  // of which version is picked.
  const emmaSessionCookieId = sessionHandle?.cookieId ?? `anon-${Date.now()}`

  // Fix 4: server-side double-submit dedup (defense-in-depth behind the client guard).
  // Key: sessionId + message + 1500ms bucket. TTL: 2s. If the key already exists,
  // the request is a duplicate — return a 202 stub so the client stays calm.
  // Failure is fail-open (KV down, bucket key unset) — we never block a real request.
  try {
    const bucket = Math.floor(Date.now() / 1500)
    const dedupeKey = `emma:dedup:${emmaSessionCookieId}:${bucket}:${message.slice(0, 80)}`
    const existing = await kvGet<1>(dedupeKey)
    if (existing) {
      // Duplicate in-flight — return empty 202 so the client's pending state
      // resolves cleanly without a second agent turn firing.
      const headers = new Headers()
      if (sessionHandle?.setCookieHeader) headers.append('Set-Cookie', sessionHandle.setCookieHeader)
      return Response.json({ reply: null, products: [], history: [] }, { status: 202, headers })
    }
    await kvSet(dedupeKey, 1, 2) // 2-second TTL
  } catch {
    // KV unavailable — fail open, let the request proceed.
  }
  const webPipelineVersion = pickWebPipelineVersion(emmaSessionCookieId)

  // Set when the v2 path is chosen but throws and we fall through to v1 (#3915).
  // The v1 block below stamps a distinguishable sms_turns.pipeline_version so
  // this silent-fallback rate is queryable, and the catch also raises a
  // Sentry-visible signal.
  let v2FellBack = false

  // --- v2 path ---
  if (webPipelineVersion === 'v2') {
    try {
      // Parse pageContext for v2: extract handle + route from pathname.
      const webPageContext = pageContext
        ? parseWebPageContext(pageContext.pathname)
        : undefined

      const v2History = history.map((t) => ({ role: t.role, text: t.text }))
      const v2Input: import('~/lib/sms-v2/adapters/web.server').ProcessWebInput = {
        sessionId: emmaSessionCookieId,
        customerText: message,
      }
      if (webPageContext !== undefined) v2Input.pageContext = webPageContext
      if (existingCartId !== null) v2Input.cartId = existingCartId
      const result = await processWebMessageV2(v2Input, v2History)

      const headers = new Headers()
      if (sessionHandle?.setCookieHeader) headers.append('Set-Cookie', sessionHandle.setCookieHeader)

      // When the checkout stage minted a fresh cart for a shopper with no
      // cart cookie, persist it here; without this the drawer opens empty
      // while the lines sit in an orphaned cart. cartUpdated still signals
      // the client to revalidate the cart loader.
      if (result.newCartId) headers.append('Set-Cookie', setCartCookie(result.newCartId))

      // ADR-003 Sub-decision E: include cookieId in the response so the client
      // can persist it to localStorage and send it back as a fallback on subsequent
      // requests if the HttpOnly cookie is lost during navigation.
      const { usage: _usage, newCartId: _newCartId, ...clientPayload } = result
      const v2Payload = sessionHandle?.cookieId
        ? { ...clientPayload, sessionId: sessionHandle.cookieId }
        : clientPayload
      return Response.json(v2Payload, { headers })
    } catch (err) {
      console.error('[api.ask-emma] v2 generate failed — falling through to v1', err)
      // A v2 failure that silently serves v1 makes a web cutover look healthy
      // while it is not. Raise a Sentry-visible signal tagged so the fallback
      // rate is alertable, then fall through to v1 (#3915).
      v2FellBack = true
      Sentry.captureException(err, { tags: { api: 'ask-emma', pipeline: 'v2-fallback-to-v1' } })
    }
  }

  // --- v1 path (default) ---
  try {
    const result = await generateChatReply(nextHistory, {
      channel: 'chat',
      cartId: existingCartId,
      // Pass the stable session key so the discovery gate can read/write its
      // state in web_conversations. Without it, priorDiscoveredSlots never
      // accumulates and the gate can force pills forever without ever searching.
      sessionId: emmaSessionCookieId,
      onCartCreated: (id: string) => {
        newCartId = id
      },
      ...(pageContext ? { pageContext } : {}),
    })
    const latencyMs = Date.now() - startedAt

    // Record actual token usage against session + global counters. Strip
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

    // #3915: when this v1 turn is a v2->v1 fallback (not a normal v1-assigned
    // session), stamp a distinguishable sms_turns.pipeline_version so the
    // fallback rate is queryable on the existing column. Fire-and-forget and
    // best-effort — never blocks or fails the reply.
    if (v2FellBack) {
      void logWebFallbackTurn({
        sessionId: emmaSessionCookieId,
        customerMsg: message,
        emmaMsg: result.reply,
        latencyMs,
      }).catch((err) => console.error('[api.ask-emma] fallback marker log failed', err))
    }

    const headers = new Headers()
    if (sessionHandle?.setCookieHeader) headers.append('Set-Cookie', sessionHandle.setCookieHeader)
    if (newCartId) headers.append('Set-Cookie', setCartCookie(newCartId))

    // ADR-003 Sub-decision E: include cookieId for session persistence defense.
    const { usage: _usage, ...clientPayload } = result
    const v1Payload = sessionHandle?.cookieId
      ? { ...clientPayload, sessionId: sessionHandle.cookieId }
      : clientPayload
    return Response.json(v1Payload, { headers })
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

/**
 * Parse a sanitized pathname into v2 web page context fields.
 * Examples:
 *   /products/lush-mini       → { handle: 'lush-mini', route: '/products/lush-mini' }
 *   /vault/lush-mini          → { handle: 'lush-mini', route: '/vault/lush-mini' }
 *   /for-her                  → { collection: 'for-her', route: '/for-her' }
 *   /                         → { route: '/' }
 */
function parseWebPageContext(
  pathname: string,
): { handle?: string; collection?: string; route?: string } {
  const ctx: { handle?: string; collection?: string; route?: string } = { route: pathname }

  const productMatch = pathname.match(/^\/products\/([^/]+)$/)
  if (productMatch?.[1]) {
    ctx.handle = productMatch[1]
    return ctx
  }

  const vaultMatch = pathname.match(/^\/vault\/([^/]+)$/)
  if (vaultMatch?.[1]) {
    ctx.handle = vaultMatch[1]
    return ctx
  }

  const collectionMatch = pathname.match(/^\/(for-him|for-her|vault)(?:\/)?$/)
  if (collectionMatch?.[1]) {
    ctx.collection = collectionMatch[1]
    return ctx
  }

  return ctx
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
