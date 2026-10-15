// engine-cost.ts
//
// Which cost the v2 pricing engine prices a variant off (pricing audit
// 2026-10-15). Pure, so the precedence rule is testable without Shopify or
// the DB.
//
// The engine prefers Shopify's inventoryItem.unitCost, which the third-party
// Nalpac Integration app writes. That app writes a Nalpac sale cost when a
// SKU goes on an "N% Off Sale" promo (unit cost lands at exactly 0.70, 0.60
// or 0.50 of list wholesale) but never raises it back when the promo ends.
// Our own code only writes unitCost once, at import. So a lapsed promo left
// ~946 variants pricing off a cost Nalpac no longer charges, and 247 of them
// sold at or below true cost.
//
// The fix: when today's feed is fresh, the SKU is not on a Nalpac sale (sale
// feed or "N% Off Sale" tag), and the unit cost sits below the feed's list
// wholesale, the unit cost is a lapsed sale cost and the feed wins. While a
// SKU is on sale, the lower unit cost is the account's real sale cost and is
// kept.

/** The cost-sync daily snapshot fields this rule reads (nalpac_price_history). */
export interface FeedCostSnapshot {
  /** Nalpac list wholesale as of observedAt. */
  wholesale: number | null
  /** Whether the SKU was on a Nalpac sale at observedAt (sale feed or "N% Off Sale" tag). */
  inSale: boolean
  observedAt: Date
}

export type EngineCostSource = 'unit_cost' | 'metafield' | 'feed' | 'none'

export interface EngineCost {
  cost: number | null
  source: EngineCostSource
  /** The Shopify unit cost the feed replaced, when source is 'feed'. */
  replacedUnitCost: number | null
}

/** A snapshot older than this is not trusted to say a promo has ended. */
export const FEED_COST_MAX_AGE_MS = 72 * 60 * 60 * 1000

/**
 * Unit cost below list wholesale by more than this is a lapsed sale cost.
 * Absorbs feed rounding (27.8 vs 27.80) and cent-level drift.
 */
export const STALE_COST_TOLERANCE = 0.98

export function resolveEngineCost(opts: {
  unitCost: number | null
  metafieldCost: number | null
  feed: FeedCostSnapshot | null
  now?: Date
}): EngineCost {
  const { unitCost, metafieldCost, feed } = opts
  const now = opts.now ?? new Date()

  const base = unitCost ?? metafieldCost
  const baseSource: EngineCostSource =
    unitCost != null ? 'unit_cost' : metafieldCost != null ? 'metafield' : 'none'

  const feedWholesale = feed?.wholesale ?? null
  const feedUsable =
    feed != null &&
    feedWholesale != null &&
    feedWholesale > 0 &&
    !feed.inSale &&
    now.getTime() - feed.observedAt.getTime() <= FEED_COST_MAX_AGE_MS

  if (feedUsable && (base == null || base < feedWholesale * STALE_COST_TOLERANCE)) {
    return { cost: feedWholesale, source: 'feed', replacedUnitCost: unitCost }
  }
  return { cost: base, source: baseSource, replacedUnitCost: null }
}

/**
 * The "N% Off Sale" tag Nalpac puts in a feed row's Main Category or
 * Sub-Category, as a fraction (0.40). Null when untagged. The tag is a better
 * sale signal than sale-feed membership alone: on 2026-10-15, 16 tagged SKUs
 * were missing from the sale feed while their unit cost sat at exactly the
 * tagged discount.
 */
export function nalpacSaleTagPct(row: Record<string, string> | undefined | null): number | null {
  if (!row) return null
  const text = `${row['Main Category'] ?? ''},${row['Sub-Category'] ?? ''}`
  const m = text.match(/(\d{1,2})%\s*Off\s*Sale/i)
  return m ? parseInt(m[1]!, 10) / 100 : null
}

/** One-line rationale suffix so the audit log says why the cost moved. */
export function engineCostNote(c: EngineCost): string {
  if (c.source !== 'feed' || c.cost == null) return ''
  const was = c.replacedUnitCost != null ? ` over Shopify unit cost $${c.replacedUnitCost.toFixed(2)}` : ''
  return ` Cost: Nalpac feed wholesale $${c.cost.toFixed(2)}${was} (lapsed sale cost, SKU no longer on a Nalpac sale).`
}
