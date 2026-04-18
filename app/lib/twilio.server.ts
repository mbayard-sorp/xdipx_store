/**
 * twilio.server.ts
 *
 * Thin Twilio helpers used by RR webhook routes:
 *   - verifyTwilioSignature: validates the X-Twilio-Signature header
 *   - twiml: returns a TwiML XML Response
 *   - sendSms: lightweight REST wrapper (used later by agent tools)
 *
 * Full Claude loop + ConversationRelay WS server lives in /ivr (Fly.io).
 */
import crypto from 'node:crypto'

function getAuthToken(): string | null {
  const t = process.env['TWILIO_AUTH_TOKEN']
  if (!t) {
    console.error('[twilio] TWILIO_AUTH_TOKEN not set — signature verification will fail closed')
    return null
  }
  return t
}

/**
 * Race a promise against a timeout. Resolves to `fallback` if the promise
 * doesn't settle in time. Keeps voice/SMS handlers under Twilio's 15s webhook
 * ceiling even if Neon/Sanity/Shopify is slow.
 */
export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T, label = 'op'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[twilio] ${label} timed out after ${ms}ms`)
      resolve(fallback)
    }, ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Twilio signs requests by concatenating the full URL with alphabetically-sorted
 * form params, then HMAC-SHA1 with the auth token, base64 encoded.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyTwilioSignature(
  signature: string | null,
  fullUrl: string,
  params: Record<string, string>,
): boolean {
  if (!signature) return false
  const token = getAuthToken()
  if (!token) return false
  const sorted = Object.keys(params).sort()
  const data = fullUrl + sorted.map((k) => k + params[k]).join('')
  const expected = crypto
    .createHmac('sha1', token)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64')
  // timingSafeEqual requires equal-length buffers
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * Extract form params from a Twilio webhook Request (application/x-www-form-urlencoded).
 * Clones the request so the caller can still consume the body if needed.
 */
export async function parseTwilioForm(request: Request): Promise<Record<string, string>> {
  const clone = request.clone()
  const form = await clone.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : ''
  return params
}

/**
 * Reconstruct the exact URL Twilio signed. Behind the Vercel proxy,
 * request.url can report the internal rewrite path (or http scheme), while
 * Twilio signs the public https URL it was configured with. We rebuild from
 * x-forwarded-proto / x-forwarded-host (or host) and trust request.url only
 * for the path + query.
 */
function reconstructSignedUrl(request: Request): string {
  const h = request.headers
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host')?.trim()
  const url = new URL(request.url)
  if (proto) url.protocol = `${proto}:`
  if (host) url.host = host
  return url.toString()
}

/**
 * Verify a Twilio request end-to-end. Returns { ok, params } so the caller can
 * use the already-parsed form fields without re-reading the body.
 * In non-production with no signature header we return ok=true to ease local dev.
 */
export async function verifyTwilioRequest(
  request: Request,
): Promise<{ ok: boolean; params: Record<string, string> }> {
  const params = await parseTwilioForm(request)
  const signature = request.headers.get('x-twilio-signature')
  if (!signature && process.env['NODE_ENV'] !== 'production') {
    return { ok: true, params }
  }
  const fullUrl = reconstructSignedUrl(request)
  return { ok: verifyTwilioSignature(signature, fullUrl, params), params }
}

/** Wrap TwiML XML in a properly-typed Response. */
export function twiml(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

/** XML-escape a string for safe interpolation into TwiML attributes/body. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Send an SMS via Twilio REST API. Returns the message SID on success. */
export async function sendSms(to: string, body: string): Promise<string> {
  const sid = process.env['TWILIO_ACCOUNT_SID']
  const token = process.env['TWILIO_AUTH_TOKEN']
  const from = process.env['TWILIO_PHONE_NUMBER']
  if (!sid || !token || !from) throw new Error('Twilio env vars not set')

  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Twilio SMS send failed (${res.status}): ${err}`)
  }
  const json = (await res.json()) as { sid: string }
  return json.sid
}
