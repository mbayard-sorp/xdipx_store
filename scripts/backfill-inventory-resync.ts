/**
 * Ticket #15375 — ONE-TIME MANUAL BACKFILL. Do not wire into any cron/routine.
 *
 * Follow-up from QA review of ticket #14756/PR #1646. That PR made every
 * NEW publish resync its inventory from the live Nalpac feed
 * (`syncVariantInventoryQuantity` in `app/lib/shopify.server.ts`), but
 * explicitly did not retroactively correct the already-live products it
 * named: 11 of 15 products from the 2026-10-09/2026-10-10 enrich->publish
 * batches went live carrying a stale, far-too-low Shopify `totalInventory`
 * (several sat at 0 while the Nalpac feed showed real stock, e.g. Pipedream
 * Moist Water-Based Lube: feed qty 2137, Shopify totalInventory 0) — live,
 * unsellable rows.
 *
 * This script finds every product published through the import/enrich
 * pipeline in the last 2 weeks, reads its current Shopify totalInventory
 * and today's Nalpac feed quantity for the same SKU, and calls the
 * already-merged `syncVariantInventoryQuantity` wherever the gap is
 * material (not normal day-to-day drift).
 *
 * Idempotent — safe to re-run. Each run re-reads current Shopify inventory
 * live, so a product already corrected (or no longer short) is skipped.
 *
 * Usage:
 *   Dry-run (default): npx tsx scripts/backfill-inventory-resync.ts
 *   Apply:              npx tsx scripts/backfill-inventory-resync.ts --apply
 *   Narrow to SKUs:     npx tsx scripts/backfill-inventory-resync.ts --skus=12345,67890 --apply
 */
// MUST be first — populates process.env before any downstream module reads it.
import './_load-env'
import { and, eq, gte, isNotNull } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { importCandidates, dealHistory } from '../db/schema'
import { fetchAllNalpacFeeds } from '../app/lib/nalpac-feeds.server'
import { getProductsByIds, syncVariantInventoryQuantity } from '../app/lib/shopify.server'

const APPLY = process.argv.includes('--apply')
const SKUS_ARG  = process.argv.find(a => a.startsWith('--skus='))
const ONLY_SKUS = SKUS_ARG
  ? new Set(SKUS_ARG.slice('--skus='.length).split(',').map(s => s.trim()).filter(Boolean))
  : null

const LOOKBACK_DAYS = 14
const BATCH_SIZE = 100

// "Materially below": the known failure pattern is Shopify sitting at 0 (or
// near it) while the feed shows real stock, not the ordinary day-to-day
// drift between two independent inventory reads. A product is flagged when
// Shopify reads exactly 0 with feed stock available, or when Shopify is
// short by at least 30% of the feed quantity AND at least 5 units — small
// absolute gaps on low-count SKUs are not worth a write.
const MIN_REL_GAP = 0.3
const MIN_ABS_GAP = 5

export function isMaterialShortfall(current: number, feedQty: number): boolean {
  if (feedQty <= 0 || current >= feedQty) return false
  if (current === 0) return true
  const deficit = feedQty - current
  return deficit >= MIN_ABS_GAP && deficit >= feedQty * MIN_REL_GAP
}

function toGid(numericId: string): string {
  return numericId.startsWith('gid://') ? numericId : `gid://shopify/Product/${numericId}`
}

async function main() {
  console.log(APPLY
    ? 'APPLY mode — will resync Shopify inventory where the gap against the Nalpac feed is material'
    : 'DRY RUN — pass --apply to write. Showing what would change:')

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const rows = await db
    .select({
      candidateId: importCandidates.id,
      productId:   dealHistory.shopifyProductId,
      sku:         dealHistory.sku,
      title:       dealHistory.seoTitle,
      publishedAt: importCandidates.publishedAt,
    })
    .from(importCandidates)
    .innerJoin(dealHistory, eq(importCandidates.dealHistoryId, dealHistory.id))
    .where(and(
      eq(importCandidates.status, 'imported'),
      isNotNull(importCandidates.publishedAt),
      gte(importCandidates.publishedAt, since),
    ))

  const candidates = (ONLY_SKUS ? rows.filter(r => ONLY_SKUS.has(r.sku)) : rows)
    .filter((r): r is typeof r & { productId: string } => !!r.productId)

  console.log(`Found ${candidates.length} product(s) published in the last ${LOOKBACK_DAYS} days (of ${rows.length} total in window).`)
  if (candidates.length === 0) return

  let freshQtyBySku = new Map<string, number | null>()
  try {
    const { snapshots } = await fetchAllNalpacFeeds()
    freshQtyBySku = new Map([...snapshots].map(([sku, snap]) => [sku, snap.qty]))
  } catch (err) {
    console.error('Nalpac feed fetch failed — cannot resync without a fresh qty read:', err instanceof Error ? err.message : err)
    process.exit(1)
  }

  const inventoryByGid = new Map<string, number | null>()
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const gids = batch.map(c => toGid(c.productId))
    const products = await getProductsByIds(gids)
    for (const p of products) inventoryByGid.set(p.id, p.totalInventory ?? null)
  }

  let corrected = 0
  let skippedNoFeedQty = 0
  let skippedNotFound = 0
  let skippedNotShort = 0

  for (const c of candidates) {
    const feedQty = freshQtyBySku.get(c.sku)
    if (feedQty == null) {
      skippedNoFeedQty++
      continue
    }

    const current = inventoryByGid.get(toGid(c.productId))
    if (current == null) {
      console.warn(`  [not found] candidate #${c.candidateId} sku=${c.sku} productId=${c.productId} did not resolve on the Storefront API`)
      skippedNotFound++
      continue
    }

    if (!isMaterialShortfall(current, feedQty)) {
      skippedNotShort++
      continue
    }

    console.log(`  ${APPLY ? 'correcting' : 'would correct'} sku=${c.sku} "${c.title ?? '(no title)'}" productId=${c.productId}: Shopify ${current} -> feed ${feedQty}`)
    if (APPLY) {
      await syncVariantInventoryQuantity(c.productId, feedQty)
    }
    corrected++
  }

  console.log('')
  console.log(`${APPLY ? 'Corrected' : 'Would correct'} ${corrected} product(s).`)
  console.log(`Skipped: ${skippedNotShort} not materially short, ${skippedNoFeedQty} no current feed row for the SKU, ${skippedNotFound} not found on Storefront API.`)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
