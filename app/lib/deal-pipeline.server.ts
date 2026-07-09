/**
 * deal-pipeline.server.ts
 *
 * Orchestrates the full automated deal staging pipeline:
 *   1. Read top candidates from KV (populated by dailyFeedProcessor)
 *   2. Filter out MAP=MSRP products and low-margin products
 *   3. Find the next open scheduling slot (today + daysAhead)
 *   4. Find or create the Shopify product for the selected candidate
 *   5. Select 2-3 accessories via Claude
 *   6. Generate all AI copy (tagline, full story, both ways, email subjects, SEO)
 *   7. Push all fields to Shopify as metafields
 *   8. Insert a dealHistory row with status: pending
 *
 * Staging is triggered manually from Admin → Settings → "Run Pipeline Now"
 * (admin.settings.tsx, intent `run-pipeline`). There is no automatic cron
 * call — daily deals are a deferred phase. The staged row lands as
 * `pending`; the owner approves it to `queued` on /admin/queue; the 23:59
 * /cron/deal-activator activates only `queued` rows. (The Shopify
 * `deal_status` metafield keeps its own vocabulary: draft/approved/live/
 * vault, written via setDealStatus.)
 */

import { kvGet } from './kv.server'
import { db } from './db.server'
import { dealHistory } from '../../db/schema'
import { getPipelineSetting, dailyFeedProcessor } from './feed-processor.server'
import { selectAccessories, generateSEOTitle } from './claude.server'
import {
  findProductBySKU,
  createShopifyProductFromFeed,
  slugifyHandle,
  pushProductToShopify,
  setDealStatus,
} from './shopify.server'
import { enqueueFieldRegenJob } from './field-regen-runner.server'
import { inArray } from 'drizzle-orm'
import type { ProductScore } from '~/types'

const DEFAULT_MIN_MARGIN = 0.40  // 40% gross margin floor

export interface PipelineResult {
  staged: boolean
  sku?: string
  shopifyProductId?: string
  dealDate?: string
  reason?: string
  /** jobId of the enqueued field-regen batch job for copy generation. */
  copyJobId?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function isViableCandidate(p: ProductScore, minMargin: number, minProfit: number): boolean {
  // Skip MAP = MSRP products — can't advertise a meaningful discount
  if (p.mapType === 'equals-msrp') return false
  // Enforce minimum margin: (MSRP - wholesale) / MSRP = 1 - wholesale/MSRP
  const margin = (p.msrp - p.wholesaleCost) / p.msrp
  if (margin < minMargin) return false
  // Enforce minimum profit per unit (deal price − wholesale cost)
  if (p.profitPerUnit < minProfit) return false
  return true
}

function nextOpenSlot(scheduledDates: Set<string>, daysAhead: number): string {
  const base = new Date()
  base.setDate(base.getDate() + daysAhead)
  // Walk forward until we find an unoccupied date
  for (let i = 0; i < 30; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    const iso = d.toISOString().split('T')[0]!
    if (!scheduledDates.has(iso)) return iso
  }
  // Fallback — should never hit
  const fallback = new Date()
  fallback.setDate(fallback.getDate() + daysAhead)
  return fallback.toISOString().split('T')[0]!
}

// Phase 2 — multi-select inference. Returns an array of audience tags.
function inferCategory(categories: string[]): Array<'for-him' | 'for-her' | 'couples'> {
  const forHimCats  = ['Vagina Strokers', 'Body Molds', 'Prostate Toys', 'Masturbators', 'Hands-Free Masturbators']
  const forHerCats  = ['Dual Action and Rabbits', 'Finger and Clit', 'Air Pulse and Suction', 'Bullets and Eggs']
  const coupleCats  = ['Couples and Wearable', 'Remote', 'Top Couples Toys', 'Restraints']
  const out: Array<'for-him' | 'for-her' | 'couples'> = []
  if (categories.some(c => forHimCats.includes(c)))  out.push('for-him')
  if (categories.some(c => forHerCats.includes(c)))  out.push('for-her')
  if (categories.some(c => coupleCats.includes(c))) out.push('couples')
  return out.length > 0 ? out : ['for-him', 'for-her']
}

// ─── Main orchestrator ─────────────────────────────────────────────────────

export async function orchestrateDealPipeline(minMarginPct = DEFAULT_MIN_MARGIN): Promise<PipelineResult> {
  try {
    // 1. Load candidates from KV (populated by dailyFeedProcessor)
    //    If cache is empty (local dev or first run), run the feed processor now
    let candidates = await kvGet<ProductScore[]>('feed:top-candidates')
    if (!candidates || candidates.length === 0) {
      console.log('[deal-pipeline] KV cache empty — running feed processor now…')
      const feedResult = await dailyFeedProcessor()
      candidates = feedResult.topCandidates
    }
    if (!candidates || candidates.length === 0) {
      return { staged: false, reason: 'Feed returned no scoreable candidates' }
    }

    // 2. Load already-scheduled SKUs and dates from DB
    const scheduled = await db
      .select({ sku: dealHistory.sku, dealDate: dealHistory.dealDate })
      .from(dealHistory)
      .where(inArray(dealHistory.status, ['pending', 'queued', 'live']))
    const scheduledSkus  = new Set(scheduled.map(r => r.sku))
    const scheduledDates = new Set(scheduled.map(r => r.dealDate))

    // 3. Pick best viable candidate not already scheduled
    const minProfitSetting = await getPipelineSetting('minProfit')
    const minProfit = Math.max(parseFloat(minProfitSetting ?? '0') || 0, 0)

    const viable = candidates.filter(p =>
      isViableCandidate(p, minMarginPct, minProfit) && !scheduledSkus.has(p.sku),
    )
    if (viable.length === 0) {
      return { staged: false, reason: 'No viable candidates after filtering (all MAP=MSRP, low-margin, low-profit, or already scheduled)' }
    }
    const chosen = viable[0]! // already sorted by score desc from feed processor

    // 4. Find next open scheduling slot
    const daysAheadSetting = await getPipelineSetting('daysAhead')
    const daysAhead = parseInt(daysAheadSetting ?? '2', 10) || 2
    const dealDate  = nextOpenSlot(scheduledDates, daysAhead)

    // 5. Find or create Shopify product
    let shopifyGid = await findProductBySKU(chosen.sku)
    let numericId: string

    if (shopifyGid) {
      numericId = shopifyGid.replace('gid://shopify/Product/', '')
    } else {
      // Product not yet in Shopify — create it as a draft.
      // Phase 1 rebuild — explicit handle (slugify-from-title preserves
      // legacy behavior for this code path).
      const handle = slugifyHandle(chosen.title)
      numericId = await createShopifyProductFromFeed(chosen, handle)
      shopifyGid = `gid://shopify/Product/${numericId}`
    }

    // 6. Select accessories from remaining candidates
    const remainingCandidates = candidates.filter(p => p.sku !== chosen.sku)
    const accessorySkus = await selectAccessories(chosen, remainingCandidates, 3)

    // Resolve accessory SKUs to Shopify GIDs
    const accessoryGids: string[] = []
    for (const sku of accessorySkus) {
      const gid = await findProductBySKU(sku)
      if (gid) accessoryGids.push(gid)
    }

    // 7. Generate SEO title synchronously (fast, single call, needed for DB row).
    const seoTitle = await generateSEOTitle(chosen.title, chosen.brand)

    // 8. Push non-copy product fields to Shopify (status, dates, pricing,
    //    accessories, raw description). Copy fields (tagline, full_story, etc.)
    //    are enqueued below and applied asynchronously by the batch runner.
    await pushProductToShopify({
      shopifyProductId: numericId,
      title:            seoTitle,
      vendor:           chosen.brand,
      category:         inferCategory(chosen.categories),
      dealStatus:       'draft',
      dealDate,
      originalPrice:    chosen.msrp,
      wholesaleCost:    chosen.wholesaleCost,
      mapPrice:         chosen.mapPrice,
      nalpacSku:        chosen.sku,
      dealScore:        chosen.score,
      accessoryProductIds: accessoryGids,
      rawDescription:      chosen.description,
    })

    // Mirror deal_status in Shopify tags (for Storefront API queries)
    await setDealStatus(shopifyGid, 'draft')

    // 9. Insert dealHistory row
    await db.insert(dealHistory).values({
      sku:              chosen.sku,
      seoTitle,
      brand:            chosen.brand,
      categories:       chosen.categories,
      dealDate,
      wholesaleCost:    chosen.wholesaleCost.toFixed(2),
      dealPrice:        chosen.dealPrice.toFixed(2),
      msrp:             chosen.msrp.toFixed(2),
      mapPrice:         chosen.mapPrice.toFixed(2),
      unitsAvailable:   chosen.qty,
      dealScore:        chosen.score.toFixed(3),
      status:           'pending',
      shopifyProductId: numericId,
    }).onConflictDoNothing()

    // 10. Enqueue copy generation via Batch API (async — cron poller applies
    //     results when the batch completes; does not block the pipeline).
    const { jobId: copyJobId } = await enqueueFieldRegenJob({
      kind:      'copy-fields',
      productId: shopifyGid,
      sku:       chosen.sku,
      product: {
        title:       seoTitle,
        brand:       chosen.brand,
        description: chosen.description,
        categories:  chosen.categories,
        dealPrice:   chosen.dealPrice,
        msrp:        chosen.msrp,
      },
      fields: ['specifications', 'tagline', 'full_story', 'both_ways', 'seo_meta', 'box_contents'],
    })
    console.log(`[deal-pipeline] copy job enqueued: ${copyJobId} for SKU ${chosen.sku}`)

    return {
      staged: true,
      sku:              chosen.sku,
      shopifyProductId: numericId,
      dealDate,
      copyJobId,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[deal-pipeline] error:', message)
    return { staged: false, reason: message }
  }
}
