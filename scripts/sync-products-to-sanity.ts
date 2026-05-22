/**
 * Sync all Shopify products into Sanity as productPage documents,
 * including all standard fields and xdipx metafields.
 *
 * Run:        npx tsx scripts/sync-products-to-sanity.ts
 * Force-push: npx tsx scripts/sync-products-to-sanity.ts --force
 *
 * Safe to re-run. Existing contentBlocks are never overwritten.
 * --force overwrites ALL fields (but still keeps contentBlocks).
 */
import 'dotenv/config'
import { createClient } from '@sanity/client'
import { JSDOM } from 'jsdom'
import { normalizeTagList, editorialTagsOnly } from '../app/lib/tag-normalize'

// ─── HTML → Portable Text converter ──────────────────────────────────────────

type PTSpan = { _type: 'span'; _key: string; text: string; marks: string[] }
type PTBlock = {
  _type: 'block'; _key: string; style: string
  listItem?: string; level?: number
  markDefs: { _key: string; _type: string; href?: string }[]
  children: PTSpan[]
}

let keyCounter = 0
function key() { return `k${++keyCounter}` }

function nodeToSpans(node: Node, marks: string[], markDefs: PTBlock['markDefs']): PTSpan[] {
  if (node.nodeType === 3) { // text node
    const text = node.textContent ?? ''
    if (!text) return []
    return [{ _type: 'span', _key: key(), text, marks: [...marks] }]
  }
  if (node.nodeType !== 1) return []
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  const childMarks = [...marks]

  if (tag === 'strong' || tag === 'b') childMarks.push('strong')
  if (tag === 'em'     || tag === 'i') childMarks.push('em')
  if (tag === 'u')                     childMarks.push('underline')
  if (tag === 'a') {
    const mkKey = key()
    markDefs.push({ _key: mkKey, _type: 'link', href: el.getAttribute('href') ?? '' })
    childMarks.push(mkKey)
  }
  if (tag === 'br') return [{ _type: 'span', _key: key(), text: '\n', marks }]

  return Array.from(el.childNodes).flatMap(c => nodeToSpans(c, childMarks, markDefs))
}

function elementToBlocks(el: Element, listItem?: string, level = 1): PTBlock[] {
  const tag = el.tagName.toLowerCase()
  const styleMap: Record<string, string> = { p: 'normal', h1: 'h2', h2: 'h2', h3: 'h3', h4: 'h3', div: 'normal' }

  if (tag === 'ul' || tag === 'ol') {
    const itemTag = tag === 'ul' ? 'bullet' : 'number'
    return Array.from(el.querySelectorAll(':scope > li')).flatMap(li => {
      const markDefs: PTBlock['markDefs'] = []
      const children = nodeToSpans(li, [], markDefs)
      const block: PTBlock = {
        _type: 'block', _key: key(), style: 'normal',
        listItem: itemTag, level,
        markDefs,
        children: children.length ? children : [{ _type: 'span', _key: key(), text: '', marks: [] }],
      }
      // Nested lists
      const nested = Array.from(li.querySelectorAll(':scope > ul, :scope > ol'))
        .flatMap(sub => elementToBlocks(sub as Element, undefined, level + 1))
      return [block, ...nested]
    })
  }

  if (styleMap[tag]) {
    const markDefs: PTBlock['markDefs'] = []
    const children = nodeToSpans(el, [], markDefs)
    return [{
      _type: 'block', _key: key(), style: styleMap[tag]!,
      ...(listItem ? { listItem, level } : {}),
      markDefs,
      children: children.length ? children : [{ _type: 'span', _key: key(), text: '', marks: [] }],
    }]
  }

  // Unknown block element — recurse into its block children
  return Array.from(el.children).flatMap(c => elementToBlocks(c as Element))
}

export function htmlToPT(html: string): PTBlock[] | undefined {
  if (!html?.trim()) return undefined
  const doc = new JSDOM(html).window.document
  const body = doc.body

  // Wrap bare inline content in a paragraph
  const hasBlockEl = Array.from(body.childNodes).some(n => {
    if (n.nodeType !== 1) return false
    const tag = (n as Element).tagName.toLowerCase()
    return ['p','div','ul','ol','h1','h2','h3','h4','h5','h6','blockquote'].includes(tag)
  })
  if (!hasBlockEl) {
    const p = doc.createElement('p')
    while (body.firstChild) p.appendChild(body.firstChild)
    body.appendChild(p)
  }

  return Array.from(body.children).flatMap(c => elementToBlocks(c as Element))
}

const SHOPIFY_DOMAIN      = process.env['SHOPIFY_STORE_DOMAIN']!
const SHOPIFY_ADMIN_TOKEN = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']!
const SANITY_PROJECT_ID   = process.env['SANITY_PROJECT_ID']!
const SANITY_DATASET      = process.env['SANITY_DATASET'] ?? 'production'
const SANITY_TOKEN        = process.env['SANITY_API_TOKEN']!
const FORCE               = process.argv.includes('--force')

if (!SHOPIFY_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
  console.error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN')
  process.exit(1)
}
if (!SANITY_PROJECT_ID || !SANITY_TOKEN) {
  console.error('Missing SANITY_PROJECT_ID or SANITY_API_TOKEN')
  process.exit(1)
}

const sanity = createClient({
  projectId: SANITY_PROJECT_ID,
  dataset:   SANITY_DATASET,
  apiVersion: '2024-10-01',
  token:     SANITY_TOKEN,
  useCdn:    false,
})

// ─── Shopify Admin GraphQL ────────────────────────────────────────────────────

const ADMIN_GQL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-10/graphql.json`

async function shopifyGQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(ADMIN_GQL, {
    method: 'POST',
    headers: {
      'Content-Type':           'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify GQL error: ${res.status} ${await res.text()}`)
  const { data, errors } = await res.json() as { data: T; errors?: { message: string }[] }
  if (errors?.length) throw new Error(errors[0]?.message)
  return data
}

const PRODUCT_QUERY = `
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          legacyResourceId
          title
          handle
          vendor
          bodyHtml
          status
          tags
          seo { title description }
          images(first: 1) { edges { node { url } } }
          metafields(namespace: "xdipx", first: 20) {
            edges { node { key value } }
          }
        }
      }
    }
  }
`

interface ShopifyNode {
  id: string
  legacyResourceId: string
  title: string
  handle: string
  vendor: string
  bodyHtml: string
  status: string
  tags: string[]
  seo: { title: string; description: string }
  images: { edges: { node: { url: string } }[] }
  metafields: { edges: { node: { key: string; value: string } }[] }
}

function mf(node: ShopifyNode, key: string): string {
  return node.metafields.edges.find(e => e.node.key === key)?.node.value ?? ''
}

function mfNum(node: ShopifyNode, key: string): number | undefined {
  const v = mf(node, key)
  return v ? parseFloat(v) : undefined
}

async function fetchAllProducts(): Promise<ShopifyNode[]> {
  const all: ShopifyNode[] = []
  let cursor: string | null = null

  do {
    const data = await shopifyGQL<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string }
        edges: { node: ShopifyNode }[]
      }
    }>(PRODUCT_QUERY, { cursor })

    const page = data.products
    all.push(...page.edges.map(e => e.node))
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
    console.log(`  fetched ${all.length} products…`)
  } while (cursor)

  return all
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching products from Shopify (Admin GraphQL)…')
  const products = await fetchAllProducts()
  const active   = products.filter(p => p.status === 'ACTIVE')
  console.log(`Found ${products.length} total, ${active.length} active.\n`)

  let created = 0
  let updated = 0
  let archived = 0

  const activeHandles = new Set(active.map(p => p.handle))

  for (const p of active) {
    // Look up existing doc by shopifyHandle field, not _id. Two prior code paths
    // wrote docs with different _id conventions (`product-{handle}` from this
    // script, `productPage-{handle}` from upsertProductPage). Matching by field
    // reuses whichever doc exists and prevents creating a second one.
    const existing = await sanity.fetch<{ _id: string } | null>(
      `*[_type == "productPage" && shopifyHandle == $handle][0]{ _id }`,
      { handle: p.handle },
    )
    const docId = existing?._id ?? `productPage-${p.handle}`

    // Build the fields object from Shopify data
    const fields: Record<string, unknown> = {
      shopifyHandle:    p.handle,
      shopifyProductId: p.legacyResourceId,
      previewImageUrl:  p.images.edges[0]?.node.url || undefined,
      title:            p.title,
      vendor:           p.vendor,
      // Editorial sub-category labels only — operational tags (cat:*, brand:*,
      // price:*, nalpac-sku-*, deal-status-*, for-*) are intentionally excluded
      // from the Studio `tags` view (see studio/schemas/productPage.js).
      // normalizedTags still derives from ALL Shopify tags so cat:* operational
      // values continue to match editorial slugs for /search faceting.
      tags:             editorialTagsOnly(p.tags),
      normalizedTags:   normalizeTagList(p.tags),
      description:      htmlToPT(p.bodyHtml),
      seoTitle:         p.seo.title        || undefined,
      seoDescription:   p.seo.description  || undefined,
      // xdipx metafields
      tagline:          mf(p, 'tagline')       || undefined,
      fullStory:        htmlToPT(mf(p, 'full_story')),
      worksForHim:      htmlToPT(mf(p, 'works_for_him')),
      worksForHer:      htmlToPT(mf(p, 'works_for_her')),
      moodImageUrl:     mf(p, 'mood_image_url') || undefined,
      category:         mf(p, 'category')       || undefined,
      dealStatus:       mf(p, 'deal_status')    || undefined,
      dealDate:         mf(p, 'deal_date')      || undefined,
      nalpacSku:        mf(p, 'nalpac_sku')     || undefined,
      originalPrice:    mfNum(p, 'original_price'),
      wholesaleCost:    mfNum(p, 'wholesale_cost'),
      mapPrice:         mfNum(p, 'map_price'),
      dealScore:        mfNum(p, 'deal_score'),
    }

    // Remove undefined values so we don't overwrite with null
    const cleanFields = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined)
    )

    if (!existing) {
      await sanity.create({ _id: docId, _type: 'productPage', ...cleanFields })
      console.log(`  ✓ created   ${p.handle}`)
      created++
    } else {
      // Fetch the full doc to honor gentle-update semantics (fill blanks only).
      const full = await sanity.getDocument(existing._id)
      if (FORCE) {
        // Update all fields except contentBlocks
        const { contentBlocks, ...rest } = cleanFields
        void contentBlocks
        await sanity.patch(existing._id).set({ ...rest, archived: false }).commit()
        console.log(`  ↺ force-upd  ${p.handle}`)
        updated++
      } else {
        const updates: Record<string, unknown> = { archived: false }
        for (const [key, value] of Object.entries(cleanFields)) {
          if (key === 'contentBlocks') continue          // never touch blocks
          if (full && !full[key] && value) updates[key] = value  // fill blanks only
          // always update these structural fields
          if (['shopifyHandle', 'shopifyProductId', 'title', 'vendor', 'tags'].includes(key)) {
            updates[key] = value
          }
        }
        await sanity.patch(existing._id).set(updates).commit()
        console.log(`  · updated   ${p.handle}`)
        updated++
      }
    }
  }

  // ─── Archive orphans ──────────────────────────────────────────────────────
  // Any productPage doc whose shopifyHandle is not in the active set points to
  // a deleted/archived Shopify product. Mark archived so search can filter it.
  const orphans = await sanity.fetch<{ _id: string; shopifyHandle: string }[]>(
    `*[_type == "productPage" && defined(shopifyHandle) && archived != true]{ _id, shopifyHandle }`,
  )
  for (const o of orphans) {
    if (activeHandles.has(o.shopifyHandle)) continue
    await sanity.patch(o._id).set({ archived: true }).commit()
    console.log(`  ⊘ archived  ${o.shopifyHandle}`)
    archived++
  }

  console.log(`\nDone. Created: ${created}  Updated: ${updated}  Archived: ${archived}`)
}

main().catch(err => { console.error(err); process.exit(1) })
