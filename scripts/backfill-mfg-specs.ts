/**
 * One-time backfill: populate Sanity mfgProductSpecs docs for all live products.
 *
 *   npx tsx scripts/backfill-mfg-specs.ts               # dry-run (default)
 *   npx tsx scripts/backfill-mfg-specs.ts --apply       # write to Sanity
 *   npx tsx scripts/backfill-mfg-specs.ts --dry-run     # explicit dry-run
 *   npx tsx scripts/backfill-mfg-specs.ts --handle <h>  # single product
 *
 * Idempotent — re-running is safe (createOrReplace replaces the whole doc).
 *
 * Prints a summary on completion:
 *   { totalProducts, sanitySpecsBefore, sanitySpecsAfter, sourceCounts, fieldCoverage }
 */

// MUST be first — populates process.env before any module reads it.
import './_load-env'

import { createClient } from '@sanity/client'
import { fetchNalpacFeed } from '../app/lib/feed-processor.server'
import {
  extractSpecsFromProduct,
  clearNalpacIndexCache,
  type MfgSpecsRow,
} from '../app/lib/mfg-specs/extractor.server'
import { upsertMfgSpecs } from '../app/lib/mfg-specs/sync.server'

// ─── Args ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const has  = (flag: string) => argv.includes(flag)
const valOf = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }

const DRY_RUN = !has('--apply') || has('--dry-run')
const HANDLE  = valOf('--handle')

// ─── Sanity client ─────────────────────────────────────────────────────────

function getSanityClient() {
  const projectId = process.env['SANITY_PROJECT_ID']
  if (!projectId) return null
  return createClient({
    projectId,
    dataset:    process.env['SANITY_DATASET'] ?? 'production',
    apiVersion: '2024-10-01',
    token:      process.env['SANITY_API_TOKEN'],
    useCdn:     false,
  })
}

// ─── Shopify product lister ────────────────────────────────────────────────

interface ShopifyAdminProduct {
  id: string
  handle: string
  title: string
  body_html: string
  status: string
  tags: string
  metafields?: Array<{ namespace: string; key: string; value: string }>
}

async function shopifyAdmin<T>(path: string): Promise<T> {
  const shop  = process.env['SHOPIFY_STORE_DOMAIN'] ?? process.env['SHOPIFY_STORE'] ?? process.env['SHOPIFY_DOMAIN'] ?? ''
  const token = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? process.env['SHOPIFY_ACCESS_TOKEN'] ?? process.env['SHOPIFY_ADMIN_API_TOKEN'] ?? ''
  if (!shop || !token) throw new Error('SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set')

  const base = shop.includes('.myshopify.com') ? `https://${shop}` : `https://${shop}.myshopify.com`
  const url  = `${base}/admin/api/2024-04${path}`
  const res  = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } })
  if (!res.ok) throw new Error(`Shopify admin ${path}: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

/**
 * Fetch all active/draft Shopify products using cursor-based pagination.
 * Returns handle, description, and nalpac_sku metafield per product.
 */
async function fetchAllProducts(targetHandle?: string): Promise<Array<{
  handle: string
  gid: string
  description: string
  nalpacSku: string | undefined
}>> {
  const out: Array<{ handle: string; gid: string; description: string; nalpacSku: string | undefined }> = []

  if (targetHandle) {
    // Single-product mode — fetch via Admin REST.
    try {
      const { product } = await shopifyAdmin<{ product: ShopifyAdminProduct | null }>(
        `/products.json?handle=${encodeURIComponent(targetHandle)}&fields=id,handle,body_html,tags&limit=1`,
      )
      if (!product) {
        console.warn(`[backfill] Product not found: ${targetHandle}`)
        return []
      }
      const nalpacTag = product.tags.split(', ').find(t => t.startsWith('nalpac-sku-'))
      out.push({
        handle:    product.handle,
        gid:       `gid://shopify/Product/${product.id}`,
        description: product.body_html ?? '',
        nalpacSku: nalpacTag?.replace('nalpac-sku-', ''),
      })
    } catch (err) {
      console.error('[backfill] single product fetch error:', err)
    }
    return out
  }

  // All-products paginated fetch.
  let pageInfo: string | null = null
  let page = 0

  while (true) {
    page++
    const qs = pageInfo
      ? `/products.json?fields=id,handle,body_html,tags&limit=250&page_info=${pageInfo}&status=active`
      : `/products.json?fields=id,handle,body_html,tags&limit=250&status=active`

    let response: Response
    try {
      const shop  = process.env['SHOPIFY_STORE_DOMAIN'] ?? process.env['SHOPIFY_STORE'] ?? process.env['SHOPIFY_DOMAIN'] ?? ''
      const token = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? process.env['SHOPIFY_ACCESS_TOKEN'] ?? process.env['SHOPIFY_ADMIN_API_TOKEN'] ?? ''
      const base  = shop.includes('.myshopify.com') ? `https://${shop}` : `https://${shop}.myshopify.com`
      response = await fetch(`${base}/admin/api/2024-04${qs}`, {
        headers: { 'X-Shopify-Access-Token': token },
      })
    } catch (err) {
      console.error(`[backfill] page ${page} fetch error:`, err)
      break
    }

    if (!response.ok) {
      // 422 or similar — page_info may be expired; fall back to offset pagination.
      if (pageInfo) {
        console.warn(`[backfill] page_info fetch failed (${response.status}), stopping pagination.`)
      }
      break
    }

    const { products } = await response.json() as { products: ShopifyAdminProduct[] }
    if (!products || products.length === 0) break

    for (const p of products) {
      const nalpacTag = (p.tags ?? '').split(', ').find(t => t.startsWith('nalpac-sku-'))
      out.push({
        handle:    p.handle,
        gid:       `gid://shopify/Product/${p.id}`,
        description: p.body_html ?? '',
        nalpacSku: nalpacTag?.replace('nalpac-sku-', ''),
      })
    }

    console.log(`[backfill] fetched page ${page}: ${products.length} products (total: ${out.length})`)

    // Parse Link header for cursor-based pagination.
    const link = response.headers.get('link') ?? ''
    const nextMatch = link.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/)
    if (nextMatch) {
      pageInfo = nextMatch[1]
    } else {
      break
    }
  }

  return out
}

// ─── Summary types ─────────────────────────────────────────────────────────

interface Summary {
  totalProducts:      number
  sanitySpecsBefore:  number
  sanitySpecsAfter:   number
  sourceCounts:       { 'nalpac-csv-v1': number; 'description-parse-v1': number; manual: number }
  fieldCoverage:      Record<string, string>
  errors:             number
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[backfill-mfg-specs] mode=${DRY_RUN ? 'DRY-RUN' : 'APPLY'}${HANDLE ? ` handle=${HANDLE}` : ''}`)

  const client = getSanityClient()
  if (!client) {
    console.error('[backfill] Sanity not configured (SANITY_PROJECT_ID / SANITY_API_TOKEN missing)')
    process.exit(1)
  }

  // Count existing mfgProductSpecs docs before run.
  const sanitySpecsBefore = await client.fetch<number>('count(*[_type == "mfgProductSpecs"])')
  console.log(`[backfill] Sanity mfgProductSpecs before: ${sanitySpecsBefore}`)

  // Fetch all products from Shopify.
  console.log('[backfill] Fetching products from Shopify...')
  const products = await fetchAllProducts(HANDLE)
  console.log(`[backfill] ${products.length} products to process`)

  // Pre-warm Nalpac index (single fetch for all products).
  try {
    await fetchNalpacFeed()
    console.log('[backfill] Nalpac feed cached.')
  } catch (err) {
    console.warn('[backfill] Nalpac feed unavailable — falling back to description-parse for all products:', err instanceof Error ? err.message : err)
  }

  const summary: Summary = {
    totalProducts:     products.length,
    sanitySpecsBefore,
    sanitySpecsAfter:  sanitySpecsBefore,
    sourceCounts:      { 'nalpac-csv-v1': 0, 'description-parse-v1': 0, manual: 0 },
    fieldCoverage:     {},
    errors:            0,
  }

  // Track field presence for coverage stats.
  const specFields: (keyof MfgSpecsRow)[] = [
    'dimensions', 'weightG', 'material', 'batteryLifeMinutes',
    'chargingPort', 'waterproofRating', 'noiseLevelDb', 'connectivity',
    'compatibleLubes', 'careInstructions', 'manufacturerNotes',
  ]
  const fieldCounts: Record<string, number> = {}
  for (const f of specFields) fieldCounts[f] = 0

  const results: MfgSpecsRow[] = []

  for (const p of products) {
    try {
      const specs = await extractSpecsFromProduct({
        handle:      p.handle,
        gid:         p.gid,
        description: p.description,
        nalpacSku:   p.nalpacSku,
      })

      results.push(specs)
      summary.sourceCounts[specs.sourceVersion]++

      // Tally field coverage.
      for (const f of specFields) {
        const val = specs[f]
        if (val !== undefined && val !== null && !(Array.isArray(val) && val.length === 0)) {
          fieldCounts[f]++
        }
      }

      if (!DRY_RUN) {
        await upsertMfgSpecs(specs)
      }
    } catch (err) {
      console.error(`[backfill] error processing ${p.handle}:`, err instanceof Error ? err.message : err)
      summary.errors++
    }
  }

  // Compute final doc count.
  if (!DRY_RUN) {
    summary.sanitySpecsAfter = await client.fetch<number>('count(*[_type == "mfgProductSpecs"])')
  }

  // Compute coverage percentages.
  const total = results.length || 1
  for (const f of specFields) {
    summary.fieldCoverage[f] = `${Math.round((fieldCounts[f] / total) * 100)}%`
  }

  console.log('\n[backfill-mfg-specs] Summary:')
  console.log(JSON.stringify(summary, null, 2))

  if (DRY_RUN) {
    console.log('\n[backfill-mfg-specs] DRY-RUN complete — no writes. Re-run with --apply to write.')
  } else {
    console.log('\n[backfill-mfg-specs] Done.')
  }

  return summary
}

main().catch(err => {
  console.error('[backfill-mfg-specs] Fatal:', err)
  process.exit(1)
})
