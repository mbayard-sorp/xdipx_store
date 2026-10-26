import { inArray } from 'drizzle-orm'
import { db } from './db.server'
import { nalpacPriceHistory } from '../../db/schema'
import { isNalpacMapVerifiedBrand } from './nalpac-dropship-policy'
import { fileBlocker, type BlockerInput } from './owner-blockers.server'
import { listSuggestions } from './team.server'
import { adminGraphQL } from './shopify.server'

/**
 * Daily discount-exposure audit (ticket #18006).
 *
 * X25XPOFF (created 2026-10-24) was a live, catalog-wide, open-ended Shopify
 * discount code with no bus row, no repo reference, and no ticket -- found
 * only because a strategy run happened to read Shopify directly. CURIOUS15,
 * FIRSTLOOK10, and buyonshop10 were the same: nothing watches "a live
 * discount code exists with no paper trail" on its own.
 *
 * Read-only: never calls a discount mutation. For every ACTIVE code discount
 * that is catalog-wide (items: all, context: all) or open-ended (no end date
 * and no usage limit) -- the shapes the pricing engine's own MAP/cost floors
 * do not protect against, because they gate the markup rules, not a discount
 * code applied on top of them -- this computes the exposure (in-stock
 * variants that would sell below wholesale cost, products where MAP already
 * equals MSRP so there is no legal discount room, variants belonging to a
 * Nalpac MAP-verified contractual brand) and files an owner blocker when the
 * code is not already covered by an open `kind:'promo'` suggestion row.
 */

// ─── Pure ───────────────────────────────────────────────────────────────────

export interface UnboundedCheckInput {
  itemsAll: boolean
  contextAll: boolean
  endsAt: string | null
  usageLimit: number | null
}

/**
 * True when an ACTIVE code discount carries none of the guardrails the
 * pricing engine's own floors would otherwise provide: scoped to the whole
 * catalog for every buyer, or with neither an end date nor a usage cap.
 */
export function isUnboundedExposure(d: UnboundedCheckInput): boolean {
  const catalogWide = d.itemsAll && d.contextAll
  const openEnded = d.endsAt == null && d.usageLimit == null
  return catalogWide || openEnded
}

export interface CatalogVariant {
  sku: string
  vendor: string
  price: number
  availableForSale: boolean
}

export interface PriceFloorRow {
  wholesale: number | null
  msrp: number | null
  mapPrice: number | null
}

export interface ExposureCounts {
  belowCostCount: number
  mapEqualsMsrpCount: number
  contractualBrandVariantCount: number
}

/**
 * The three exposure numbers for one code's percentage against the live
 * catalog. A variant counts toward `belowCostCount` only when it is actually
 * in stock (an out-of-stock variant cannot be sold below cost) and this
 * store carries a wholesale cost for its SKU to compare against.
 */
export function computeExposureCounts(
  percentage: number,
  variants: readonly CatalogVariant[],
  floors: ReadonlyMap<string, PriceFloorRow>,
): ExposureCounts {
  let belowCostCount = 0
  let mapEqualsMsrpCount = 0
  let contractualBrandVariantCount = 0
  for (const v of variants) {
    const floor = floors.get(v.sku)
    const discounted = v.price * (1 - percentage)
    if (v.availableForSale && floor?.wholesale != null && discounted < floor.wholesale) belowCostCount++
    if (floor?.mapPrice != null && floor.msrp != null && floor.mapPrice === floor.msrp) mapEqualsMsrpCount++
    if (isNalpacMapVerifiedBrand(v.vendor)) contractualBrandVariantCount++
  }
  return { belowCostCount, mapEqualsMsrpCount, contractualBrandVariantCount }
}

/** Case-insensitive: does this code appear anywhere in an open promo row's text? */
export function codeAppearsInPromoRows(code: string, rowTexts: readonly string[]): boolean {
  const needle = code.toLowerCase()
  return rowTexts.some(t => t.toLowerCase().includes(needle))
}

// ─── Dependency seam ────────────────────────────────────────────────────────

export interface ExposedDiscount {
  code: string
  discountId: string
  /** 0..1. */
  percentage: number
  endsAt: string | null
  usageLimit: number | null
}

export interface DiscountExposureDeps {
  /** Every ACTIVE code discount that `isUnboundedExposure` flags. Filtered live so the audit never has to page the whole discount list twice. */
  listExposedDiscounts: () => Promise<ExposedDiscount[]>
  listCatalogVariants: () => Promise<CatalogVariant[]>
  getPriceFloors: (skus: readonly string[]) => Promise<Map<string, PriceFloorRow>>
  isCoveredByOpenPromo: (code: string) => Promise<boolean>
  fileBlocker: (input: BlockerInput) => Promise<unknown>
}

// Non-terminal promo-row statuses: a code already proposed, approved, in
// flight, or shipped through the bus is covered, even if the row text does
// not name the live discount's exact Shopify id.
const OPEN_PROMO_STATUSES = ['proposed', 'approved', 'in_progress', 'pr_open', 'in_review', 'verified', 'applied'] as const

async function isCoveredByOpenPromoLive(code: string): Promise<boolean> {
  const rows = await listSuggestions({ kinds: ['promo'], statuses: OPEN_PROMO_STATUSES, limit: 100 })
  return codeAppearsInPromoRows(code, rows.map(r => r.suggestion))
}

async function getPriceFloorsLive(skus: readonly string[]): Promise<Map<string, PriceFloorRow>> {
  const floors = new Map<string, PriceFloorRow>()
  if (skus.length === 0) return floors
  const rows = await db
    .select({ sku: nalpacPriceHistory.sku, wholesale: nalpacPriceHistory.wholesale, msrp: nalpacPriceHistory.msrp, mapPrice: nalpacPriceHistory.mapPrice })
    .from(nalpacPriceHistory)
    .where(inArray(nalpacPriceHistory.sku, [...skus]))
  for (const r of rows) {
    floors.set(r.sku, {
      wholesale: r.wholesale != null ? Number(r.wholesale) : null,
      msrp: r.msrp != null ? Number(r.msrp) : null,
      mapPrice: r.mapPrice != null ? Number(r.mapPrice) : null,
    })
  }
  return floors
}

/**
 * Every ACTIVE, in-stock-relevant variant: sku, vendor, price, availability.
 * Mirrors the paging shape of `fetchActiveProductsForMapSweep`
 * (shopify.server.ts), minus its single-vendor filter, because an
 * `items: all` discount is scoped to the whole catalog.
 */
async function listCatalogVariantsLive(): Promise<CatalogVariant[]> {
  type Node = { vendor: string; variants: { nodes: { sku: string | null; price: string; availableForSale: boolean }[] } }
  const out: CatalogVariant[] = []
  let after: string | null = null
  for (;;) {
    const data: { products: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } =
      await adminGraphQL(`
        query DiscountExposureCatalogVariants($after: String) {
          products(first: 50, after: $after, query: "status:active") {
            nodes {
              vendor
              variants(first: 100) { nodes { sku price availableForSale } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, { after })
    for (const p of data.products.nodes) {
      for (const v of p.variants.nodes) {
        if (!v.sku) continue
        out.push({ sku: v.sku, vendor: p.vendor, price: Number(v.price), availableForSale: v.availableForSale })
      }
    }
    if (!data.products.pageInfo.hasNextPage) break
    after = data.products.pageInfo.endCursor
  }
  return out
}

/**
 * Every ACTIVE code discount, filtered to the unbounded shapes
 * `isUnboundedExposure` flags. Field shapes verified live against the Admin
 * schema (2026-10-26): `DiscountCodeBasic.context` and
 * `DiscountCustomerGets.items` are both unions read by `__typename`
 * (`DiscountBuyerSelectionAll`, `AllDiscountItems`), and
 * `DiscountCustomerGetsValue` is read the same way for `DiscountPercentage`.
 */
async function listExposedDiscountsLive(): Promise<ExposedDiscount[]> {
  type Node = {
    id: string
    discount: {
      __typename: string
      codes?: { nodes: { code: string }[] }
      endsAt?: string | null
      usageLimit?: number | null
      context?: { __typename: string }
      customerGets?: { items: { __typename: string }; value: { __typename: string; percentage?: number } }
    }
  }
  const out: ExposedDiscount[] = []
  let after: string | null = null
  for (;;) {
    const data: { discountNodes: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } =
      await adminGraphQL(`
        query ActiveCodeDiscountsForExposureAudit($after: String) {
          discountNodes(first: 50, after: $after, query: "status:active method:code") {
            nodes {
              id
              discount {
                __typename
                ... on DiscountCodeBasic {
                  codes(first: 1) { nodes { code } }
                  endsAt
                  usageLimit
                  context { __typename }
                  customerGets {
                    items { __typename }
                    value { __typename ... on DiscountPercentage { percentage } }
                  }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, { after })
    for (const n of data.discountNodes.nodes) {
      const d = n.discount
      if (d.__typename !== 'DiscountCodeBasic') continue
      const code = d.codes?.nodes[0]?.code
      if (!code) continue
      const itemsAll = d.customerGets?.items.__typename === 'AllDiscountItems'
      const contextAll = d.context?.__typename === 'DiscountBuyerSelectionAll'
      const endsAt = d.endsAt ?? null
      const usageLimit = d.usageLimit ?? null
      if (!isUnboundedExposure({ itemsAll, contextAll, endsAt, usageLimit })) continue
      const percentage = d.customerGets?.value.__typename === 'DiscountPercentage' ? (d.customerGets.value.percentage ?? 0) : 0
      out.push({ code, discountId: n.id, percentage, endsAt, usageLimit })
    }
    if (!data.discountNodes.pageInfo.hasNextPage) break
    after = data.discountNodes.pageInfo.endCursor
  }
  return out
}

export function defaultDiscountExposureDeps(): DiscountExposureDeps {
  return {
    listExposedDiscounts: listExposedDiscountsLive,
    listCatalogVariants: listCatalogVariantsLive,
    getPriceFloors: getPriceFloorsLive,
    isCoveredByOpenPromo: isCoveredByOpenPromoLive,
    fileBlocker,
  }
}

// ─── Orchestration ──────────────────────────────────────────────────────────

export interface ExposureFinding extends ExposureCounts {
  code: string
  covered: boolean
  blockerFiled: boolean
}

export interface DiscountExposureAuditResult {
  exposed: number
  findings: ExposureFinding[]
}

function blockerDetail(code: string, d: Pick<ExposedDiscount, 'endsAt' | 'usageLimit' | 'percentage'>, counts: ExposureCounts): string {
  const pct = Math.round(d.percentage * 100)
  const bits = [
    `${counts.belowCostCount} in-stock variant(s) would sell below wholesale cost at ${pct}% off`,
    `${counts.mapEqualsMsrpCount} product(s) have MAP equal to MSRP (no legal room for any discount)`,
    `${counts.contractualBrandVariantCount} variant(s) belong to a Nalpac MAP-verified (contractual) brand`,
  ]
  if (d.endsAt == null) bits.push('no end date')
  if (d.usageLimit == null) bits.push('no usage limit')
  return `Code ${code}: ${bits.join('; ')}.`
}

/**
 * Read-only sweep: find every ACTIVE, unbounded code discount, compute its
 * exposure against the live catalog, and file an owner blocker for any that
 * no open `kind:'promo'` row covers. `fileBlocker` dedupes on
 * `discount-exposure:<code>`, so re-running reopens/extends the same row
 * rather than filing a duplicate.
 */
export async function runDiscountExposureAudit(
  deps: DiscountExposureDeps = defaultDiscountExposureDeps(),
): Promise<DiscountExposureAuditResult> {
  const exposed = await deps.listExposedDiscounts()
  if (exposed.length === 0) return { exposed: 0, findings: [] }

  const variants = await deps.listCatalogVariants()
  const skus = [...new Set(variants.map(v => v.sku))]
  const floors = await deps.getPriceFloors(skus)

  const findings: ExposureFinding[] = []
  for (const d of exposed) {
    const counts = computeExposureCounts(d.percentage, variants, floors)
    const covered = await deps.isCoveredByOpenPromo(d.code)
    let blockerFiled = false
    if (!covered) {
      await deps.fileBlocker({
        dedupeKey: `discount-exposure:${d.code.toLowerCase()}`,
        title: `Discount code ${d.code} is live with no promo row covering it`,
        detail: blockerDetail(d.code, d, counts),
        category: 'decision',
        priority: counts.belowCostCount > 0 || counts.contractualBrandVariantCount > 0 ? 1 : 2,
        source: 'sweep',
        sourceRef: d.discountId,
        evidence: `discountNodes (status:active method:code) + ${variants.length} live catalog variants + nalpac_price_history, read ${new Date().toISOString().slice(0, 10)}`,
      })
      blockerFiled = true
    }
    findings.push({ code: d.code, ...counts, covered, blockerFiled })
  }

  return { exposed: exposed.length, findings }
}
