import { createHash, randomUUID } from 'node:crypto'

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

// ─── Core sender ──────────────────────────────────────────────────────────────

/**
 * POST a single event to the Meta Conversions API.
 *
 * Consent gating: when consentGranted is false, all PII (em) is stripped from
 * user_data before sending. Non-PII signals (ip, ua, fbp, fbc, custom_data)
 * are still sent so Meta can do probabilistic matching without personal data.
 *
 * No-ops silently when META_PIXEL_ID or META_CAPI_TOKEN are absent so local
 * dev without Meta creds never throws.
 *
 * NEVER throws. Returns { ok: false, error } on failure; the caller owns
 * durability (fire-and-forget for ViewContent/AddToCart; retry for Purchase).
 */
export async function sendCapiEvent(
  event: CapiEvent,
  opts: { consentGranted: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const pixelId = process.env['META_PIXEL_ID']
  const token   = process.env['META_CAPI_TOKEN']

  // No-op in dev/missing-creds environments.
  if (!pixelId || !token) return { ok: true }

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

  const testCode = process.env['META_TEST_EVENT_CODE']
  if (testCode) payload['test_event_code'] = testCode

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
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
