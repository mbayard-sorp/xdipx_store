import { createHash, randomUUID } from 'node:crypto'
import { getMarketingConsent } from './consent.server'
import { getFbCookies, getClientIPOrNull } from './attribution.server'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapiUserData {
  client_ip_address?: string | undefined
  client_user_agent?: string | undefined
  fbp?: string | null
  fbc?: string | null
  /** SHA-256 hashed email. Only populated when consentGranted = true. */
  em?: string | undefined
}

export interface CapiCustomData {
  content_ids: string[]
  content_type: 'product'
  value: number
  currency: string
  num_items?: number
}

export interface CapiEvent {
  event_name: 'ViewContent' | 'AddToCart' | 'Purchase'
  event_id: string
  event_time: number
  action_source: 'website'
  user_data: CapiUserData
  custom_data: CapiCustomData
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function generateEventId(): string {
  return randomUUID()
}

export function hashPII(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

// ─── Fire-and-forget helper ───────────────────────────────────────────────────

/**
 * Convenience wrapper for the common fire-and-forget CAPI pattern.
 *
 * Generates a dedup event id, reads consent/fbp/fbc/ip from the request,
 * fires sendCapiEvent as a void (never blocks the loader), and returns the
 * eventId so the browser pixel can use the same id for Meta-side dedup.
 *
 * Covers ViewContent and AddToCart. For Purchase (requires retry) call
 * sendCapiEvent directly.
 */
export function fireCapiEvent(
  request: Request,
  eventName: 'ViewContent' | 'AddToCart',
  opts: {
    contentIds: string[]
    value: number
    currency?: string
    numItems?: number
  },
): string {
  const eventId = generateEventId()
  const consentGranted = getMarketingConsent(request)
  const { fbp, fbc } = getFbCookies(request)
  const clientIp = getClientIPOrNull(request)

  void sendCapiEvent(
    {
      event_name:    eventName,
      event_id:      eventId,
      event_time:    Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: {
        // Omitted rather than placeheld when unknown: a junk IP inflates Meta's
        // match-key coverage while matching nobody.
        ...(clientIp ? { client_ip_address: clientIp } : {}),
        client_user_agent: request.headers.get('user-agent') ?? undefined,
        fbp,
        fbc,
      },
      custom_data: {
        content_ids:  opts.contentIds,
        content_type: 'product',
        value:        opts.value,
        currency:     opts.currency ?? 'USD',
        ...(opts.numItems !== undefined ? { num_items: opts.numItems } : {}),
      },
    },
    { consentGranted },
  )

  return eventId
}

// ─── Core sender ──────────────────────────────────────────────────────────────

/**
 * POST a single event to the Meta Conversions API.
 *
 * Consent gating: when consentGranted is false, all PII (em) is stripped from
 * user_data before sending. Non-PII signals (ip, ua, fbp, fbc, custom_data)
 * are still sent so Meta can do probabilistic matching without personal data.
 *
 * Reports missing credentials as { ok: false, skipped } rather than success.
 * This used to return { ok: true } and send nothing, which meant a
 * misconfigured production environment looked identical to a delivered
 * conversion and never enqueued a retry. Callers must treat `skipped` as
 * "not delivered, but do not burn a retry attempt on it".
 *
 * NEVER throws. Returns { ok: false, error } on failure; the caller owns
 * durability (fire-and-forget for ViewContent/AddToCart; retry for Purchase).
 */
export async function sendCapiEvent(
  event: CapiEvent,
  opts: { consentGranted: boolean; testMode?: boolean },
): Promise<{ ok: boolean; error?: string; skipped?: string }> {
  const pixelId = process.env['META_PIXEL_ID']
  const token   = process.env['META_CAPI_TOKEN']

  if (!pixelId) return { ok: false, skipped: 'no META_PIXEL_ID' }
  if (!token)   return { ok: false, skipped: 'no META_CAPI_TOKEN' }

  // Strip PII when consent not confirmed.
  const user_data: CapiUserData = { ...event.user_data }
  if (!opts.consentGranted) {
    delete user_data.em
  }

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name:    event.event_name,
        event_id:      event.event_id,
        event_time:    event.event_time,
        action_source: event.action_source,
        user_data,
        custom_data:   event.custom_data,
      },
    ],
    access_token: token,
  }

  // Test events are opt-in per call, never ambient. Attaching test_event_code
  // to a live send diverts it into Events Manager's Test Events tab and out of
  // the production dataset, so a stray env var in production would silently
  // stop all conversion collection.
  //
  // NODE_ENV is the wrong signal on Vercel: it is 'production' for preview
  // deployments too, so a preview build with real Meta credentials would post
  // LIVE conversions into the production dataset. VERCEL_ENV is the one that
  // distinguishes them, same as app/lib/botid.server.ts does and for the same
  // reason. Off Vercel (local, CI), fall back to NODE_ENV.
  const testCode = process.env['META_TEST_EVENT_CODE']
  const vercelEnv = process.env['VERCEL_ENV']
  const isRealProduction = vercelEnv
    ? vercelEnv === 'production'
    : process.env['NODE_ENV'] === 'production'
  const wantsTest = opts.testMode === true || !isRealProduction
  if (testCode && wantsTest) payload['test_event_code'] = testCode

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${pixelId}/events`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Meta CAPI ${res.status}: ${text}` }
    }

    // A 200 is not proof of acceptance. Meta answers 200 with
    // { events_received: 0 } plus a `messages` array when it drops an event for
    // a payload problem, which is exactly the silent failure this whole module
    // exists to stop.
    const body = await res.json().catch(() => null) as
      { events_received?: number; messages?: unknown[]; fbtrace_id?: string } | null

    if (body && typeof body.events_received === 'number' && body.events_received < 1) {
      const messages = Array.isArray(body.messages) ? JSON.stringify(body.messages).slice(0, 300) : ''
      return { ok: false, error: `Meta CAPI accepted 0 events${messages ? `: ${messages}` : ''}` }
    }
    if (body && Array.isArray(body.messages) && body.messages.length > 0) {
      return { ok: false, error: `Meta CAPI warning: ${JSON.stringify(body.messages).slice(0, 300)}` }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
