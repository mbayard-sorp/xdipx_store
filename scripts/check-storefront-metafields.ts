/**
 * Hits Shopify *Storefront* API (not Admin) and dumps every xdipx metafield
 * the PDP loader would actually receive. If a value is null here but populated
 * via Admin API, the metafield definition is missing storefront PUBLIC_READ.
 *
 * Usage: bun run scripts/check-storefront-metafields.ts <handle>
 */
import 'dotenv/config'

const handle = process.argv[2]
if (!handle) {
  console.error('usage: bun run scripts/check-storefront-metafields.ts <handle>')
  process.exit(1)
}

const STORE = process.env['SHOPIFY_STORE_DOMAIN']
const TOKEN = process.env['SHOPIFY_STOREFRONT_ACCESS_TOKEN'] ?? process.env['SHOPIFY_STOREFRONT_TOKEN']
const VERSION = process.env['SHOPIFY_STOREFRONT_API_VERSION'] ?? '2024-10'
if (!STORE || !TOKEN) {
  console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_ACCESS_TOKEN must be set in .env')
  process.exit(1)
}

const KEYS = [
  'tagline', 'feature_bullets', 'box_contents', 'specifications', 'seo_meta_description',
  'product_type_dial', 'sensation_dial', 'sensation_dial_v2', 'care_instructions',
  'mood_image_url', 'emma_hero', 'mood_tags', 'audience_tags', 'matters_tags',
  'category', 'deal_status', 'map_restricted',
]

const identifiers = KEYS.map(k => `{ namespace: "xdipx", key: "${k}" }`).join('\n          ')

const query = `
  query CheckStorefront($handle: String!) {
    product(handle: $handle) {
      handle
      title
      metafields(identifiers: [
          ${identifiers}
      ]) {
        key
        type
        value
      }
    }
  }
`

const res = await fetch(`https://${STORE}/api/${VERSION}/graphql.json`, {
  method: 'POST',
  headers: {
    'Content-Type':                       'application/json',
    'X-Shopify-Storefront-Access-Token':  TOKEN!,
  },
  body: JSON.stringify({ query, variables: { handle } }),
})

const body = await res.json() as {
  data?: { product: { handle: string; title: string; metafields: ({ key: string; type: string; value: string } | null)[] } | null }
  errors?: Array<{ message: string }>
}

if (body.errors?.length) {
  console.error('GraphQL errors:', body.errors.map(e => e.message).join('; '))
  process.exit(1)
}
if (!body.data?.product) {
  console.error(`Product with handle "${handle}" not found via Storefront API (is it Active and on the sales channel?)`)
  process.exit(1)
}

const p = body.data.product
console.log(`product: ${p.title} (handle: ${p.handle})\n`)
KEYS.forEach((k, i) => {
  const mf = p.metafields[i]
  if (!mf) {
    console.log(`  ✗ ${k} → NULL (missing definition or no PUBLIC_READ access)`)
  } else {
    const preview = mf.value.length > 120 ? mf.value.slice(0, 120) + '…' : mf.value
    console.log(`  ✓ ${k} (${mf.type}): ${preview}`)
  }
})
process.exit(0)
