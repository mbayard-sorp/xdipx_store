/**
 * Bulk product import library.
 * Parses a modified Nalpac CSV (with Master SKU / Variant Option columns),
 * groups rows into MasterProductGroups, and imports each group through the
 * full AI content generation pipeline into Shopify + Neon DB.
 */

import { parse } from 'csv-parse/sync'
import { eq, max } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { dealHistory } from '../../db/schema'
import { generateSEOTitle } from '~/lib/claude.server'
import { generateProductContent } from '~/lib/emma-orchestrator.server'
import { cleanDescription, isDiscontinued, deriveSection } from '~/lib/feed-processor.server'
import { UNCATEGORIZED_SENTINEL } from '~/lib/master-collapse.server'
import {
  findProductBySKU,
  createShopifyProductFromFeed,
  createShopifyProductWithVariants,
  slugifyHandle,
  getProductHandleById,
  getPairingCandidates,
  pushProductToShopify,
  activateProductInventoryAtLocations,
  publishProductToXdipxChannels,
} from '~/lib/shopify.server'
import { upsertProductPage } from '~/lib/sanity.server'
import type { BulkImportRow, BulkVariantRow, MasterProductGroup } from '~/types'
import type { ProductScore } from '~/types'

// ─── Category inference (mirrors deal-pipeline.server.ts) ─────────────────────

/** Phase 2 — multi-select inference. Returns an array of audience tags. */
function inferCategory(categories: string[]): Array<'for-him' | 'for-her' | 'couples'> {
  const forHimCats  = ['Vagina Strokers', 'Body Molds', 'Prostate Toys', 'Masturbators', 'Hands-Free Masturbators']
  const forHerCats  = ['Dual Action and Rabbits', 'Finger and Clit', 'Air Pulse and Suction', 'Bullets and Eggs']
  const coupleCats  = ['Couples and Wearable', 'Remote', 'Top Couples Toys', 'Restraints']
  const out: Array<'for-him' | 'for-her' | 'couples'> = []
  if (categories.some(c => forHimCats.includes(c)))  out.push('for-him')
  if (categories.some(c => forHerCats.includes(c)))  out.push('for-her')
  if (categories.some(c => coupleCats.includes(c))) out.push('couples')
  // Default to ['for-him', 'for-her'] — the legacy 'both' equivalent — when no
  // category signals match.
  return out.length > 0 ? out : ['for-him', 'for-her']
}

/** Editorial sub-category labels for Shopify/Sanity tags — drops the
 *  "(uncategorized)" placeholder the master-collapse pipeline emits when no
 *  Sub-Category can be inferred. */
function editorialTagsFrom(categories: string[]): string[] {
  return categories.filter(c => c && c !== UNCATEGORIZED_SENTINEL)
}

// ─── Deal price computation (mirrors feed-processor.server.ts) ────────────────

function computeDealPrice(wholesale: number, msrp: number, map: number): number {
  if (map === 0)    return Math.round(Math.max(wholesale * 1.4, msrp * 0.55) * 100) / 100
  if (map < msrp)   return Math.round(map * 100) / 100
  return Math.round(msrp * 100) / 100
}

// ─── Image extraction ─────────────────────────────────────────────────────────

function getImages(row: BulkImportRow): string[] {
  const imgs: string[] = []
  for (let i = 1; i <= 10; i++) {
    const url = row[`Image ${i}` as keyof BulkImportRow] as string | undefined
    if (url?.trim()) imgs.push(url.trim())
  }
  return imgs
}

// ─── CSV parse ────────────────────────────────────────────────────────────────

export function parseBulkImportCSV(csvText: string): {
  groups: MasterProductGroup[]
  parseErrors: { sku: string; message: string }[]
} {
  const rows = parse(csvText, {
    columns:           true,
    skip_empty_lines:  true,
    trim:              true,
  }) as BulkImportRow[]

  const parseErrors: { sku: string; message: string }[] = []

  // Strip trailing ".0" from Master SKU values (artifact of spreadsheet export)
  for (const row of rows) {
    if (row['Master SKU']) {
      row['Master SKU'] = row['Master SKU'].replace(/\.0$/, '')
    }
  }

  // Separate masters (Master SKU empty) from children (Master SKU filled)
  const masterRows  = rows.filter(r => !r['Master SKU'])
  const childRows   = rows.filter(r => !!r['Master SKU'])

  const groups: MasterProductGroup[] = []

  for (const master of masterRows) {
    const masterSku = master.SKU
    const children  = childRows.filter(r => r['Master SKU'] === masterSku)

    if (children.length === 0 && !master['Variant Option Value'] && !master['Variant Option Value 2']) {
      // Standalone product — no variants
      groups.push({ masterRow: master, variants: [], isSingleVariant: true })
      continue
    }

    // Master row itself is the first variant when it carries a Variant Option Value
    const allVariantRows: BulkImportRow[] = master['Variant Option Value']
      ? [master, ...children]
      : children

    // Validate consistent Variant Option Name (axis 1) across the group
    const optionNames1 = new Set(allVariantRows.map(r => r['Variant Option Name']).filter(Boolean))
    if (optionNames1.size > 1) {
      parseErrors.push({
        sku:     masterSku,
        message: `Inconsistent Variant Option Name: ${[...optionNames1].join(', ')}`,
      })
      continue
    }

    // Validate consistent Variant Option Name 2 (axis 2) across the group
    const optionNames2 = new Set(allVariantRows.map(r => r['Variant Option Name 2']).filter(Boolean))
    if (optionNames2.size > 1) {
      parseErrors.push({
        sku:     masterSku,
        message: `Inconsistent Variant Option Name 2: ${[...optionNames2].join(', ')}`,
      })
      continue
    }

    // Axis-2 must be uniformly present or uniformly absent across the group.
    // Partial population (some rows have Value 2, others don't) is a data error.
    const hasAxis2Name = optionNames2.size === 1
    if (hasAxis2Name) {
      for (const r of allVariantRows) {
        if (!r['Variant Option Value 2']) {
          parseErrors.push({
            sku:     masterSku,
            message: `Row SKU ${r.SKU} is missing Variant Option Value 2 but other rows in this group supply one`,
          })
        }
      }
      if (parseErrors.some(e => e.sku === masterSku)) continue
    } else {
      for (const r of allVariantRows) {
        if (r['Variant Option Value 2']) {
          parseErrors.push({
            sku:     masterSku,
            message: `Row SKU ${r.SKU} supplies Variant Option Value 2 but Variant Option Name 2 is missing or inconsistent`,
          })
        }
      }
      if (parseErrors.some(e => e.sku === masterSku)) continue
    }

    const variants: BulkVariantRow[] = allVariantRows.map(r => {
      const wholesale     = parseFloat(r.Wholesale) || 0
      const msrp          = parseFloat(r.MSRP)      || 0
      const map           = parseFloat(r.MAP ?? '0') || 0
      const qty           = parseInt(r['Total qty available']) || 0
      const value1        = r['Variant Option Value'] || r.SKU
      const optionValues  = hasAxis2Name
        ? [value1, r['Variant Option Value 2']]
        : [value1]
      return {
        sku:            r.SKU,
        optionValues,
        price:          computeDealPrice(wholesale, msrp, map),
        compareAtPrice: msrp,
        qty,
        wholesale,
        images:         getImages(r),
      }
    })

    groups.push({ masterRow: master, variants, isSingleVariant: false })
  }

  return { groups, parseErrors }
}

// ─── Duplicate check ──────────────────────────────────────────────────────────

export async function isSkuAlreadyImported(sku: string): Promise<boolean> {
  const rows = await db
    .select({ sku: dealHistory.sku })
    .from(dealHistory)
    .where(eq(dealHistory.sku, sku))
    .limit(1)
  return rows.length > 0
}

// ─── Import one product group ─────────────────────────────────────────────────

export async function importProductGroup(group: MasterProductGroup): Promise<{
  success: boolean
  sku: string
  shopifyProductId?: string
  skipped?: boolean
  error?: string
  /** Non-fatal issues — Shopify row succeeded but something downstream (e.g. Sanity sync) didn't. */
  warnings?: { stage: string; message: string }[]
}> {
  const { masterRow, variants, isSingleVariant } = group
  const masterSku = masterRow.SKU

  try {
    // 1. Discontinued check — Nalpac flags abandoned products in Sub-Category /
    //    Product Title / Description. Don't waste AI spend on a product we'll
    //    have to take down. The daily-feed-processor cron archives any
    //    already-imported SKUs that flip discontinued in a later feed.
    if (isDiscontinued({
      'Sub-Category':       masterRow['Sub-Category'] ?? '',
      'Product Title':      masterRow['Product Title'] ?? '',
      'Product Description': masterRow['Product Description'] ?? '',
    })) {
      console.info(`[bulk-import] ${masterSku} skipped: discontinued`)
      return { success: false, sku: masterSku, skipped: true, error: 'discontinued by manufacturer' }
    }

    // 2. Duplicate check
    if (await isSkuAlreadyImported(masterSku)) {
      return { success: false, sku: masterSku, skipped: true }
    }

    // 2. Parse product fields from master row
    const wholesale = parseFloat(masterRow.Wholesale) || 0
    const msrp      = parseFloat(masterRow.MSRP)      || 0
    const map       = parseFloat(masterRow.MAP ?? '0') || 0
    const qty       = parseInt(masterRow['Total qty available']) || 0
    const images    = getImages(masterRow)
    const rawDesc     = masterRow['Product Description'] ?? ''
    const cleanedDesc = cleanDescription(rawDesc)
    const description = cleanedDesc || `${masterRow.Brand} ${masterRow['Product Title']}`
    const categories  = masterRow['Sub-Category']
      ? masterRow['Sub-Category'].split(',').map(c => c.trim()).filter(Boolean)
      : []
    const dealPrice   = computeDealPrice(wholesale, msrp, map)
    const category    = inferCategory(categories)

    // 3. Create Shopify product (reuse existing if already in Shopify)
    let numericId: string
    const existingGid = await findProductBySKU(masterSku)

    if (existingGid) {
      numericId = existingGid.replace('gid://shopify/Product/', '')
    } else if (isSingleVariant) {
      // Single-variant — use existing createShopifyProductFromFeed
      const productScore: ProductScore = {
        sku:          masterSku,
        title:        masterRow['Product Title'],
        brand:        masterRow.Brand,
        description,
        score:        0,
        msrp,
        wholesaleCost: wholesale,
        mapPrice:     map,
        dealPrice,
        discountPct:  msrp > 0 ? ((msrp - dealPrice) / msrp) * 100 : 0,
        profitPerUnit: dealPrice - wholesale,
        qty,
        mapType:      map === 0 ? 'no-map' : map < msrp ? 'below-msrp' : 'equals-msrp',
        images,
        categories,
      }
      // Phase 1 rebuild — handle is now an explicit caller input. Bulk-import
      // preserves the legacy slugify-from-title behavior via slugifyHandle();
      // new importNewProduct() entry point accepts an explicit handle from
      // the product-management agent.
      const handle = slugifyHandle(masterRow['Product Title'])
      numericId = await createShopifyProductFromFeed(productScore, handle)
    } else {
      // Multi-variant
      const name1 = group.masterRow['Variant Option Name'] || 'Option'
      const name2 = group.masterRow['Variant Option Name 2']
      const optionNames = name2 ? [name1, name2] : [name1]
      const handle = slugifyHandle(masterRow['Product Title'])
      numericId = await createShopifyProductWithVariants(
        {
          title:      masterRow['Product Title'],
          brand:      masterRow.Brand,
          sku:        masterSku,
          images,
          msrp,
          categories,
        },
        variants,
        optionNames,
        handle,
      )
    }

    // 4. Generate SEO title (initial seed for Emma's orchestrator — the
    //    orchestrator's `generateProductTitle` tool may augment it further
    //    based on dial classification + tags).
    const seoTitle = await generateSEOTitle(masterRow['Product Title'], masterRow.Brand)

    // 5. Resolve pairing candidates so the orchestrator's `proposePairingWhy`
    //    tool can pick 1–3 sibling products to recommend with Emma-voice copy.
    //    Best-effort — if Shopify is empty for this category, we just pass an
    //    empty list and the tool short-circuits.
    const pairingCandidates = await getPairingCandidates({
      shopifyProductId: numericId,
      category,
      subCategories:    categories,
    }).catch(err => {
      console.warn(`[bulk-import] ${masterSku} pairing-candidates lookup failed:`, err instanceof Error ? err.message : err)
      return []
    })

    // 6. Run the Emma orchestrator — Sonnet tool-use loop that decides which
    //    content generators to call (Emma's take, dial v2, care, mood/audience/
    //    matters tags, pairing-why, mood image, etc.) and returns a consolidated
    //    payload. Note: full_story is no longer generated — the PDP reads
    //    descriptionHtml.
    const { writes, telemetry } = await generateProductContent({
      product: {
        title:       masterRow['Product Title'],
        brand:       masterRow.Brand,
        description,
        categories,
        dealPrice,
        msrp,
      },
      seoTitle,
      category,
      pairingCandidates,
    })

    // Final shopper-facing title (augmented when Emma decided the raw title
    // needed an SEO descriptor; otherwise unchanged).
    const finalTitle = writes.productTitle ?? seoTitle

    console.info(
      `[bulk-import] ${masterSku} orchestrator: tokens=${telemetry.totalTokens} ` +
      `duration=${telemetry.durationMs}ms turns=${telemetry.turns} ` +
      `pairings=${writes.accessoryProductIds?.length ?? 0} ` +
      `titleAugmented=${writes.productTitleAugmented ? 'yes' : 'no'} ` +
      `tools=[${telemetry.toolCalls.map(c => `${c.name}${c.ok ? '' : '!'}`).join(',')}]`,
    )

    // 7. Push all metafields to Shopify (full_story deliberately omitted)
    await pushProductToShopify({
      shopifyProductId:   numericId,
      // Update product.title when augmented; leave alone otherwise.
      ...(writes.productTitleAugmented ? { title: finalTitle } : {}),
      seoTitle:           finalTitle,
      tagline:            writes.tagline,
      ...(writes.worksForHim      !== undefined ? { worksForHim:      writes.worksForHim }      : {}),
      ...(writes.worksForHer      !== undefined ? { worksForHer:      writes.worksForHer }      : {}),
      ...(writes.boxContents      !== undefined ? { boxContents:      writes.boxContents }      : {}),
      ...(writes.specifications   !== undefined ? { specifications:   writes.specifications }   : {}),
      seoMetaDescription: writes.seoMetaDescription,
      descriptionHtml:    writes.descriptionHtml,
      ...(writes.careInstructions !== undefined ? { careInstructions: writes.careInstructions } : {}),
      ...(writes.sensationDialV2  !== undefined ? { sensationDialV2:  writes.sensationDialV2 }  : {}),
      productTypeDial:    writes.productTypeDial,
      ...(writes.productSubtypeDial != null ? { productSubtypeDial: writes.productSubtypeDial } : {}),
      moodTags:           writes.moodTags,
      audienceTags:       writes.audienceTags,
      mattersTags:        writes.mattersTags,
      ...(writes.emmaHero         !== undefined ? { emmaHero:         writes.emmaHero }         : {}),
      ...(writes.moodImageUrl     !== undefined ? { moodImageUrl:     writes.moodImageUrl }     : {}),
      ...(writes.originalTitle    !== undefined ? { originalTitle:    writes.originalTitle }    : {}),
      ...(writes.accessoryProductIds !== undefined ? { accessoryProductIds: writes.accessoryProductIds } : {}),
      ...(writes.pairingWhy       !== undefined ? { pairingWhy:       writes.pairingWhy }       : {}),
      tags:               editorialTagsFrom(categories),
      category,
      sectionTags:        [deriveSection({ productTypeDial: writes.productTypeDial, categories, title: masterRow['Product Title'] })],
      dealStatus:         'pending_approval',
      dealDate:           '2099-12-31',
      originalPrice:      msrp,
      wholesaleCost:      wholesale,
      mapPrice:           map,
      nalpacSku:          masterSku,
      rawDescription:     cleanedDesc || undefined,
    })

    // 7. Insert DB row — lands at the bottom of the queue (max sortOrder + 1).
    //    dealDate is still NOT NULL on the schema, so a sentinel is required;
    //    queue activation now reads status='queued' ORDER BY sortOrder ASC
    //    (see deal-rotator.server.ts).
    const [{ maxSort = 0 } = {}] = await db
      .select({ maxSort: max(dealHistory.sortOrder) })
      .from(dealHistory)
    const nextSortOrder = (maxSort ?? 0) + 1

    await db.insert(dealHistory).values({
      sku:              masterSku,
      seoTitle,
      brand:            masterRow.Brand,
      categories,
      dealDate:         '2099-12-31',
      wholesaleCost:    wholesale.toFixed(2),
      dealPrice:        dealPrice.toFixed(2),
      msrp:             msrp.toFixed(2),
      mapPrice:         map.toFixed(2),
      unitsAvailable:   qty,
      dealScore:        null,
      status:           'queued',
      sortOrder:        nextSortOrder,
      shopifyProductId: numericId,
    }).onConflictDoNothing()

    // 8. Create the Sanity productPage doc so search, content blocks, IVR,
    //    and sitemap surfaces pick up the new product. Best-effort — a Sanity
    //    hiccup should not kill a successful Shopify import, but we surface
    //    it as a warning so the admin UI can show it instead of swallowing.
    const warnings: { stage: string; message: string }[] = []
    try {
      const handle = await getProductHandleById(numericId)
      if (!handle) {
        const msg = 'could not resolve Shopify handle — skipping Sanity sync'
        console.warn(`[bulk-import] ${masterSku} ${msg}`)
        warnings.push({ stage: 'sanity', message: msg })
      } else {
        const gid = `gid://shopify/Product/${numericId}`
        const upsertParams: Parameters<typeof upsertProductPage>[0] = {
          handle,
          shopifyProductId: gid,
          title:            masterRow['Product Title'],
          vendor:           masterRow.Brand,
          tags:             editorialTagsFrom(categories), // Mirror sub-categories so Studio editors can filter
          tagline:          writes.tagline,
          description,
          seoTitle,
          seoDescription:   writes.seoMetaDescription,
          category,
          // Pricing fields removed from Sanity productPage schema — pricing
          // lives solely on Shopify metafields where the deal pipeline reads.
          productTypeDial:  writes.productTypeDial,
          ...(writes.productSubtypeDial != null ? { productSubtypeDial: writes.productSubtypeDial } : {}),
          moodTags:         writes.moodTags,
          audienceTags:     writes.audienceTags,
          mattersTags:      writes.mattersTags,
          // IVR / voice surfaces — populated by the orchestrator's IVR tools.
          ...(writes.ivrExperience    !== undefined ? { ivrExperience:    writes.ivrExperience    } : {}),
          ...(writes.ivrUseCase       !== undefined ? { ivrUseCase:       writes.ivrUseCase       } : {}),
          ...(writes.ivrFeatures      !== undefined ? { ivrFeatures:      writes.ivrFeatures      } : {}),
          ...(writes.productFaqs      !== undefined ? { productFaqs:      writes.productFaqs      } : {}),
        }
        if (images[0])              upsertParams.imageUrl     = images[0]
        if (writes.moodImageUrl)    upsertParams.moodImageUrl = writes.moodImageUrl

        // One retry on transient failure (network, short-lived auth hiccup).
        let lastErr: unknown
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const { created } = await upsertProductPage(upsertParams)
            console.info(`[bulk-import] ${masterSku} sanity: ${created ? 'created' : 'updated'} productPage-${handle}`)
            lastErr = null
            break
          } catch (err) {
            lastErr = err
            if (attempt === 1) {
              console.warn(`[bulk-import] ${masterSku} sanity sync attempt 1 failed, retrying in 500ms:`, err instanceof Error ? err.message : err)
              await new Promise(r => setTimeout(r, 500))
            }
          }
        }
        if (lastErr) {
          const msg = `sanity sync failed after retry: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
          console.error(`[bulk-import] ${masterSku} ${msg}`)
          warnings.push({ stage: 'sanity', message: msg })
        }
      }
    } catch (err) {
      const msg = `sanity sync threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`
      console.error(`[bulk-import] ${masterSku} ${msg}`)
      warnings.push({ stage: 'sanity', message: msg })
    }

    return {
      success:          true,
      sku:              masterSku,
      shopifyProductId: numericId,
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[bulk-import] Failed SKU ${masterSku}:`, message)
    return { success: false, sku: masterSku, error: message }
  }
}

// ─── Raw import (no enrichment) ──────────────────────────────────────────────
// Mirrors importProductGroup but skips the Sonnet orchestrator + AI metafield
// push. Use this when you want to land products in Shopify quickly and run
// enrichment as a separate batched pass (Anthropic Message Batches, 50% off).

export async function importProductGroupRaw(group: MasterProductGroup): Promise<{
  success: boolean
  sku: string
  shopifyProductId?: string
  skipped?: boolean
  error?: string
  warnings?: { stage: string; message: string }[]
}> {
  const { masterRow, variants, isSingleVariant } = group
  const masterSku = masterRow.SKU

  try {
    if (isDiscontinued({
      'Sub-Category':       masterRow['Sub-Category'] ?? '',
      'Product Title':      masterRow['Product Title'] ?? '',
      'Product Description': masterRow['Product Description'] ?? '',
    })) {
      return { success: false, sku: masterSku, skipped: true, error: 'discontinued by manufacturer' }
    }

    if (await isSkuAlreadyImported(masterSku)) {
      return { success: false, sku: masterSku, skipped: true }
    }

    const wholesale = parseFloat(masterRow.Wholesale) || 0
    const msrp      = parseFloat(masterRow.MSRP)      || 0
    const map       = parseFloat(masterRow.MAP ?? '0') || 0
    const qty       = parseInt(masterRow['Total qty available']) || 0
    const images    = getImages(masterRow)
    const rawDesc     = masterRow['Product Description'] ?? ''
    const cleanedDesc = cleanDescription(rawDesc)
    const description = cleanedDesc || `${masterRow.Brand} ${masterRow['Product Title']}`
    const categories  = masterRow['Sub-Category']
      ? masterRow['Sub-Category'].split(',').map(c => c.trim()).filter(Boolean)
      : []
    const dealPrice   = computeDealPrice(wholesale, msrp, map)
    const category    = inferCategory(categories)

    let numericId: string
    const existingGid = await findProductBySKU(masterSku)

    if (existingGid) {
      numericId = existingGid.replace('gid://shopify/Product/', '')
    } else if (isSingleVariant) {
      const productScore: ProductScore = {
        sku:           masterSku,
        title:         masterRow['Product Title'],
        brand:         masterRow.Brand,
        description,
        score:         0,
        msrp,
        wholesaleCost: wholesale,
        mapPrice:      map,
        dealPrice,
        discountPct:   msrp > 0 ? ((msrp - dealPrice) / msrp) * 100 : 0,
        profitPerUnit: dealPrice - wholesale,
        qty,
        mapType:       map === 0 ? 'no-map' : map < msrp ? 'below-msrp' : 'equals-msrp',
        images,
        categories,
      }
      const handle = slugifyHandle(masterRow['Product Title'])
      numericId = await createShopifyProductFromFeed(productScore, handle)
    } else {
      const name1 = group.masterRow['Variant Option Name'] || 'Option'
      const name2 = group.masterRow['Variant Option Name 2']
      const optionNames = name2 ? [name1, name2] : [name1]
      const handle = slugifyHandle(masterRow['Product Title'])
      numericId = await createShopifyProductWithVariants(
        {
          title:      masterRow['Product Title'],
          brand:      masterRow.Brand,
          sku:        masterSku,
          images,
          msrp,
          categories,
        },
        variants,
        optionNames,
        handle,
      )
    }

    // Push BASE metafields only — no tagline, descriptionHtml, dial, mood/audience/
    // matters tags, IVR, FAQs. Those are filled by the batched enrichment pass.
    await pushProductToShopify({
      shopifyProductId: numericId,
      tags:             editorialTagsFrom(categories),
      category,
      sectionTags:      [deriveSection({ categories, title: masterRow['Product Title'] })],
      dealStatus:       'pending_approval',
      dealDate:         '2099-12-31',
      originalPrice:    msrp,
      wholesaleCost:    wholesale,
      mapPrice:         map,
      nalpacSku:        masterSku,
      rawDescription:   cleanedDesc || undefined,
      requireTagline:   false,
    })

    const [{ maxSort = 0 } = {}] = await db
      .select({ maxSort: max(dealHistory.sortOrder) })
      .from(dealHistory)
    const nextSortOrder = (maxSort ?? 0) + 1

    await db.insert(dealHistory).values({
      sku:              masterSku,
      seoTitle:         masterRow['Product Title'],  // raw title until enrichment runs
      brand:            masterRow.Brand,
      categories,
      dealDate:         '2099-12-31',
      wholesaleCost:    wholesale.toFixed(2),
      dealPrice:        dealPrice.toFixed(2),
      msrp:             msrp.toFixed(2),
      mapPrice:         map.toFixed(2),
      unitsAvailable:   qty,
      dealScore:        null,
      status:           'queued',
      sortOrder:        nextSortOrder,
      shopifyProductId: numericId,
    }).onConflictDoNothing()

    const warnings: { stage: string; message: string }[] = []

    // Stock the product at both fulfillment locations (quantities come from the
    // daily Nalpac/Entrenue feeds, not from import) and publish to the xdipx
    // sales channels. Both are non-fatal: a failure warns and the import succeeds.
    try {
      await activateProductInventoryAtLocations(numericId)
    } catch (err) {
      warnings.push({ stage: 'inventory-locations', message: err instanceof Error ? err.message : String(err) })
    }
    try {
      await publishProductToXdipxChannels(numericId)
    } catch (err) {
      warnings.push({ stage: 'publish-channels', message: err instanceof Error ? err.message : String(err) })
    }

    // Stub Sanity productPage — title/handle/vendor/raw description only.
    // Enrichment pass will fill tagline, seoTitle, dial, tags, IVR, FAQs.
    try {
      const handle = await getProductHandleById(numericId)
      if (!handle) {
        warnings.push({ stage: 'sanity', message: 'could not resolve Shopify handle — skipping Sanity sync' })
      } else {
        const gid = `gid://shopify/Product/${numericId}`
        const upsertParams: Parameters<typeof upsertProductPage>[0] = {
          handle,
          shopifyProductId: gid,
          title:            masterRow['Product Title'],
          vendor:           masterRow.Brand,
          tags:             editorialTagsFrom(categories),
          description,
          category,
        }
        if (images[0]) upsertParams.imageUrl = images[0]

        let lastErr: unknown
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await upsertProductPage(upsertParams)
            lastErr = null
            break
          } catch (err) {
            lastErr = err
            if (attempt === 1) await new Promise(r => setTimeout(r, 500))
          }
        }
        if (lastErr) {
          warnings.push({ stage: 'sanity', message: `sanity sync failed after retry: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}` })
        }
      }
    } catch (err) {
      warnings.push({ stage: 'sanity', message: err instanceof Error ? err.message : String(err) })
    }

    return {
      success:          true,
      sku:              masterSku,
      shopifyProductId: numericId,
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[bulk-import-raw] Failed SKU ${masterSku}:`, message)
    return { success: false, sku: masterSku, error: message }
  }
}

// ─── Phase 1 forward pipeline — agent-friendly entry point ───────────────────
// `importProductGroup` above stays the entry for the Nalpac CSV bulk path.
// `importNewProduct` below is the entry the product-management agent uses
// (via /api/import-product). It accepts a clean, source-neutral input shape
// and shares the same downstream calls. Future cleanup: merge the glue code
// once both callers stabilize.

export interface ImportNewProductInput {
  /** Where this product came from. Drives source-tag wiring. */
  source: 'manual' | 'agent' | 'nalpac'
  /** Required: SEO-stable product handle. Per CLAUDE.md, the canonical URL
   *  is `/products/{handle}` and never changes once set. The agent picks it. */
  handle: string
  /** Raw product fields. The agent normalizes before calling — no CSV-row
   *  shapes leak in here. */
  rawProduct: {
    sku:           string
    title:         string
    brand:         string
    description:   string
    /** Optional pre-cleaned variant. When omitted, `description` is used. */
    rawDescription?: string
    categories:    string[]
    dealPrice:     number
    msrp:          number
    wholesaleCost: number
    mapPrice?:     number
    qty?:          number
    images?:       string[]
  }
  /** Optional voice-profile override. When omitted, generators use the
   *  default brand voice from pipelineSettings. The hash is stored alongside
   *  cached generations so cache invalidates when voice changes. */
  voiceProfile?: { hash?: string; brandVoice?: string }
}

export interface ImportNewProductResult {
  shopifyProductId: string  // numeric, e.g. "1234567890"
  gid:              string  // gid://shopify/Product/<id>
  handle:           string
  warnings:         { stage: string; message: string }[]
}

/**
 * Import a single product through the Phase 1 enrichment pipeline. Used by
 * the product-management agent (via /api/import-product) and any other
 * non-CSV caller.
 *
 * Flow:
 *   1. Discontinued check — refuse if Nalpac flags it.
 *   2. SKU duplicate check — return existing GID if already imported.
 *   3. Create draft Shopify product with the EXPLICIT handle (no slugify).
 *   4. Run the import orchestrator (A/B/C/D/G/H tools). E/F deal-cycle
 *      tools and B2/B3/Phase-2 tools are excluded by the orchestrator's
 *      tool list.
 *   5. Push enrichment to Shopify metafields.
 *   6. Insert dealHistory queue row.
 *   7. Upsert Sanity productPage.
 *
 * Caller is responsible for activation (changing draft -> active publication).
 * That stays an admin step — Phase 1 leaves products in draft + 'pending_approval'.
 */
export async function importNewProduct(input: ImportNewProductInput): Promise<ImportNewProductResult> {
  const { source, handle, rawProduct, voiceProfile } = input
  const sku = rawProduct.sku
  const warnings: { stage: string; message: string }[] = []

  // 1. Discontinued check
  if (isDiscontinued({
    'Sub-Category':        rawProduct.categories.join(', '),
    'Product Title':       rawProduct.title,
    'Product Description': rawProduct.rawDescription ?? rawProduct.description,
  })) {
    throw new Error(`importNewProduct: ${sku} is flagged discontinued by manufacturer`)
  }

  // 2. Duplicate check — if SKU already exists, surface the existing GID
  //    rather than creating a duplicate Shopify product.
  const existingGid = await findProductBySKU(sku)
  if (existingGid) {
    const existingId = existingGid.replace('gid://shopify/Product/', '')
    return {
      shopifyProductId: existingId,
      gid:              existingGid,
      handle,  // caller's input handle — may differ from the actual Shopify handle, intentional
      warnings: [{ stage: 'duplicate', message: `SKU ${sku} already imported as ${existingGid}; not re-creating` }],
    }
  }

  // 3. Create draft Shopify product with EXPLICIT handle.
  const productScore: ProductScore = {
    sku,
    title:         rawProduct.title,
    brand:         rawProduct.brand,
    description:   rawProduct.description,
    score:         0,
    msrp:          rawProduct.msrp,
    wholesaleCost: rawProduct.wholesaleCost,
    mapPrice:      rawProduct.mapPrice ?? 0,
    dealPrice:     rawProduct.dealPrice,
    discountPct:   rawProduct.msrp > 0 ? ((rawProduct.msrp - rawProduct.dealPrice) / rawProduct.msrp) * 100 : 0,
    profitPerUnit: rawProduct.dealPrice - rawProduct.wholesaleCost,
    qty:           rawProduct.qty ?? 0,
    mapType:       (rawProduct.mapPrice ?? 0) === 0 ? 'no-map' : (rawProduct.mapPrice ?? 0) < rawProduct.msrp ? 'below-msrp' : 'equals-msrp',
    images:        rawProduct.images ?? [],
    categories:    rawProduct.categories,
  }
  const numericId = await createShopifyProductFromFeed(productScore, handle)
  const gid       = `gid://shopify/Product/${numericId}`

  // 4. Run the import orchestrator. Source-neutral input — uses rawProduct
  //    fields directly. Voice profile flows through to the per-tool
  //    generators (default when omitted).
  const seoTitle = await generateSEOTitle(rawProduct.title, rawProduct.brand)
  const category = inferCategory(rawProduct.categories)
  const pairingCandidates = await getPairingCandidates({
    shopifyProductId: numericId,
    category,
    subCategories:    rawProduct.categories,
  }).catch(err => {
    console.warn(`[importNewProduct] ${sku} pairing-candidates lookup failed:`, err instanceof Error ? err.message : err)
    return []
  })
  const { writes, telemetry } = await generateProductContent({
    product: {
      title:       rawProduct.title,
      brand:       rawProduct.brand,
      description: rawProduct.description,
      categories:  rawProduct.categories,
      dealPrice:   rawProduct.dealPrice,
      msrp:        rawProduct.msrp,
    },
    seoTitle,
    category,
    pairingCandidates,
  })
  const finalTitle = writes.productTitle ?? seoTitle
  console.info(
    `[importNewProduct] ${sku} (source=${source}) orchestrator: tokens=${telemetry.totalTokens} ` +
    `duration=${telemetry.durationMs}ms turns=${telemetry.turns} ` +
    `voiceHash=${voiceProfile?.hash ?? 'default'} ` +
    `tools=[${telemetry.toolCalls.map(c => `${c.name}${c.ok ? '' : '!'}`).join(',')}]`,
  )

  // 5. Push enrichment to Shopify (parallel structure to importProductGroup
  //    step 7 above — drift between the two should be reconciled in a
  //    future refactor).
  await pushProductToShopify({
    shopifyProductId:   numericId,
    ...(writes.productTitleAugmented ? { title: finalTitle } : {}),
    seoTitle:           finalTitle,
    tagline:            writes.tagline,
    ...(writes.boxContents      !== undefined ? { boxContents:      writes.boxContents }      : {}),
    ...(writes.specifications   !== undefined ? { specifications:   writes.specifications }   : {}),
    seoMetaDescription: writes.seoMetaDescription,
    descriptionHtml:    writes.descriptionHtml,
    ...(writes.careInstructions !== undefined ? { careInstructions: writes.careInstructions } : {}),
    ...(writes.sensationDialV2  !== undefined ? { sensationDialV2:  writes.sensationDialV2 }  : {}),
    productTypeDial:    writes.productTypeDial,
    ...(writes.productSubtypeDial != null ? { productSubtypeDial: writes.productSubtypeDial } : {}),
    moodTags:           writes.moodTags,
    audienceTags:       writes.audienceTags,
    mattersTags:        writes.mattersTags,
    ...(writes.originalTitle    !== undefined ? { originalTitle:    writes.originalTitle }    : {}),
    tags:               editorialTagsFrom(rawProduct.categories),
    category,
    dealStatus:         'pending_approval',
    dealDate:           '2099-12-31',
    originalPrice:      rawProduct.msrp,
    wholesaleCost:      rawProduct.wholesaleCost,
    mapPrice:           rawProduct.mapPrice ?? 0,
    nalpacSku:          sku,
    rawDescription:     rawProduct.rawDescription ?? rawProduct.description,
  })

  // 6. Insert dealHistory queue row — lands at bottom of queue.
  const [{ maxSort = 0 } = {}] = await db
    .select({ maxSort: max(dealHistory.sortOrder) })
    .from(dealHistory)
  const nextSortOrder = (maxSort ?? 0) + 1
  await db.insert(dealHistory).values({
    sku,
    seoTitle,
    brand:            rawProduct.brand,
    categories:       rawProduct.categories,
    dealDate:         '2099-12-31',
    wholesaleCost:    rawProduct.wholesaleCost.toFixed(2),
    dealPrice:        rawProduct.dealPrice.toFixed(2),
    msrp:             rawProduct.msrp.toFixed(2),
    mapPrice:         (rawProduct.mapPrice ?? 0).toFixed(2),
    unitsAvailable:   rawProduct.qty ?? 0,
    dealScore:        null,
    status:           'queued',
    sortOrder:        nextSortOrder,
    shopifyProductId: numericId,
  }).onConflictDoNothing()

  // 7. Upsert Sanity productPage — best-effort with one retry.
  try {
    const upsertParams: Parameters<typeof upsertProductPage>[0] = {
      handle,
      shopifyProductId: gid,
      title:            rawProduct.title,
      vendor:           rawProduct.brand,
      tags:             editorialTagsFrom(rawProduct.categories),
      tagline:          writes.tagline,
      description:      rawProduct.description,
      seoTitle,
      seoDescription:   writes.seoMetaDescription,
      category,
      // Pricing fields removed from Sanity productPage schema (Shopify-only).
      productTypeDial:  writes.productTypeDial,
      ...(writes.productSubtypeDial != null ? { productSubtypeDial: writes.productSubtypeDial } : {}),
      moodTags:         writes.moodTags,
      audienceTags:     writes.audienceTags,
      mattersTags:      writes.mattersTags,
      ...(writes.ivrExperience !== undefined ? { ivrExperience: writes.ivrExperience } : {}),
      ...(writes.ivrUseCase    !== undefined ? { ivrUseCase:    writes.ivrUseCase    } : {}),
      ...(writes.ivrFeatures   !== undefined ? { ivrFeatures:   writes.ivrFeatures   } : {}),
      ...(writes.productFaqs   !== undefined ? { productFaqs:   writes.productFaqs   } : {}),
    }
    if (rawProduct.images?.[0]) upsertParams.imageUrl = rawProduct.images[0]
    let lastErr: unknown
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await upsertProductPage(upsertParams)
        lastErr = null
        break
      } catch (err) {
        lastErr = err
        if (attempt === 1) await new Promise(r => setTimeout(r, 500))
      }
    }
    if (lastErr) {
      const msg = `sanity sync failed after retry: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
      warnings.push({ stage: 'sanity', message: msg })
    }
  } catch (err) {
    warnings.push({ stage: 'sanity', message: err instanceof Error ? err.message : String(err) })
  }

  return { shopifyProductId: numericId, gid, handle, warnings }
}
