/**
 * Dump all xdipx-namespace metafields for a Shopify product.
 * Usage: bun run scripts/check-product-metafields.ts <numericProductId>
 */
import { shopifyAdmin } from '~/lib/shopify.server'

const id = process.argv[2]
if (!id) {
  console.error('usage: bun run scripts/check-product-metafields.ts <numericProductId>')
  process.exit(1)
}

const { product } = await shopifyAdmin<{ product: { id: number; title: string; status: string; handle: string } }>(
  `/products/${id}.json?fields=id,title,status,handle`,
)
console.log(`product: ${product.title} (handle: ${product.handle}, status: ${product.status})`)

const { metafields } = await shopifyAdmin<{ metafields: { namespace: string; key: string; type: string; value: string }[] }>(
  `/products/${id}/metafields.json?limit=250`,
)

const xdipx = metafields.filter(m => m.namespace === 'xdipx')
console.log(`\n${xdipx.length} xdipx metafield(s):\n`)
for (const m of xdipx) {
  const preview = m.value.length > 200 ? m.value.slice(0, 200) + '…' : m.value
  console.log(`  ${m.key} (${m.type}): ${preview}`)
}

const missing = ['sensation_dial_v2', 'product_type_dial', 'mood_image_url', 'care_instructions', 'mood_tags', 'audience_tags', 'matters_tags', 'emma_hero']
  .filter(k => !xdipx.some(m => m.key === k))
if (missing.length) console.log(`\nmissing keys: ${missing.join(', ')}`)
process.exit(0)
