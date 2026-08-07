import { getPipelineSetting } from './feed-processor.server'
import { sendOwnerEmail, escapeHtml } from './owner-alerts.server'
import { addSuggestionNote } from './team.server'
import { getProductsByHandles, adminGraphQL } from './shopify.server'

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
 * Conservative MAP-conflict signals. Every brief mentions "MAP" (the guard is
 * part of the format), so we match only explicit conflict phrasing, never the
 * bare word, to avoid refusing a clean promo whose note says "MAP check: clean".
 */
const MAP_CONFLICT_RE =
  /\bmap\b[^.\n]*\b(conflict|violation|violat\w*|risk|issue|flagged?|breach)\b|\b(below|under|beneath|breaks?|breaches?|fails?)\s+map\b|\bnot\s+map[\s-]*compliant\b/i

export interface ParsedPromo {
  code: string | null
  /** Discount depth as a whole-number percent, 1 to 99. */
  percentage: number | null
  /** ISO 8601 datetimes derived from the two dated boundaries in the brief. */
  startsAt: string | null
  endsAt: string | null
  /** Product handles pulled from /products/<handle> links in the brief. */
  handles: string[]
  mapNote: string | null
  body: string
}

export interface PromoDecision {
  ok: boolean
  /**
   * 'ok' | 'map-conflict-flagged' | 'no-code' | 'no-depth' |
   * 'no-explicit-window' | 'invalid-window'
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

/** True when the brief text flags a MAP conflict. Conservative: explicit phrasing only. */
export function detectMapConflict(text: string): boolean {
  return MAP_CONFLICT_RE.test(text)
}

/** Best-effort structured extraction from a free-text promo brief. */
export function parsePromoBrief(text: string): ParsedPromo {
  const codeMatch = text.match(/^\s*code\s*[^:\n]*:\s*([A-Za-z0-9][A-Za-z0-9_-]{2,39})/im)
  const code = codeMatch?.[1] ? codeMatch[1].trim() : null

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

export interface PromoExecuteDeps {
  getSetting: (key: string) => Promise<string | null>
  resolveProductGids: (handles: string[]) => Promise<string[]>
  createDiscount: (variables: Record<string, unknown>) => Promise<ShopifyDiscountResult>
  sendOwnerEmail: (
    subject: string,
    html: string,
    opts?: { fromName?: string },
  ) => Promise<{ sent: boolean; error?: string }>
  addNote: (id: number, ref: string) => Promise<void>
}

async function resolveProductGidsLive(handles: string[]): Promise<string[]> {
  if (handles.length === 0) return []
  const products = await getProductsByHandles(handles)
  return products.map(p => p.id).filter((id): id is string => !!id)
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
  const sent = await deps.sendOwnerEmail(mail.subject, mail.html, { fromName: 'xdipx promo' })
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

  const productGids = await deps.resolveProductGids(parsed.handles)
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
  const sent = await deps.sendOwnerEmail(mail.subject, mail.html, { fromName: 'xdipx promo' })
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
