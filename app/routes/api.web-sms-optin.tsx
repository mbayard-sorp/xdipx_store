/**
 * app/routes/api.web-sms-optin.tsx
 *
 * Ticket #3916. Opt-in "text me this, continue on SMS" beat for the web chat
 * widget. A visitor who explicitly types a phone number and checks the
 * consent box gets the same conversation continued by text — this is the
 * write path that finally populates web_conversations.customer_gid so
 * cross-channel.server.ts's handoff can resolve for a web-originated thread.
 *
 * No schema change: customer_gid already exists on both web_conversations
 * and sms_conversations (Phase 10). All the linking logic lives in
 * app/lib/sms-v2/web-sms-link.server.ts.
 */
import type { ActionFunctionArgs } from 'react-router'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'
import { rejectIfBot } from '~/lib/botid.server'
import { linkWebSessionToSms, normalizePhoneToE164 } from '~/lib/sms-v2/web-sms-link.server'

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

// Loader required so fetcher revalidation doesn't 404.
export async function loader() {
  return Response.json(null)
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }

  if (!isAllowedOrigin(request.headers.get('origin'))) {
    return Response.json({ error: 'forbidden_origin' }, { status: 403 })
  }

  const bot = await rejectIfBot()
  if (bot) return bot

  const rl = await checkRateLimit(request, 'web-sms-optin', 5, 3600)
  if (!rl.ok) return rateLimited()

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const body = (payload ?? {}) as { phone?: unknown; sessionId?: unknown; consent?: unknown }

  if (body.consent !== true) {
    return Response.json({ error: 'consent_required' }, { status: 400 })
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId || sessionId.length > 64) {
    return Response.json({ error: 'invalid_session' }, { status: 400 })
  }

  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  const phone = normalizePhoneToE164(rawPhone)
  if (!phone) {
    return Response.json({ error: 'invalid_phone' }, { status: 400 })
  }

  // Never reply with silence on a customer-facing send — a thrown error here
  // otherwise looks identical to a dropped request on the client, and the
  // visitor has no way to know whether to try again.
  try {
    const result = await linkWebSessionToSms({ sessionId, phone })
    if (!result.ok) {
      return Response.json(
        { ok: false, error: 'opted_out', reply: "That number's opted out of texts from us — I can't text it ♥" },
        { status: 200 },
      )
    }
    if (!result.sent) {
      return Response.json(
        { ok: false, error: 'send_failed', reply: "That text didn't want to go through just now. Mind trying again?" },
        { status: 200 },
      )
    }
    return Response.json({
      ok: true,
      alreadyConsented: result.alreadyConsented,
      reply: result.alreadyConsented
        ? "Sent ♥ Keep going any time by text."
        : "Sent ♥ Reply YES on your phone to keep the conversation going by text.",
    })
  } catch (err) {
    console.error('[api.web-sms-optin] link failed', err)
    return Response.json(
      { ok: false, error: 'server_error', reply: "Sorry — I hit a snag sending that. Try again?" },
      { status: 500 },
    )
  }
}
