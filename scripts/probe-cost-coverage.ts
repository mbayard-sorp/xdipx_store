/**
 * probe-cost-coverage.ts
 *
 * Probes how many variants have Shopify native unitCost set vs the legacy
 * xdipx.wholesale_cost metafield vs neither.
 *
 * Usage (preview env):
 *   pnpm tsx --env-file=.env.preview scripts/probe-cost-coverage.ts
 *
 * Does NOT import shopify.server.ts (avoids pulling in KV/Drizzle deps).
 * Uses the Admin GraphQL client pattern directly.
 *
 * READONLY. Makes no writes to Shopify.
 */

const ADMIN_GQL_ENDPOINT = `https://${process.env['SHOPIFY_STORE_DOMAIN']}/admin/api/2024-10/graphql.json`

async function adminGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']
  if (!token) throw new Error('SHOPIFY_ADMIN_ACCESS_TOKEN is not set')
  if (!process.env['SHOPIFY_STORE_DOMAIN']) throw new Error('SHOPIFY_STORE_DOMAIN is not set')

  const res = await fetch(ADMIN_GQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Admin GraphQL error: ${res.status}`)
  const { data, errors } = await res.json() as { data: T; errors?: { message: string }[] }
  if (errors?.length) throw new Error(errors[0]?.message ?? 'Shopify Admin GraphQL error')
  return data
}

const COST_PROBE_QUERY = `
  query CostProbe($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "metafields.xdipx.nalpac_sku:*") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        handle
        title
        variants(first: 100) {
          nodes {
            sku
            inventoryItem {
              unitCost { amount }
            }
          }
        }
        metafields(namespace: "xdipx", first: 5) {
          nodes {
            key
            value
          }
        }
      }
    }
  }
`

interface ProbeResult {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes: Array<{
      handle: string
      title: string
      variants: {
        nodes: Array<{
          sku: string | null
          inventoryItem: {
            unitCost: { amount: string } | null
          } | null
        }>
      }
      metafields: { nodes: Array<{ key: string; value: string }> }
    }>
  }
}

type Bucket = 'both' | 'unitCostOnly' | 'metafieldOnly' | 'neither'

interface VariantRecord {
  handle: string
  sku: string
  bucket: Bucket
}

async function main(): Promise<void> {
  console.log('Probing cost coverage against preview environment...\n')
  console.log(`Store: ${process.env['SHOPIFY_STORE_DOMAIN'] ?? '(unset)'}`)

  const records: VariantRecord[] = []
  let cursor: string | null = null
  let pageCount = 0

  do {
    const data = await adminGraphQL<ProbeResult>(COST_PROBE_QUERY, {
      first: 100,
      after: cursor ?? null,
    })

    for (const product of data.products.nodes) {
      const wholesaleMf = product.metafields.nodes.find(m => m.key === 'wholesale_cost')
      const hasMetafield = wholesaleMf != null && wholesaleMf.value !== '' && parseFloat(wholesaleMf.value) > 0

      for (const variant of product.variants.nodes) {
        if (!variant.sku) continue // skip blanks (parsePricingSnapshot drops these)

        const hasUnitCost =
          variant.inventoryItem?.unitCost?.amount != null &&
          parseFloat(variant.inventoryItem.unitCost.amount) > 0

        let bucket: Bucket
        if (hasUnitCost && hasMetafield) bucket = 'both'
        else if (hasUnitCost && !hasMetafield) bucket = 'unitCostOnly'
        else if (!hasUnitCost && hasMetafield) bucket = 'metafieldOnly'
        else bucket = 'neither'

        records.push({ handle: product.handle, sku: variant.sku, bucket })
      }
    }

    pageCount++
    cursor = data.products.pageInfo.hasNextPage
      ? (data.products.pageInfo.endCursor ?? null)
      : null
  } while (cursor !== null)

  console.log(`Pages fetched: ${pageCount}\n`)

  // Tally
  const buckets: Record<Bucket, VariantRecord[]> = {
    both: [],
    unitCostOnly: [],
    metafieldOnly: [],
    neither: [],
  }
  for (const r of records) {
    buckets[r.bucket].push(r)
  }

  const total = records.length
  const pct = (n: number) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '0%'

  console.log('=== Cost Coverage Summary ===\n')
  console.log(`Total variants (with SKU): ${total}`)
  console.log('')
  console.log(`both          (unitCost + metafield):  ${buckets.both.length.toString().padStart(4)}  ${pct(buckets.both.length)}`)
  console.log(`unitCostOnly  (unitCost, no metafield): ${buckets.unitCostOnly.length.toString().padStart(4)}  ${pct(buckets.unitCostOnly.length)}`)
  console.log(`metafieldOnly (metafield, no unitCost): ${buckets.metafieldOnly.length.toString().padStart(4)}  ${pct(buckets.metafieldOnly.length)}`)
  console.log(`neither       (no cost data at all):   ${buckets.neither.length.toString().padStart(4)}  ${pct(buckets.neither.length)}`)

  // First 10 SKUs per bucket
  for (const [bucketName, items] of Object.entries(buckets) as [Bucket, VariantRecord[]][]) {
    const sample = items.slice(0, 10)
    if (sample.length === 0) {
      console.log(`\n--- ${bucketName}: (empty) ---`)
      continue
    }
    console.log(`\n--- ${bucketName} (first ${sample.length} of ${items.length}) ---`)
    for (const item of sample) {
      console.log(`  ${item.sku.padEnd(30)} ${item.handle}`)
    }
  }
}

main().catch((err) => {
  console.error('ERROR:', err)
  process.exit(1)
})
