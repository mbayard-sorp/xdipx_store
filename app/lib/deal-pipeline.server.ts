/**
 * deal-pipeline.server.ts
 *
 * Orchestrates the full automated deal staging pipeline:
 *   1. Read top candidates from KV (populated by dailyFeedProcessor)
 *   2. Filter out MAP=MSRP products and low-margin products
 *   3. Find the next open scheduling slot (today + daysAhead)
 *   4. Find or create the Shopify product for the selected candidate
 *   5. Select 2-3 accessories via Claude
 *   6. Generate all AI copy (tagline, full story, both ways, bullets, email subjects, SEO)
 *   7. Push all fields to Shopify as metafields
 *   8. Insert a dealHistory row with status: draft
 *
 * Called automatically after dailyFeedProcessor() in server/cron.js.
 * Can also be triggered manually via Admin → Settings → "Run Pipeline Now".
 */

import { kvGet } from './kv.server'
import { db } from './db.server'
import { dealHistory } from '../../db/schema'
import { getPipelineSetting, dailyFeedProcessor } from './feed-processor.server'
import { selectAccessories, generateCopy, generateSEOTitle } from './claude.server'
import {
  findProductBySKU,
  createShopifyProductFromFeed,
  pushProductToShopify,
  setDealStatus,
} from './shopify.server'
import { eq, or } from 'drizzle-orm'
import type { ProductScore } from '~/types'

const DEFAULT_MIN_MARGIN = 0.40  // 40% gross margin floor

export interface PipelineResult {
  staged: boolean
  sku?: string
  shopifyProductId?: string
  dealDate?: string
  reason?: string
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

// Determine Shopify category from ProductScore categories
function inferCategory(categories: string[]): string {
  const forHimCats  = ['Vagina Strokers', 'Body Molds', 'Prostate Toys', 'Masturbators', 'Hands-Free Masturbators']
  const forHerCats  = ['Dual Action and Rabbits', 'Finger and Clit', 'Air Pulse and Suction', 'Bullets and Eggs']
  const coupleCats  = ['Couples and Wearable', 'Remote', 'Top Couples Toys', 'Restraints']
  const isHim = categories.some(c => forHimCats.includes(c))
  const isHer = categories.some(c => forHerCats.includes(c))
  const isCouples = categories.some(c => coupleCats.includes(c))
  if (isCouples) return 'couples'
  if (isHim && isHer) return 'both'
  if (isHim) return 'for-him'
  if (isHer) return 'for-her'
  return 'both'
}

// ─── Copy validation ───────────────────────────────────────────────────────

function validateCopyFields(fields: {
  tagline: string; fullStory: string; forHim: string; forHer: string
  specs: string; boxContents: string[]; seoMeta: string; bullets: string[]
}) {
  if (!fields.tagline?.trim())               throw new Error('Copy generation failed: tagline is empty')
  if (!fields.fullStory?.includes('<p'))      throw new Error('Copy generation failed: fullStory missing HTML')
  if (!fields.forHim?.trim())                throw new Error('Copy generation failed: forHim is empty')
  if (!fields.forHer?.trim())                throw new Error('Copy generation failed: forHer is empty')
  if (!fields.specs?.trim())                 throw new Error('Copy generation failed: specifications is empty')
  if (!fields.boxContents.length)            throw new Error('Copy generation failed: boxContents is empty')
  if (!fields.seoMeta || fields.seoMeta.length < 50) throw new Error('Copy generation failed: seoMeta too short')
  if (fields.bullets.length < 3)             throw new Error('Copy generation failed: fewer than 3 bullets')
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
      .where(
        or(
          eq(dealHistory.status, 'queued'),
          eq(dealHistory.status, 'live'),
        ),
      )
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
      // Product not yet in Shopify — create it as a draft
      numericId = await createShopifyProductFromFeed(chosen)
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

    // 7. Generate AI copy
    //    Step A: extract specs from raw description FIRST so nothing is lost in the rewrite
    const seoTitle = await generateSEOTitle(chosen.title, chosen.brand)

    const productContext = {
      title: seoTitle,
      brand: chosen.brand,
      description: chosen.description,
      categories: chosen.categories,
      dealPrice: chosen.dealPrice,
      msrp: chosen.msrp,
    }

    const specsResult = await generateCopy({ type: 'specifications', product: productContext })

    //    Step B: remaining copy in parallel (full_story knows specs are in a separate tab)
    const [taglineResult, storyResult, bothWaysResult, bulletsResult, seoMetaResult, boxContentsResult] =
      await Promise.all([
        generateCopy({ type: 'tagline',      product: productContext }),
        generateCopy({ type: 'full_story',   product: productContext }),
        generateCopy({ type: 'both_ways',    product: productContext }),
        generateCopy({ type: 'bullets',      product: productContext }),
        generateCopy({ type: 'seo_meta',     product: productContext }),
        generateCopy({ type: 'box_contents', product: productContext }),
      ])

    const tagline  = Array.isArray(taglineResult.content)
      ? (taglineResult.content[0] ?? '')
      : taglineResult.content as string
    const fullStory  = storyResult.content as string
    const bothWays   = bothWaysResult.content as { forHim: string; forHer: string }
    const forHim     = bothWays.forHim
    const forHer     = bothWays.forHer
    const bullets    = bulletsResult.content as string[]
    const seoMeta    = seoMetaResult.content as string
    const specs      = specsResult.content as string
    const boxContents = boxContentsResult.content as string[]

    // Validate all 8 required fields before touching Shopify
    validateCopyFields({ tagline, fullStory, forHim, forHer, specs, boxContents, seoMeta, bullets })

    // 8. Push all fields to Shopify
    await pushProductToShopify({
      shopifyProductId: numericId,
      title:            seoTitle,
      vendor:           chosen.brand,
      description:      fullStory,   // sets Shopify bodyHtml
      tagline,
      fullStory,
      worksForHim:      forHim,
      worksForHer:      forHer,
      featureBullets:   bullets,
      category:         inferCategory(chosen.categories),
      dealStatus:       'draft',
      dealDate,
      originalPrice:    chosen.msrp,
      wholesaleCost:    chosen.wholesaleCost,
      mapPrice:         chosen.mapPrice,
      nalpacSku:        chosen.sku,
      dealScore:        chosen.score,
      accessoryProductIds: accessoryGids,
      seoMetaDescription:  seoMeta,
      specifications:      specs,
      boxContents,
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
      status:           'queued',
      shopifyProductId: numericId,
    }).onConflictDoNothing()

    return {
      staged: true,
      sku:             chosen.sku,
      shopifyProductId: numericId,
      dealDate,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[deal-pipeline] error:', message)
    return { staged: false, reason: message }
  }
}
