import { getPipelineSetting } from './feed-processor.server'
import { sendOwnerEmail, escapeHtml } from './owner-alerts.server'
import type { EscalationClassName } from './owner-escalation'
import { addSuggestionNote } from './team.server'
import { getProductsByHandles, findProductBySKU, adminGraphQL } from './shopify.server'

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
 */
const MAP_FAIL_RE =
  /\bmap\b[^.\n]{0,40}?\b(?:conflict|violation|violates?|breach(?:es|ed)?|fail(?:s|ed|ure)?|flagged?)\b|\b(?:violates?|breaches?|breaking)\s+map\b|\bnot\s+map[\s-]*compliant\b|\bmap[\s-]*(?:check|status|result)[\s:_-]*fail/i

const MAP_PASS_RE =
  /\bmap\b[^.\n]{0,40}?\b(?:pass(?:ed|es)?|clean|clear|compliant|legal)\b|\bmap[\s_]*(?:price)?[\s_]*=?\s*0\b/i

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
   * 'ok' | 'map-conflict-flagged' | 'map-not-confirmed' | 'no-code' |
   * 'no-depth' | 'no-explicit-window' | 'invalid-window'
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

/** True when the brief carries an explicit MAP-FAIL verdict about this promo. */
export function detectMapConflict(text: string): boolean {
  return MAP_FAIL_RE.test(text)
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
 * Extract eligible product SKUs from labelled lists. Only numbers that directly
 * follow a "SKU"/"SKUs" label are taken, so counts written elsewhere as "SKUs
 * (1503 MAP-locked ...)" and dollar/percent figures are never mistaken for a
 * scope. Row #51 writes them as "SKUs 84740/84743/84747/84748; ...".
 */
export function extractSkus(text: string): string[] {
  const skus = new Set<string>()
  for (const m of text.matchAll(/\bskus?\b\s*:?\s*(\d[\d,/\s]*\d)/gi)) {
    for (const n of (m[1] as string).split(/[^\d]+/)) {
      if (n.length >= 3) skus.add(n)
    }
  }
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
 * The pre-mint guard. Order matters: the loudest, most safety-critical refusal
 * (a MAP conflict) is reported first, then the structural requirements.
 */
export function decidePromo(parsed: ParsedPromo, fullText: string): PromoDecision {
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

async function refuse(
  row: { id: number },
  parsed: ParsedPromo,
  reason: string,
  productCount: number,
  deps: PromoExecuteDeps,
): Promise<PromoExecuteResult> {
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
