// cost-sync.server.ts
//
// WS3: Nalpac price-drop / cost-sync loop (ADR-007:
// docs/adr/ADR-007-pricing-engine-convergence.md).
//
// Detects a material Nalpac wholesale/MAP DROP on a CARRIED sku (vs the last
// observed snapshot in nalpac_price_history), syncs the fresh cost/MAP
// metafields to Shopify, then reprices through recomputeVariant (the v2
// pricing engine) so the resulting row lands in pricing_audit_log -- the
// monitored table. This module never imports pricing-apply.server.ts /
// pricing-engine.server.ts / processNalpacCostChanges (v1). See ADR-007
// decision 1.
//
// Gated end-to-end by the dedicated `pricing_costsync_enabled` kill switch
// (default 'false', migration 061) -- NOT the pre-existing
// `pricing_webhook_enabled` (that one is "is the external Nalpac webhook on",
// a v1 concern). While the switch is off, this module makes no DB writes and
// no Shopify calls at all.
//
// Called from runImportMonitor() (app/lib/import-monitor.server.ts) once per
// daily run. Best-effort: a single bad SKU/variant is caught and logged, never
// aborts the batch, and this function never throws out of the cron.

import { inArray, sql } from 'drizzle-orm'
import { db } from './db.server'
import { nalpacPriceHistory } from '../../db/schema'
import { getPipelineSetting } from './feed-processor.server'
import { findVariantsBySkus, updateProductMetafield } from './shopify.server'
import { recomputeVariant } from './pricing-apply-v2.server'
import type { NalpacPriceSnapshot } from './nalpac-feeds.server'

export interface CostSyncResult {
  /** Whether pricing_costsync_enabled was 'true' for this run. */
  enabled: boolean
  /** Carried SKUs present in today's feed that were diffed against history. */
  skusChecked: number
  /** SKUs where a material wholesale/MAP drop was detected (and not already
   *  synced today). */
  dropsDetected: number
  /** Variants successfully pushed through updateProductMetafield +
   *  recomputeVariant without throwing. */
  variantsRepriced: number
  errors: string[]
}

const DISABLED_RESULT: CostSyncResult = {
  enabled:          false,
  skusChecked:      0,
  dropsDetected:    0,
  variantsRepriced: 0,
  errors:           [],
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Derive an approximate observed sale price from the snapshot. The Nalpac
 * sale feed's raw "Sale Price"/"Promo Price"/"On Sale Price" column isn't
 * carried on NalpacPriceSnapshot (only the derived nalpacDiscountPct is), so
 * this reconstructs it from msrp * (1 - discount). Informational only -- the
 * drop rule below never reads this field.
 */
function deriveSalePrice(snap: NalpacPriceSnapshot): number | null {
  if (!snap.inSaleFeed || snap.nalpacDiscountPct == null || snap.msrp <= 0) return null
  return round2(snap.msrp * (1 - snap.nalpacDiscountPct))
}

/**
 * Run the daily cost-sync pass over today's Nalpac feed snapshots, scoped to
 * the carried catalog. No-ops entirely (no DB write, no Shopify call) unless
 * `pricing_costsync_enabled` is 'true'.
 */
export async function runNalpacCostSync(opts: {
  snapshots: Map<string, NalpacPriceSnapshot>
  carriedSkus: Set<string>
}): Promise<CostSyncResult> {
  try {
    const enabledVal = await getPipelineSetting('pricing_costsync_enabled')
    if (enabledVal !== 'true') {
      console.info('[cost-sync] pricing_costsync_enabled is off; skipping')
      return DISABLED_RESULT
    }

    const { snapshots, carriedSkus } = opts

    // Carried SKUs present in today's feed only -- bound to the carried
    // catalog, never the full ~15,500-sku feed.
    const carriedInFeed = [...carriedSkus].filter(sku => snapshots.has(sku))

    const result: CostSyncResult = {
      enabled:          true,
      skusChecked:      carriedInFeed.length,
      dropsDetected:    0,
      variantsRepriced: 0,
      errors:           [],
    }

    if (carriedInFeed.length === 0) return result

    const dropPctRaw = await getPipelineSetting('import_monitor_watch_price_drop_pct')
    const dropPct = parseFloat(dropPctRaw ?? '0.10') || 0.10

    // 1. Load prior ("last observed") rows for these SKUs.
    const priorRows = await db
      .select()
      .from(nalpacPriceHistory)
      .where(inArray(nalpacPriceHistory.sku, carriedInFeed))
    const priorBySku = new Map(priorRows.map(r => [r.sku, r]))

    const today = todayIso()
    const now = new Date()

    const dropSkus: string[] = []
    type HistoryRow = typeof nalpacPriceHistory.$inferInsert
    const upsertRows: HistoryRow[] = []

    // 2 + 3 + 4. Per-sku: detect drop, apply day-scoped idempotency, and
    // always build the fresh observation row.
    for (const sku of carriedInFeed) {
      const snap = snapshots.get(sku)
      if (!snap) continue // shouldn't happen given the filter above, but be safe

      const prior = priorBySku.get(sku)
      let isDrop = false

      if (prior) {
        const priorWholesale = prior.wholesale != null ? parseFloat(prior.wholesale) : 0
        const priorMap       = prior.mapPrice  != null ? parseFloat(prior.mapPrice)  : 0
        const newWholesale   = snap.wholesale
        const newMap         = snap.mapPrice ?? 0

        const wholesaleDrop = priorWholesale > 0 && newWholesale > 0 &&
          newWholesale <= priorWholesale * (1 - dropPct)
        const mapDrop = priorMap > 0 && newMap > 0 &&
          newMap <= priorMap * (1 - dropPct)

        isDrop = wholesaleDrop || mapDrop

        if (isDrop && prior.syncedAt != null) {
          const syncedToday = prior.syncedAt.toISOString().slice(0, 10) === today
          if (syncedToday) isDrop = false // already emitted this drop today; don't re-fire on a same-day retry
        }
      }

      if (isDrop) {
        dropSkus.push(sku)
        result.dropsDetected++
      }

      const nalpacDiscountPct = snap.nalpacDiscountPct != null
        ? round2(snap.nalpacDiscountPct)
        : null
      const salePrice = deriveSalePrice(snap)

      upsertRows.push({
        sku,
        wholesale:         snap.wholesale > 0 ? String(snap.wholesale) : null,
        msrp:              snap.msrp > 0 ? String(snap.msrp) : null,
        mapPrice:          snap.mapPrice != null ? String(snap.mapPrice) : null,
        salePrice:         salePrice != null ? String(salePrice) : null,
        qty:               snap.qty,
        nalpacDiscountPct: nalpacDiscountPct != null ? String(nalpacDiscountPct) : null,
        inTop100:          snap.inTop100Feed,
        inNew:             snap.inNewFeed,
        inSale:            snap.inSaleFeed,
        observedAt:        now,
        // Sticky across days: only advance synced_at for SKUs that actually
        // fire a sync this run; otherwise carry forward whatever was there.
        syncedAt:          isDrop ? now : (prior?.syncedAt ?? null),
      })
    }

    // Batch upsert (chunked, mirrors findVariantsBySkus' 50-per-query batching
    // pattern below). Best-effort: a write failure here doesn't block the
    // Shopify sync pass for the SKUs already identified as drops.
    const UPSERT_BATCH = 200
    for (let i = 0; i < upsertRows.length; i += UPSERT_BATCH) {
      const chunk = upsertRows.slice(i, i + UPSERT_BATCH)
      try {
        await db
          .insert(nalpacPriceHistory)
          .values(chunk)
          .onConflictDoUpdate({
            target: nalpacPriceHistory.sku,
            set: {
              wholesale:         sql`excluded.wholesale`,
              msrp:              sql`excluded.msrp`,
              mapPrice:          sql`excluded.map_price`,
              salePrice:         sql`excluded.sale_price`,
              qty:               sql`excluded.qty`,
              nalpacDiscountPct: sql`excluded.nalpac_discount_pct`,
              inTop100:          sql`excluded.in_top100`,
              inNew:             sql`excluded.in_new`,
              inSale:            sql`excluded.in_sale`,
              observedAt:        sql`excluded.observed_at`,
              syncedAt:          sql`excluded.synced_at`,
            },
          })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[cost-sync] price-history upsert batch failed:', msg)
        result.errors.push(`history upsert batch: ${msg}`)
      }
    }

    if (dropSkus.length === 0) return result

    // 5. Resolve drop SKUs to Shopify variants, sync cost/MAP metafields, then
    // reprice through the v2 engine. Best-effort per SKU.
    let matches: Awaited<ReturnType<typeof findVariantsBySkus>> = []
    try {
      matches = await findVariantsBySkus(dropSkus)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[cost-sync] findVariantsBySkus failed:', msg)
      result.errors.push(`findVariantsBySkus: ${msg}`)
      return result
    }

    for (const match of matches) {
      const sku = match.variant.sku
      const snap = sku ? snapshots.get(sku) : undefined
      if (!snap) continue

      try {
        if (snap.wholesale > 0) {
          await updateProductMetafield(
            match.productGid,
            'wholesale_cost',
            String(snap.wholesale),
            'number_decimal',
          )
        }
        if (snap.mapPrice != null && snap.mapPrice > 0) {
          await updateProductMetafield(
            match.productGid,
            'map_price',
            String(snap.mapPrice),
            'number_decimal',
          )
        }

        await recomputeVariant({ variantId: match.variant.variantId, trigger: 'webhook' })
        result.variantsRepriced++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[cost-sync] variant sync failed for sku ${sku}:`, msg)
        result.errors.push(`${sku}: ${msg}`)
      }
    }

    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cost-sync] runNalpacCostSync failed:', msg)
    return {
      enabled:          true,
      skusChecked:      0,
      dropsDetected:    0,
      variantsRepriced: 0,
      errors:           [msg],
    }
  }
}
