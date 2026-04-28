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
import { cleanDescription, isDiscontinued } from '~/lib/feed-processor.server'
import {
  findProductBySKU,
  createShopifyProductFromFeed,
  createShopifyProductWithVariants,
  getProductHandleById,
  getPairingCandidates,
  pushProductToShopify,
} from '~/lib/shopify.server'
import { upsertProductPage } from '~/lib/sanity.server'
import type { BulkImportRow, BulkVariantRow, MasterProductGroup } from '~/types'
import type { ProductScore } from '~/types'

// ─── Category inference (mirrors deal-pipeline.server.ts) ─────────────────────

function inferCategory(categories: string[]): 'for-him' | 'for-her' | 'both' | 'couples' {
  const forHimCats  = ['Vagina Strokers', 'Body Molds', 'Prostate Toys', 'Masturbators', 'Hands-Free Masturbators']
  const forHerCats  = ['Dual Action and Rabbits', 'Finger and Clit', 'Air Pulse and Suction', 'Bullets and Eggs']
  const coupleCats  = ['Couples and Wearable', 'Remote', 'Top Couples Toys', 'Restraints']
  const isHim     = categories.some(c => forHimCats.includes(c))
  const isHer     = categories.some(c => forHerCats.includes(c))
  const isCouples = categories.some(c => coupleCats.includes(c))
  if (isCouples) return 'couples'
  if (isHim && isHer) return 'both'
  if (isHim) return 'for-him'
  if (isHer) return 'for-her'
  return 'both'
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

    if (children.length === 0 && !master['Variant Option Value']) {
      // Standalone product — no variants
      groups.push({ masterRow: master, variants: [], isSingleVariant: true })
      continue
    }

    // Master row itself is the first variant when it carries a Variant Option Value
    const allVariantRows: BulkImportRow[] = master['Variant Option Value']
      ? [master, ...children]
      : children

    // Validate consistent Variant Option Name across the group
    const optionNames = new Set(allVariantRows.map(r => r['Variant Option Name']).filter(Boolean))
    if (optionNames.size > 1) {
      parseErrors.push({
        sku:     masterSku,
        message: `Inconsistent Variant Option Name: ${[...optionNames].join(', ')}`,
      })
      continue
    }

    const variants: BulkVariantRow[] = allVariantRows.map(r => {
      const wholesale     = parseFloat(r.Wholesale) || 0
      const msrp          = parseFloat(r.MSRP)      || 0
      const map           = parseFloat(r.MAP ?? '0') || 0
      const qty           = parseInt(r['Total qty available']) || 0
      return {
        sku:            r.SKU,
        optionValue:    r['Variant Option Value'] || r.SKU,
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
    const rawDesc   = masterRow['Product Description'] ?? ''
    const description = cleanDescription(rawDesc) || `${masterRow.Brand} ${masterRow['Product Title']}`
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
      numericId = await createShopifyProductFromFeed(productScore)
    } else {
      // Multi-variant
      const optionName = group.masterRow['Variant Option Name'] || 'Option'
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
        optionName,
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
      moodTags:           writes.moodTags,
      audienceTags:       writes.audienceTags,
      mattersTags:        writes.mattersTags,
      ...(writes.emmaHero         !== undefined ? { emmaHero:         writes.emmaHero }         : {}),
      ...(writes.moodImageUrl     !== undefined ? { moodImageUrl:     writes.moodImageUrl }     : {}),
      ...(writes.originalTitle    !== undefined ? { originalTitle:    writes.originalTitle }    : {}),
      ...(writes.accessoryProductIds !== undefined ? { accessoryProductIds: writes.accessoryProductIds } : {}),
      ...(writes.pairingWhy       !== undefined ? { pairingWhy:       writes.pairingWhy }       : {}),
      category,
      dealStatus:         'pending_approval',
      dealDate:           '2099-12-31',
      originalPrice:      msrp,
      wholesaleCost:      wholesale,
      mapPrice:           map,
      nalpacSku:          masterSku,
      rawDescription:     rawDesc,
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
          tags:             categories,                  // Mirror sub-categories so Studio editors can filter
          tagline:          writes.tagline,
          description,
          seoTitle,
          seoDescription:   writes.seoMetaDescription,
          category,
          mapPrice:         dealPrice,
          originalPrice:    msrp,
          productTypeDial:  writes.productTypeDial,
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
