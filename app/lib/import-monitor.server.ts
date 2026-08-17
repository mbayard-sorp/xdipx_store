/**
 * Import Monitor — server core.
 *
 * Runs daily (via /cron/import-monitor) to diff the 4 Nalpac feeds against
 * the already-carried SKU set, collapse per-SKU snapshots into MasterRecords,
 * tier + gap-score each master, and upsert into import_candidates.
 * Fully deterministic, LLM-free.
 *
 * Phase 1: all candidates stay 'pending'; no auto-import.
 * Phase 2 (implemented): strict-gate auto-import via autoImportPhase2().
 * Phase 3: deferred. See the phase note below.
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { importCandidates, importMonitorRuns, dealHistory } from '../../db/schema'
import { kvGet, kvSet } from '~/lib/kv.server'
import { fetchAllNalpacFeeds } from '~/lib/nalpac-feeds.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { setPipelineSetting } from '~/lib/pricing-webhook.server'
import { runNalpacCostSync } from '~/lib/cost-sync.server'
import { computeTargetPrice } from '~/lib/pricing-engine.server'
import type { PricingSnapshot } from '~/lib/pricing-engine.server'
import { isSkuAlreadyImported } from '~/lib/bulk-import.server'
import {
  collapseMasters,
  detectAxes,
  isEligible,
  gapScore,
  needsReview,
} from '~/lib/master-collapse.server'
import type { MasterRecord } from '~/lib/master-collapse.server'
import type { BulkImportRow, BulkVariantRow, MasterProductGroup } from '~/types'

// ─── Public row types ──────────────────────────────────────────────────────────

export type ImportCandidateRow = typeof importCandidates.$inferSelect
export type ImportMonitorRunRow = typeof importMonitorRuns.$inferSelect

// ─── Run result ────────────────────────────────────────────────────────────────

export interface ImportMonitorResult {
  feedsOk: boolean
  candidatesFound: number
  candidatesNew: number
  candidatesResurfaced: number
  autoImported: number
  error?: string
}

// ─── KV keys ──────────────────────────────────────────────────────────────────

const KV_FEED_SKUS = 'monitor:feed-skus'

// ─── Phase 2 (implemented) / Phase 3 (deferred) ───────────────────────────────
// Phase 2 (`import_monitor_phase` = '2'): autoImportPhase2() below auto-imports
// masters that clear ALL strict gates (tier A/B, markup/qty/gapScore floors,
// carried-brand, hard MAP gate, not needsReview), up to a per-day cap. Gated by
// the import_monitor_enabled kill-switch. Everything else stays 'pending'.
// NOTE: dealScore is gap_score (~1-6 scale), NOT the old 0-1 per-SKU score.
//
// Phase 3 (`= '3'`, NOT YET BUILT): relax to tier A/B/C, higher cap, per-day
// volume guard, exception-only review. Do not enable until Phase 2 proves out.

// ─── Shared per-master compute helper ─────────────────────────────────────────

/**
 * Given a MasterRecord plus a carried-brand set and today's date string,
 * compute tier, gapReason, gapScore, pricing preview, and build the full
 * DB upsert payload.
 *
 * Used by both runImportMonitor and stageMasterCandidatesBySkus so there is
 * exactly one mapping code path.
 */
function buildMasterUpsertPayload(
  master: MasterRecord,
  carriedBrands: Set<string>,
  todayStr: string,
  overrides?: { gapReason?: string },
): {
  tier:          'A' | 'B' | 'C' | 'D'
  gapReason:     string
  score:         number
  upsertPayload: Omit<typeof importCandidates.$inferInsert, 'status' | 'firstSeenAt'>
} {
  const brand = master.brand.toLowerCase().trim()

  let tier: 'A' | 'B' | 'C' | 'D' = 'D'
  let gapReason = ''

  if (master.inTop100Feed) {
    tier = 'A'
    gapReason = 'In Nalpac top-100 feed, not yet in catalog'
  } else if (carriedBrands.has(brand) && master.marginMsrpPct >= 0.45) {
    tier = 'B'
    gapReason = `Brand "${master.brand}" already carried; margin ${(master.marginMsrpPct * 100).toFixed(0)}%, ${master.inStockVariants} variant(s) in stock`
  } else if (master.inNewFeed) {
    // New-products feed = "new item". Surfaced regardless of margin (all new
    // items belong on the site); margin is shown for the approval decision.
    tier = 'C'
    gapReason = `In Nalpac new-products feed; margin ${(master.marginMsrpPct * 100).toFixed(0)}%, ${master.inStockVariants} variant(s) in stock`
  } else {
    tier = 'D'
    gapReason = `Brand opportunity: "${master.brand}" has ${master.variantCount} qualifying variant(s) not in catalog; margin ${(master.marginMsrpPct * 100).toFixed(0)}%`
  }

  if (overrides?.gapReason) gapReason = overrides.gapReason

  const score = gapScore(master)

  const repSku = master.skus[0] ?? ''
  const pricingSnap: PricingSnapshot = {
    sku:               repSku,
    vendor:            master.brand,
    msrp:              master.msrp,
    wholesale:         master.wholesale,
    mapPrice:          master.map > 0 ? master.map : null,
    currentPrice:      master.msrp,
    currentCompareAt:  null,
    inSaleFeed:        master.inSaleFeed,
    nalpacDiscountPct: null,
  }
  const priceResult   = computeTargetPrice(pricingSnap)
  const proposedPrice = priceResult.newPrice
  const marginPct     = priceResult.marginPct * 100
  const profitPerUnit = proposedPrice - master.wholesale
  const imageCount    = master.sampleImage ? 1 : 0

  const { axes } = detectAxes(master)

  const upsertPayload = {
    sku:             repSku,
    brand:           master.brand,
    productTitle:    master.displayTitle,
    baseTitle:       master.baseTitle,
    categories:      [master.category],
    tier,
    gapReason,
    dealScore:       score.toFixed(3),
    msrp:            master.msrp.toFixed(2),
    wholesaleCost:   master.wholesale.toFixed(2),
    mapPrice:        master.map > 0 ? master.map.toFixed(2) : null,
    proposedPrice:   proposedPrice.toFixed(2),
    marginPct:       marginPct.toFixed(2),
    profitPerUnit:   profitPerUnit.toFixed(2),
    qtyAvailable:    master.totalQty,
    totalQty:        master.totalQty,
    imageCount,
    inTop100Feed:    master.inTop100Feed,
    inNewFeed:       master.inNewFeed,
    inSaleFeed:      master.inSaleFeed,
    masterKey:       master.masterKey,
    variantSkus:     master.skus,
    variantCount:    master.variantCount,
    inStockVariants: master.inStockVariants,
    colors:          master.colors,
    sizes:           master.sizes,
    volumes:         master.fluidOz,
    axes,
    needsReview:     needsReview(master),
    upc:             master.upcs[0] ?? null,
    sampleImage:     master.sampleImage || null,
    runDate:         todayStr,
    lastSeenAt:      new Date(),
    updatedAt:       new Date(),
  }

  return { tier, gapReason, score, upsertPayload }
}

// ─── Main monitor run ──────────────────────────────────────────────────────────

export async function runImportMonitor(
  opts: { source?: 'cron' | 'manual' } = {},
): Promise<ImportMonitorResult> {
  const source = opts.source ?? 'cron'
  const todayStr = new Date().toISOString().slice(0, 10)

  // 1. Insert a run row (started). Wrap everything; on error, finalize the row
  //    and return — cron must return 200.
  const insertedRuns = await db
    .insert(importMonitorRuns)
    .values({
      runDate:  todayStr,
      source,
      feedsOk:  false,
    })
    .returning({ id: importMonitorRuns.id })

  const runId = insertedRuns[0]?.id
  if (runId == null) {
    return {
      feedsOk:              false,
      candidatesFound:      0,
      candidatesNew:        0,
      candidatesResurfaced: 0,
      autoImported:         0,
      error:                'failed to insert importMonitorRuns row',
    }
  }

  try {
    // 2. Fetch all 4 Nalpac feeds (KV-cached by nalpac-feeds.server.ts).
    const feedResult = await fetchAllNalpacFeeds()
    const feedsOk = feedResult.errors.length === 0
    if (!feedsOk) {
      console.warn('[import-monitor] feed errors:', feedResult.errors)
    }

    // 3. Build CARRIED set from dealHistory (SKU + brand).
    const carriedRows = await db
      .selectDistinct({ sku: dealHistory.sku, brand: dealHistory.brand })
      .from(dealHistory)
    const carriedSkus = new Set(carriedRows.map(r => r.sku))
    const carriedBrands = new Set(
      carriedRows
        .map(r => r.brand?.toLowerCase().trim())
        .filter(Boolean) as string[],
    )

    // 3b. WS3 price-drop / cost-sync loop (ADR-007, v2 engine only). Gated
    // internally by pricing_costsync_enabled (default off); no-ops entirely
    // when the switch is off. runNalpacCostSync never throws (best-effort per
    // SKU/variant internally) but this call is wrapped anyway so a cost-sync
    // failure never marks the whole import-monitor run as failed.
    try {
      const costSyncResult = await runNalpacCostSync({
        snapshots: feedResult.snapshots,
        carriedSkus,
      })
      if (costSyncResult.enabled) {
        console.info(
          `[import-monitor] cost-sync: checked=${costSyncResult.skusChecked} ` +
          `drops=${costSyncResult.dropsDetected} repriced=${costSyncResult.variantsRepriced} ` +
          `errors=${costSyncResult.errors.length}`,
        )
        if (costSyncResult.errors.length > 0) {
          console.warn('[import-monitor] cost-sync errors:', costSyncResult.errors)
        }
      }
    } catch (err) {
      console.error('[import-monitor] cost-sync threw unexpectedly:', err)
    }

    // 4. New-product diff vs prior feed-SKU snapshot in KV.
    const currentFeedSkus = [...feedResult.snapshots.keys()]
    const priorFeedSkus = await kvGet<string[]>(KV_FEED_SKUS)
    const priorSet = new Set(priorFeedSkus ?? [])
    const _addedSkus = new Set(currentFeedSkus.filter(s => !priorSet.has(s)))
    void _addedSkus // reserved for Phase 2 new-product-diff alerting
    await kvSet(KV_FEED_SKUS, currentFeedSkus, 25 * 60 * 60) // 25h TTL

    // 5. Collapse flat SKU snapshots into master groups.
    const allMasters = collapseMasters(feedResult.snapshots)

    // 6. Drop masters where ANY of their SKUs is already carried.
    //    Then drop masters that fail isEligible (qty floor, no image, pricing).
    const eligibleMasters = allMasters.filter(master => {
      const anyCarried = master.skus.some(s => carriedSkus.has(s))
      if (anyCarried) return false
      const { ok } = isEligible(master)
      return ok
    })

    // 7. Read watch thresholds + max-candidates cap from pipelineSettings.
    const [watchScoreDeltaStr, watchPriceDropPctStr, phase, maxCandidatesStr] = await Promise.all([
      getPipelineSetting('import_monitor_watch_score_delta'),
      getPipelineSetting('import_monitor_watch_price_drop_pct'),
      getPipelineSetting('import_monitor_phase'),
      getPipelineSetting('import_monitor_max_candidates'),
    ])
    const watchScoreDelta = parseFloat(watchScoreDeltaStr ?? '0.10')
    const watchPriceDropPct = parseFloat(watchPriceDropPctStr ?? '0.10')
    const monitorPhase = phase ?? '1'
    const maxCandidates = Math.max(1, parseInt(maxCandidatesStr ?? '300', 10) || 300)

    // 8. Compute tier, gapReason, gapScore, and pricing preview for each master
    //    using the shared helper (same code path as stageMasterCandidatesBySkus).
    type EnrichedMaster = {
      master:        MasterRecord
      tier:          'A' | 'B' | 'C' | 'D'
      gapReason:     string
      score:         number
      upsertPayload: ReturnType<typeof buildMasterUpsertPayload>['upsertPayload']
    }

    const enriched: EnrichedMaster[] = eligibleMasters.map(master => {
      const { tier, gapReason, score, upsertPayload } = buildMasterUpsertPayload(
        master,
        carriedBrands,
        todayStr,
      )
      return { master, tier, gapReason, score, upsertPayload }
    })

    // 9. Rank + cap. Nalpac top-100 AND new-products masters must ALWAYS
    //    surface — proven sellers and new items both belong on the site — so
    //    they bypass the gap_score cap. Remaining slots go to the highest
    //    gap_score of the rest (carried-brand depth + brand opportunities).
    const sorted = enriched.sort((a, b) => b.score - a.score)
    const guaranteed = sorted.filter(e => e.master.inTop100Feed || e.master.inNewFeed)
    const rest       = sorted.filter(e => !(e.master.inTop100Feed || e.master.inNewFeed))
    const restSlots  = Math.max(0, maxCandidates - guaranteed.length)
    const capped = [...guaranteed, ...rest.slice(0, restSlots)]

    console.info(
      `[import-monitor] collapsed=${allMasters.length} eligible=${eligibleMasters.length} ` +
      `guaranteed=${guaranteed.length} capped=${capped.length} (max=${maxCandidates})`,
    )

    // 10. Load existing candidate rows keyed by masterKey for the capped set.
    const cappedKeys = capped.map(c => c.master.masterKey).filter(Boolean)
    const existingRows = cappedKeys.length > 0
      ? await db
          .select({
            masterKey:  importCandidates.masterKey,
            status:     importCandidates.status,
            watchScore: importCandidates.watchScore,
            watchPrice: importCandidates.watchPrice,
          })
          .from(importCandidates)
          .where(inArray(importCandidates.masterKey, cappedKeys))
      : []
    const existingByKey = new Map(existingRows.map(r => [r.masterKey ?? '', r]))

    let candidatesNew = 0
    let candidatesResurfaced = 0
    let candidatesFound = 0

    for (const { master, score, upsertPayload } of capped) {
      const masterKey = master.masterKey
      const proposedPrice = parseFloat(upsertPayload.proposedPrice as string)

      // 11. Upsert logic keyed on masterKey — same status lifecycle as before.
      const existing = existingByKey.get(masterKey)

      if (!existing) {
        // Net-new master.
        await db.insert(importCandidates).values({
          ...upsertPayload,
          status:     'pending',
          firstSeenAt: new Date(),
        }).onConflictDoNothing()
        candidatesNew++
        candidatesFound++
      } else if (existing.status === 'rejected' || existing.status === 'imported') {
        // Never reopen — bump lastSeenAt only.
        await db
          .update(importCandidates)
          .set({ lastSeenAt: new Date(), updatedAt: new Date() })
          .where(eq(importCandidates.masterKey, masterKey))
      } else if (existing.status === 'watching') {
        // Reopen to 'pending' if score improved materially OR price dropped materially.
        const priorScore = parseFloat(existing.watchScore ?? '0')
        const priorPrice = parseFloat(existing.watchPrice ?? '0')
        const scoreImproved = score >= priorScore + watchScoreDelta
        const priceDropped  = priorPrice > 0 && proposedPrice <= priorPrice * (1 - watchPriceDropPct)

        if (scoreImproved || priceDropped) {
          // Reopening clears the watch-era review stamp: a pending row must
          // never carry reviewed_by, or it reads as claimed and pollutes the
          // per-day action-cap count (ticket #554).
          await db
            .update(importCandidates)
            .set({ ...upsertPayload, status: 'pending', reviewedBy: null, reviewedAt: null })
            .where(eq(importCandidates.masterKey, masterKey))
          candidatesResurfaced++
          candidatesFound++
        } else {
          await db
            .update(importCandidates)
            .set({ lastSeenAt: new Date(), updatedAt: new Date() })
            .where(eq(importCandidates.masterKey, masterKey))
        }
      } else {
        // 'pending' or 'approved' — refresh metrics; keep status.
        await db
          .update(importCandidates)
          .set(upsertPayload)
          .where(eq(importCandidates.masterKey, masterKey))
        candidatesFound++
      }
    }

    // 12. Phase gating: auto-import.
    let autoImported = 0
    if (monitorPhase === '2') {
      autoImported = await autoImportPhase2(cappedKeys, carriedBrands, todayStr, allMasters)
    } else if (monitorPhase !== '1') {
      console.log(`[import-monitor] phase ${monitorPhase} auto-approve not yet implemented; treating as phase 1`)
    }

    // 13. Finalize run row.
    await db
      .update(importMonitorRuns)
      .set({
        finishedAt:           new Date(),
        feedsOk,
        candidatesFound,
        candidatesNew,
        candidatesResurfaced,
        autoImported,
      })
      .where(eq(importMonitorRuns.id, runId))

    await setPipelineSetting('import_monitor_last_run_at', new Date().toISOString())

    console.info(
      `[import-monitor] done: feedsOk=${feedsOk} found=${candidatesFound} ` +
      `new=${candidatesNew} resurfaced=${candidatesResurfaced}`,
    )

    return { feedsOk, candidatesFound, candidatesNew, candidatesResurfaced, autoImported }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[import-monitor] run failed:', errorMessage)

    await db
      .update(importMonitorRuns)
      .set({
        finishedAt:   new Date(),
        feedsOk:      false,
        errorMessage,
      })
      .where(eq(importMonitorRuns.id, runId))
      .catch(e => console.error('[import-monitor] could not write error to run row:', e))

    return {
      feedsOk:              false,
      candidatesFound:      0,
      candidatesNew:        0,
      candidatesResurfaced: 0,
      autoImported:         0,
      error:                errorMessage,
    }
  }
}

// ─── Phase 2 auto-import ───────────────────────────────────────────────────────

/**
 * Phase 2 partial automation. Auto-imports masters from the just-upserted capped
 * set that clear ALL strict gates, up to a per-day cap. Returns the number of
 * masters auto-imported this run.
 *
 * Gates (thresholds in pipeline_settings, defaults in code):
 *   - tier A or B only (C/D stay manual in Phase 2)
 *   - proposedPrice >= wholesaleCost * (1 + monitor_p2_min_markup_pct) (default 0.08) —
 *     no margin floor; volume is the goal, this only covers wholesale + processor fees
 *   - totalQty >= monitor_p2_min_qty (default 30)
 *   - dealScore (gap_score, ~1-6 scale) >= monitor_p2_min_gap_score (default 3.0)
 *   - brand already carried (monitor_p2_require_carried_brand, default true)
 *   - hard MAP gate: skip if mapPrice > 0 && proposedPrice < mapPrice
 *   - not needsReview (>30-variant masters never auto-import)
 *   - daily cap: monitor_p2_max_auto_imports_per_day (default 8), counted against
 *     import_candidates where status='imported' AND run_date=today
 *
 * The import_monitor_enabled kill-switch short-circuits before any auto-import.
 * Each import is wrapped in try/catch: a per-master failure is logged and skipped,
 * never thrown (the cron must always return 200).
 */
async function autoImportPhase2(
  cappedKeys: string[],
  carriedBrands: Set<string>,
  todayStr: string,
  allMasters: MasterRecord[],
): Promise<number> {
  // Kill-switch: defense-in-depth (the cron also gates this; manual runs do not).
  const enabled = await getPipelineSetting('import_monitor_enabled')
  if (enabled === 'false') {
    console.info('[import-monitor] phase 2 auto-import skipped: monitor disabled')
    return 0
  }

  if (cappedKeys.length === 0) return 0

  const [minMarkupStr, minQtyStr, minGapStr, requireCarriedStr, maxPerDayStr] = await Promise.all([
    getPipelineSetting('monitor_p2_min_markup_pct'),
    getPipelineSetting('monitor_p2_min_qty'),
    getPipelineSetting('monitor_p2_min_gap_score'),
    getPipelineSetting('monitor_p2_require_carried_brand'),
    getPipelineSetting('monitor_p2_max_auto_imports_per_day'),
  ])
  const minMarkupPct      = parseFloat(minMarkupStr ?? '0.08')
  const minQty            = parseInt(minQtyStr ?? '30', 10) || 30
  const minGapScore       = parseFloat(minGapStr ?? '3.0')
  const requireCarried    = (requireCarriedStr ?? 'true') !== 'false'
  const maxPerDay         = Math.max(0, parseInt(maxPerDayStr ?? '8', 10) || 0)

  if (maxPerDay <= 0) return 0

  // Tier-C (Nalpac new-products feed) auto-import: a separate, stricter branch
  // than A/B with its own daily sub-cap. Ships off (monitor_p2_tierC_enabled).
  // Admits all vendors for now per owner direction (30-day review, see runbook).
  const [tierCEnabledStr, tierCMinQtyStr, tierCMinGapStr, tierCMinMarkupStr, tierCMaxPerDayStr] = await Promise.all([
    getPipelineSetting('monitor_p2_tierC_enabled'),
    getPipelineSetting('monitor_p2_tierC_min_qty'),
    getPipelineSetting('monitor_p2_tierC_min_gap_score'),
    getPipelineSetting('monitor_p2_tierC_min_markup_pct'),
    getPipelineSetting('monitor_p2_tierC_max_per_day'),
  ])
  const tierCEnabled   = tierCEnabledStr === 'true'
  const tierCMinQty    = parseInt(tierCMinQtyStr ?? '60', 10) || 60
  const tierCMinGap    = parseFloat(tierCMinGapStr ?? '4.5')
  const tierCMinMarkup = parseFloat(tierCMinMarkupStr ?? '0.15')
  const tierCMaxPerDay = Math.max(0, parseInt(tierCMaxPerDayStr ?? '3', 10) || 0)

  // Daily cap: how many have already been imported today (auto or manual).
  const importedTodayRows = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(importCandidates)
    .where(and(eq(importCandidates.status, 'imported'), eq(importCandidates.runDate, todayStr)))
  const importedToday = importedTodayRows[0]?.cnt ?? 0
  const remaining = maxPerDay - importedToday
  if (remaining <= 0) {
    console.info(`[import-monitor] phase 2 daily cap reached (${importedToday}/${maxPerDay})`)
    return 0
  }

  // Pull just-upserted pending candidates in the capped set, best tier/score first.
  const pending = await db
    .select({
      id:            importCandidates.id,
      tier:          importCandidates.tier,
      brand:         importCandidates.brand,
      wholesaleCost: importCandidates.wholesaleCost,
      totalQty:      importCandidates.totalQty,
      dealScore:     importCandidates.dealScore,
      mapPrice:      importCandidates.mapPrice,
      msrp:          importCandidates.msrp,
      proposedPrice: importCandidates.proposedPrice,
      needsReview:   importCandidates.needsReview,
    })
    .from(importCandidates)
    .where(and(
      eq(importCandidates.status, 'pending'),
      inArray(importCandidates.masterKey, cappedKeys),
    ))
    .orderBy(importCandidates.tier, sql`${importCandidates.dealScore} DESC NULLS LAST`)

  const gated = pending.filter(c => {
    const tierOk    = c.tier === 'A' || c.tier === 'B'
    if (!tierOk || c.needsReview) return false
    const carriedOk = requireCarried ? carriedBrands.has((c.brand ?? '').toLowerCase().trim()) : true
    if (!carriedOk) return false
    const wholesale = parseFloat(c.wholesaleCost ?? '0')
    const gap    = parseFloat(c.dealScore ?? '0')
    const qty    = c.totalQty ?? 0
    const map    = parseFloat(c.mapPrice ?? '0')
    const price  = parseFloat(c.proposedPrice ?? '0')
    const mapOk    = !(map > 0 && price < map)
    const markupOk = wholesale > 0 && price >= wholesale * (1 + minMarkupPct)
    return markupOk && qty >= minQty && gap >= minGapScore && mapOk
  })

  let imported = 0
  for (const c of gated) {
    if (imported >= remaining) break
    try {
      const r = await approveAndImport(c.id, 'phase2-auto', { preloadedMasters: allMasters })
      if (r.ok && !r.skipped) {
        imported++
        console.info(`[import-monitor] phase 2 auto-imported candidate ${c.id} (tier ${c.tier})`)
      } else if (!r.ok) {
        console.warn(`[import-monitor] phase 2 auto-import failed for candidate ${c.id}: ${r.error}`)
      }
    } catch (err) {
      console.error(`[import-monitor] phase 2 auto-import threw for candidate ${c.id}:`, err)
    }
  }

  // Tier-C branch: fresh new-products masters, stricter gates, own sub-cap,
  // bounded by whatever remains of the overall daily cap. MAP-clean means the
  // proposed price clears MAP and MAP is a real discount floor (map < msrp).
  if (tierCEnabled && tierCMaxPerDay > 0 && imported < remaining) {
    const gatedTierC = pending.filter(c => {
      if (c.tier !== 'C' || c.needsReview) return false
      const wholesale = parseFloat(c.wholesaleCost ?? '0')
      const gap   = parseFloat(c.dealScore ?? '0')
      const qty   = c.totalQty ?? 0
      const map   = parseFloat(c.mapPrice ?? '0')
      const msrp  = parseFloat(c.msrp ?? '0')
      const price = parseFloat(c.proposedPrice ?? '0')
      const mapClean = !(map > 0 && (price < map || map >= msrp))
      const markupOk = wholesale > 0 && price >= wholesale * (1 + tierCMinMarkup)
      return markupOk && qty >= tierCMinQty && gap >= tierCMinGap && mapClean
    })

    let importedTierC = 0
    for (const c of gatedTierC) {
      if (imported >= remaining || importedTierC >= tierCMaxPerDay) break
      try {
        const r = await approveAndImport(c.id, 'phase2-auto', { preloadedMasters: allMasters })
        if (r.ok && !r.skipped) {
          imported++
          importedTierC++
          console.info(`[import-monitor] phase 2 tier-C auto-imported candidate ${c.id}`)
        } else if (!r.ok) {
          console.warn(`[import-monitor] phase 2 tier-C auto-import failed for candidate ${c.id}: ${r.error}`)
        }
      } catch (err) {
        console.error(`[import-monitor] phase 2 tier-C auto-import threw for candidate ${c.id}:`, err)
      }
    }
    if (importedTierC > 0) {
      console.info(`[import-monitor] phase 2 tier-C auto-imported ${importedTierC} (sub-cap ${tierCMaxPerDay})`)
    }
  }

  console.info(`[import-monitor] phase 2 auto-imported ${imported} (cap ${maxPerDay}, ${importedToday} prior today)`)
  return imported
}

// ─── Staging helper (used by PM agent + cron) ─────────────────────────────────

export interface StageMasterResult {
  staged:         number
  skippedCarried: number
  notFound:       string[]
}

/**
 * Stage one or more Nalpac SKUs as pending import candidates.
 *
 * Each input SKU is mapped to its master group via collapseMasters. Multiple
 * input SKUs that resolve to the same master are deduped. Masters whose any
 * SKU is already in dealHistory are skipped (counted as skippedCarried).
 * Remaining masters are upserted into import_candidates (status 'pending')
 * using the same field-mapping + tier/gapScore/price-preview logic that
 * runImportMonitor uses (via the shared buildMasterUpsertPayload helper).
 * Rows already 'rejected' or 'imported' are NOT reopened.
 */
export async function stageMasterCandidatesBySkus(
  skus: string[],
  opts?: { reason?: string },
): Promise<StageMasterResult> {
  const todayStr  = new Date().toISOString().slice(0, 10)
  const gapReason = opts?.reason ?? 'Staged by PM agent'

  // 1. Fetch feeds and collapse into masters.
  const feedResult = await fetchAllNalpacFeeds()
  const allMasters = collapseMasters(feedResult.snapshots)

  // 2. Build carried-SKU set from dealHistory.
  const carriedRows = await db
    .selectDistinct({ sku: dealHistory.sku, brand: dealHistory.brand })
    .from(dealHistory)
  const carriedSkus   = new Set(carriedRows.map(r => r.sku))
  const carriedBrands = new Set(
    carriedRows
      .map(r => r.brand?.toLowerCase().trim())
      .filter(Boolean) as string[],
  )

  // 3. Build a sku->master lookup.
  const skuToMaster = new Map<string, MasterRecord>()
  for (const master of allMasters) {
    for (const sku of master.skus) {
      skuToMaster.set(sku, master)
    }
  }

  // 4. Resolve input SKUs to masters; track notFound.
  const notFound:       string[]          = []
  const mastersToDo:    Set<string>       = new Set()
  const masterByKey:    Map<string, MasterRecord> = new Map()

  for (const sku of skus) {
    const master = skuToMaster.get(sku)
    if (!master) {
      notFound.push(sku)
    } else {
      mastersToDo.add(master.masterKey)
      masterByKey.set(master.masterKey, master)
    }
  }

  // 5. Load existing candidate rows for these masterKeys.
  const masterKeys = [...mastersToDo]
  const existingRows = masterKeys.length > 0
    ? await db
        .select({ masterKey: importCandidates.masterKey, status: importCandidates.status })
        .from(importCandidates)
        .where(inArray(importCandidates.masterKey, masterKeys))
    : []
  const existingByKey = new Map(existingRows.map(r => [r.masterKey ?? '', r.status]))

  let staged         = 0
  let skippedCarried = 0

  for (const masterKey of mastersToDo) {
    const master = masterByKey.get(masterKey)!

    // Skip if any variant is already carried.
    if (master.skus.some(s => carriedSkus.has(s))) {
      skippedCarried++
      continue
    }

    const existingStatus = existingByKey.get(masterKey)

    // Never reopen rejected/imported.
    if (existingStatus === 'rejected' || existingStatus === 'imported') {
      continue
    }

    const { upsertPayload } = buildMasterUpsertPayload(
      master,
      carriedBrands,
      todayStr,
      { gapReason },
    )

    if (!existingStatus) {
      // Net-new.
      await db.insert(importCandidates).values({
        ...upsertPayload,
        status:      'pending',
        firstSeenAt: new Date(),
      }).onConflictDoNothing()
      staged++
    } else if (existingStatus === 'watching') {
      // Re-open watching rows to pending when explicitly staged. Clears the
      // watch-era review stamp for the same reason as the score/price reopen
      // above: a pending row must never carry reviewed_by (ticket #554).
      await db
        .update(importCandidates)
        .set({ ...upsertPayload, status: 'pending', reviewedBy: null, reviewedAt: null })
        .where(eq(importCandidates.masterKey, masterKey))
      staged++
    } else {
      // 'pending' or 'approved' — refresh metrics; keep status.
      await db
        .update(importCandidates)
        .set(upsertPayload)
        .where(eq(importCandidates.masterKey, masterKey))
      staged++
    }
  }

  return { staged, skippedCarried, notFound }
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

/**
 * Return candidates filtered by status, ordered by tier then dealScore desc.
 */
export async function getImportCandidatesByStatus(
  statuses: string[],
  limit?: number,
): Promise<ImportCandidateRow[]> {
  if (statuses.length === 0) return []
  const query = db
    .select()
    .from(importCandidates)
    .where(inArray(importCandidates.status, statuses))
    .orderBy(
      importCandidates.tier,
      sql`${importCandidates.dealScore} DESC NULLS LAST`,
    )
  if (limit != null) return query.limit(limit)
  return query
}

/**
 * Catalog coverage report: brand coverage, category coverage, brand opportunities.
 */
export async function getCatalogOpportunities(): Promise<{
  brandCoverage: { brand: string; carried: number }[]
  categoryCoverage: { category: string; carried: number }[]
  brandOpportunities: { brand: string; tier: string; count: number; avgScore: number }[]
}> {
  const brandRows = await db
    .select({ brand: dealHistory.brand })
    .from(dealHistory)
    .where(sql`${dealHistory.brand} IS NOT NULL`)

  const brandCount = new Map<string, number>()
  for (const r of brandRows) {
    if (!r.brand) continue
    brandCount.set(r.brand, (brandCount.get(r.brand) ?? 0) + 1)
  }
  const brandCoverage = [...brandCount.entries()]
    .map(([brand, carried]) => ({ brand, carried }))
    .sort((a, b) => b.carried - a.carried)

  const catRows = await db
    .select({ categories: dealHistory.categories })
    .from(dealHistory)
    .where(sql`${dealHistory.categories} IS NOT NULL`)

  const catCount = new Map<string, number>()
  for (const r of catRows) {
    for (const cat of (r.categories ?? [])) {
      catCount.set(cat, (catCount.get(cat) ?? 0) + 1)
    }
  }
  const categoryCoverage = [...catCount.entries()]
    .map(([category, carried]) => ({ category, carried }))
    .sort((a, b) => b.carried - a.carried)

  const pendingRows = await db
    .select({
      brand:     importCandidates.brand,
      tier:      importCandidates.tier,
      dealScore: importCandidates.dealScore,
    })
    .from(importCandidates)
    .where(inArray(importCandidates.status, ['pending', 'watching']))

  const oppMap = new Map<string, { tier: string; scores: number[] }>()
  for (const r of pendingRows) {
    if (!r.brand) continue
    if (!oppMap.has(r.brand)) oppMap.set(r.brand, { tier: r.tier ?? 'D', scores: [] })
    const entry = oppMap.get(r.brand)!
    if ((r.tier ?? 'D') < entry.tier) entry.tier = r.tier ?? 'D'
    if (r.dealScore != null) entry.scores.push(parseFloat(r.dealScore))
  }
  const brandOpportunities = [...oppMap.entries()]
    .map(([brand, { tier, scores }]) => ({
      brand,
      tier,
      count:    scores.length,
      avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    }))
    .sort((a, b) => a.tier.localeCompare(b.tier) || b.avgScore - a.avgScore)

  return { brandCoverage, categoryCoverage, brandOpportunities }
}

/**
 * Recent import monitor runs, newest first.
 */
export async function getRecentImportRuns(limit: number): Promise<ImportMonitorRunRow[]> {
  return db
    .select()
    .from(importMonitorRuns)
    .orderBy(sql`${importMonitorRuns.startedAt} DESC`)
    .limit(limit)
}

/**
 * Update candidate status. When setting 'watching', snapshot current
 * dealScore -> watchScore and proposedPrice -> watchPrice.
 *
 * reviewed_by/reviewed_at are stamped ONLY on the terminal statuses
 * ('rejected' here; approveAndImport stamps 'imported' the same way), never
 * on a non-terminal one (ticket #554). A 'watching' stamp used to survive the
 * monitor's watching->pending reopen, leaving pending rows carrying a
 * product-manager-agent stamp: run137's sweep found 77 of them, each burning
 * the endpoint's daily action cap on the day it was stamped and cluttering
 * every later sweep. Watch/unwatch are cheap bookkeeping moves, not reviews;
 * the action cap exists to bound the expensive approve chain (see the
 * MAX_APPROVALS_PER_REQUEST note in api.team.import-candidate-action), and
 * rejects still count because rejected is terminal.
 */
const REVIEW_TERMINAL_STATUSES = new Set(['rejected', 'imported'])

export async function updateCandidateStatus(
  id: number,
  status: string,
  opts: { reviewedBy?: string; rejectionReason?: string } = {},
): Promise<void> {
  const now = new Date()
  const base: Partial<typeof importCandidates.$inferInsert> = {
    status:          status as ImportCandidateRow['status'],
    rejectionReason: opts.rejectionReason,
    updatedAt:       now,
  }
  if (REVIEW_TERMINAL_STATUSES.has(status)) {
    base.reviewedAt = now
    base.reviewedBy = opts.reviewedBy
  }

  if (status === 'watching') {
    const rows = await db
      .select({ dealScore: importCandidates.dealScore, proposedPrice: importCandidates.proposedPrice })
      .from(importCandidates)
      .where(eq(importCandidates.id, id))
      .limit(1)
    if (rows[0]) {
      base.watchScore = rows[0].dealScore
      base.watchPrice = rows[0].proposedPrice
    }
  }

  await db
    .update(importCandidates)
    .set(base)
    .where(eq(importCandidates.id, id))
}

/**
 * Approve a candidate and import it via importProductGroupRaw.
 * Re-collapses today's feed to get fresh per-variant data (Color/Size/Volume
 * + per-variant pricing + images) before building the MasterProductGroup.
 */
export async function approveAndImport(id: number, reviewedBy?: string, opts: { preloadedMasters?: MasterRecord[] } = {}): Promise<{
  ok: boolean
  skipped?: boolean
  shopifyProductId?: string
  dealHistoryId?: number
  error?: string
}> {
  // When a caller identifies itself (the product-manager endpoint or the
  // Phase-2 auto-import path), stamp reviewed_by/reviewed_at so the endpoint's
  // per-day-per-reviewedBy action cap counts approvals — not just reject/watch.
  const reviewedStamp = reviewedBy
    ? { reviewedBy, reviewedAt: new Date() }
    : {}
  const rows = await db
    .select()
    .from(importCandidates)
    .where(eq(importCandidates.id, id))
    .limit(1)
  const candidate = rows[0]
  if (!candidate) {
    return { ok: false, error: `candidate ${id} not found` }
  }

  const repSku = candidate.sku

  // Guard: check dealHistory for already-imported SKU.
  if (await isSkuAlreadyImported(repSku)) {
    await db
      .update(importCandidates)
      .set({ status: 'imported', updatedAt: new Date(), ...reviewedStamp })
      .where(eq(importCandidates.id, id))
    return { ok: true, skipped: true }
  }

  // Re-fetch and re-collapse today's feed to get fresh per-variant data.
  // Bulk callers doing many sequential approvals can pass preloadedMasters to
  // fetch + collapse once instead of per candidate.
  const masters = opts.preloadedMasters
    ?? collapseMasters((await fetchAllNalpacFeeds()).snapshots)
  const master = masters.find(m => m.masterKey === candidate.masterKey)

  if (!master) {
    return { ok: false, error: 'master no longer in feed' }
  }

  const { axes, variantRows } = detectAxes(master)

  const { importProductGroupRaw } = await import('~/lib/bulk-import.server')

  // Representative snapshot for the master row.
  const repSnap = master.snapshots[0]!
  const repRow  = repSnap.raw.mainRow ?? repSnap.raw.saleRow ?? {}

  // Build the common base for BulkImportRow fields.
  const masterRowBase: BulkImportRow = {
    SKU:                      repSku,
    'UPC/barcode':            master.upcs[0] ?? '',
    'Product Title':          master.displayTitle,
    'Product Description':    repRow['Product Description'] ?? '',
    Wholesale:                String(master.wholesale),
    MSRP:                     String(master.msrp),
    MAP:                      master.map > 0 ? String(master.map) : '0',
    'Nalpac qty available':   String(master.totalQty),
    'Entrenue qty available': '0',
    'Total qty available':    String(master.totalQty),
    'Fluid Oz':               master.fluidOz[0] ?? '',
    Brand:                    master.brand,
    Material:                 repRow['Material'] ?? '',
    Color:                    master.colors[0] ?? '',
    'Main Category':          repRow['Main Category'] ?? '',
    'Sub-Category':           master.category,
    Size:                     master.sizes[0] ?? '',
    'Image 1':  repRow['Image 1']  ?? master.sampleImage ?? '',
    'Image 2':  repRow['Image 2']  ?? '',
    'Image 3':  repRow['Image 3']  ?? '',
    'Image 4':  repRow['Image 4']  ?? '',
    'Image 5':  repRow['Image 5']  ?? '',
    'Image 6':  repRow['Image 6']  ?? '',
    'Image 7':  repRow['Image 7']  ?? '',
    'Image 8':  repRow['Image 8']  ?? '',
    'Image 9':  repRow['Image 9']  ?? '',
    'Image 10': repRow['Image 10'] ?? '',
    'Master SKU':           '',
    'Variant Option Name':  axes[0]?.name ?? '',
    'Variant Option Value': variantRows[0]?.optionValues[0] ?? '',
    'Variant Option Name 2':  axes[1]?.name ?? '',
    'Variant Option Value 2': variantRows[0]?.optionValues[1] ?? '',
    'Nav Category': '',
    'Nav Path':     '',
    Collections:    '',
    MPN:            '',
  }

  let group: MasterProductGroup

  if (variantRows.length <= 1 || axes.length === 0) {
    // Single-variant path — no option axes needed.
    group = { masterRow: masterRowBase, variants: [], isSingleVariant: true }
  } else {
    // Multi-variant path.
    // masterRow carries the option axis names (Variant Option Name / Name 2).
    // variants is one BulkVariantRow per VariantBuild from detectAxes.
    const variants: BulkVariantRow[] = variantRows.map(vr => ({
      sku:            vr.sku,
      optionValues:   vr.optionValues,
      price:          vr.price,
      compareAtPrice: vr.compareAtPrice,
      qty:            vr.qty,
      wholesale:      vr.wholesale,
      images:         vr.images,
    }))
    group = { masterRow: masterRowBase, variants, isSingleVariant: false }
  }

  const result = await importProductGroupRaw(group)

  if (!result.success && !result.skipped) {
    return { ok: false, error: result.error ?? 'importProductGroupRaw failed' }
  }

  // Look up the new dealHistory row by the representative SKU.
  const dhRows = await db
    .select({ id: dealHistory.id })
    .from(dealHistory)
    .where(eq(dealHistory.sku, repSku))
    .limit(1)
  const dealHistoryId = dhRows[0]?.id

  await db
    .update(importCandidates)
    .set({
      status:        'imported',
      dealHistoryId: dealHistoryId ?? null,
      updatedAt:     new Date(),
      ...reviewedStamp,
    })
    .where(eq(importCandidates.id, id))

  return {
    ok:               true,
    ...(result.shopifyProductId !== undefined ? { shopifyProductId: result.shopifyProductId } : {}),
    ...(dealHistoryId !== undefined ? { dealHistoryId } : {}),
  }
}
