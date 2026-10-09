/**
 * One-time cleanup for Nalpac's dropship restriction notice (2026-10-09).
 * DRY-RUN by default; pass --apply to write.
 *
 *   1. Archive live/draft Shopify products Nalpac will not dropship
 *      (Crave, restricted-brand supplements, store-exclusive items).
 *   2. Reject open import_candidates rows for the same.
 *   3. For Nalpac MAP-verified brands: sync xdipx.map_price to today's feed
 *      MAP (single-MAP products only), and raise any variant priced below
 *      MAP to exactly MAP. Compare-at becomes that SKU's feed MSRP when it is
 *      above MAP (the engine's msrp compare-at strategy), otherwise it equals
 *      the price (no strike-through). Each raise writes a 'manual'
 *      pricing_audit_log row.
 *
 * Step 3 writes directly instead of calling recomputeVariant because the
 * approval threshold would park every raise above 80% (e.g. $6.99 -> $14.99)
 * in the pending queue, and a below-MAP listing fails Nalpac's verification.
 * After this, the daily engine holds these brands at MAP on its own.
 *
 * Usage:
 *   npx tsx scripts/nalpac-dropship-sweep.ts            # dry run, prints the plan
 *   npx tsx scripts/nalpac-dropship-sweep.ts --apply    # writes
 *   add --skip-archive / --skip-queue / --skip-map to run one part only
 */
import 'dotenv/config'
import { inArray, eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { importCandidates, pricingAuditLog } from '../db/schema'
import {
  adminGraphQL,
  archiveShopifyProduct,
  bulkFetchProductsForPricing,
  updateProductMetafield,
  updateVariantPricing,
} from '../app/lib/shopify.server'
import { fetchAllNalpacFeeds } from '../app/lib/nalpac-feeds.server'
import { collapseMasters } from '../app/lib/master-collapse.server'
import { masterDropshipRestriction } from '../app/lib/import-monitor.server'
import { dropshipRestriction, isNalpacMapVerifiedBrand } from '../app/lib/nalpac-dropship-policy'

const apply = process.argv.includes('--apply')
const skip = (part: string) => process.argv.includes(`--skip-${part}`)
const tag = apply ? '[apply]' : '[dry-run]'

async function productStatus(productGid: string): Promise<string | null> {
  const r = await adminGraphQL<{ product: { status: string } | null }>(
    `query($id: ID!) { product(id: $id) { status } }`,
    { id: productGid },
  )
  return r.product?.status ?? null
}

async function main() {
  console.log(`${tag} fetching Nalpac feeds and Shopify catalog...`)
  const feed = await fetchAllNalpacFeeds({ force: true })
  if (feed.errors.length) console.warn('feed errors:', feed.errors)
  const products = await bulkFetchProductsForPricing()
  console.log(`${tag} feed SKUs=${feed.snapshots.size} shopify products=${products.length}`)

  // 1. Restricted listings.
  if (!skip('archive')) {
    let archived = 0
    for (const p of products) {
      const snaps = p.variants.map(v => feed.snapshots.get(v.sku)).filter(s => s != null)
      const reason = dropshipRestriction({
        brand:         snaps[0]?.vendor ?? p.vendor,
        titles:        [p.title, ...snaps.map(s => s.productTitle)],
        subCategories: snaps.flatMap(s => [s.raw.mainRow?.['Sub-Category'], s.raw.saleRow?.['Sub-Category']]),
        skus:          p.variants.map(v => v.sku),
      }) ?? dropshipRestriction({ brand: p.vendor, titles: [p.title], subCategories: [], skus: [] })
      if (!reason) continue
      const status = await productStatus(p.productGid)
      if (status === 'ARCHIVED') continue
      console.log(`${tag} ARCHIVE ${status} ${p.handle} [${p.vendor}] skus=${p.variants.map(v => v.sku).join('/')} :: ${reason}`)
      if (apply) await archiveShopifyProduct(p.productGid, reason)
      archived++
    }
    console.log(`${tag} restricted listings: ${archived}`)
  }

  // 2. Open queue rows.
  if (!skip('queue')) {
    const masters = new Map(collapseMasters(feed.snapshots).map(m => [m.masterKey, m]))
    const open = await db
      .select({ id: importCandidates.id, masterKey: importCandidates.masterKey, title: importCandidates.productTitle, status: importCandidates.status })
      .from(importCandidates)
      .where(inArray(importCandidates.status, ['pending', 'approved', 'watching']))
    let rejected = 0
    for (const row of open) {
      const master = row.masterKey ? masters.get(row.masterKey) : undefined
      const reason = master ? masterDropshipRestriction(master) : null
      if (!reason) continue
      console.log(`${tag} REJECT candidate ${row.id} (${row.status}) ${row.title} :: ${reason}`)
      if (apply) {
        await db
          .update(importCandidates)
          .set({ status: 'rejected', rejectionReason: reason, reviewedBy: 'nalpac-dropship-sweep', reviewedAt: new Date(), updatedAt: new Date() })
          .where(eq(importCandidates.id, row.id))
      }
      rejected++
    }
    console.log(`${tag} queue rows rejected: ${rejected} of ${open.length} open`)
  }

  // 3. MAP-verified brands.
  if (!skip('map')) {
    let synced = 0
    let raised = 0
    for (const p of products) {
      if (!isNalpacMapVerifiedBrand(p.vendor)) continue
      const maps = p.variants
        .map(v => feed.snapshots.get(v.sku)?.mapPrice ?? 0)
        .filter(m => m > 0)
      if (maps.length === 0) continue
      // map_price is product-level. When sizes carry different MAPs (Gun Oil)
      // leave it alone: the engine reads each SKU's own feed MAP for these
      // brands, and one product value would be wrong for every other size.
      const distinct = [...new Set(maps)]
      const feedMap = distinct[0]!
      if (distinct.length > 1) {
        console.log(`${tag} SKIP map_price ${p.handle}: variants carry ${distinct.length} different MAPs (${distinct.join(', ')})`)
      } else if (p.metafields.mapPrice == null || Math.abs(p.metafields.mapPrice - feedMap) > 0.005) {
        console.log(`${tag} SYNC map_price ${p.handle}: ${p.metafields.mapPrice ?? 'none'} -> ${feedMap}`)
        if (apply) await updateProductMetafield(p.productGid, 'map_price', String(feedMap), 'number_decimal')
        synced++
      }
      for (const v of p.variants) {
        const snap = feed.snapshots.get(v.sku)
        const map = snap?.mapPrice ?? 0
        if (!(map > 0) || v.price >= map - 0.005) continue
        // The variant's own MSRP, never a sibling size's: some multi-size
        // products carry the largest bottle's MSRP as every size's compare-at.
        const msrp = snap?.msrp ?? 0
        const compare = msrp > map ? msrp : map
        console.log(`${tag} RAISE ${v.sku} ${p.handle} [${p.vendor}] $${v.price} -> $${map} (compare-at ${v.compareAtPrice ?? 'none'} -> ${compare})`)
        if (apply) {
          await updateVariantPricing(v.variantId, String(map), String(compare))
          await db.insert(pricingAuditLog).values({
            variantId:    v.variantId,
            sku:          v.sku,
            productType:  p.productType,
            trigger:      'manual',
            oldMap:       p.metafields.mapPrice != null ? String(p.metafields.mapPrice) : null,
            newMap:       String(map),
            oldSell:      String(v.price),
            newSell:      String(map),
            oldCompareAt: v.compareAtPrice != null ? String(v.compareAtPrice) : null,
            newCompareAt: String(compare),
            status:       'auto_applied',
            rationale:    `Raised to MAP $${map}: ${p.vendor} is on Nalpac's MAP-verification list (nalpac-dropship-sweep).`,
          })
        }
        raised++
      }
    }
    console.log(`${tag} map_price synced: ${synced}; variants raised to MAP: ${raised}`)
  }

  if (!apply) console.log('\nDry run only. Re-run with --apply to write.')
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
