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
import { fileDetectionTicket, makeDedupeKey, priorityFromSeverity } from './detection-tickets.server'
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
  /** SKUs where a material wholesale INCREASE was detected and FLAGGED via a
   *  detection ticket (ticket #10871). Never repriced automatically -- the
   *  drop side of this module exists to protect margin fast, but a cost rise
   *  is a "should we eat it or pass it on" call this module does not make. */
  increasesFlagged: number
  errors: string[]
}

const DISABLED_RESULT: CostSyncResult = {
  enabled:           false,
  skusChecked:       0,
  dropsDetected:     0,
  variantsRepriced:  0,
  increasesFlagged:  0,
  errors:            [],
}

/**
 * Per-run ceiling on new wholesale-rise detection tickets (ticket #10871), so
 * a broad feed-wide cost jump can't flood the product-team queue in one run.
 * `fileDetectionTicket`'s own dedupe already keeps a persistently-elevated SKU
 * from refiling every day while its ticket is still open; this cap is only
 * about the first run a rise is seen across many SKUs at once.
 */
const MAX_WHOLESALE_RISE_FLAGS_PER_RUN = 10

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
      enabled:           true,
      skusChecked:       carriedInFeed.length,
      dropsDetected:     0,
      variantsRepriced:  0,
      increasesFlagged:  0,
      errors:            [],
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
    // Ticket #10871: material wholesale INCREASE on a carried sku, the mirror
    // image of wholesaleDrop below. FLAGGED only (a detection ticket for
    // product/pricing to review), never pushed through updateProductMetafield
    // + recomputeVariant -- unlike a drop, passing a cost rise through to the
    // live sell price is a business call, not a mechanical margin-protection
    // sync, so this module stops at surfacing it.
    const riseFlags: { sku: string; priorWholesale: number; newWholesale: number }[] = []
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

        // Wholesale only, matching the ticket's explicit scope ("material
        // wholesale INCREASES") -- MAP rising is not the same margin-erosion
        // risk a silent wholesale rise is. Mutually exclusive with
        // wholesaleDrop by construction (dropPct > 0), so this never fires on
        // a sku already queued for a drop-sync above.
        const wholesaleRise = priorWholesale > 0 && newWholesale > 0 &&
          newWholesale >= priorWholesale * (1 + dropPct)
        if (wholesaleRise) riseFlags.push({ sku, priorWholesale, newWholesale })
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

    // 4b. File a FLAG-only detection ticket per material wholesale rise
    // (ticket #10871), capped per run. `fileDetectionTicket`'s own dedupe
    // (ON CONFLICT DO NOTHING while a same-key ticket is still open) keeps a
    // persistently-elevated sku from refiling every day on its own; the cap
    // here is only about a single run seeing many risers at once. Never
    // blocks or fails the drop-sync path below.
    for (const flag of riseFlags.slice(0, MAX_WHOLESALE_RISE_FLAGS_PER_RUN)) {
      try {
        const id = await fileDetectionTicket({
          detector:   'cost-sync',
          dedupeKey:  makeDedupeKey('cost-sync-wholesale-rise', flag.sku),
          priority:   priorityFromSeverity('P3'),
          category:   'other',
          kind:       'process',
          targetTeam: 'product',
          suggestion:
            `Carried SKU ${flag.sku}'s Nalpac wholesale cost rose from $${flag.priorWholesale.toFixed(2)} ` +
            `to $${flag.newWholesale.toFixed(2)} (>= the ${Math.round(dropPct * 100)}% material-change ` +
            `threshold this module also uses to detect a drop). This is a FLAG only: cost-sync never reprices ` +
            `on a rise the way it does on a drop, because passing a higher cost through to the live sell price ` +
            `is a business call, not a mechanical margin-protection sync. Confirm whether the live sell price ` +
            `still clears margin at the new wholesale, and reprice through the normal pricing pipeline if not. ` +
            `DONE WHEN: ${flag.sku}'s margin at its current live price is confirmed acceptable at the new ` +
            `wholesale, or it is repriced.`,
        })
        if (id) result.increasesFlagged++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[cost-sync] wholesale-rise flag failed for sku ${flag.sku}:`, msg)
        result.errors.push(`${flag.sku}: rise-flag ${msg}`)
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
      enabled:           true,
      skusChecked:       0,
      dropsDetected:     0,
      variantsRepriced:  0,
      increasesFlagged:  0,
      errors:            [msg],
    }
  }
}
