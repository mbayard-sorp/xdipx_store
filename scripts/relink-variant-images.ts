/**
 * Relink per-variant images on already-imported products.
 *
 * Use when products were imported before the per-variant image linkage fix
 * landed in createShopifyProductWithVariants. Matches CSV rows to Shopify
 * variants by SKU, then for each variant whose CSV row carries images[0]:
 *   - PUT /variants/{id}.json with image_id when the URL is already in the gallery
 *   - POST /products/{id}/images.json with variant_ids when it's a new URL
 * Idempotent — re-running won't duplicate uploads or change already-correct links.
 *
 *   npx tsx scripts/relink-variant-images.ts <csv-path>                # dry-run
 *   npx tsx scripts/relink-variant-images.ts <csv-path> --apply        # write
 *   npx tsx scripts/relink-variant-images.ts <csv-path> --apply --limit 5
 *   npx tsx scripts/relink-variant-images.ts <csv-path> --apply --start 10
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseBulkImportCSV } from '~/lib/bulk-import.server'
import { findProductBySKU, shopifyAdmin } from '~/lib/shopify.server'

interface Args {
  csvPath: string
  apply: boolean
  limit?: number
  start: number
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let csvPath: string | undefined
  let apply = false
  let limit: number | undefined
  let start = 0
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') apply = true
    else if (a === '--limit') limit = parseInt(argv[++i] ?? '', 10)
    else if (a === '--start') start = parseInt(argv[++i] ?? '', 10) || 0
    else if (a?.startsWith('--limit=')) limit = parseInt(a.slice(8), 10)
    else if (a?.startsWith('--start=')) start = parseInt(a.slice(8), 10) || 0
    else if (a && !a.startsWith('--')) csvPath = a
  }
  if (!csvPath) {
    console.error('Usage: npx tsx scripts/relink-variant-images.ts <csv-path> [--apply] [--limit N] [--start N]')
    process.exit(1)
  }
  return { csvPath: resolve(csvPath), apply, ...(limit !== undefined ? { limit } : {}), start }
}

interface ShopifyVariant {
  id: number
  sku: string
  image_id: number | null
}
interface ShopifyImage {
  id: number
  src: string
  variant_ids: number[]
}

async function fetchProduct(productId: string): Promise<{ variants: ShopifyVariant[]; images: ShopifyImage[] }> {
  const res = await shopifyAdmin<{ product: { variants: ShopifyVariant[]; images: ShopifyImage[] } }>(
    `/products/${productId}.json`,
    'GET',
  )
  return { variants: res.product.variants, images: res.product.images }
}

async function relinkOne(
  masterSku: string,
  variantsCSV: { sku: string; images: string[] }[],
  apply: boolean,
): Promise<{ relinked: number; uploaded: number; alreadyLinked: number; skippedNoImage: number; warnings: string[] }> {
  const result = { relinked: 0, uploaded: 0, alreadyLinked: 0, skippedNoImage: 0, warnings: [] as string[] }
  const gid = await findProductBySKU(masterSku)
  if (!gid) {
    result.warnings.push(`product not found in Shopify for SKU ${masterSku}`)
    return result
  }
  const productId = gid.replace('gid://shopify/Product/', '')
  const { variants: shopifyVariants, images: shopifyImages } = await fetchProduct(productId)

  const variantBySku = new Map<string, ShopifyVariant>()
  for (const v of shopifyVariants) variantBySku.set(v.sku, v)
  const galleryByUrl = new Map<string, number>()
  for (const img of shopifyImages) galleryByUrl.set(img.src, img.id)

  for (const csvV of variantsCSV) {
    if (csvV.images.length === 0 || !csvV.images[0]) {
      result.skippedNoImage++
      continue
    }
    const firstImage = csvV.images[0]
    const sv = variantBySku.get(csvV.sku)
    if (!sv) {
      result.warnings.push(`variant ${csvV.sku} not found on Shopify product ${productId}`)
      continue
    }

    const existingId = galleryByUrl.get(firstImage)
    if (existingId !== undefined) {
      if (sv.image_id === existingId) {
        result.alreadyLinked++
        continue
      }
      if (apply) {
        await shopifyAdmin(`/variants/${sv.id}.json`, 'PUT', {
          variant: { id: sv.id, image_id: existingId },
        })
        await new Promise(r => setTimeout(r, 250))
      }
      result.relinked++
    } else {
      if (apply) {
        const imgRes = await shopifyAdmin<{ image: { id: number; src: string } }>(
          `/products/${productId}/images.json`,
          'POST',
          { image: { src: firstImage, variant_ids: [sv.id] } },
        )
        galleryByUrl.set(firstImage, imgRes.image.id)
        await new Promise(r => setTimeout(r, 250))
      }
      result.uploaded++
    }
  }
  return result
}

async function main(): Promise<void> {
  const args = parseArgs()
  const csvText = readFileSync(args.csvPath, 'utf8')
  const { groups, parseErrors } = parseBulkImportCSV(csvText)
  const multiVariantGroups = groups.filter(g => !g.isSingleVariant)

  console.log('─── Relink variant images ───')
  console.log(`File:           ${args.csvPath}`)
  console.log(`Mode:           ${args.apply ? 'APPLY (writes to Shopify)' : 'DRY-RUN (no writes)'}`)
  console.log(`Multi-variant:  ${multiVariantGroups.length} of ${groups.length} groups (single-variant rows skipped)`)
  console.log(`Parse errors:   ${parseErrors.length}`)

  const slice = multiVariantGroups.slice(args.start, args.limit !== undefined ? args.start + args.limit : undefined)
  console.log(`Will process:   ${slice.length} groups (start=${args.start}${args.limit !== undefined ? `, limit=${args.limit}` : ''})`)
  console.log('─────────────────────────────')

  let totals = { relinked: 0, uploaded: 0, alreadyLinked: 0, skippedNoImage: 0, productNotFound: 0, errors: 0 }
  const startTs = Date.now()

  for (let i = 0; i < slice.length; i++) {
    const g = slice[i]
    if (!g) continue
    const sku = g.masterRow.SKU
    const idx = args.start + i + 1
    try {
      const r = await relinkOne(sku, g.variants, args.apply)
      totals.relinked      += r.relinked
      totals.uploaded      += r.uploaded
      totals.alreadyLinked += r.alreadyLinked
      totals.skippedNoImage += r.skippedNoImage
      const productMissing = r.warnings.some(w => w.startsWith('product not found'))
      if (productMissing) totals.productNotFound++
      const flag = productMissing ? '–' : (r.relinked + r.uploaded > 0 ? '✓' : '·')
      const detail = `relinked=${r.relinked} uploaded=${r.uploaded} alreadyLinked=${r.alreadyLinked} skipNoImg=${r.skippedNoImage}`
      process.stdout.write(`[${idx}/${args.start + slice.length}] ${flag} ${sku}: ${detail}${r.warnings.length > 0 ? ` (${r.warnings.length} warnings)` : ''}\n`)
      for (const w of r.warnings) process.stdout.write(`    ⚠ ${w}\n`)
    } catch (err) {
      totals.errors++
      const msg = err instanceof Error ? err.message : String(err)
      process.stdout.write(`[${idx}/${args.start + slice.length}] ✗ ${sku}: ${msg}\n`)
    }
  }

  const elapsedSec = Math.round((Date.now() - startTs) / 1000)
  console.log('─────────────────────────────')
  console.log(`Done in ${elapsedSec}s`)
  console.log(`  variants relinked (URL already in gallery → PUT image_id): ${totals.relinked}`)
  console.log(`  variants uploaded (new image POSTed with variant_ids):     ${totals.uploaded}`)
  console.log(`  already linked (no-op):                                    ${totals.alreadyLinked}`)
  console.log(`  variants skipped (no image in CSV):                        ${totals.skippedNoImage}`)
  console.log(`  products not found in Shopify:                             ${totals.productNotFound}`)
  console.log(`  errors:                                                    ${totals.errors}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
