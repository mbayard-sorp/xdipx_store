import { eq } from 'drizzle-orm'
import { db } from './db.server'
import { pipelineSettings, pricingChanges } from '../../db/schema'
import { kvGet, kvSet } from './kv.server'
import { fetchAllNalpacFeeds } from './nalpac-feeds.server'
import { bulkFetchProductsForPricing, updateVariantPricing, updateProductMetafield } from './shopify.server'
import { computeTargetPrice } from './pricing-engine.server'
import type { PricingSnapshot, PricingRules } from './pricing-engine.server'
import { buildPricingReport, sendPricingReportEmail } from './pricing-report.server'
import type { PricingChangeRecord } from './pricing-report.server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalMode = 'all' | 'guardrails' | 'auto'

export interface RunOptions {
  dryRun?: boolean
  approvalMode?: ApprovalMode
  forceFeedRefresh?: boolean
  source: 'cron' | 'manual' | 'cli'
}

export interface RunResult {
  runDate: string
  startedAt: string
  finishedAt: string
  source: 'cron' | 'manual' | 'cli'
  dryRun: boolean
  approvalMode: ApprovalMode
  productsScanned: number
  variantsScanned: number
  changesProposed: number
  changesAutoApplied: number
  changesPending: number
  changesFailed: number
  feedErrors: string[]
  changeIds: number[]
  reportEmailSent: boolean
}

const LOCK_KEY = 'pricing:run-lock'
const LOCK_TTL = 300 // 5 minutes

// ---------------------------------------------------------------------------
// Pipeline settings helpers
// ---------------------------------------------------------------------------

export async function getApprovalMode(): Promise<ApprovalMode> {
  try {
    const rows = await db
      .select({ value: pipelineSettings.value })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, 'pricing_approval_mode'))
      .limit(1)
    const val = rows[0]?.value
    if (val === 'all' || val === 'guardrails' || val === 'auto') return val
  } catch {
    // fall through
  }
  return 'all'
}

export async function setApprovalMode(mode: ApprovalMode): Promise<void> {
  await db
    .insert(pipelineSettings)
    .values({ key: 'pricing_approval_mode', value: mode })
    .onConflictDoUpdate({
      target: pipelineSettings.key,
      set: { value: mode, updatedAt: new Date() },
    })
}

export async function getPricingRules(): Promise<PricingRules> {
  try {
    const keys = [
      'pricing_margin_floor',
      'pricing_high_margin_discount',
      'pricing_medium_margin_discount',
      'pricing_per_type_overrides',
    ]
    // Fetch all four in parallel
    const fetch1 = (k: string) =>
      db.select({ value: pipelineSettings.value })
        .from(pipelineSettings)
        .where(eq(pipelineSettings.key, k))
        .limit(1)
        .then(r => r[0]?.value ?? null)
    const [floor, high, medium, perType] = await Promise.all([
      fetch1(keys[0]!),
      fetch1(keys[1]!),
      fetch1(keys[2]!),
      fetch1(keys[3]!),
    ])
    const rules: PricingRules = {}
    if (floor != null) rules.marginFloor = parseFloat(floor)
    if (high != null) rules.highMarginDiscount = parseFloat(high)
    if (medium != null) rules.mediumMarginDiscount = parseFloat(medium)
    if (perType != null) {
      try { rules.perTypeOverrides = JSON.parse(perType) } catch { /* ignore */ }
    }
    return rules
  } catch {
    return {}
  }
}

export async function setPricingRules(rules: PricingRules): Promise<void> {
  const pairs: Array<[string, string]> = []
  if (rules.marginFloor !== undefined) pairs.push(['pricing_margin_floor', String(rules.marginFloor)])
  if (rules.highMarginDiscount !== undefined) pairs.push(['pricing_high_margin_discount', String(rules.highMarginDiscount)])
  if (rules.mediumMarginDiscount !== undefined) pairs.push(['pricing_medium_margin_discount', String(rules.mediumMarginDiscount)])
  if (rules.perTypeOverrides !== undefined) pairs.push(['pricing_per_type_overrides', JSON.stringify(rules.perTypeOverrides)])
  await Promise.all(
    pairs.map(([k, v]) =>
      db.insert(pipelineSettings)
        .values({ key: k, value: v })
        .onConflictDoUpdate({ target: pipelineSettings.key, set: { value: v, updatedAt: new Date() } })
    )
  )
}

// Persistent product-types cache — stored as JSON in pipeline_settings so the
// admin loader doesn't have to paginate Shopify on every page load.
export interface CachedProductTypes {
  types: Array<{ productType: string; count: number }>
  refreshedAt: string // ISO
}

export async function getCachedProductTypes(): Promise<CachedProductTypes | null> {
  const raw = await getPipelineSettingLocal('pricing_product_types_cache')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as CachedProductTypes
    if (!Array.isArray(parsed.types)) return null
    return parsed
  } catch {
    return null
  }
}

export async function setCachedProductTypes(types: Array<{ productType: string; count: number }>): Promise<void> {
  const payload: CachedProductTypes = { types, refreshedAt: new Date().toISOString() }
  const value = JSON.stringify(payload)
  await db.insert(pipelineSettings)
    .values({ key: 'pricing_product_types_cache', value })
    .onConflictDoUpdate({ target: pipelineSettings.key, set: { value, updatedAt: new Date() } })
}

async function getPipelineSettingLocal(key: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ value: pipelineSettings.value })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, key))
      .limit(1)
    return rows[0]?.value ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Apply / reject helpers
// ---------------------------------------------------------------------------

export async function applyApprovedChange(changeId: number, approvedBy: string): Promise<void> {
  const rows = await db
    .select()
    .from(pricingChanges)
    .where(eq(pricingChanges.id, changeId))
    .limit(1)

  const row = rows[0]
  if (!row) throw new Error(`pricing_changes row ${changeId} not found`)
  if (row.status !== 'pending') throw new Error(`Row ${changeId} is not pending (status: ${row.status})`)

  await updateVariantPricing(
    row.variantId,
    String(row.newPrice),
    String(row.newCompareAt ?? row.newPrice),
  )

  await db
    .update(pricingChanges)
    .set({ status: 'approved', appliedAt: new Date(), approvedBy })
    .where(eq(pricingChanges.id, changeId))
}

export async function rejectChange(changeId: number, rejectedBy: string): Promise<void> {
  await db
    .update(pricingChanges)
    .set({ status: 'rejected', approvedBy: rejectedBy })
    .where(eq(pricingChanges.id, changeId))
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function runDailyPriceReview(opts: RunOptions): Promise<RunResult> {
  const startedAt = new Date()
  const runDate = utcDateString(startedAt)

  // Acquire lock
  const existing = await kvGet<string>(LOCK_KEY)
  if (existing) throw new Error('pricing review already in progress')
  await kvSet(LOCK_KEY, startedAt.toISOString(), LOCK_TTL)

  try {
    // Resolve effective options
    const dryRun = opts.dryRun ?? (process.env['DRY_RUN_PRICING'] === 'true')
    const approvalModeSetting = await getPipelineSettingLocal('pricing_approval_mode')
    const approvalMode: ApprovalMode =
      opts.approvalMode ??
      (approvalModeSetting === 'guardrails' || approvalModeSetting === 'auto' ? approvalModeSetting : 'all')

    // Parallel fetch
    const feedOpts = opts.forceFeedRefresh !== undefined ? { force: opts.forceFeedRefresh } : {}
    const [feedResult, shopifyProducts] = await Promise.all([
      fetchAllNalpacFeeds(feedOpts),
      bulkFetchProductsForPricing(),
    ])

    const feedErrors = [...feedResult.errors]
    const nalpacMap = feedResult.snapshots

    // Track metafield updates to batch by product (one call per changed field per product)
    type MetafieldUpdate = { productId: string; key: string; value: string; oldValue: string | null }
    const metafieldUpdates: MetafieldUpdate[] = []

    // Rows to insert
    type ChangeRow = typeof pricingChanges.$inferInsert
    const rows: ChangeRow[] = []

    let productsScanned = 0
    let variantsScanned = 0

    for (const product of shopifyProducts) {
      productsScanned++
      const productNalpacSku = product.metafields.nalpacSku

      for (const variant of product.variants) {
        variantsScanned++

        // Resolve SKU: variant SKU takes priority, fall back to product-level nalpac_sku metafield
        const sku = variant.sku || productNalpacSku || ''
        const nalpacSnap = sku ? nalpacMap.get(sku) : undefined

        if (!nalpacSnap) {
          // Orphan — skip price write, no row
          continue
        }

        const variantTitleVal = variant.title !== 'Default Title' ? variant.title : undefined
        const snapshot: PricingSnapshot = {
          sku,
          vendor: product.vendor ?? nalpacSnap.vendor,
          msrp: nalpacSnap.msrp > 0 ? nalpacSnap.msrp : (product.metafields.originalPrice ?? 0),
          wholesale: nalpacSnap.wholesale > 0 ? nalpacSnap.wholesale : (product.metafields.wholesaleCost ?? 0),
          mapPrice: nalpacSnap.mapPrice ?? product.metafields.mapPrice,
          currentPrice: variant.price,
          currentCompareAt: variant.compareAtPrice,
          inSaleFeed: nalpacSnap.inSaleFeed,
          nalpacDiscountPct: nalpacSnap.nalpacDiscountPct,
          productTitle: product.title,
          ...(variantTitleVal !== undefined ? { variantTitle: variantTitleVal } : {}),
        }

        const computation = computeTargetPrice(snapshot)

        if (computation.tier === 'no-change-needed') continue

        // Determine status
        let status: ChangeRow['status']
        let applyNow = false

        if (computation.tier === 'refuse-missing-data') {
          status = 'failed'
        } else if (dryRun) {
          status = 'skipped_dry_run'
        } else if (approvalMode === 'all') {
          status = 'pending'
        } else if (approvalMode === 'guardrails') {
          const safeToAuto =
            computation.mapRespected &&
            computation.marginPct >= 0.20 &&
            Math.abs(computation.deltaPct) <= 0.15
          if (safeToAuto) {
            status = 'auto_applied'
            applyNow = true
          } else {
            status = 'pending'
          }
        } else {
          // auto mode — hard safety stops
          const blocked = !computation.mapRespected || computation.marginPct < 0.20
          if (blocked) {
            status = 'pending'
          } else {
            status = 'auto_applied'
            applyNow = true
          }
        }

        let applyError: string | null = null

        if (applyNow) {
          try {
            await updateVariantPricing(
              variant.variantId,
              String(computation.newPrice),
              String(computation.newCompareAt),
            )

            // Queue metafield updates if values changed
            const newWholesaleStr = String(nalpacSnap.wholesale)
            if (
              product.metafields.wholesaleCost == null ||
              Math.abs(product.metafields.wholesaleCost - nalpacSnap.wholesale) > 0.001
            ) {
              metafieldUpdates.push({
                productId: product.productGid,
                key: 'wholesale_cost',
                value: newWholesaleStr,
                oldValue: product.metafields.wholesaleCost != null ? String(product.metafields.wholesaleCost) : null,
              })
            }

            if (nalpacSnap.mapPrice != null) {
              const newMapStr = String(nalpacSnap.mapPrice)
              if (
                product.metafields.mapPrice == null ||
                Math.abs(product.metafields.mapPrice - nalpacSnap.mapPrice) > 0.001
              ) {
                metafieldUpdates.push({
                  productId: product.productGid,
                  key: 'map_price',
                  value: newMapStr,
                  oldValue: product.metafields.mapPrice != null ? String(product.metafields.mapPrice) : null,
                })
              }
            }
          } catch (err) {
            applyError = err instanceof Error ? err.message : String(err)
            status = 'failed'
          }
        }

        rows.push({
          runDate,
          sku,
          productId: product.productGid,
          productHandle: product.handle,
          productTitle: product.title,
          variantId: variant.variantId,
          variantTitle: variant.title !== 'Default Title' ? variant.title : null,
          vendor: product.vendor ?? nalpacSnap.vendor,
          tier: computation.tier,
          oldPrice: String(variant.price),
          newPrice: String(computation.newPrice),
          oldCompareAt: variant.compareAtPrice != null ? String(variant.compareAtPrice) : null,
          newCompareAt: String(computation.newCompareAt),
          oldWholesale: product.metafields.wholesaleCost != null ? String(product.metafields.wholesaleCost) : null,
          newWholesale: nalpacSnap.wholesale > 0 ? String(nalpacSnap.wholesale) : null,
          mapPrice: nalpacSnap.mapPrice != null ? String(nalpacSnap.mapPrice) : null,
          marginPct: String(computation.marginPct),
          reason: computation.reason,
          mapRespected: computation.mapRespected,
          status,
          appliedAt: (status === 'auto_applied') ? new Date() : null,
          applyError,
        })
      }
    }

    // Flush deduplicated metafield updates (one per productId+key, last write wins)
    const seen = new Set<string>()
    for (const upd of metafieldUpdates) {
      const dedupeKey = `${upd.productId}:${upd.key}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      try {
        await updateProductMetafield(upd.productId, upd.key, upd.value, 'number_decimal')
      } catch (err) {
        feedErrors.push(`metafield ${upd.key} for ${upd.productId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Bulk insert — chunk to stay under the Neon HTTP request size cap.
    // 100 rows * ~20 cols of mostly-short values comfortably fits.
    let changeIds: number[] = []
    if (rows.length > 0) {
      const CHUNK = 100
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK)
        const inserted = await db.insert(pricingChanges).values(slice).returning({ id: pricingChanges.id })
        changeIds.push(...inserted.map((r) => r.id))
      }
    }

    // Build report
    const records: PricingChangeRecord[] = rows.map((r, i) => ({
      id: changeIds[i] ?? 0,
      runDate: r.runDate,
      sku: r.sku,
      productId: r.productId,
      productHandle: r.productHandle ?? null,
      productTitle: r.productTitle ?? null,
      variantId: r.variantId,
      variantTitle: r.variantTitle ?? null,
      vendor: r.vendor ?? null,
      tier: r.tier,
      oldPrice: r.oldPrice != null ? parseFloat(r.oldPrice) : null,
      newPrice: parseFloat(r.newPrice),
      oldCompareAt: r.oldCompareAt != null ? parseFloat(r.oldCompareAt) : null,
      newCompareAt: r.newCompareAt != null ? parseFloat(r.newCompareAt) : null,
      marginPct: r.marginPct != null ? parseFloat(r.marginPct) : null,
      mapPrice: r.mapPrice != null ? parseFloat(r.mapPrice) : null,
      reason: r.reason,
      mapRespected: r.mapRespected ?? true,
      status: r.status as PricingChangeRecord['status'],
    }))

    const report = buildPricingReport(records, runDate)
    const emailResult = await sendPricingReportEmail(report, {
      adminUrl: process.env['SITE_URL'] ?? 'https://xdipx.com',
    })

    const finishedAt = new Date()

    return {
      runDate,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      source: opts.source,
      dryRun,
      approvalMode,
      productsScanned,
      variantsScanned,
      changesProposed: rows.length,
      changesAutoApplied: rows.filter((r) => r.status === 'auto_applied').length,
      changesPending: rows.filter((r) => r.status === 'pending').length,
      changesFailed: rows.filter((r) => r.status === 'failed').length,
      feedErrors,
      changeIds,
      reportEmailSent: emailResult.sent,
    }
  } finally {
    await kvSet(LOCK_KEY, '', 1)
  }
}
