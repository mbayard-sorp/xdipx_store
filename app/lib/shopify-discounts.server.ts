import { eq, and } from 'drizzle-orm'
import { getPipelineSetting } from './feed-processor.server'
import { sendOwnerEmail, escapeHtml } from './owner-alerts.server'
import type { EscalationClassName } from './owner-escalation'
import { addSuggestionNote, listSuggestions } from './team.server'
import { getProductsByHandles, findProductBySKU, adminGraphQL } from './shopify.server'
import { db } from './db.server'
import { suggestionLinks } from '../../db/schema'

/**
 * Executor for `kind:'promo'` suggestion rows (the promo-manager brief format).
 * Turns an APPROVED, MAP-clean promo into a live Shopify discount code via the
 * Admin GraphQL `discountCodeBasicCreate` mutation, emails the owner on every
 * mint, and records the result as a note on the ticket. Before this, an
 * approved promo row was a permanent owner dead end.
 *
 * This mints a LIVE code, so it is fail-closed by design. It refuses, loudly,
 * any row that:
 *   - carries a MAP-conflict flag in its policy note,
 *   - lacks an explicit start and end window,
 *   - lacks a parseable code or discount depth, or
 *   - names no eligible product it can resolve (minting a catalog-wide code is
 *     the exact unbounded-giveaway hazard the promo-manager warns about, so a
 *     promo with no resolvable products is refused rather than scoped to "all").
 *
 * The whole path is gated behind `promo_execute_enabled`, which defaults OFF in
 * code (a missing setting reads as off), so with the valve off nothing changes.
 */

/** Valve key. Read via the generic pipeline-settings getter. Default OFF. */
export const PROMO_EXECUTE_VALVE = 'promo_execute_enabled'

/**
 * MAP verdict detection, in two halves, both fail-closed.
 *
 * Every promo-manager brief carries an explicit MAP verdict ("MAP CHECK PASS",
 * "MAP check result: clean", "MAP conflict on X"), and briefs *also* discuss MAP
 * in general guardrail prose ("...any further discount on those would sell below
 * MAP", explaining why a scoping guardrail exists). The earlier detector matched
 * the bare phrase "below MAP" anywhere in the body, so it refused the clean,
 * MAP-passing brief #51 on the strength of its own guardrail rationale.
 *
 * `MAP_FAIL_RE` now matches only an explicit conflict/failure verdict, never the
 * bare "below MAP" that appears in explanatory prose. `MAP_PASS_RE` matches an
 * explicit clean verdict. The executor refuses on a FAIL verdict AND refuses
 * unless a PASS verdict is explicitly present, so a brief that merely mentions
 * MAP in passing is refused, never minted.
 *
 * `detectMapConflict` additionally guards against a second false-positive shape
 * (ticket #9319/#9366): a brief's exclusion-rationale prose explaining why a
 * SKU was left OUT of the promo's scope ("9 excluded already at MAP floor /
 * zero headroom (further discount breaches MAP -- ...)") trips the
 * `violates?|breaches?|breaking` alternative even though it is not a verdict
 * on the promo itself. This false-positived LUBE20 (#6757) on 2026-09-08 even
 * though the same brief carries an explicit "MAP CHECK CLEAN" verdict. A match
 * only counts as a real conflict when the ~120 characters immediately
 * preceding it do not contain "exclud" (case-insensitive) — exclusion
 * rationale always names the excluded SKUs right before explaining why.
 */
const MAP_FAIL_RE =
  /\bmap\b[^.\n]{0,40}?\b(?:conflict|violation|violates?|breach(?:es|ed)?|fail(?:s|ed|ure)?|flagged?)\b|\b(?:violates?|breaches?|breaking)\s+map\b|\bnot\s+map[\s-]*compliant\b|\bmap[\s-]*(?:check|status|result)[\s:_-]*fail/i

const MAP_PASS_RE =
  /\bmap\b[^.\n]{0,40}?\b(?:pass(?:ed|es)?|clean|clear|compliant|legal)\b|\bmap[\s_]*(?:price)?[\s_]*=?\s*0\b/i

/** How far back to look for exclusion-rationale prose before a FAIL match. */
const MAP_FAIL_CONTEXT_WINDOW = 120

export interface ParsedPromo {
  code: string | null
  /** Discount depth as a whole-number percent, 1 to 99. */
  percentage: number | null
  /** ISO 8601 datetimes derived from the two dated boundaries in the brief. */
  startsAt: string | null
  endsAt: string | null
  /** Product handles pulled from /products/<handle> links in the brief. */
  handles: string[]
  /** Nalpac/variant SKU numbers pulled from labelled "SKU(s) N/N/..." lists. */
  skus: string[]
  mapNote: string | null
  body: string
}

export interface PromoDecision {
  ok: boolean
  /**
   * 'ok' | 'not-applicable' | 'map-conflict-flagged' | 'map-not-confirmed' |
   * 'no-code' | 'no-depth' | 'no-explicit-window' | 'invalid-window'
   */
  reason: string
}

export interface PromoExecuteResult {
  minted: boolean
  /** Set true when a guard refused the row (as opposed to a Shopify error). */
  refused?: boolean | undefined
  reason: string
  discountId?: string | undefined
  code?: string | undefined
  ownerEmailed?: boolean | undefined
}

/** Valve gate. A missing or non-'true' setting is OFF. */
export function promoExecuteEnabled(settingValue: string | null): boolean {
  return settingValue === 'true'
}

/**
 * True when the brief carries an explicit MAP-FAIL verdict about this promo.
 * A match is discarded when it sits inside exclusion-rationale prose (see the
 * doc comment above MAP_FAIL_RE) — checked per match, so a real conflict
 * verdict elsewhere in the same brief is never masked by an unrelated
 * exclusion note.
 */
export function detectMapConflict(text: string): boolean {
  const re = new RegExp(MAP_FAIL_RE.source, 'gi')
  for (const m of text.matchAll(re)) {
    const precedingStart = Math.max(0, m.index - MAP_FAIL_CONTEXT_WINDOW)
    const preceding = text.slice(precedingStart, m.index)
    if (!/exclud/i.test(preceding)) return true
  }
  return false
}

/**
 * True when the brief carries an explicit MAP-clean verdict (a PASS/clean check,
 * or an explicit map_price=0). Required before any mint: a brief that never
 * states MAP compliance is refused rather than minted.
 */
export function detectMapClean(text: string): boolean {
  return MAP_PASS_RE.test(text)
}

/** Section labels and units that look ALL-CAPS but are never a discount code. */
const CODE_STOPWORDS = new Set([
  'PROMO', 'DEPTH', 'ELIGIBILITY', 'SKU', 'SKUS', 'MSRP', 'MAP', 'AOV', 'PDP',
  'CTA', 'STANDING', 'GUARDRAIL', 'WINDOW', 'CHANNEL', 'STACKING', 'PLAN',
  'SCOPE', 'CHECK', 'PASS', 'FAIL', 'VOICE', 'NOTE', 'USD', 'ONLY', 'THIS',
])

/**
 * Extract the discount code. The promo-manager writes it three ways, so we try
 * three in order:
 *   A. an explicit `Code: FOO` line (the synthetic/ideal format),
 *   B. the token right after a `PROMO n \u2014` (em-dash or hyphen) header, which is
 *      how the live briefs state it inline (row #51: "PROMO 2 (...) \u2014 FIRSTLOOK10"),
 *   C. the first standalone ALL-CAPS token that contains a digit and is not a
 *      known section label.
 * A brief with none of these has no parseable code, and decidePromo refuses it.
 */
export function extractPromoCode(text: string): string | null {
  const line = text.match(/^\s*code\s*[^:\n]*:\s*([A-Za-z0-9][A-Za-z0-9_-]{2,39})/im)
  if (line?.[1]) return line[1].trim()

  // \u2014 is the em-dash, matched by codepoint so this source stays em-dash-free.
  const header = text.match(/\bpromo\b[^\u2014\n]*(?:\u2014|-)\s*([A-Z][A-Z0-9]{3,39})\b/i)
  if (header?.[1] && !CODE_STOPWORDS.has(header[1].toUpperCase())) return header[1]

  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]{3,39})\b/g)) {
    const tok = m[1] as string
    if (!CODE_STOPWORDS.has(tok) && /\d/.test(tok)) return tok
  }
  return null
}

/**
 * Extract eligible product SKUs from labelled lists. Two shapes, both
 * additive (a brief may use either or both; nothing here can subtract a
 * match the other shape found):
 *
 *  A. Numbers that directly follow a "SKU"/"SKUs" label, e.g. row #51's
 *     "SKUs 84740/84743/84747/84748; ...". Only these numbers are taken by
 *     this half, so counts written elsewhere as "SKUs (1503 MAP-locked ...)"
 *     and dollar/percent figures are never mistaken for a scope.
 *
 *  B. The per-SKU margin-list shape real promo-manager briefs actually write
 *     today (ticket #10737): a lead-in sentence naming a SKU count, followed
 *     by a "; "-delimited list of "<SKU> <Product Name> $<price> -> <pct>%"
 *     entries, e.g. "...for these 12: 99352 Camtoyz Fouria $53.99 -> 30.5%;
 *     98578 Syntra Bullet $21.99 -> 28.9%; ...". `extractSkus` used to only
 *     recognize shape A, so briefs #9321 (BULLETWEEK20) and #9322
 *     (COUPLESCONTROL20) resolved ZERO products and were refused
 *     'no-eligible-products' even though every one of their 12 and 8 SKUs is
 *     a real, live, resolvable product (verified 2026-09-22 against
 *     production Shopify).
 *
 *     The "-> pct%" arrow is the load-bearing anchor: a brief's EXCLUDED list
 *     uses a different shape ("93291 BANG! 7X ($13.99, wholesale $14.99,
 *     -33.9%)", or a bare comma list of numbers with no product name or
 *     price at all), never the arrow, so requiring it is what keeps this
 *     half from mistaking an excluded SKU for an eligible one. The number
 *     immediately preceding the arrow-margin is taken only when nothing
 *     else — no other digit, no "$", no semicolon — sits between them,
 *     which is what keeps a stray count or date earlier in the same
 *     sentence ("scoped to exactly 12 SKUs", "confirmed live ...
 *     2026-09-14") from being mistaken for the SKU that owns a much later
 *     margin figure.
 */
const SKU_MARGIN_LIST_RE = /(\d{4,6})[^\d$;\n]*\$[\d.]+\s*->\s*[\d.]+%/g

export function extractSkus(text: string): string[] {
  const skus = new Set<string>()
  for (const m of text.matchAll(/\bskus?\b\s*:?\s*(\d[\d,/\s]*\d)/gi)) {
    for (const n of (m[1] as string).split(/[^\d]+/)) {
      if (n.length >= 3) skus.add(n)
    }
  }
  for (const m of text.matchAll(SKU_MARGIN_LIST_RE)) skus.add(m[1] as string)
  return [...skus]
}

/** Best-effort structured extraction from a free-text promo brief. */
export function parsePromoBrief(text: string): ParsedPromo {
  const code = extractPromoCode(text)

  // Depth: prefer an explicit "Depth: 15%" line, then "15% off", then a bare percent.
  const depth =
    text.match(/^\s*depth\s*[^:\n]*:\s*(\d{1,2})\s*%?/im)
    ?? text.match(/(\d{1,2})\s*%\s*off/i)
    ?? text.match(/(\d{1,2})\s*%/)
  const depthNum = depth?.[1] ? parseInt(depth[1], 10) : NaN
  const percentage = Number.isFinite(depthNum) && depthNum >= 1 && depthNum <= 99 ? depthNum : null

  // Window: the two dated boundaries. Require ISO YYYY-MM-DD so "explicit" is
  // unambiguous; a brief without two ISO dates is treated as having no window.
  const isoDates = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(m => m[1] as string)
  const startsAt = isoDates.length >= 2 && isoDates[0] ? `${isoDates[0]}T00:00:00Z` : null
  const endsAt = isoDates.length >= 2 && isoDates[1] ? `${isoDates[1]}T23:59:59Z` : null

  const handles = [...text.matchAll(/\/products\/([a-z0-9][a-z0-9-]*)/gi)]
    .map(m => (m[1] as string).toLowerCase())
  const uniqueHandles = [...new Set(handles)]

  const mapLine = text.match(/^.*\bmap\b.*$/im)
  const mapNote = mapLine?.[0] ? mapLine[0].trim() : null

  return {
    code,
    percentage,
    startsAt,
    endsAt,
    handles: uniqueHandles,
    skus: extractSkus(text),
    mapNote,
    body: text,
  }
}

/**
 * Whether the brief even describes a percentage discount code at all, as
 * opposed to a different promo mechanism (a free-shipping-threshold change, a
 * bundle, a loyalty perk) that this executor has no way to mint and never
 * should try to. A bare `NN%` anywhere in the text is the loosest possible
 * signal a percentage mechanism could leave, matching the loosest of
 * parsePromoBrief's own depth-extraction fallbacks — so when this is false,
 * `parsed.percentage` is guaranteed null too, and 'no-depth' would otherwise
 * misreport a wrong-mechanism row as a malformed percentage row.
 */
const DISCOUNT_CODE_CANDIDATE_RE = /\d{1,2}\s*%/

/**
 * The pre-mint guard. Order matters: whether this is even a percentage-code
 * mechanism is checked first (ticket #9366) — a non-applicable row can never
 * pass any later check, and mis-refusing it as 'no-depth' invites retrying it
 * forever once refusals become retryable — then the loudest, most
 * safety-critical refusal (a MAP conflict) is reported, then the structural
 * requirements.
 */
export function decidePromo(parsed: ParsedPromo, fullText: string): PromoDecision {
  if (!DISCOUNT_CODE_CANDIDATE_RE.test(fullText)) return { ok: false, reason: 'not-applicable' }
  if (detectMapConflict(fullText)) return { ok: false, reason: 'map-conflict-flagged' }
  if (!parsed.code) return { ok: false, reason: 'no-code' }
  if (parsed.percentage == null) return { ok: false, reason: 'no-depth' }
  if (!parsed.startsAt || !parsed.endsAt) return { ok: false, reason: 'no-explicit-window' }
  if (new Date(parsed.endsAt).getTime() <= new Date(parsed.startsAt).getTime()) {
    return { ok: false, reason: 'invalid-window' }
  }
  // Fail-closed: mint only when MAP compliance is explicitly stated, never on the
  // mere absence of a conflict word.
  if (!detectMapClean(fullText)) return { ok: false, reason: 'map-not-confirmed' }
  return { ok: true, reason: 'ok' }
}

export interface DiscountVariablesInput {
  code: string
  percentage: number     // whole-number percent, 1..99
  startsAt: string
  endsAt: string
  productGids: string[]   // must be non-empty; the code is scoped to these
}

/** Variables for `discountCodeBasicCreate`. Percent is sent as a 0..1 decimal. */
export function buildDiscountVariables(i: DiscountVariablesInput): Record<string, unknown> {
  return {
    basicCodeDiscount: {
      title: i.code,
      code: i.code,
      startsAt: i.startsAt,
      endsAt: i.endsAt,
      customerSelection: { all: true },
      customerGets: {
        value: { percentage: i.percentage / 100 },
        items: { products: { productsToAdd: i.productGids } },
      },
      appliesOncePerCustomer: true,
    },
  }
}

export const DISCOUNT_CODE_BASIC_CREATE = `
  mutation promoCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }
`

export function buildPromoOwnerEmail(i: {
  suggestionId: number
  outcome: 'minted' | 'refused'
  code: string | null
  percentage: number | null
  startsAt: string | null
  endsAt: string | null
  productCount: number
  reason: string
  discountId: string | null
  body: string
}): { subject: string; html: string } {
  const window =
    i.startsAt && i.endsAt ? `${i.startsAt} to ${i.endsAt}` : '(no explicit window)'
  const head =
    i.outcome === 'minted'
      ? `<h2>Discount code minted</h2><p>Ticket #${i.suggestionId}. This code is <strong>live</strong> in Shopify for the window below.</p>`
      : `<h2>Promo refused, not minted</h2><p>Ticket #${i.suggestionId} was <strong>not</strong> minted. Reason: <strong>${escapeHtml(i.reason)}</strong>. Nothing was created in Shopify.</p>`
  const html = [
    head,
    `<ul>`,
    `<li><strong>Code:</strong> ${escapeHtml(i.code ?? '(none parsed)')}</li>`,
    `<li><strong>Depth:</strong> ${i.percentage != null ? `${i.percentage}%` : '(none parsed)'}</li>`,
    `<li><strong>Window:</strong> ${escapeHtml(window)}</li>`,
    `<li><strong>Scoped products:</strong> ${i.productCount}</li>`,
    i.discountId ? `<li><strong>Discount id:</strong> ${escapeHtml(i.discountId)}</li>` : '',
    `</ul>`,
    `<h3>Full brief</h3>`,
    `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(i.body)}</pre>`,
  ].filter(Boolean).join('\n')
  const subject =
    i.outcome === 'minted'
      ? `Discount minted: ${i.code ?? 'promo'} (${window})`
      : `Promo refused (${i.reason}): ticket #${i.suggestionId}`
  return { subject, html }
}

// ─── Dependency seam ────────────────────────────────────────────────────────

export interface ShopifyDiscountResult {
  id: string | null
  userErrors: { field?: readonly string[] | null; message: string }[]
}

export interface ProductSelector {
  handles: string[]
  skus: string[]
}

export interface PromoExecuteDeps {
  getSetting: (key: string) => Promise<string | null>
  resolveProductGids: (sel: ProductSelector) => Promise<string[]>
  createDiscount: (variables: Record<string, unknown>) => Promise<ShopifyDiscountResult>
  sendOwnerEmail: (
    subject: string,
    html: string,
    opts: { escalation: EscalationClassName; fromName?: string },
  ) => Promise<{ sent: boolean; error?: string }>
  addNote: (id: number, ref: string) => Promise<void>
}

async function resolveProductGidsLive(sel: ProductSelector): Promise<string[]> {
  const gids = new Set<string>()
  if (sel.handles.length > 0) {
    const products = await getProductsByHandles(sel.handles)
    for (const p of products) if (p.id) gids.add(p.id)
  }
  // The live briefs (row #51) name eligible products by Nalpac SKU, not by a
  // /products/ link. Imported products carry that value as their variant SKU, so
  // `sku:` search resolves each one to its product GID.
  for (const sku of sel.skus) {
    const gid = await findProductBySKU(sku)
    if (gid) gids.add(gid)
  }
  return [...gids]
}

async function createDiscountLive(variables: Record<string, unknown>): Promise<ShopifyDiscountResult> {
  const data = await adminGraphQL<{
    discountCodeBasicCreate: {
      codeDiscountNode: { id: string } | null
      userErrors: { field?: readonly string[] | null; message: string }[]
    }
  }>(DISCOUNT_CODE_BASIC_CREATE, variables)
  return {
    id: data.discountCodeBasicCreate.codeDiscountNode?.id ?? null,
    userErrors: data.discountCodeBasicCreate.userErrors ?? [],
  }
}

/** Production wiring of the dependency seam. */
export function defaultPromoExecuteDeps(): PromoExecuteDeps {
  return {
    getSetting: getPipelineSetting,
    resolveProductGids: resolveProductGidsLive,
    createDiscount: createDiscountLive,
    sendOwnerEmail,
    addNote: addSuggestionNote,
  }
}

/**
 * Refusal reasons that never reach the owner's inbox: the row is not a defect
 * in *this* brief, it is the wrong mechanism entirely for this executor
 * (ticket #9366), and there is nothing for the owner to decide by re-reading
 * the same non-percentage brief every day.
 */
const SILENT_REFUSAL_REASONS = new Set(['not-applicable'])

async function refuse(
  row: { id: number },
  parsed: ParsedPromo,
  reason: string,
  productCount: number,
  deps: PromoExecuteDeps,
): Promise<PromoExecuteResult> {
  if (SILENT_REFUSAL_REASONS.has(reason)) {
    await deps.addNote(row.id, `REFUSED (${reason}): no Shopify discount minted. Not a percentage-code mechanism; owner not emailed.`)
    return { minted: false, refused: true, reason, ownerEmailed: false }
  }

  const mail = buildPromoOwnerEmail({
    suggestionId: row.id,
    outcome: 'refused',
    code: parsed.code,
    percentage: parsed.percentage,
    startsAt: parsed.startsAt,
    endsAt: parsed.endsAt,
    productCount,
    reason,
    discountId: null,
    body: parsed.body,
  })
  const sent = await deps.sendOwnerEmail(mail.subject, mail.html, { escalation: 'owner-decision', fromName: 'xdipx promo' })
  await deps.addNote(row.id, `REFUSED (${reason}): no Shopify discount minted. Owner emailed.`)
  return { minted: false, refused: true, reason, ownerEmailed: sent.sent }
}

/**
 * Execute one approved promo brief. Valve-gated: with the valve off this returns
 * immediately and touches nothing. With the valve on it runs the fail-closed
 * guard, resolves the eligible products, mints the code, emails the owner, and
 * records the outcome on the ticket.
 */
export async function executeApprovedPromo(
  row: { id: number; suggestion: string },
  deps: PromoExecuteDeps,
): Promise<PromoExecuteResult> {
  if (!promoExecuteEnabled(await deps.getSetting(PROMO_EXECUTE_VALVE))) {
    return { minted: false, reason: 'valve-off' }
  }

  const parsed = parsePromoBrief(row.suggestion)
  const decision = decidePromo(parsed, row.suggestion)
  if (!decision.ok) {
    return refuse(row, parsed, decision.reason, 0, deps)
  }

  const productGids = await deps.resolveProductGids({ handles: parsed.handles, skus: parsed.skus })
  if (productGids.length === 0) {
    // Fail closed: never mint a catalog-wide code. A promo with no resolvable
    // eligible product is not actionable, per the promo-manager bound-the-reach rule.
    return refuse(row, parsed, 'no-eligible-products', 0, deps)
  }

  // decidePromo(ok) guarantees code, percentage, and the window are present.
  const variables = buildDiscountVariables({
    code: parsed.code as string,
    percentage: parsed.percentage as number,
    startsAt: parsed.startsAt as string,
    endsAt: parsed.endsAt as string,
    productGids,
  })

  let result: ShopifyDiscountResult
  try {
    result = await deps.createDiscount(variables)
  } catch (err) {
    const reason = `shopify-error: ${err instanceof Error ? err.message : String(err)}`
    await deps.addNote(row.id, `Promo mint FAILED (${reason}). No code created.`)
    return { minted: false, reason }
  }

  if (result.userErrors.length > 0 || !result.id) {
    const detail = result.userErrors.map(e => e.message).join('; ') || 'no discount id returned'
    const reason = `shopify-user-error: ${detail}`
    await deps.addNote(row.id, `Promo mint FAILED (${reason}). No code created.`)
    return { minted: false, reason }
  }

  const mail = buildPromoOwnerEmail({
    suggestionId: row.id,
    outcome: 'minted',
    code: parsed.code,
    percentage: parsed.percentage,
    startsAt: parsed.startsAt,
    endsAt: parsed.endsAt,
    productCount: productGids.length,
    reason: 'ok',
    discountId: result.id,
    body: parsed.body,
  })
  const sent = await deps.sendOwnerEmail(mail.subject, mail.html, { escalation: 'owner-decision', fromName: 'xdipx promo' })
  await deps.addNote(
    row.id,
    `Shopify discount code minted: ${parsed.code} (${parsed.percentage}% off, ${parsed.startsAt} to ${parsed.endsAt}, ${productGids.length} products). Discount id: ${result.id}.`,
  )

  return {
    minted: true,
    reason: 'ok',
    discountId: result.id,
    code: parsed.code as string,
    ownerEmailed: sent.sent,
  }
}

// ─── Execution pass (ticket #8022) ─────────────────────────────────────────
//
// Was inlined in scripts/execute-approved-promos.ts::main() as the ONLY
// caller of executeApprovedPromo/defaultPromoExecuteDeps, which meant this
// pass only ran when the weekly strategy cloud routine invoked the script,
// roughly once a week. executeApprovedPromo does not gate on "has the
// promo's window opened" -- it embeds startsAt/endsAt into the Shopify
// discountCodeBasicCreate mutation and lets Shopify enforce activation, so
// running this pass daily (or more often) is safe and in fact desirable: an
// approved promo whose window opens between weekly runs currently misses it
// entirely (two consecutive live incidents, #6757/#6756 and predecessor
// #5231). The fix is cadence, not logic, so the loop now lives here with one
// implementation, callable from both the daily cron (server/cron.ts) and the
// script (which stays a thin wrapper for the manual/weekly path).

const PROMO_HANDLED_NOTE_RE = /discount code minted|REFUSED \(|mint FAILED/i

async function promoAlreadyHandled(id: number): Promise<boolean> {
  const links = await db
    .select({ ref: suggestionLinks.ref })
    .from(suggestionLinks)
    .where(and(eq(suggestionLinks.suggestionId, id), eq(suggestionLinks.kind, 'note')))
  return links.some(l => PROMO_HANDLED_NOTE_RE.test(l.ref ?? ''))
}

export interface PromoExecutionPassResult {
  total: number
  minted: number
  refused: number
  skipped: number
}

/**
 * Mint a Shopify discount code for every APPROVED, MAP-clean promo brief that
 * has not already been handled. Valve-gated (via `deps.getSetting`) inside
 * `executeApprovedPromo` itself, so with `promo_execute_enabled` off this
 * still lists rows but mints nothing and adds no notes. Idempotent: a promo
 * row that already carries an execution note (minted, refused, or failed) is
 * skipped, so calling this from multiple schedules never double-mints or
 * re-spams the owner.
 */
export async function runPromoExecutionPass(
  deps: PromoExecuteDeps = defaultPromoExecuteDeps(),
): Promise<PromoExecutionPassResult> {
  const rows = await listSuggestions({
    team: 'strategy',
    kinds: ['promo'],
    statuses: ['approved'],
    orderBy: 'age',
  })

  let minted = 0
  let refused = 0
  let skipped = 0
  for (const row of rows) {
    if (await promoAlreadyHandled(row.id)) {
      skipped++
      console.log(`[promo-execute] #${row.id} already handled. Skipping.`)
      continue
    }
    const res = await executeApprovedPromo({ id: row.id, suggestion: row.suggestion }, deps)
    if (res.minted) {
      minted++
      console.log(`[promo-execute] #${row.id} minted ${res.code} (${res.discountId}).`)
    } else if (res.refused) {
      refused++
      console.log(`[promo-execute] #${row.id} refused: ${res.reason}.`)
    } else {
      console.log(`[promo-execute] #${row.id} not minted: ${res.reason}.`)
    }
  }

  console.log(`[promo-execute] done. minted=${minted} refused=${refused} skipped=${skipped} of ${rows.length}.`)
  return { total: rows.length, minted, refused, skipped }
}
