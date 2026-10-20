/**
 * The M8 exclusion audience sync, pure half (ticket #16687, plan §9.4,
 * docs/ads-policy.md M8). No database, no network, so the normalization, the
 * hashing and the consent rule test without either. The run lives in
 * audience-sync.server.ts; the Graph writes live in
 * channels/meta/mutate.server.ts.
 *
 * Two Meta customer-list audiences, both used only as exclusions:
 *   - buyers: people with at least one order that was not cancelled, read
 *             from the Shopify order events Klaviyo's Shopify integration
 *             records ("Placed Order" minus "Cancelled Order"). Not from the
 *             Shopify Admin API: on the store's current plan the app is not
 *             approved for customer PII and every customers query is refused.
 *   - leads:  members of the Klaviyo subscriber lists (paid leads from the
 *             curious funnel, daily-deal subscribers, optionally Email List).
 *
 * Consent rule (the conservative one; an owner and legal decision, see the
 * PR for ticket #16687):
 *   1. Email only. Phone numbers are never uploaded. The privacy policy says
 *      "No mobile information will be shared with third parties or affiliates
 *      for marketing or promotional purposes", and a Meta customer list is a
 *      third party. normalizePhone and hashPhone exist so a later decision can
 *      add the column, and are tested, but nothing here calls them.
 *   2. A person is uploaded only when Klaviyo shows email marketing consent
 *      SUBSCRIBED, can_receive_email_marketing true, no global or list
 *      suppression, and no sale or sharing opt-out.
 *   3. A sale or sharing opt-out is a truthy do_not_sell_or_share (or
 *      ccpa_opt_out) property on the Klaviyo profile. The store records no
 *      such opt-out anywhere today, so this is the hook the owner sets by
 *      hand when someone asks.
 *   4. One do-not-upload set wins over both lists: every email that said no
 *      in any row of either source stays out of both audiences.
 *
 * Raw values never leave the caller's memory: the run logs counts only, and
 * the Meta writer refuses anything that is not a 64-hex digest.
 */
import { createHash } from 'node:crypto'

export type AudienceSyncKey = 'buyers' | 'leads'

export interface AudienceSyncDef {
  key: AudienceSyncKey
  /** The exact Meta audience name. The sync finds the audience by it. */
  name: string
  description: string
}

export const AUDIENCE_SYNC_DEFS: Readonly<Record<AudienceSyncKey, AudienceSyncDef>> = {
  buyers: {
    key: 'buyers',
    name: 'xdipx buyers (exclude)',
    description: 'M8 exclusion. People with a Shopify order who gave email marketing consent. Refreshed weekly by xdipx; exclusion only, never targeting.',
  },
  leads: {
    key: 'leads',
    name: 'xdipx leads (exclude)',
    description: 'M8 exclusion. Klaviyo subscribers (paid leads, daily-deal list) with email marketing consent. Refreshed weekly by xdipx; exclusion only, never targeting.',
  },
}

/** Which sync audience a Meta audience name is, or null. Case and spacing do not matter. */
export function audienceSyncKeyOfName(name: string | null | undefined): AudienceSyncKey | null {
  if (!name) return null
  const n = name.trim().replace(/\s+/g, ' ').toLowerCase()
  for (const def of Object.values(AUDIENCE_SYNC_DEFS)) if (def.name.toLowerCase() === n) return def.key
  return null
}

/** Meta takes at most 10,000 rows per /users or /usersreplace request. */
export const META_AUDIENCE_BATCH_MAX = 10_000

/** The ledger row's target. ad_actions.target_level is text; the sync targets the account's M8 audiences. */
export const AUDIENCE_SYNC_TARGET_ID = 'm8_exclusions'
export const AUDIENCE_SYNC_TARGET_LEVEL = 'audience'

// ---------------------------------------------------------------------------
// Normalization and hashing (Meta customer list spec)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Trim and lowercase, per Meta. Null when the result is not an email address. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  return EMAIL_RE.test(v) ? v : null
}

/**
 * Digits only with the country code, no plus and no leading zeros, per Meta.
 * A 10-digit number is read as US/Canada and gets the 1. Null when the result
 * is not 8 to 15 digits (E.164 length).
 */
export function normalizePhone(raw: string | null | undefined, defaultCountryCode = '1'): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  let digits = trimmed.replace(/\D/g, '').replace(/^0+/, '')
  if (!trimmed.startsWith('+') && digits.length === 10) digits = `${defaultCountryCode}${digits}`
  return /^\d{8,15}$/.test(digits) ? digits : null
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export const isSha256Hex = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

export function hashEmail(raw: string | null | undefined): string | null {
  const n = normalizeEmail(raw)
  return n ? sha256Hex(n) : null
}

export function hashPhone(raw: string | null | undefined, defaultCountryCode = '1'): string | null {
  const n = normalizePhone(raw, defaultCountryCode)
  return n ? sha256Hex(n) : null
}

// ---------------------------------------------------------------------------
// The consent rule
// ---------------------------------------------------------------------------

/** What the sync reads off one Klaviyo profile. */
export interface ConsentRow {
  email: string | null
  /** subscriptions.email.marketing.consent: SUBSCRIBED, UNSUBSCRIBED, NEVER_SUBSCRIBED, ... */
  consent: string | null
  canReceiveEmailMarketing: boolean | null
  /** True when the profile carries any global suppression or a list suppression. */
  suppressed: boolean
  /** True when the profile records a sale or sharing opt-out (CCPA/CPRA). */
  saleOptOut: boolean
}

/** A buyer: a profile plus its Shopify order event counts. */
export interface BuyerRow extends ConsentRow {
  placedOrders: number
  cancelledOrders: number
}

export type SkipReason = 'no_email' | 'no_paid_order' | 'sale_opt_out' | 'suppressed' | 'no_marketing_consent' | 'do_not_upload'

/** Klaviyo profile properties that mean "do not sell or share my data". */
export const SALE_OPT_OUT_PROPERTIES = ['do_not_sell_or_share', 'ccpa_opt_out'] as const

export function saleOptOutFromProperties(props: Record<string, unknown> | null | undefined): boolean {
  if (!props) return false
  return SALE_OPT_OUT_PROPERTIES.some(k => {
    const v = props[k]
    return v === true || (typeof v === 'string' && /^(true|yes|1)$/i.test(v.trim())) || v === 1
  })
}

/** Why a row may not be uploaded, or null when it may. Buyers also need an order that was not cancelled. */
export function consentDecision(r: ConsentRow): Exclude<SkipReason, 'no_paid_order' | 'do_not_upload'> | null {
  if (!normalizeEmail(r.email)) return 'no_email'
  if (r.saleOptOut) return 'sale_opt_out'
  if (r.suppressed || r.canReceiveEmailMarketing === false) return 'suppressed'
  if ((r.consent ?? '').toUpperCase() !== 'SUBSCRIBED') return 'no_marketing_consent'
  return null
}

export function buyerDecision(b: BuyerRow): Exclude<SkipReason, 'do_not_upload'> | null {
  if (!normalizeEmail(b.email)) return 'no_email'
  if (!(b.placedOrders - b.cancelledOrders > 0)) return 'no_paid_order'
  return consentDecision(b)
}

/** True when the row says no in a way that must keep the email out of every audience. */
function saysNo(r: ConsentRow): boolean {
  return r.saleOptOut || r.suppressed || r.canReceiveEmailMarketing === false || (r.consent ?? '').toUpperCase() === 'UNSUBSCRIBED'
}

/** Emails nobody may upload, from either source. Normalized, not hashed: it never leaves memory. */
export function doNotUploadSet(rows: ConsentRow[]): Set<string> {
  const out = new Set<string>()
  for (const r of rows) {
    const e = normalizeEmail(r.email)
    if (e && saysNo(r)) out.add(e)
  }
  return out
}

export interface AudienceListCounts {
  /** Rows read from the source. */
  read: number
  /** Unique hashed emails that will be uploaded. */
  included: number
  /** Rows the rule kept out, by reason. */
  skipped: Partial<Record<SkipReason, number>>
}

export interface AudienceLists {
  buyers: string[]
  leads: string[]
  counts: Record<AudienceSyncKey, AudienceListCounts>
}

/**
 * Applies the consent rule and returns sorted, de-duplicated SHA-256 email
 * digests per audience, plus counts. The only output that carries identity
 * is the digest list.
 */
export function buildAudienceLists(buyerRows: BuyerRow[], leadRows: ConsentRow[]): AudienceLists {
  const blocked = doNotUploadSet([...buyerRows, ...leadRows])
  const counts: Record<AudienceSyncKey, AudienceListCounts> = {
    buyers: { read: buyerRows.length, included: 0, skipped: {} },
    leads: { read: leadRows.length, included: 0, skipped: {} },
  }
  const collect = (key: AudienceSyncKey, rows: ConsentRow[], decide: (r: ConsentRow) => SkipReason | null): string[] => {
    const out = new Set<string>()
    for (const r of rows) {
      const e = normalizeEmail(r.email)
      const reason = decide(r) ?? (e && blocked.has(e) ? 'do_not_upload' : null)
      if (reason) {
        counts[key].skipped[reason] = (counts[key].skipped[reason] ?? 0) + 1
        continue
      }
      out.add(sha256Hex(e as string))
    }
    counts[key].included = out.size
    return [...out].sort()
  }
  const buyers = collect('buyers', buyerRows, r => buyerDecision(r as BuyerRow))
  const leads = collect('leads', leadRows, consentDecision)
  return { buyers, leads, counts }
}

/** Splits a list into Meta-sized batches. */
export function chunk<T>(items: readonly T[], size = META_AUDIENCE_BATCH_MAX): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
