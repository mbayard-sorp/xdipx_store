/**
 * Verifies that a set of imported Shopify product IDs landed both in
 * Shopify (metafields populated) and in Sanity (productPage doc created
 * with Emma Discovery fields).
 *
 * Usage:
 *   bun run scripts/verify-bulk-import.ts 8741165072555 8741165433003 8741166022827
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', override: true })
dotenv.config({ path: '.env',       override: true })

const ids = process.argv.slice(2)
if (ids.length === 0) {
  console.error('Usage: bun run scripts/verify-bulk-import.ts <productId> [<productId>...]')
  process.exit(1)
}

const shop   = process.env.SHOPIFY_STORE_DOMAIN
const token  = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
if (!shop || !token) {
  console.error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN')
  process.exit(1)
}

const METAFIELD_KEYS = [
  'product_type_dial',
  'mood_tags',
  'audience_tags',
  'matters_tags',
  'sensation_dial_v2',
  'care_instructions',
  'emma_hero',
  'mood_image_url',
  'full_story',       // should be empty for new imports
  'tagline',
  'feature_bullets',
  'seo_meta_description',
] as const

async function fetchShopify(id: string) {
  const productRes = await fetch(
    `https://${shop}/admin/api/2025-01/products/${id}.json?fields=id,handle,title,body_html`,
    { headers: { 'X-Shopify-Access-Token': token! } },
  )
  if (!productRes.ok) {
    return { error: `product ${id}: ${productRes.status} ${await productRes.text()}` }
  }
  const { product } = await productRes.json() as any

  const mfRes = await fetch(
    `https://${shop}/admin/api/2025-01/products/${id}/metafields.json?namespace=xdipx`,
    { headers: { 'X-Shopify-Access-Token': token! } },
  )
  if (!mfRes.ok) {
    return { error: `metafields ${id}: ${mfRes.status} ${await mfRes.text()}` }
  }
  const { metafields } = await mfRes.json() as any
  const mfMap: Record<string, string> = {}
  for (const mf of metafields) mfMap[mf.key] = mf.value

  return {
    id:      product.id,
    handle:  product.handle,
    title:   product.title,
    bodyHtmlChars: (product.body_html ?? '').length,
    metafields: mfMap,
  }
}

async function fetchSanity(handle: string) {
  const projectId = process.env.SANITY_PROJECT_ID
  const dataset   = process.env.SANITY_DATASET ?? 'production'
  const apiVersion = '2024-01-01'
  if (!projectId) return null
  const query = encodeURIComponent(
    `*[_type == "productPage" && shopifyHandle == "${handle}"][0]{
      _id, shopifyHandle, title, productTypeDial, moodTags, audienceTags, mattersTags
    }`,
  )
  const url = `https://${projectId}.api.sanity.io/v${apiVersion}/data/query/${dataset}?query=${query}`
  const res = await fetch(url, {
    headers: process.env.SANITY_API_TOKEN
      ? { Authorization: `Bearer ${process.env.SANITY_API_TOKEN}` }
      : {},
  })
  if (!res.ok) throw new Error(`Sanity ${res.status}: ${await res.text()}`)
  const { result } = await res.json() as any
  return result
}

function truncate(s: string, n = 60) {
  if (!s) return '(empty)'
  return s.length > n ? s.slice(0, n) + '…' : s
}

for (const id of ids) {
  console.log(`\n═══ ${id} ${'═'.repeat(60)}`)
  const shopify = await fetchShopify(id)
  if ('error' in shopify) {
    console.error(`  ✖ Shopify: ${shopify.error}`)
    continue
  }
  console.log(`  Title:  ${shopify.title}`)
  console.log(`  Handle: ${shopify.handle}`)
  console.log(`  body_html (descriptionHtml): ${shopify.bodyHtmlChars} chars`)

  console.log(`  Metafields (xdipx.*):`)
  for (const key of METAFIELD_KEYS) {
    const val = shopify.metafields[key]
    const flag = key === 'full_story'
      ? (val ? '⚠ ' : '✓ ')  // full_story should be empty
      : (val ? '✓ ' : '✖ ')  // rest should be populated
    console.log(`    ${flag}${key.padEnd(22)} ${truncate(val ?? '', 80)}`)
  }

  try {
    const sanityDoc = await fetchSanity(shopify.handle)
    if (!sanityDoc) {
      console.error(`  ✖ Sanity: no productPage for handle "${shopify.handle}"`)
    } else {
      const d = sanityDoc as any
      console.log(`  Sanity productPage:`)
      console.log(`    _id:             ${d._id}`)
      console.log(`    productTypeDial: ${d.productTypeDial ?? '(empty)'}`)
      console.log(`    moodTags:        ${(d.moodTags ?? []).join(', ') || '(empty)'}`)
      console.log(`    audienceTags:    ${(d.audienceTags ?? []).join(', ') || '(empty)'}`)
      console.log(`    mattersTags:     ${(d.mattersTags ?? []).join(', ') || '(empty)'}`)
    }
  } catch (err) {
    console.error(`  ✖ Sanity fetch failed:`, err instanceof Error ? err.message : err)
  }
}
