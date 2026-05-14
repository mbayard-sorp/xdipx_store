/**
 * Sets mm-google-shopping.adult = "yes" on every active Shopify product so
 * Google Merchant Center treats the entire catalog as adult-only without
 * per-SKU toggling in GMC.
 *
 * Idempotent: re-running is safe — metafieldsSet upserts by (owner, namespace, key).
 *
 * Usage:
 *   npx tsx scripts/set-google-adult-flag.ts          # dry run (default)
 *   npx tsx scripts/set-google-adult-flag.ts --apply  # actually write
 *
 * Environment (reads from .env):
 *   SHOPIFY_STORE_DOMAIN        — e.g. xdipx.myshopify.com
 *   SHOPIFY_ADMIN_ACCESS_TOKEN  — Admin API token (shpat_...)
 *   SHOPIFY_ADMIN_API_VERSION   — optional, default 2024-10
 */
import 'dotenv/config'

const STORE = process.env['SHOPIFY_STORE_DOMAIN']
const TOKEN = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? process.env['SHOPIFY_ADMIN_TOKEN']
const VERSION = process.env['SHOPIFY_ADMIN_API_VERSION'] ?? '2024-10'
const APPLY = process.argv.includes('--apply')

if (!STORE || !TOKEN) {
  console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set in .env')
  process.exit(1)
}

const ENDPOINT = `https://${STORE}/admin/api/${VERSION}/graphql.json`

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type':           'application/json',
      'X-Shopify-Access-Token': TOKEN!,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`)
  const body = await res.json() as { data: T; errors?: Array<{ message: string }> }
  if (body.errors?.length) throw new Error(`GraphQL: ${body.errors.map(e => e.message).join('; ')}`)
  return body.data
}

const LIST_QUERY = `
  query Products($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        adultFlag: metafield(namespace: "mm-google-shopping", key: "adult") { value }
      }
    }
  }
`

const SET_MUTATION = `
  mutation SetAdult($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace }
      userErrors { field message }
    }
  }
`

type Product = {
  id:       string
  handle:   string
  adultFlag: { value: string } | null
}

async function* listProducts(): AsyncGenerator<Product> {
  let cursor: string | null = null
  do {
    const data = await gql<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes:    Product[]
      }
    }>(LIST_QUERY, { cursor })
    for (const p of data.products.nodes) yield p
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null
  } while (cursor)
}

async function main() {
  console.log(`Scanning active products on ${STORE}${APPLY ? '' : ' (dry run — pass --apply to write)'}...`)
  const toSet: Product[] = []
  let total = 0
  let alreadySet = 0
  for await (const p of listProducts()) {
    total++
    if (p.adultFlag?.value === 'yes') alreadySet++
    else toSet.push(p)
  }
  console.log(`Scanned ${total} products. ${alreadySet} already adult=yes. ${toSet.length} need updating.`)

  if (!APPLY || toSet.length === 0) {
    if (toSet.length > 0) {
      console.log('Sample (first 5):')
      for (const p of toSet.slice(0, 5)) console.log(`  - ${p.handle}`)
    }
    console.log(APPLY ? 'Nothing to do.' : 'Dry run complete. Re-run with --apply to write.')
    return
  }

  // metafieldsSet accepts up to 25 per call.
  const CHUNK = 25
  let written = 0
  for (let i = 0; i < toSet.length; i += CHUNK) {
    const batch = toSet.slice(i, i + CHUNK)
    const result = await gql<{
      metafieldsSet: {
        metafields: Array<{ id: string }> | null
        userErrors: Array<{ field: string[]; message: string }>
      }
    }>(SET_MUTATION, {
      metafields: batch.map(p => ({
        ownerId:   p.id,
        namespace: 'mm-google-shopping',
        key:       'adult',
        type:      'single_line_text_field',
        value:     'yes',
      })),
    })
    const errs = result.metafieldsSet.userErrors
    if (errs.length > 0) {
      console.error(`  ✗ batch ${i / CHUNK + 1}: ${errs.map(e => `${e.field?.join('.')} ${e.message}`).join('; ')}`)
    }
    written += result.metafieldsSet.metafields?.length ?? 0
    console.log(`  + batch ${i / CHUNK + 1}: wrote ${result.metafieldsSet.metafields?.length ?? 0}/${batch.length}`)
  }
  console.log(`Done. Wrote adult=yes on ${written} products.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
