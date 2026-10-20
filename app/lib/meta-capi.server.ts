import { createHash, randomUUID } from 'node:crypto'
import { parse as parseCookie, serialize as serializeCookie } from 'cookie'
import { getMarketingConsentState, type MarketingConsentState } from './consent.server'
import { fbCookieDomain, getFbCookies, getClientIPOrNull } from './attribution.server'
import { isCapiEligible } from './capi-eligibility.server'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CapiEventName = 'PageView' | 'ViewContent' | 'AddToCart' | 'Purchase' | 'Lead'

export interface CapiUserData {
  client_ip_address?: string | undefined
  client_user_agent?: string | undefined
  fbp?: string | null
  fbc?: string | null
  // Every field below is a SHA-256 hash of a Meta-normalized value (see
  // buildHashedUserData). All of them are stripped when PII is not allowed.
  em?: string | undefined
  ph?: string | undefined
  fn?: string | undefined
  ln?: string | undefined
  ct?: string | undefined
  st?: string | undefined
  zp?: string | undefined
  country?: string | undefined
  /** One id or several (Meta accepts an array). Hashed like the rest. */
  external_id?: string | string[] | undefined
}

/** The user_data keys that carry customer information, hashed or not. */
export const PII_KEYS = ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'external_id'] as const

export interface CapiCustomData {
  content_ids: string[]
  content_type: 'product'
  value: number
  currency: string
  num_items?: number
}

/** Custom data for a Lead: no products, just which surface captured it. */
export interface CapiLeadData {
  content_name: string
  content_category?: string
}

export interface CapiEvent {
  event_name: CapiEventName
  event_id: string
  event_time: number
  action_source: 'website'
  event_source_url?: string
  user_data: CapiUserData
  /** PageView has none. */
  custom_data?: CapiCustomData | CapiLeadData
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function generateEventId(): string {
  return randomUUID()
}

const SHA256_HEX = /^[a-f0-9]{64}$/

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Legacy helper: trim, lowercase, hash. Kept for callers that hash an email. */
export function hashPII(value: string): string {
  return sha256(value.trim().toLowerCase())
}

// ─── Meta normalization (Conversions API customer information parameters) ────
//
// Meta matches on the hash, so a value normalized differently from how Meta
// normalized the same person's profile simply never matches. Each rule below
// is Meta's published rule for that key. Every normalizer returns null for a
// value that is empty after normalization, so a blank field is omitted rather
// than sent as the hash of an empty string (which matches nobody and still
// reads as coverage).

export function normalizeEmail(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase()
  return s.includes('@') ? s : null
}

/**
 * Digits only, country code required, no leading zeros. This store sells to
 * the US, so a bare 10-digit number gets the US country code. Anything else is
 * assumed to already carry its country code (E.164 input does).
 */
export function normalizePhone(v: string | null | undefined): string | null {
  let digits = (v ?? '').replace(/\D/g, '').replace(/^0+/, '')
  if (digits.length === 10) digits = `1${digits}`
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}

/** Lowercase letters only: Meta wants names and cities without punctuation or spaces. */
function lettersOnly(v: string | null | undefined): string | null {
  const s = (v ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}]/gu, '')
  return s.length > 0 ? s : null
}

export const normalizeName = lettersOnly
export const normalizeCity = lettersOnly

/** Two-letter state or province code, lowercase. A full name is reduced to letters. */
export function normalizeState(v: string | null | undefined): string | null {
  return lettersOnly(v)
}

/** Lowercase, no spaces or dashes; a US zip keeps only its first five digits. */
export function normalizeZip(v: string | null | undefined): string | null {
  const s = (v ?? '').toLowerCase().replace(/[\s-]/g, '')
  if (!s) return null
  const us = s.match(/^(\d{5})\d{4}$/)
  return us ? us[1]! : s
}

/** ISO 3166-1 alpha-2, lowercase. */
export function normalizeCountry(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase()
  return /^[a-z]{2}$/.test(s) ? s : null
}

export function normalizeExternalId(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase()
  return s.length > 0 ? s : null
}

/** Hash a normalized value, passing an already-hashed value through untouched. */
function hashNormalized(raw: string | null | undefined, normalize: (v: string) => string | null): string | undefined {
  if (raw == null) return undefined
  const trimmed = raw.trim().toLowerCase()
  if (SHA256_HEX.test(trimmed)) return trimmed
  const n = normalize(raw)
  return n ? sha256(n) : undefined
}

export interface CustomerInfo {
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
  /** Raw ids (visitor id, customer id). Hashed and de-duplicated here. */
  externalIds?: Array<string | null | undefined>
}

/**
 * Turn whatever customer information a caller has into Meta's hashed
 * user_data keys. Only keys with a usable value are returned. A value that is
 * already a SHA-256 hex digest is passed through, so a hash carried on a cart
 * attribute is never hashed twice.
 */
export function buildHashedUserData(info: CustomerInfo): Partial<CapiUserData> {
  const out: Partial<CapiUserData> = {}
  const em = hashNormalized(info.email, normalizeEmail)
  const ph = hashNormalized(info.phone, normalizePhone)
  const fn = hashNormalized(info.firstName, normalizeName)
  const ln = hashNormalized(info.lastName, normalizeName)
  const ct = hashNormalized(info.city, normalizeCity)
  const st = hashNormalized(info.state, normalizeState)
  const zp = hashNormalized(info.zip, normalizeZip)
  const country = hashNormalized(info.country, normalizeCountry)
  if (em) out.em = em
  if (ph) out.ph = ph
  if (fn) out.fn = fn
  if (ln) out.ln = ln
  if (ct) out.ct = ct
  if (st) out.st = st
  if (zp) out.zp = zp
  if (country) out.country = country
  const ids = [...new Set((info.externalIds ?? [])
    .map(id => hashNormalized(id, normalizeExternalId))
    .filter((id): id is string => Boolean(id)))]
  if (ids.length === 1) out.external_id = ids[0]!
  else if (ids.length > 1) out.external_id = ids
  return out
}

// ─── PII policy ───────────────────────────────────────────────────────────────

/**
 * Whether hashed customer information may ride on a CAPI event.
 *
 * Opt-out, matching the store's US audience: hashed identifiers are sent unless
 * the visitor explicitly chose "Essential only" on the cookie banner. The old
 * rule stripped them for everyone who never touched the banner, which is
 * almost every visitor, and that is why Purchase sat at Event Match Quality 3
 * and why a lead's own email never reached Meta. The browser pixel stays
 * opt-in exactly as before; this governs only the server copy.
 */
export function piiAllowed(state: MarketingConsentState): boolean {
  return state !== 'denied'
}

// ─── First-party identity cookies ─────────────────────────────────────────────

/** Visitor id minted client-side in root.tsx's analytics bootstrap, next to _fbp. */
export const VISITOR_ID_COOKIE = '_xid'
/** SHA-256 of a captured lead's normalized email, set by /api/lead. Never the raw address. */
export const LEAD_EMAIL_HASH_COOKIE = '_xem'

function readCookie(request: Request, name: string): string | null {
  const v = parseCookie(request.headers.get('Cookie') ?? '')[name]
  return v && v.length <= 200 ? v : null
}

export function getVisitorId(request: Request): string | null {
  return readCookie(request, VISITOR_ID_COOKIE)
}

export function getLeadEmailHash(request: Request): string | null {
  const v = readCookie(request, LEAD_EMAIL_HASH_COOKIE)
  return v && SHA256_HEX.test(v) ? v : null
}

/**
 * Set-Cookie for the lead's email hash, so a lead who later buys carries the
 * hash onto the cart (attribution-cart.server.ts) and the Purchase can match
 * on it. Shared across *.xdipx.com because the lead is captured on
 * curious.xdipx.com and the purchase happens on xdipx.com.
 */
export function leadEmailHashCookie(request: Request, email: string): string | null {
  const n = normalizeEmail(email)
  if (!n) return null
  const domain = fbCookieDomain(request)
  return serializeCookie(LEAD_EMAIL_HASH_COOKIE, sha256(n), {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 90,
    ...(domain ? { domain } : {}),
    ...(process.env['NODE_ENV'] === 'production' ? { secure: true } : {}),
  })
}

/**
 * The network and cookie signals every browser-originated event carries:
 * ip, user agent, fbp, fbc, and the hashed visitor id as external_id.
 * Unknown values are omitted rather than placeheld: a junk value inflates
 * Meta's match-key coverage while matching nobody.
 */
export function requestUserData(request: Request, extra: CustomerInfo = {}): CapiUserData {
  const { fbp, fbc } = getFbCookies(request)
  const clientIp = getClientIPOrNull(request)
  const ua = request.headers.get('user-agent')
  return {
    ...(clientIp ? { client_ip_address: clientIp } : {}),
    ...(ua ? { client_user_agent: ua } : {}),
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
    ...buildHashedUserData({ ...extra, externalIds: [getVisitorId(request), ...(extra.externalIds ?? [])] }),
  }
}

// ─── Request-scoped senders ───────────────────────────────────────────────────

/**
 * AddToCart from the cart action. Awaited: Vercel discards work started after
 * the response is sent, so the old voided send was best-effort at most.
 *
 * Returns null, and sends nothing, for a request that is not a real visitor
 * (crawler, prefetch, the checkout probe). The caller hands the id to the
 * browser pixel, and a null id suppresses that side too, so the dedup pair
 * stays intact either way.
 */
export async function fireCapiEvent(
  request: Request,
  eventName: 'AddToCart',
  opts: {
    contentIds: string[]
    value: number
    currency?: string
    numItems?: number
  },
): Promise<string | null> {
  if (!isCapiEligible(request)) return null
  const eventId = generateEventId()
  const result = await sendCapiEvent(
    {
      event_name:    eventName,
      event_id:      eventId,
      event_time:    Math.floor(Date.now() / 1000),
      action_source: 'website',
      ...(request.headers.get('referer') ? { event_source_url: request.headers.get('referer')! } : {}),
      user_data:     requestUserData(request),
      custom_data: {
        // Numeric ids, matching the catalog feed and the Purchase event.
        content_ids:  opts.contentIds.map(id => id.split('/').pop() || id),
        content_type: 'product',
        value:        opts.value,
        currency:     opts.currency ?? 'USD',
        ...(opts.numItems !== undefined ? { num_items: opts.numItems } : {}),
      },
    },
    { consentGranted: piiAllowed(getMarketingConsentState(request)) },
  )
  if (!result.ok && !result.skipped) console.error(`[meta-capi] ${eventName} not delivered:`, result.error)
  return eventId
}

/**
 * Server copy of a browser pixel event (PageView, ViewContent). The browser
 * minted the event id and fired fbq with it; this sends the same id over CAPI
 * so Meta keeps one of the pair. The browser side only reaches Meta after the
 * visitor accepts marketing cookies; this side carries the non-consent signals
 * (ip, ua, fbp, fbc, visitor id) for everyone else, same as AddToCart always has.
 */
export async function sendBrowserEventCapi(
  request: Request,
  ev: { eventName: 'PageView' | 'ViewContent'; eventId: string; eventSourceUrl: string; customData?: CapiCustomData },
): Promise<{ ok: boolean; error?: string; skipped?: string }> {
  return sendCapiEvent(
    {
      event_name:       ev.eventName,
      event_id:         ev.eventId,
      event_time:       Math.floor(Date.now() / 1000),
      action_source:    'website',
      event_source_url: ev.eventSourceUrl,
      user_data:        requestUserData(request),
      ...(ev.customData ? { custom_data: ev.customData } : {}),
    },
    { consentGranted: piiAllowed(getMarketingConsentState(request)) },
  )
}

/**
 * Send a Lead for a captured signup and return its event id for the browser
 * pixel's dedup. Awaited, not fire-and-forget: Vercel discards work started
 * after the response is sent, so a voided send here would never leave.
 *
 * The visitor just typed this email into the form, so it rides along hashed
 * (with phone and first name when given) unless they explicitly declined
 * marketing cookies. Returns null and sends nothing for the checkout probe or
 * a crawler. Never throws; a failed send is logged and the signup still
 * succeeds. Every outcome is logged, success included, because a Lead that
 * silently never reached Meta is exactly what this replaced: three real leads
 * on 2026-10-19/20 produced no Lead in the dataset and left no trace.
 */
export async function sendCapiLead(
  request: Request,
  opts: { email: string; phone?: string | null; firstName?: string | null; contentName: string; category?: string },
): Promise<string | null> {
  if (!isCapiEligible(request)) return null
  const eventId = generateEventId()
  const referer = request.headers.get('referer')
  const result = await sendCapiEvent(
    {
      event_name:       'Lead',
      event_id:         eventId,
      event_time:       Math.floor(Date.now() / 1000),
      action_source:    'website',
      ...(referer ? { event_source_url: referer } : {}),
      user_data:        requestUserData(request, { email: opts.email, phone: opts.phone ?? null, firstName: opts.firstName ?? null }),
      custom_data: {
        content_name: opts.contentName,
        ...(opts.category ? { content_category: opts.category } : {}),
      },
    },
    { consentGranted: piiAllowed(getMarketingConsentState(request)) },
  )
  if (result.ok) console.info('[meta-capi] Lead delivered', eventId, opts.contentName)
  else console.error('[meta-capi] Lead not delivered:', result.error ?? result.skipped, eventId)
  return eventId
}

// ─── Core sender ──────────────────────────────────────────────────────────────

/**
 * POST a single event to the Meta Conversions API.
 *
 * `consentGranted` means "hashed customer information may be sent" (see
 * piiAllowed). When false, every PII_KEYS field is stripped before sending.
 * Non-PII signals (ip, ua, fbp, fbc, custom_data) are still sent so Meta can
 * match probabilistically without personal data.
 *
 * Reports missing credentials as { ok: false, skipped } rather than success.
 * This used to return { ok: true } and send nothing, which meant a
 * misconfigured production environment looked identical to a delivered
 * conversion and never enqueued a retry. Callers must treat `skipped` as
 * "not delivered, but do not burn a retry attempt on it".
 *
 * NEVER throws. Returns { ok: false, error } on failure; the caller owns
 * durability.
 */
export async function sendCapiEvent(
  event: CapiEvent,
  opts: { consentGranted: boolean; testMode?: boolean },
): Promise<{ ok: boolean; error?: string; skipped?: string }> {
  const pixelId = process.env['META_PIXEL_ID']
  const token   = process.env['META_CAPI_TOKEN']

  if (!pixelId) return { ok: false, skipped: 'no META_PIXEL_ID' }
  if (!token)   return { ok: false, skipped: 'no META_CAPI_TOKEN' }

  const user_data: CapiUserData = { ...event.user_data }
  if (!opts.consentGranted) {
    for (const k of PII_KEYS) delete user_data[k]
  }
  // null fbp/fbc are omitted, not sent as JSON null.
  if (user_data.fbp == null) delete user_data.fbp
  if (user_data.fbc == null) delete user_data.fbc

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name:    event.event_name,
        event_id:      event.event_id,
        event_time:    event.event_time,
        action_source: event.action_source,
        ...(event.event_source_url ? { event_source_url: event.event_source_url } : {}),
        user_data,
        ...(event.custom_data ? { custom_data: event.custom_data } : {}),
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
  //
  // Caveat measured 2026-10-20: when the code does not match an ACTIVE Test
  // Events session, Meta answers "received and processed normally", i.e. the
  // event lands in the live dataset anyway, with a warning message that this
  // function reports as not-ok.
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
