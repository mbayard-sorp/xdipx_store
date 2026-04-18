/**
 * Bulk product import library.
 * Parses a modified Nalpac CSV (with Master SKU / Variant Option columns),
 * groups rows into MasterProductGroups, and imports each group through the
 * full AI content generation pipeline into Shopify + Neon DB.
 */

import { parse } from 'csv-parse/sync'
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { dealHistory } from '../../db/schema'
import { generateSEOTitle, generateCopy } from '~/lib/claude.server'
import { cleanDescription } from '~/lib/feed-processor.server'
import {
  findProductBySKU,
  createShopifyProductFromFeed,
  createShopifyProductWithVariants,
  pushProductToShopify,
} from '~/lib/shopify.server'
import type { BulkImportRow, BulkVariantRow, MasterProductGroup } from '~/types'
import type { ProductScore } from '~/types'

// ─── Category inference (mirrors deal-pipeline.server.ts) ─────────────────────

function inferCategory(categories: string[]): string {
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
}> {
  const { masterRow, variants, isSingleVariant } = group
  const masterSku = masterRow.SKU

  try {
    // 1. Duplicate check
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

    // 4. Generate SEO title
    const seoTitle = await generateSEOTitle(masterRow['Product Title'], masterRow.Brand)

    // 5. Generate copy — all 7 types; catch individual failures
    const copyProduct = {
      title:       masterRow['Product Title'],
      brand:       masterRow.Brand,
      description,
      categories,
      dealPrice,
      msrp,
    }

    const [taglineResult, fullStoryResult, bothWaysResult, bulletsResult, boxResult, seoResult, specsResult] =
      await Promise.allSettled([
        generateCopy({ type: 'tagline',      product: copyProduct }),
        generateCopy({ type: 'full_story',   product: copyProduct }),
        generateCopy({ type: 'both_ways',    product: copyProduct }),
        generateCopy({ type: 'bullets',      product: copyProduct }),
        generateCopy({ type: 'box_contents', product: copyProduct }),
        generateCopy({ type: 'seo_meta',     product: copyProduct }),
        generateCopy({ type: 'specifications', product: copyProduct }),
      ])

    const taglines     = taglineResult.status === 'fulfilled' ? taglineResult.value.content : []
    const fullStory    = fullStoryResult.status === 'fulfilled' ? (fullStoryResult.value.content as string) : `<p>${description.slice(0, 400)}</p>`
    const bothWays     = bothWaysResult.status === 'fulfilled'
      ? (bothWaysResult.value.content as { forHim: string; forHer: string })
      : { forHim: '', forHer: '' }
    const bullets      = bulletsResult.status === 'fulfilled' ? (bulletsResult.value.content as string[]) : []
    const boxContents  = boxResult.status === 'fulfilled' ? (boxResult.value.content as string[]) : []
    const seoMeta      = seoResult.status === 'fulfilled' ? (seoResult.value.content as string) : ''
    const specs        = specsResult.status === 'fulfilled' ? (specsResult.value.content as string) : ''

    const tagline = Array.isArray(taglines) ? (taglines[0] ?? '') : (taglines as string)

    // 6. Push all metafields to Shopify
    await pushProductToShopify({
      shopifyProductId: numericId,
      seoTitle,
      tagline,
      fullStory,
      worksForHim:     bothWays.forHim,
      worksForHer:     bothWays.forHer,
      featureBullets:  bullets,
      boxContents,
      seoMetaDescription: seoMeta,
      specifications:  specs,
      category,
      dealStatus:      'pending',
      dealDate:        '2099-12-31',
      originalPrice:   msrp,
      wholesaleCost:   wholesale,
      mapPrice:        map,
      nalpacSku:       masterSku,
      rawDescription:  rawDesc,
    })

    // 7. Insert DB row — sentinel date so it sorts to bottom of queue
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
      status:           'pending',
      shopifyProductId: numericId,
    }).onConflictDoNothing()

    return { success: true, sku: masterSku, shopifyProductId: numericId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[bulk-import] Failed SKU ${masterSku}:`, message)
    return { success: false, sku: masterSku, error: message }
  }
}
