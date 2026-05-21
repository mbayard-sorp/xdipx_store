/**
 * PM Chat tools — Anthropic.Tool definitions and dispatcher for the
 * product-manager agent persona.
 *
 * All tools are READ or STAGE only. Writes land INERT/pending for human
 * approval in the relevant /admin screen. No tool executes live changes.
 *
 * Tool dispatcher shape matches emma-chat-tools.server.ts exactly so both
 * can be passed to the generic streamAgentReply() engine.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { eq, sql } from 'drizzle-orm'
import { db } from './db.server'
import {
  pricingChanges,
  discoveryRules,
  pipelineSettings,
  dealHistory,
} from '../../db/schema'
import { fetchAllNalpacFeeds } from './nalpac-feeds.server'
import { scoreProduct } from './feed-processor.server'
import { computeTargetPrice } from './pricing-engine.server'
import type { PricingSnapshot } from './pricing-engine.server'
import { findProductBySKU, findVariantBySKU, searchCatalogForEmma } from './shopify.server'
import { stageMasterCandidatesBySkus } from './import-monitor.server'
import type { NalpacProduct } from '~/types'

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const PM_CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_nalpac_feed',
    description:
      'Search the live Nalpac distributor feed (all 4 feeds merged). Use this BEFORE ' +
      'asserting what Nalpac has on offer. Returns compact rows: sku, title, vendor, ' +
      'wholesale, msrp, map, qty, margin_pct, in_sale_feed, in_new_feed, in_top100_feed. ' +
      'Default limit 20, max 50.',
    input_schema: {
      type: 'object',
      properties: {
        brand:       { type: 'string',  description: 'Brand/vendor name (case-insensitive substring).' },
        category:    { type: 'string',  description: 'Sub-category substring (from the Nalpac Sub-Category column).' },
        keyword:     { type: 'string',  description: 'Product title keyword (case-insensitive substring).' },
        on_sale_only:{ type: 'boolean', description: 'If true, return only SKUs present in the Nalpac sale feed.' },
        new_only:    { type: 'boolean', description: 'If true, return only SKUs present in the Nalpac new-products feed.' },
        top100_only: { type: 'boolean', description: 'If true, return only SKUs in the Nalpac top-100 feed.' },
        limit:       { type: 'integer', description: 'Max rows to return. Default 20, max 50.', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'get_catalog_coverage',
    description:
      'Report catalog coverage for a brand or category. Returns how many of that ' +
      "brand's in-feed SKUs we carry vs. the gap count. Also returns the overall " +
      'brand/category opportunity summary. Use after search_nalpac_feed to understand ' +
      'the carry gap.',
    input_schema: {
      type: 'object',
      properties: {
        brand:    { type: 'string', description: 'Vendor/brand name to analyze.' },
        category: { type: 'string', description: 'Category substring to analyze (optional).' },
      },
    },
  },
  {
    name: 'search_our_catalog',
    description:
      'Search the products we currently list on xdipx.com. Use this to check what ' +
      "we already carry before staging imports. Returns handle, title, price, available. " +
      'Same engine as the Emma Chat search_products tool.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Title keyword (substring match).' },
        brand:   { type: 'string', description: 'Vendor/brand name filter.' },
        tags:    { type: 'array', items: { type: 'string' }, description: 'Shopify tags to filter on.' },
        limit:   { type: 'integer', description: 'Max results. Default 20, max 50.', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'price_preview',
    description:
      'For a list of Nalpac SKUs, compute MAP-safe proposed prices and margins using ' +
      'the pricing engine. Returns: sku, proposed_price, compare_at, margin_pct, ' +
      'profit_per_unit, map_respected. Always call this before recommending a price.',
    input_schema: {
      type: 'object',
      properties: {
        skus: {
          type: 'array',
          items: { type: 'string' },
          description: 'Nalpac SKUs to price-preview. Max 20.',
        },
      },
      required: ['skus'],
    },
  },
  {
    name: 'score_candidates',
    description:
      'Score Nalpac SKUs using the 5-factor deal-scoring algorithm (profitability, ' +
      'deal-ability, inventory, images, category freshness). Returns: sku, score.',
    input_schema: {
      type: 'object',
      properties: {
        skus: {
          type: 'array',
          items: { type: 'string' },
          description: 'Nalpac SKUs to score. Max 20.',
        },
      },
      required: ['skus'],
    },
  },
  {
    name: 'stage_import_candidates',
    description:
      'Stage Nalpac SKUs as PENDING import candidates in the /admin/imports queue. ' +
      'Each input SKU is resolved to its master product group (collapsing all ' +
      'Color/Size/Volume variants into one row). Multiple SKUs that map to the same ' +
      'master are deduped automatically. Skips masters whose any SKU is already ' +
      'carried. Returns counts of staged, skipped_carried, not_found. ' +
      'Human approves in /admin/imports.',
    input_schema: {
      type: 'object',
      properties: {
        skus:   { type: 'array', items: { type: 'string' }, description: 'Nalpac SKUs to stage (any variant SKU from the master group works).' },
        reason: { type: 'string', description: 'Human-readable reason for staging (stored as gap_reason).' },
      },
      required: ['skus'],
    },
  },
  {
    name: 'propose_pricing_changes',
    description:
      "For CARRIED products only: propose pricing changes (status='pending') in the " +
      '/admin/pricing queue. Never sets a price below MAP. If a SKU is not carried, ' +
      'it is skipped with a note — use stage_import_candidates first. Returns counts ' +
      'of proposed, skipped-not-carried, skipped-below-map.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku:       { type: 'string', description: 'Nalpac SKU.' },
              new_price: { type: 'number', description: 'Proposed new sell price in USD.' },
            },
            required: ['sku', 'new_price'],
          },
          description: 'Array of {sku, new_price} pairs.',
        },
        reason: { type: 'string', description: 'Human-readable reason for the pricing change.' },
      },
      required: ['items', 'reason'],
    },
  },
  {
    name: 'propose_discovery_pins',
    description:
      'Insert discovery pin_fallback rules (active=false, inactive until a human ' +
      'activates in /admin/discovery-rules). If a brand is given, resolves carried ' +
      'product handles via search_our_catalog logic. Returns count of rows inserted.',
    input_schema: {
      type: 'object',
      properties: {
        handles:  { type: 'array', items: { type: 'string' }, description: 'Explicit product handles to pin.' },
        brand:    { type: 'string', description: 'Brand name — resolves carried handles automatically.' },
        category: { type: 'string', description: 'Discovery category for the pin (e.g. Pleasure, Play, Body, Wear).' },
        reason:   { type: 'string', description: 'Human-readable notes stored on the rule.' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'draft_brand_collection',
    description:
      'Return a STRUCTURED PLAN for a brand collection (no DB write). Includes a ' +
      'suggested collection title, handle, Emma-voice description, and handles to ' +
      'include. The team creates the collection in /admin/collections-mgr.',
    input_schema: {
      type: 'object',
      properties: {
        brand:           { type: 'string',  description: 'Brand/vendor name.' },
        product_handles: { type: 'array', items: { type: 'string' }, description: 'Optional explicit handles to include.' },
      },
      required: ['brand'],
    },
  },
  {
    name: 'get_homepage_levers',
    description:
      'Read the current homepage prominence configuration: daily-deal queue status, ' +
      'for-him/for-her tag carousels, and active discovery rules. Useful before ' +
      "recommending placement. Returns a summary of each lever's current state.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
]

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export type PmToolExecutionResult = {
  content: string
  is_error?: boolean
  diagnostics?: {
    durationMs: number
    resultCount?: number
  }
}

export async function dispatchPmTool(
  name: string,
  input: Record<string, unknown>,
): Promise<PmToolExecutionResult> {
  const start = Date.now()
  try {
    // ------------------------------------------------------------------
    // 1. search_nalpac_feed
    // ------------------------------------------------------------------
    if (name === 'search_nalpac_feed') {
      const brand      = typeof input['brand']       === 'string'  ? input['brand'].toLowerCase()    : null
      const category   = typeof input['category']    === 'string'  ? input['category'].toLowerCase() : null
      const keyword    = typeof input['keyword']     === 'string'  ? input['keyword'].toLowerCase()  : null
      const onSaleOnly = input['on_sale_only'] === true
      const newOnly    = input['new_only']     === true
      const top100Only = input['top100_only']  === true
      const limit      = typeof input['limit'] === 'number' ? Math.min(input['limit'], 50) : 20

      const feedResult = await fetchAllNalpacFeeds()
      const rows: {
        sku: string; title: string | null; vendor: string | null
        wholesale: number; msrp: number; map: number | null
        qty: number | null; margin_pct: number
        in_sale_feed: boolean; in_new_feed: boolean; in_top100_feed: boolean
      }[] = []

      for (const [sku, snap] of feedResult.snapshots) {
        if (onSaleOnly  && !snap.inSaleFeed)   continue
        if (newOnly     && !snap.inNewFeed)    continue
        if (top100Only  && !snap.inTop100Feed) continue
        if (brand    && !snap.vendor?.toLowerCase().includes(brand))       continue
        if (keyword  && !snap.productTitle?.toLowerCase().includes(keyword)) continue
        if (category) {
          const subCat = snap.raw.mainRow?.['Sub-Category']?.toLowerCase() ?? ''
          if (!subCat.includes(category)) continue
        }
        const margin_pct = snap.msrp > 0
          ? Math.round(((snap.msrp - snap.wholesale) / snap.msrp) * 100) / 100
          : 0
        rows.push({
          sku,
          title:        snap.productTitle,
          vendor:       snap.vendor,
          wholesale:    snap.wholesale,
          msrp:         snap.msrp,
          map:          snap.mapPrice,
          qty:          snap.qty,
          margin_pct,
          in_sale_feed:  snap.inSaleFeed,
          in_new_feed:   snap.inNewFeed,
          in_top100_feed: snap.inTop100Feed,
        })
        if (rows.length >= limit) break
      }

      return {
        content: JSON.stringify({ count: rows.length, results: rows, feed_errors: feedResult.errors }),
        diagnostics: { durationMs: Date.now() - start, resultCount: rows.length },
      }
    }

    // ------------------------------------------------------------------
    // 2. get_catalog_coverage
    // ------------------------------------------------------------------
    if (name === 'get_catalog_coverage') {
      const brand    = typeof input['brand']    === 'string' ? input['brand']    : null
      const category = typeof input['category'] === 'string' ? input['category'] : null

      // Carried SKUs from dealHistory
      const carriedRows = await db
        .selectDistinct({ sku: dealHistory.sku, brand: dealHistory.brand })
        .from(dealHistory)
      const carriedSkus = new Set(carriedRows.map(r => r.sku))

      if (brand) {
        const brandLower = brand.toLowerCase()
        // Feed SKUs for this brand
        const feedResult = await fetchAllNalpacFeeds()
        const feedBrandSkus: string[] = []
        for (const [sku, snap] of feedResult.snapshots) {
          if (snap.vendor?.toLowerCase().includes(brandLower)) feedBrandSkus.push(sku)
        }
        const feedCount    = feedBrandSkus.length
        const carriedCount = feedBrandSkus.filter(s => carriedSkus.has(s)).length
        const gapCount     = feedCount - carriedCount

        return {
          content: JSON.stringify({
            brand,
            feed_sku_count:    feedCount,
            carried_count:     carriedCount,
            gap_count:         gapCount,
            coverage_pct:      feedCount > 0 ? Math.round((carriedCount / feedCount) * 100) : 0,
          }),
          diagnostics: { durationMs: Date.now() - start },
        }
      }

      // General coverage summary
      const brandCount = new Map<string, { feed: number; carried: number }>()
      const feedResult = await fetchAllNalpacFeeds()
      for (const [sku, snap] of feedResult.snapshots) {
        if (!snap.vendor) continue
        const b = snap.vendor
        if (!brandCount.has(b)) brandCount.set(b, { feed: 0, carried: 0 })
        const entry = brandCount.get(b)!
        entry.feed++
        if (carriedSkus.has(sku)) entry.carried++
      }
      const summary = [...brandCount.entries()]
        .filter(([, v]) => v.feed > 0)
        .map(([brand, v]) => ({
          brand,
          feed_sku_count:    v.feed,
          carried_count:     v.carried,
          gap_count:         v.feed - v.carried,
          coverage_pct:      Math.round((v.carried / v.feed) * 100),
        }))
        .filter(r => category ? r.brand.toLowerCase().includes(category.toLowerCase()) : true)
        .sort((a, b) => b.gap_count - a.gap_count)
        .slice(0, 30)

      return {
        content: JSON.stringify({ brands: summary }),
        diagnostics: { durationMs: Date.now() - start, resultCount: summary.length },
      }
    }

    // ------------------------------------------------------------------
    // 3. search_our_catalog
    // ------------------------------------------------------------------
    if (name === 'search_our_catalog') {
      const params: Parameters<typeof searchCatalogForEmma>[0] = { limit: 20 }
      if (typeof input['keyword'] === 'string') params.keyword   = input['keyword']
      if (Array.isArray(input['tags']))          params.tags      = input['tags'] as string[]
      if (typeof input['limit']   === 'number') params.limit     = Math.min(input['limit'] as number, 50)
      // brand becomes a keyword filter if no dedicated field
      if (typeof input['brand']   === 'string' && !params.keyword) params.keyword = input['brand']
      const cards = await searchCatalogForEmma(params)
      return {
        content: JSON.stringify({ count: cards.length, results: cards }),
        diagnostics: { durationMs: Date.now() - start, resultCount: cards.length },
      }
    }

    // ------------------------------------------------------------------
    // 4. price_preview
    // ------------------------------------------------------------------
    if (name === 'price_preview') {
      const skus = Array.isArray(input['skus']) ? (input['skus'] as string[]).slice(0, 20) : []
      if (skus.length === 0) {
        return {
          content: JSON.stringify({ error: 'skus array is required and must be non-empty' }),
          is_error: true,
          diagnostics: { durationMs: Date.now() - start },
        }
      }
      const feedResult = await fetchAllNalpacFeeds()
      const results: {
        sku: string
        proposed_price: number
        compare_at: number
        margin_pct: number
        profit_per_unit: number
        map_respected: boolean
        tier: string
        error?: string
      }[] = []

      for (const sku of skus) {
        const snap = feedResult.snapshots.get(sku)
        if (!snap) {
          results.push({ sku, proposed_price: 0, compare_at: 0, margin_pct: 0, profit_per_unit: 0, map_respected: false, tier: 'not_found', error: 'SKU not in feed' })
          continue
        }
        const pricingSnap: PricingSnapshot = {
          sku,
          vendor:           snap.vendor,
          msrp:             snap.msrp,
          wholesale:        snap.wholesale,
          mapPrice:         snap.mapPrice,
          currentPrice:     snap.msrp,
          currentCompareAt: null,
          inSaleFeed:       snap.inSaleFeed,
          nalpacDiscountPct: snap.nalpacDiscountPct,
        }
        const computation = computeTargetPrice(pricingSnap)
        const profit = computation.newPrice - snap.wholesale
        results.push({
          sku,
          proposed_price:  computation.newPrice,
          compare_at:      computation.newCompareAt,
          margin_pct:      Math.round(computation.marginPct * 100) / 100,
          profit_per_unit: Math.round(profit * 100) / 100,
          map_respected:   computation.mapRespected,
          tier:            computation.tier,
        })
      }
      return {
        content: JSON.stringify({ count: results.length, results }),
        diagnostics: { durationMs: Date.now() - start, resultCount: results.length },
      }
    }

    // ------------------------------------------------------------------
    // 5. score_candidates
    // ------------------------------------------------------------------
    if (name === 'score_candidates') {
      const skus = Array.isArray(input['skus']) ? (input['skus'] as string[]).slice(0, 20) : []
      if (skus.length === 0) {
        return {
          content: JSON.stringify({ error: 'skus array is required and must be non-empty' }),
          is_error: true,
          diagnostics: { durationMs: Date.now() - start },
        }
      }
      const feedResult = await fetchAllNalpacFeeds()
      const recentSkus = new Set<string>()
      const recentCategories: string[][] = []
      const blockedBrands = new Set<string>()

      const results: { sku: string; score: number; error?: string }[] = []
      for (const sku of skus) {
        const snap = feedResult.snapshots.get(sku)
        if (!snap) {
          results.push({ sku, score: 0, error: 'SKU not in feed' })
          continue
        }
        const syntheticProduct: NalpacProduct = {
          SKU:                      sku,
          'UPC/barcode':            '',
          'Product Title':          snap.productTitle ?? '',
          'Product Description':    '',
          'Image 1': snap.raw.mainRow?.['Image 1'] ?? snap.raw.saleRow?.['Image 1'] ?? '',
          'Image 2': snap.raw.mainRow?.['Image 2'] ?? snap.raw.saleRow?.['Image 2'] ?? '',
          'Image 3': snap.raw.mainRow?.['Image 3'] ?? snap.raw.saleRow?.['Image 3'] ?? '',
          'Image 4': '', 'Image 5': '', 'Image 6': '', 'Image 7': '',
          'Image 8': '', 'Image 9': '', 'Image 10': '',
          Wholesale:                String(snap.wholesale),
          MSRP:                     String(snap.msrp),
          MAP:                      String(snap.mapPrice ?? 0),
          'Nalpac qty available':   String(snap.qty ?? 0),
          'Entrenue qty available': '0',
          'Total qty available':    String(snap.qty ?? 0),
          'Fluid Oz': '',
          Brand:      snap.vendor ?? '',
          Material:   '',
          Color:      '',
          'Main Category':  '',
          'Sub-Category':   snap.raw.mainRow?.['Sub-Category'] ?? snap.raw.saleRow?.['Sub-Category'] ?? '',
          Size:             '',
        }
        const scored = scoreProduct(syntheticProduct, recentSkus, recentCategories, blockedBrands)
        results.push({ sku, score: scored?.score ?? 0 })
      }
      return {
        content: JSON.stringify({ count: results.length, results }),
        diagnostics: { durationMs: Date.now() - start, resultCount: results.length },
      }
    }

    // ------------------------------------------------------------------
    // 6. stage_import_candidates
    // ------------------------------------------------------------------
    if (name === 'stage_import_candidates') {
      const skus   = Array.isArray(input['skus']) ? (input['skus'] as string[]) : []
      const reason = typeof input['reason'] === 'string' ? input['reason'] : undefined
      if (skus.length === 0) {
        return {
          content: JSON.stringify({ error: 'skus array is required and must be non-empty' }),
          is_error: true,
          diagnostics: { durationMs: Date.now() - start },
        }
      }

      const result = await stageMasterCandidatesBySkus(skus, reason ? { reason } : undefined)

      return {
        content: JSON.stringify({
          staged:          result.staged,
          skipped_carried: result.skippedCarried,
          not_found:       result.notFound,
        }),
        diagnostics: { durationMs: Date.now() - start, resultCount: result.staged },
      }
    }

    // ------------------------------------------------------------------
    // 7. propose_pricing_changes
    // ------------------------------------------------------------------
    if (name === 'propose_pricing_changes') {
      type ItemInput = { sku: string; new_price: number }
      const items  = Array.isArray(input['items'])  ? (input['items'] as ItemInput[]) : []
      const reason = typeof input['reason'] === 'string' ? input['reason'] : 'PM agent proposal'
      if (items.length === 0) {
        return {
          content: JSON.stringify({ error: 'items array is required and must be non-empty' }),
          is_error: true,
          diagnostics: { durationMs: Date.now() - start },
        }
      }

      const feedResult = await fetchAllNalpacFeeds()
      const todayStr   = new Date().toISOString().slice(0, 10)
      let proposed = 0, skippedNotCarried = 0, skippedBelowMap = 0
      const notes: string[] = []

      for (const item of items) {
        const { sku, new_price } = item
        if (!sku || typeof new_price !== 'number') {
          notes.push(`Invalid item: ${JSON.stringify(item)}`)
          continue
        }

        // Resolve productId + the actual variant GID via Shopify (confirms the
        // SKU is carried). variantId must be a real ProductVariant GID — the
        // pricing-apply path reads pricingChanges.variantId directly.
        const productId = await findProductBySKU(sku)
        const variantId = await findVariantBySKU(sku)
        if (!productId || !variantId) {
          skippedNotCarried++
          notes.push(`${sku}: not found in Shopify catalog — use stage_import_candidates first`)
          continue
        }

        // MAP enforcement: check feed for MAP.
        const snap = feedResult.snapshots.get(sku)
        const mapPrice = snap?.mapPrice ?? null
        if (mapPrice != null && new_price < mapPrice) {
          skippedBelowMap++
          notes.push(`${sku}: proposed $${new_price} is below MAP $${mapPrice} — skipped`)
          continue
        }

        // Compute compare_at from feed MSRP.
        const msrp       = snap?.msrp ?? new_price
        const wholesale  = snap?.wholesale ?? 0
        const marginPct  = new_price > 0 ? (new_price - wholesale) / new_price : 0

        await db.insert(pricingChanges).values({
          runDate:      todayStr,
          sku,
          productId,
          productHandle: null,
          productTitle:  snap?.productTitle ?? null,
          variantId,
          variantTitle: null,
          vendor:       snap?.vendor ?? null,
          tier:         'manual',
          oldPrice:     null,
          newPrice:     String(new_price),
          oldCompareAt: null,
          newCompareAt: String(msrp),
          oldWholesale: null,
          newWholesale: snap?.wholesale != null ? String(snap.wholesale) : null,
          mapPrice:     mapPrice != null ? String(mapPrice) : null,
          marginPct:    String(Math.round(marginPct * 10000) / 10000),
          reason,
          mapRespected: true,
          status:       'pending',
        })
        proposed++
      }

      return {
        content: JSON.stringify({
          proposed,
          skipped_not_carried: skippedNotCarried,
          skipped_below_map:   skippedBelowMap,
          notes,
          next_step: 'Review and approve in /admin/pricing',
        }),
        diagnostics: { durationMs: Date.now() - start, resultCount: proposed },
      }
    }

    // ------------------------------------------------------------------
    // 8. propose_discovery_pins
    // ------------------------------------------------------------------
    if (name === 'propose_discovery_pins') {
      const explicitHandles = Array.isArray(input['handles']) ? (input['handles'] as string[]) : []
      const brand           = typeof input['brand']    === 'string' ? input['brand']    : null
      const category        = typeof input['category'] === 'string' ? input['category'] : null
      const reason          = typeof input['reason']   === 'string' ? input['reason']   : 'PM agent proposal'

      let handles = [...explicitHandles]

      // Resolve brand to carried handles if provided.
      if (brand) {
        const cards = await searchCatalogForEmma({ keyword: brand, limit: 20 })
        const brandHandles = cards.map(c => c.handle)
        handles = [...new Set([...handles, ...brandHandles])]
      }

      if (handles.length === 0) {
        return {
          content: JSON.stringify({ error: 'No handles to pin. Provide handles or a brand.' }),
          is_error: true,
          diagnostics: { durationMs: Date.now() - start },
        }
      }

      let inserted = 0
      for (const handle of handles) {
        await db.insert(discoveryRules).values({
          ruleType:  'pin_fallback',
          ruleValue: handle,
          category:  category ?? null,
          sortOrder: 0,
          notes:     reason,
          active:    false, // INERT until human activates in /admin/discovery-rules
        })
        inserted++
      }

      return {
        content: JSON.stringify({
          inserted,
          handles,
          active: false,
          next_step: 'Activate in /admin/discovery-rules when ready',
        }),
        diagnostics: { durationMs: Date.now() - start, resultCount: inserted },
      }
    }

    // ------------------------------------------------------------------
    // 9. draft_brand_collection
    // ------------------------------------------------------------------
    if (name === 'draft_brand_collection') {
      const brand          = typeof input['brand']           === 'string' ? input['brand']           : 'Unknown Brand'
      const productHandles = Array.isArray(input['product_handles']) ? (input['product_handles'] as string[]) : []

      let handles = productHandles
      if (handles.length === 0) {
        const cards = await searchCatalogForEmma({ keyword: brand, limit: 30 })
        handles = cards.map(c => c.handle)
      }

      const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const plan = {
        brand,
        suggested_collection_title:  `${brand} — Full Collection`,
        suggested_handle:            slug,
        suggested_description:
          `Discover everything from ${brand} — curated picks across pleasure, play, and body wellness. ` +
          `Each product is selected for quality, value, and real-world results.`,
        product_handles: handles,
        product_count:   handles.length,
        next_step:       'Create this collection in /admin/collections-mgr with these handles.',
      }

      return {
        content: JSON.stringify(plan),
        diagnostics: { durationMs: Date.now() - start },
      }
    }

    // ------------------------------------------------------------------
    // 10. get_homepage_levers
    // ------------------------------------------------------------------
    if (name === 'get_homepage_levers') {
      const [homepageTemplate, activeRulesRows] = await Promise.all([
        db.select({ value: pipelineSettings.value }).from(pipelineSettings)
          .where(eq(pipelineSettings.key, 'homepage_template')).limit(1),
        db.select({ ruleType: discoveryRules.ruleType, category: discoveryRules.category, count: sql<number>`count(*)` })
          .from(discoveryRules)
          .where(eq(discoveryRules.active, true))
          .groupBy(discoveryRules.ruleType, discoveryRules.category),
      ])

      const template = homepageTemplate[0]?.value ?? 'compass'

      const levers = {
        homepage_template: template,
        levers: [
          {
            name:        'Daily Deal Queue',
            description: 'Emma features one hand-picked product on the homepage. Manage in /admin/deals.',
            how_to_use:  'Approve a deal in /admin/deals or use stage_import_candidates to surface new candidates.',
          },
          {
            name:        'For-Him / For-Her Tag Carousels',
            description: 'Homepage rails driven by for-him and for-her Shopify tags.',
            how_to_use:  'Add for-him or for-her tags to products in Shopify admin or via propose_discovery_pins.',
          },
          {
            name:        'Discovery Pin Fallbacks',
            description: 'Curator-pinned products that appear when the discovery filter returns too few results.',
            how_to_use:  "Use propose_discovery_pins to stage pins. Activate in /admin/discovery-rules.",
            active_pins: activeRulesRows.filter(r => r.ruleType === 'pin_fallback').map(r => ({
              category: r.category ?? 'all',
              count:    Number(r.count),
            })),
          },
        ],
      }

      return {
        content: JSON.stringify(levers),
        diagnostics: { durationMs: Date.now() - start },
      }
    }

    // Unknown tool
    return {
      content: JSON.stringify({ error: 'unknown_tool', name }),
      is_error: true,
      diagnostics: { durationMs: Date.now() - start },
    }
  } catch (err) {
    return {
      content: JSON.stringify({
        error:   'tool_execution_failed',
        message: err instanceof Error ? err.message : String(err),
      }),
      is_error: true,
      diagnostics: { durationMs: Date.now() - start },
    }
  }
}
