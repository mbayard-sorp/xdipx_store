import crypto from 'node:crypto'
import type { Deal, Product, VaultDeal, Cart, CartLine, ProductImage, ProductVideo, ProductScore, ProductTypeDial, SellingPlan, SellingPlanGroup, SensationDial, SensationDialV2, SensationDialItem, DialValue, CareInstructions, EmmaHeroCopy } from '~/types'
import { toHTML } from '@portabletext/to-html'
import { cached, invalidateCache, kvGet, kvSet, KV_KEYS } from '~/lib/kv.server'
import { isOperationalTag, editorialTagsOnly } from '~/lib/tag-normalize'
import { UNCATEGORIZED_SENTINEL } from '~/lib/master-collapse.server'
import { deriveProductType } from '~/lib/product-type-derive'

// Short TTL for read-through product caches — long enough to dedupe burst
// traffic, short enough for admin edits to appear on the next page load.
const READ_TTL = 60

const COLLECTION_CURSOR_TTL = 300 // 5 minutes — collection order is stable short-term

type PortableTextBlocks = Parameters<typeof toHTML>[0]

function ptToHtml(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value  // already HTML (legacy)
  if (Array.isArray(value) && value.length > 0) return toHTML(value as PortableTextBlocks)
  return undefined
}

const STOREFRONT_ENDPOINT   = `https://${process.env['SHOPIFY_STORE_DOMAIN']}/api/2024-10/graphql.json`
const ADMIN_ENDPOINT        = `https://${process.env['SHOPIFY_STORE_DOMAIN']}/admin/api/2024-10`
const ADMIN_GQL_ENDPOINT    = `https://${process.env['SHOPIFY_STORE_DOMAIN']}/admin/api/2024-10/graphql.json`

// ─── Clients ──────────────────────────────────────────────────────────────

/**
 * The Storefront API did not answer — timeout, transport error, non-2xx, or a
 * GraphQL error. Deliberately distinct from a `null` product, which means
 * Shopify *did* answer and the product genuinely does not exist.
 *
 * Collapsing the two is what put live PDPs into Search Console as
 * "Not found (404)": getDealByHandle raced the fetch against a 5s timeout that
 * resolved to `null`, the PDP loader read `null` as "gone" and threw a 404,
 * and `cached()` pinned that verdict for the full read TTL — so one slow
 * Storefront call served a hard 404 for a live product to every visitor,
 * Googlebot included, for up to two minutes. A 404 tells Google to drop the
 * URL; a Shopify blip is not grounds for that.
 *
 * Any caller that serves a page MUST map this to a retryable status (503),
 * never to 404/410.
 */
export class StorefrontUnavailableError extends Error {
  readonly handle: string | undefined
  constructor(message: string, handle?: string, cause?: unknown) {
    super(`Shopify Storefront unavailable${handle ? ` for "${handle}"` : ''}: ${message}`)
    this.name = 'StorefrontUnavailableError'
    this.handle = handle
    if (cause !== undefined) this.cause = cause
  }
}

async function storefront<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(STOREFRONT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': process.env['SHOPIFY_STOREFRONT_ACCESS_TOKEN']!,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify Storefront API error: ${res.status}`)
  const { data, errors } = await res.json() as { data: T; errors?: { message: string }[] }
  if (errors?.length) throw new Error(errors[0]?.message ?? 'Shopify error')
  return data
}

export async function shopifyAdmin<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${ADMIN_ENDPOINT}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']!,
    },
    body: body ? JSON.stringify(body) : null,
  })
  if (!res.ok) {
    // 4xx bodies name the invalid field (e.g. {"errors":{"product":[...]}}) —
    // without them a 422 is undiagnosable from logs.
    const errBody = await res.text().catch(() => '')
    throw new Error(`Shopify Admin API error: ${res.status} ${path}${errBody ? ` ${errBody.slice(0, 500)}` : ''}`)
  }
  return res.json() as Promise<T>
}

/** Shopify's leaky-bucket cost block, as it arrives on a GraphQL response. */
interface ShopifyQueryCost {
  requestedQueryCost?: number
  throttleStatus?: { currentlyAvailable?: number; restoreRate?: number }
}

/**
 * How long the leaky bucket needs to refill enough to afford the requested
 * query, in ms, from Shopify's own cost block. 0 when Shopify didn't give us
 * both a shortfall and a restore rate (so the caller falls back to its own
 * backoff). Shared by adminGraphQL's in-loop backoff and the ShopifyThrottleError
 * hint so the two never drift.
 */
export function shopifyThrottleRefillMs(cost: ShopifyQueryCost | undefined): number {
  const needed = (cost?.requestedQueryCost ?? 0) - (cost?.throttleStatus?.currentlyAvailable ?? 0)
  const restoreRate = cost?.throttleStatus?.restoreRate ?? 0
  return needed > 0 && restoreRate > 0 ? Math.ceil((needed / restoreRate) * 1000) : 0
}

/**
 * A THROTTLED GraphQL error that survived adminGraphQL's own short retries. It
 * carries Shopify's refill estimate so a caller that can afford a longer, single
 * rest (the daily pricing batch) waits the real amount instead of guessing. Its
 * message is still "Throttled", so callers that match on the message keep working.
 */
export class ShopifyThrottleError extends Error {
  readonly retryAfterMs: number
  constructor(message: string, retryAfterMs: number) {
    super(message)
    this.name = 'ShopifyThrottleError'
    this.retryAfterMs = retryAfterMs
  }
}

export async function adminGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const doFetch = () => fetch(ADMIN_GQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']!,
    },
    body: JSON.stringify({ query, variables }),
  })

  // Discovery index builds chain 30+ calls. Shopify throttles two different
  // ways and we have to handle BOTH: a transport-level HTTP 429 (rare), and —
  // far more common for the GraphQL Admin API — an HTTP 200 whose body carries
  // `errors: [{ extensions: { code: "THROTTLED" } }]` plus a cost block with
  // the leaky-bucket restore rate. Retrying only on 429 (the old behavior)
  // missed every GraphQL throttle, so a cold-start build would throw
  // "Throttled" on the first cost-limit hit and cascade into a 500.
  const MAX_ATTEMPTS = 4
  for (let attempt = 1; ; attempt++) {
    const res = await doFetch()

    if (res.status === 429) {
      if (attempt >= MAX_ATTEMPTS) throw new Error('Shopify Admin GraphQL error: 429')
      const retryAfter = Number(res.headers.get('retry-after')) || 1
      await new Promise(r => setTimeout(r, Math.min(retryAfter * 1000, 5000)))
      continue
    }

    if (!res.ok) throw new Error(`Shopify Admin GraphQL error: ${res.status}`)

    const body = await res.json() as {
      data: T
      errors?: { message: string; extensions?: { code?: string } }[]
      extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } }
    }

    const throttled = body.errors?.some(
      e => e.extensions?.code === 'THROTTLED' || /throttled/i.test(e.message),
    )
    if (throttled && attempt < MAX_ATTEMPTS) {
      // Wait long enough for the leaky bucket to refill to the requested cost,
      // when Shopify tells us the rates; otherwise fall back to exponential.
      // Capped at 5s here so an interactive caller isn't stalled — a caller that
      // can afford the full refill reads it off ShopifyThrottleError below.
      const refillMs = shopifyThrottleRefillMs(body.extensions?.cost)
      const backoffMs = refillMs || 2 ** (attempt - 1) * 500
      await new Promise(r => setTimeout(r, Math.min(backoffMs, 5000)))
      continue
    }

    if (body.errors?.length) {
      // A throttle that outlived every short retry throws a typed error carrying
      // Shopify's own refill estimate, so a batch caller can rest the real amount
      // in one go instead of re-entering these too-short retries and giving up.
      if (throttled) {
        throw new ShopifyThrottleError(
          body.errors[0]?.message ?? 'Throttled',
          shopifyThrottleRefillMs(body.extensions?.cost),
        )
      }
      throw new Error(body.errors[0]?.message ?? 'Shopify Admin GraphQL error')
    }
    return body.data
  }
}

// ─── GraphQL Fragments ────────────────────────────────────────────────────

const METAFIELDS_FRAGMENT = `
  metafields(identifiers: [
    { namespace: "xdipx", key: "tagline" }
    { namespace: "xdipx", key: "full_story" }
    { namespace: "xdipx", key: "works_for_him" }
    { namespace: "xdipx", key: "works_for_her" }
    { namespace: "xdipx", key: "box_contents" }
    { namespace: "xdipx", key: "deal_score" }
    { namespace: "xdipx", key: "wholesale_cost" }
    { namespace: "xdipx", key: "map_price" }
    { namespace: "xdipx", key: "original_price" }
    { namespace: "xdipx", key: "category" }
    { namespace: "xdipx", key: "nalpac_sku" }
    { namespace: "xdipx", key: "seo_meta_description" }
    { namespace: "xdipx", key: "mood_image_url" }
    { namespace: "xdipx", key: "accessory_product_ids" }
    { namespace: "xdipx", key: "specifications" }
    { namespace: "xdipx", key: "map_restricted" }
    { namespace: "xdipx", key: "hero_video" }
    { namespace: "xdipx", key: "mood_tags" }
    { namespace: "xdipx", key: "audience_tags" }
    { namespace: "xdipx", key: "matters_tags" }
    { namespace: "xdipx", key: "product_type_dial" }
    { namespace: "xdipx", key: "sensation_dial" }
    { namespace: "xdipx", key: "sensation_dial_v2" }
    { namespace: "xdipx", key: "care_instructions" }
    { namespace: "xdipx", key: "pairing_why" }
    { namespace: "xdipx", key: "emma_hero" }
    { namespace: "xdipx", key: "quiet_endorsement_copy" }
    { namespace: "xdipx", key: "pair_bundle_copy" }
    { namespace: "xdipx", key: "endorsement_copy" }
    { namespace: "custom", key: "original_description" }
  ]) {
    namespace key value
  }
`

const PRODUCT_CORE_FRAGMENT = `
  id handle title vendor tags description descriptionHtml
  createdAt updatedAt
  collections(first: 10) {
    edges { node { handle title } }
  }
  images(first: 10) {
    edges { node { url altText } }
  }
  media(first: 15) {
    edges {
      node {
        mediaContentType
        ... on Video {
          previewImage { url }
          sources { url mimeType height width }
        }
      }
    }
  }
  options { name values }
  variants(first: 20) {
    edges {
      node {
        id
        title
        selectedOptions { name value }
        image { url altText }
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
        availableForSale
        quantityAvailable
        barcode
        metafields(identifiers: [{ namespace: "custom", key: "original_description" }]) {
          value
        }
      }
    }
  }
  sellingPlanGroups(first: 5) {
    edges {
      node {
        name
        appName
        options { name values }
        sellingPlans(first: 10) {
          edges {
            node {
              id
              name
              description
              recurringDeliveries
              options { name value }
              priceAdjustments {
                adjustmentValue {
                  __typename
                  ... on SellingPlanPercentagePriceAdjustment { adjustmentPercentage }
                  ... on SellingPlanFixedAmountPriceAdjustment { adjustmentAmount { amount currencyCode } }
                  ... on SellingPlanFixedPriceAdjustment       { price           { amount currencyCode } }
                }
              }
            }
          }
        }
      }
    }
  }
  ${METAFIELDS_FRAGMENT}
`

// Lightweight fragment for list/grid views (vault, PLPs). Skips media,
// extra variants, options, and non-card metafields — cuts payload ~70%
// versus PRODUCT_CORE_FRAGMENT.
const CARD_METAFIELDS_FRAGMENT = `
  metafields(identifiers: [
    { namespace: "xdipx", key: "original_price" }
    { namespace: "xdipx", key: "category" }
    { namespace: "xdipx", key: "mood_tags" }
    { namespace: "xdipx", key: "audience_tags" }
    { namespace: "xdipx", key: "matters_tags" }
    { namespace: "xdipx", key: "hero_video" }
  ]) {
    namespace key value
  }
`

const PRODUCT_CARD_FRAGMENT = `
  id handle title vendor tags
  options { name values }
  images(first: 6) {
    edges { node { url altText } }
  }
  variants(first: 50) {
    edges {
      node {
        id
        price { amount }
        compareAtPrice { amount }
        quantityAvailable
        availableForSale
      }
    }
  }
  ${CARD_METAFIELDS_FRAGMENT}
`

interface ShopifyProductCardNode {
  id: string
  handle: string
  title: string
  vendor: string
  tags: string[]
  options?: { name: string; values: string[] }[]
  images: { edges: { node: { url: string; altText: string | null } }[] }
  variants: {
    edges: {
      node: {
        id: string
        price: { amount: string }
        compareAtPrice: { amount: string } | null
        quantityAvailable: number
        availableForSale: boolean
      }
    }[]
  }
  metafields: ({ namespace: string; key: string; value: string } | null)[]
}

function nodeToVaultDeal(node: ShopifyProductCardNode): VaultDeal {
  const mf = node.metafields
  const variantEdges = node.variants.edges
  const variant = variantEdges[0]?.node
  const dealPrice = parseFloat(variant?.price.amount ?? '0')
  const moodTags     = parseMetafieldJSON<string[]>(mf, 'mood_tags',     [])
  const audienceTags = parseMetafieldJSON<string[]>(mf, 'audience_tags', [])
  const mattersTags  = parseMetafieldJSON<string[]>(mf, 'matters_tags',  [])
  const heroVideo    = parseMetafieldJSON<{ src?: string; poster?: string; duration?: number }>(mf, 'hero_video', {})
  const colorOpt = (node.options ?? []).find(o => /^colou?r$/i.test(o.name))
  const sizeOpt  = (node.options ?? []).find(o =>
    /^(size|volume|capacity|length|fl\.?\s*oz)$/i.test(o.name)
  )
  const colorValues = colorOpt && colorOpt.values.length > 1 ? colorOpt.values : undefined
  const sizeValues  = sizeOpt  && sizeOpt.values.length  > 1 ? sizeOpt.values  : undefined
  const variantPrices = variantEdges
    .map(e => parseFloat(e.node.price.amount))
    .filter(n => Number.isFinite(n) && n > 0)
  const priceMin = variantPrices.length > 0 ? Math.min(...variantPrices) : dealPrice
  const priceMax = variantPrices.length > 0 ? Math.max(...variantPrices) : dealPrice
  const hasPriceRange = priceMax > priceMin
  const variantSavings = variantEdges
    .map(e => {
      const p  = parseFloat(e.node.price.amount)
      const ca = parseFloat(e.node.compareAtPrice?.amount ?? '0')
      return ca > p && p > 0
        ? { amount: ca - p, percent: Math.round(((ca - p) / ca) * 100) }
        : null
    })
    .filter((s): s is { amount: number; percent: number } => s !== null)
  const maxSavingsAmount  = variantSavings.length > 0 ? Math.max(...variantSavings.map(s => s.amount))  : 0
  const maxSavingsPercent = variantSavings.length > 0 ? Math.max(...variantSavings.map(s => s.percent)) : 0
  return {
    id: node.id,
    handle: node.handle,
    seoTitle: node.title,
    dealPrice,
    msrp: parseFloat(parseMetafield(mf, 'original_price') || (variant?.compareAtPrice?.amount ?? '0')),
    images: parseImages(node.images.edges),
    brand: node.vendor,
    category: parseCategory(parseMetafield(mf, 'category')),
    qty: variant?.quantityAvailable ?? 0,
    defaultVariantId:    variant?.id ?? null,
    hasMultipleVariants: variantEdges.length > 1,
    ...(colorValues ? { colorValues } : {}),
    ...(sizeValues  ? { sizeValues }  : {}),
    ...(hasPriceRange ? { priceMin, priceMax } : {}),
    ...(maxSavingsAmount > 0 ? { maxSavingsAmount, maxSavingsPercent } : {}),
    ...(moodTags.length     > 0 ? { moodTags }     : {}),
    ...(audienceTags.length > 0 ? { audienceTags } : {}),
    ...(mattersTags.length  > 0 ? { mattersTags }  : {}),
    ...(heroVideo?.src && typeof heroVideo.duration === 'number'
      ? { heroVideo: { src: heroVideo.src, duration: heroVideo.duration, ...(heroVideo.poster ? { poster: heroVideo.poster } : {}) } }
      : {}),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function parseMetafield(metafields: ({ namespace: string; key: string; value: string } | null)[], key: string): string {
  return metafields.find(m => m?.key === key)?.value ?? ''
}

export function parseMetafieldJSON<T>(metafields: ({ namespace: string; key: string; value: string } | null)[], key: string, fallback: T): T {
  const raw = parseMetafield(metafields, key)
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

/**
 * Category parser. Phase 2 stores `xdipx.category` as a JSON-stringified
 * `string[]` of audience tags (`for-him` / `for-her` / `couples`). Legacy
 * products have a single-value string (`for-him` / `for-her` / `both` /
 * `couples`). The legacy `both` expands to `['for-him', 'for-her']`. Empty
 * raw → empty array. Returns the canonical multi-select array.
 */
function parseCategory(raw: string): Array<'for-him' | 'for-her' | 'couples'> {
  if (!raw) return []
  const valid = new Set(['for-him', 'for-her', 'couples'])
  // New format: JSON array
  if (raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed
          .filter((s): s is string => typeof s === 'string' && valid.has(s))
          .map(s => s as 'for-him' | 'for-her' | 'couples')
      }
    } catch { /* fall through */ }
  }
  // Legacy: single-value string
  const v = raw.trim().toLowerCase()
  if (v === 'both')  return ['for-him', 'for-her']
  if (v === 'him')   return ['for-him']  // legacy stale
  if (v === 'her')   return ['for-her']
  if (valid.has(v))  return [v as 'for-him' | 'for-her' | 'couples']
  return []
}

/**
 * Specifications-bullet parser. Phase 2 stores `xdipx.specifications` as a
 * JSON-stringified `string[]` of "Label: Value" bullets. Legacy products still
 * have HTML strings (a `<ul>` of `<li><strong>Label:</strong> Value</li>`).
 * Returns the bullets as a plain string array regardless of source format.
 */
function parseSpecificationsBullets(raw: string): string[] {
  if (!raw) return []
  // New format: JSON array
  if (raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter(s => typeof s === 'string' && s.trim()).map(s => (s as string).trim())
    } catch { /* fall through */ }
  }
  // Legacy format: HTML <ul>/<li> — extract bullet text. Strip inner tags but
  // keep label/value semantics by collapsing "<strong>Label:</strong> Value"
  // to "Label: Value".
  const items = Array.from(raw.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
  if (items.length === 0) return []
  return items
    .map(m => (m[1] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 0)
}

function parseImages(edges: { node: { url: string; altText: string | null } }[]): ProductImage[] {
  return edges.map(e => ({ url: e.node.url, altText: e.node.altText ?? '' }))
}

// ─── Sensation dial v1 → v2 projection ────────────────────────────────────
// Legacy fixed-key labels per dimension. Used only when sensation_dial_v2 is
// absent — lets old products keep rendering while migration proceeds.
const LEGACY_DIAL_LABELS: Record<string, string> = {
  intensity:      'Intensity',
  quietness:      'Quietness',
  softness:       'Softness',
  suction:        'Suction strength',
  buildup:        'Buildup speed',
  learningCurve:  'Learning curve',
  patternVariety: 'Pattern variety',
  reach:          'Reach',
  slipperiness:   'Slipperiness',
  longevity:      'Longevity',
  fit:            'Fit',
}

function clampDialValue(n: number): DialValue {
  const v = Math.round(n)
  if (v <= 1) return 1
  if (v >= 5) return 5
  return v as DialValue
}

function projectLegacyDial(legacy: SensationDial | undefined): SensationDialV2 | undefined {
  if (!legacy) return undefined
  const items: SensationDialItem[] = []
  for (const [key, value] of Object.entries(legacy)) {
    if (typeof value !== 'number') continue
    const label = LEGACY_DIAL_LABELS[key] ?? key
    items.push({ label, value: clampDialValue(value) })
  }
  return items.length > 0 ? { items } : undefined
}

function normalizeSensationDialV2(raw: unknown): SensationDialV2 | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as { items?: unknown }
  if (!Array.isArray(r.items)) return undefined
  const items: SensationDialItem[] = []
  for (const it of r.items) {
    if (!it || typeof it !== 'object') continue
    const o = it as { label?: unknown; value?: unknown; proposed?: unknown }
    if (typeof o.label !== 'string' || typeof o.value !== 'number') continue
    const item: SensationDialItem = { label: o.label, value: clampDialValue(o.value) }
    if (o.proposed === true) item.proposed = true
    items.push(item)
  }
  return items.length > 0 ? { items } : undefined
}

function normalizeCareInstructions(raw: unknown): CareInstructions | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
  return out.length > 0 ? out : undefined
}

/** Shopify Storefront API returns video CDN URLs on the store's custom domain
 *  (e.g. xdipx.com/cdn/shop/videos/...). When the custom domain points at
 *  Vercel instead of Shopify those paths 404.  Rewrite to cdn.shopify.com. */
function fixVideoCdnUrl(url: string): string {
  const m = url.match(/\/cdn\/shop\/(videos\/.*)/)
  return m ? `https://cdn.shopify.com/${m[1]}` : url
}

function parseVideos(media?: { edges: { node: ShopifyMediaNode }[] }): ProductVideo[] {
  if (!media) return []
  return media.edges
    .filter(e => e.node.mediaContentType === 'VIDEO' && e.node.previewImage && e.node.sources?.length)
    .map(e => {
      const sources = e.node.sources ?? []
      // Prefer dimensions from the mp4 source (or first). Some sources lack h/w; fall back.
      const dimSource = sources.find(s => s.mimeType.includes('mp4') && s.height && s.width) ?? sources.find(s => s.height && s.width)
      const width = dimSource?.width
      const height = dimSource?.height
      let aspect: ProductVideo['aspect'] | undefined
      if (width && height) {
        if (height > width * 1.15) aspect = 'portrait'
        else if (width > height * 1.15) aspect = 'landscape'
        else aspect = 'square'
      }
      const video: ProductVideo = {
        previewImageUrl: e.node.previewImage!.url,
        sources: sources.map(s => ({ url: fixVideoCdnUrl(s.url), mimeType: s.mimeType })),
      }
      if (aspect) video.aspect = aspect
      if (width) video.width = width
      if (height) video.height = height
      return video
    })
}

interface ShopifyVariantNode {
  id: string
  title: string
  selectedOptions: { name: string; value: string }[]
  image?: { url: string; altText: string | null }
  price: { amount: string }
  compareAtPrice: { amount: string } | null
  availableForSale: boolean
  quantityAvailable: number
  barcode: string | null
  metafields?: ({ value: string } | null)[]
}

interface ShopifyMediaNode {
  mediaContentType: string
  previewImage?: { url: string }
  sources?: { url: string; mimeType: string; height: number; width: number }[]
}

interface ShopifySellingPlanAdjustmentValue {
  __typename: string
  adjustmentPercentage?: number
  adjustmentAmount?: { amount: string; currencyCode: string }
  price?: { amount: string; currencyCode: string }
}

interface ShopifySellingPlanNode {
  id: string
  name: string
  description: string | null
  recurringDeliveries: boolean
  options: { name: string; value: string }[]
  priceAdjustments: { adjustmentValue: ShopifySellingPlanAdjustmentValue }[]
}

interface ShopifySellingPlanGroupNode {
  name: string
  appName: string
  options: { name: string; values: string[] }[]
  sellingPlans: { edges: { node: ShopifySellingPlanNode }[] }
}

interface ShopifyProductNode {
  id: string
  handle: string
  title: string
  vendor: string
  tags: string[]
  description: string
  descriptionHtml?: string
  createdAt?: string
  updatedAt?: string
  collections?: { edges: { node: { handle: string; title: string } }[] }
  images: { edges: { node: { url: string; altText: string | null } }[] }
  media?: { edges: { node: ShopifyMediaNode }[] }
  options: { name: string; values: string[] }[]
  variants: { edges: { node: ShopifyVariantNode }[] }
  metafields: ({ namespace: string; key: string; value: string } | null)[]
  sellingPlanGroups?: { edges: { node: ShopifySellingPlanGroupNode }[] }
}

function parseSellingPlanGroups(
  raw?: { edges: { node: ShopifySellingPlanGroupNode }[] },
): SellingPlanGroup[] | undefined {
  if (!raw?.edges?.length) return undefined
  const groups: SellingPlanGroup[] = raw.edges.map(({ node }) => ({
    name: node.name,
    appName: node.appName,
    options: node.options ?? [],
    sellingPlans: node.sellingPlans.edges.map(({ node: sp }) => {
      const plan: SellingPlan = {
        id: sp.id,
        name: sp.name,
        options: sp.options ?? [],
        recurringDeliveries: sp.recurringDeliveries,
        priceAdjustments: sp.priceAdjustments.map(pa => {
          const v = pa.adjustmentValue
          if (v.__typename === 'SellingPlanPercentagePriceAdjustment' && typeof v.adjustmentPercentage === 'number') {
            return { adjustmentValue: { __typename: 'SellingPlanPercentagePriceAdjustment', adjustmentPercentage: v.adjustmentPercentage } }
          }
          if (v.__typename === 'SellingPlanFixedAmountPriceAdjustment' && v.adjustmentAmount) {
            return { adjustmentValue: { __typename: 'SellingPlanFixedAmountPriceAdjustment', adjustmentAmount: v.adjustmentAmount } }
          }
          if (v.__typename === 'SellingPlanFixedPriceAdjustment' && v.price) {
            return { adjustmentValue: { __typename: 'SellingPlanFixedPriceAdjustment', price: v.price } }
          }
          // Fallback — 0% adjustment keeps typings happy without inventing a price.
          return { adjustmentValue: { __typename: 'SellingPlanPercentagePriceAdjustment', adjustmentPercentage: 0 } }
        }),
      }
      if (sp.description) plan.description = sp.description
      return plan
    }),
  }))
  return groups.filter(g => g.sellingPlans.length > 0)
}

function nodeToProduct(node: ShopifyProductNode): Product {
  const variant = node.variants.edges[0]?.node
  const mf = node.metafields
  const moodTags     = parseMetafieldJSON<string[]>(mf, 'mood_tags',     [])
  const audienceTags = parseMetafieldJSON<string[]>(mf, 'audience_tags', [])
  const mattersTags  = parseMetafieldJSON<string[]>(mf, 'matters_tags',  [])
  const heroVideo    = parseMetafieldJSON<{ src?: string; poster?: string; duration?: number }>(mf, 'hero_video', {})
  // Same parse as nodeToDeal so the lean and full shapes never disagree on a
  // product's dial: v2 metafield first, legacy sensation_dial projected as a
  // fallback. undefined when neither exists (no fabricated reading).
  const sensationDialV2 = normalizeSensationDialV2(parseMetafieldJSON<unknown>(mf, 'sensation_dial_v2', null))
    ?? projectLegacyDial(parseMetafieldJSON<SensationDial>(mf, 'sensation_dial', {}) as SensationDial | undefined)
  const mapPriceRaw = parseFloat(parseMetafield(mf, 'map_price') ?? '')
  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    images: parseImages(node.images.edges),
    videos: parseVideos(node.media),
    variants: node.variants.edges.map(e => ({
      id: e.node.id,
      title: e.node.title,
      selectedOptions: e.node.selectedOptions,
      ...(e.node.image ? { image: { url: e.node.image.url, altText: e.node.image.altText ?? '' } } : {}),
      price: e.node.price.amount,
      compareAtPrice: e.node.compareAtPrice?.amount ?? null,
      availableForSale: e.node.availableForSale,
      quantityAvailable: e.node.quantityAvailable,
      ...(e.node.barcode ? { barcode: e.node.barcode } : {}),
      ...(e.node.metafields?.[0]?.value ? { originalDescription: e.node.metafields[0].value } : {}),
    })),
    price: parseFloat(variant?.price.amount ?? '0'),
    ...(variant?.compareAtPrice ? { compareAtPrice: parseFloat(variant.compareAtPrice.amount) } : {}),
    ...(Number.isFinite(mapPriceRaw) && mapPriceRaw > 0 ? { mapPrice: mapPriceRaw } : {}),
    brand: node.vendor,
    tags: node.tags,
    ...(moodTags.length     > 0 ? { moodTags }     : {}),
    ...(audienceTags.length > 0 ? { audienceTags } : {}),
    ...(mattersTags.length  > 0 ? { mattersTags }  : {}),
    ...(heroVideo?.src && typeof heroVideo.duration === 'number'
      ? { heroVideo: { src: heroVideo.src, duration: heroVideo.duration, ...(heroVideo.poster ? { poster: heroVideo.poster } : {}) } }
      : {}),
    ...(sensationDialV2 ? { sensationDialV2 } : {}),
  }
}

function nodeToDeal(node: ShopifyProductNode): Deal {
  const mf = node.metafields
  const variant = node.variants.edges[0]?.node

  // v2 redesign metafield parsing (all optional)
  const mapRestrictedRaw = parseMetafield(mf, 'map_restricted')
  const heroVideo        = parseMetafieldJSON<{ src?: string; poster?: string; duration?: number }>(mf, 'hero_video', {})
  const productTypeDial  = parseMetafield(mf, 'product_type_dial') as ProductTypeDial | ''
  const sensationDial    = parseMetafieldJSON<Deal['sensationDial']>(mf, 'sensation_dial', {})
  const sensationDialV2  = normalizeSensationDialV2(parseMetafieldJSON<unknown>(mf, 'sensation_dial_v2', null))
    ?? projectLegacyDial(sensationDial as SensationDial | undefined)
  const careInstructions = normalizeCareInstructions(parseMetafieldJSON<unknown>(mf, 'care_instructions', null))
  const pairingWhy       = parseMetafieldJSON<Record<string, string>>(mf, 'pairing_why', {})
  const moodTags         = parseMetafieldJSON<string[]>(mf, 'mood_tags',     [])
  const audienceTags     = parseMetafieldJSON<string[]>(mf, 'audience_tags', [])
  const mattersTags      = parseMetafieldJSON<string[]>(mf, 'matters_tags',  [])
  const emmaHero         = parseMetafieldJSON<Partial<import('~/types').EmmaHeroCopy>>(mf, 'emma_hero', {})
  const quietEndorsementCopy = parseMetafieldJSON<Partial<import('~/types').QuietEndorsementCopy>>(mf, 'quiet_endorsement_copy', {})
  const pairBundleCopy       = parseMetafieldJSON<Partial<import('~/types').PairBundleCopy>>(mf, 'pair_bundle_copy', {})
  const endorsementCopy      = parseMetafieldJSON<Partial<import('~/types').EndorsementCopy>>(mf, 'endorsement_copy', {})
  const sellingPlanGroups    = parseSellingPlanGroups(node.sellingPlanGroups)

  return {
    id: node.id,
    shopifyProductId: node.id,
    sku: parseMetafield(mf, 'nalpac_sku'),
    handle: node.handle,
    seoTitle: node.title,
    tagline: parseMetafield(mf, 'tagline'),
    fullStory: parseMetafield(mf, 'full_story') || node.description,
    worksForHim: parseMetafield(mf, 'works_for_him'),
    worksForHer: parseMetafield(mf, 'works_for_her'),
    boxContents: parseMetafieldJSON<string[]>(mf, 'box_contents', []),
    images: parseImages(node.images.edges),
    videos: parseVideos(node.media),
    ...(parseMetafield(mf, 'mood_image_url') ? { moodImageUrl: parseMetafield(mf, 'mood_image_url') } : {}),
    dealPrice: parseFloat(variant?.price.amount ?? '0'),
    msrp: parseFloat(parseMetafield(mf, 'original_price') || (variant?.compareAtPrice?.amount ?? '0')),
    wholesaleCost: parseFloat(parseMetafield(mf, 'wholesale_cost') || '0'),
    mapPrice: parseFloat(parseMetafield(mf, 'map_price') || '0'),
    brand: node.vendor,
    category: parseCategory(parseMetafield(mf, 'category')),
    qty: variant?.quantityAvailable ?? 0,
    tags: node.tags ?? [],
    accessoryProductIds: parseMetafieldJSON<string[]>(mf, 'accessory_product_ids', []),
    ...(((): { specifications?: string[] } => {
      const bullets = parseSpecificationsBullets(parseMetafield(mf, 'specifications'))
      return bullets.length > 0 ? { specifications: bullets } : {}
    })()),
    metaDescription: parseMetafield(mf, 'seo_meta_description'),
    ...(parseMetafield(mf, 'original_description') ? { rawDescription: parseMetafield(mf, 'original_description') } : {}),
    ...(parseMetafield(mf, 'deal_score') ? { dealScore: parseFloat(parseMetafield(mf, 'deal_score')) } : {}),
    ...(parseMetafield(mf, 'nalpac_sku') ? { nalpacSku: parseMetafield(mf, 'nalpac_sku') } : {}),
    variantId: variant?.id ?? '',
    variants: node.variants.edges.map(e => ({
      id: e.node.id,
      title: e.node.title,
      selectedOptions: e.node.selectedOptions,
      ...(e.node.image ? { image: { url: e.node.image.url, altText: e.node.image.altText ?? '' } } : {}),
      price: e.node.price.amount,
      compareAtPrice: e.node.compareAtPrice?.amount ?? null,
      availableForSale: e.node.availableForSale,
      quantityAvailable: e.node.quantityAvailable,
      ...(e.node.barcode ? { barcode: e.node.barcode } : {}),
      ...(e.node.metafields?.[0]?.value ? { originalDescription: e.node.metafields[0].value } : {}),
    })),
    options: node.options,
    // rating populated by Judge.me integration — omitted until available
    // v2 metafields
    ...(mapRestrictedRaw === 'true' ? { mapRestricted: true } : {}),
    ...(heroVideo?.src && typeof heroVideo.duration === 'number'
      ? { heroVideo: { src: heroVideo.src, duration: heroVideo.duration, ...(heroVideo.poster ? { poster: heroVideo.poster } : {}) } }
      : {}),
    ...(moodTags.length     > 0 ? { moodTags }     : {}),
    ...(audienceTags.length > 0 ? { audienceTags } : {}),
    ...(mattersTags.length  > 0 ? { mattersTags }  : {}),
    ...(productTypeDial ? { productTypeDial } : {}),
    ...(sensationDial && Object.keys(sensationDial).length > 0 ? { sensationDial } : {}),
    ...(sensationDialV2 ? { sensationDialV2 } : {}),
    ...(careInstructions ? { careInstructions } : {}),
    ...(node.descriptionHtml ? { descriptionHtml: node.descriptionHtml } : {}),
    ...(pairingWhy    && Object.keys(pairingWhy).length > 0    ? { pairingWhy } : {}),
    ...(emmaHero?.headline && emmaHero?.variant
      ? { emmaHero: emmaHero as import('~/types').EmmaHeroCopy }
      : {}),
    ...(quietEndorsementCopy?.eyebrow && quietEndorsementCopy?.body && quietEndorsementCopy?.bannerHeadline
      ? { quietEndorsementCopy: quietEndorsementCopy as import('~/types').QuietEndorsementCopy }
      : {}),
    ...(pairBundleCopy?.headline && pairBundleCopy?.pairedHandle
      ? { pairBundleCopy: pairBundleCopy as import('~/types').PairBundleCopy }
      : {}),
    ...(endorsementCopy?.quote && endorsementCopy?.emmaIntro
      ? { endorsementCopy: endorsementCopy as import('~/types').EndorsementCopy }
      : {}),
    ...(sellingPlanGroups && sellingPlanGroups.length > 0 ? { sellingPlanGroups } : {}),
    ...(node.collections?.edges?.length
      ? { collections: node.collections.edges.map(e => ({ handle: e.node.handle, title: e.node.title })) }
      : {}),
    ...(node.createdAt ? { createdAt: node.createdAt } : {}),
    ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * The product Emma is currently featuring, in full.
 *
 * Source of truth is the Sanity hero singleton the homepage team maintains
 * (`singleton.emmaHeroStorefront.featuredProductHandle`). It used to be the
 * `deal-status-live` Shopify tag, set by the midnight daily-deal rotator —
 * that rotator is retired, so the tag is never written and would be a
 * permanently-empty source.
 *
 * Sanity is imported dynamically to keep this module free of a static
 * shopify -> sanity edge.
 */
export async function getFeaturedProductHandle(): Promise<string | null> {
  try {
    const { getEmmaHeroSettings } = await import('./sanity.server')
    const hero = await getEmmaHeroSettings()
    return hero?.featuredProductHandle ?? null
  } catch (err) {
    console.error('[shopify] getFeaturedProductHandle failed:', err)
    return null
  }
}

export async function getDailyDeal(): Promise<Deal | null> {
  const handle = await getFeaturedProductHandle()
  if (!handle) return null

  const data = await storefront<{ product: ShopifyProductNode | null }>(`
    query GetFeaturedProduct($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
    }
  `, { handle })
  if (!data.product) return null
  return nodeToDeal(data.product)
}

/** Lightweight: only the featured product's handle. Used by PLPs to flag tiles. */
export async function getLiveDealHandle(): Promise<string | null> {
  return getFeaturedProductHandle()
}

export async function getProductByHandle(handle: string): Promise<Product | null> {
  return cached(`shopify:p:${handle}`, READ_TTL, async () => {
    const data = await storefront<{ product: ShopifyProductNode | null }>(`
      query GetProduct($handle: String!) {
        product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
      }
    `, { handle })
    if (!data.product) return null
    return nodeToProduct(data.product)
  })
}

/**
 * Fetch just the Shopify handle for a numeric product ID. Lightweight GET.
 * Returns null if the product no longer exists.
 */
export async function getProductHandleById(numericId: string): Promise<string | null> {
  const id = String(numericId).replace('gid://shopify/Product/', '')
  try {
    const { product } = await shopifyAdmin<{ product: { id: number; handle: string } | null }>(
      `/products/${id}.json?fields=id,handle`,
    )
    return product?.handle ?? null
  } catch {
    return null
  }
}

/**
 * Fetch a deal by numeric Shopify product ID via Admin REST (no CDN cache).
 * Used by admin pages and homepage so they always reflect current state.
 */
export async function getDealByShopifyId(numericId: string): Promise<Deal | null> {
  const id = numericId.replace('gid://shopify/Product/', '')
  return cached(`shopify:deal:byid:${id}`, READ_TTL, () => getDealByShopifyIdUncached(id))
}

async function getDealByShopifyIdUncached(id: string): Promise<Deal | null> {

  interface RestVariant {
    id: number; title: string; price: string; compare_at_price: string | null
    inventory_quantity: number; option1: string | null; option2: string | null; option3: string | null
    image_id: number | null
    barcode: string | null
  }
  interface RestImage { id: number; src: string; alt: string | null }
  interface RestOption { name: string; values: string[] }
  interface RestProduct {
    id: number; handle: string; title: string; vendor: string; tags: string
    body_html: string
    images: RestImage[]
    options: RestOption[]
    variants: RestVariant[]
  }
  interface RestMetafield { key: string; value: string }

  const [{ product }, { metafields: xdipxMF }, { metafields: customMF }] = await Promise.all([
    shopifyAdmin<{ product: RestProduct | null }>(`/products/${id}.json`),
    shopifyAdmin<{ metafields: RestMetafield[] }>(`/products/${id}/metafields.json?namespace=xdipx&limit=50`),
    shopifyAdmin<{ metafields: RestMetafield[] }>(`/products/${id}/metafields.json?namespace=custom&limit=50`),
  ])

  if (!product) return null

  // Fetch videos via Storefront API (REST API doesn't expose media)
  interface StorefrontMediaNode {
    mediaContentType: string
    previewImage?: { url: string }
    sources?: { url: string; mimeType: string; height: number; width: number }[]
  }
  const storefrontMedia = await storefront<{ product: { media: { edges: { node: StorefrontMediaNode }[] } } | null }>(`
    query GetProductMedia($handle: String!) {
      product(handle: $handle) {
        media(first: 15) {
          edges {
            node {
              mediaContentType
              ... on Video {
                previewImage { url }
                sources { url mimeType height width }
              }
            }
          }
        }
      }
    }
  `, { handle: product.handle }).catch(() => ({ product: null }))

  const videos: ProductVideo[] = (storefrontMedia.product?.media.edges ?? [])
    .filter(e => e.node.mediaContentType === 'VIDEO' && e.node.previewImage && e.node.sources?.length)
    .map(e => ({
      previewImageUrl: e.node.previewImage!.url,
      sources: e.node.sources!.map(s => ({ url: fixVideoCdnUrl(s.url), mimeType: s.mimeType })),
    }))

  const mf = [...(xdipxMF ?? []), ...(customMF ?? [])]
  const mfVal = (key: string) => mf.find(m => m.key === key)?.value ?? ''
  const mfJSON = <T>(key: string, fallback: T): T => {
    const raw = mfVal(key)
    if (!raw) return fallback
    try { return JSON.parse(raw) as T } catch { return fallback }
  }

  // Emma hero copy (Claude-generated on deal activation). Only populated when
  // both the variant and headline are present — otherwise we let the route
  // fall through to the Sanity/default hero copy.
  const emmaHeroRaw = mfJSON<Partial<import('~/types').EmmaHeroCopy>>('emma_hero', {})
  const emmaHero = emmaHeroRaw?.headline && emmaHeroRaw?.variant
    ? (emmaHeroRaw as import('~/types').EmmaHeroCopy)
    : null
  const quietEndorsementCopyRaw = mfJSON<Partial<import('~/types').QuietEndorsementCopy>>('quiet_endorsement_copy', {})
  const quietEndorsementCopy = quietEndorsementCopyRaw?.eyebrow && quietEndorsementCopyRaw?.body && quietEndorsementCopyRaw?.bannerHeadline
    ? (quietEndorsementCopyRaw as import('~/types').QuietEndorsementCopy)
    : null
  const pairBundleCopyRaw = mfJSON<Partial<import('~/types').PairBundleCopy>>('pair_bundle_copy', {})
  const pairBundleCopy = pairBundleCopyRaw?.headline && pairBundleCopyRaw?.pairedHandle
    ? (pairBundleCopyRaw as import('~/types').PairBundleCopy)
    : null
  const endorsementCopyRaw = mfJSON<Partial<import('~/types').EndorsementCopy>>('endorsement_copy', {})
  const endorsementCopy = endorsementCopyRaw?.quote && endorsementCopyRaw?.emmaIntro
    ? (endorsementCopyRaw as import('~/types').EndorsementCopy)
    : null
  const mapRestricted = mfVal('map_restricted') === 'true'

  // v2 dial + care
  const productTypeDialAdmin = mfVal('product_type_dial') as ProductTypeDial | ''
  const legacyDialAdmin = mfJSON<SensationDial>('sensation_dial', {} as SensationDial)
  const sensationDialV2Admin =
    normalizeSensationDialV2(mfJSON<unknown>('sensation_dial_v2', null))
    ?? projectLegacyDial(Object.keys(legacyDialAdmin).length > 0 ? legacyDialAdmin : undefined)
  const careInstructionsAdmin = normalizeCareInstructions(mfJSON<unknown>('care_instructions', null))
  const pairingWhyAdmin = mfJSON<Record<string, string>>('pairing_why', {})

  const variant = product.variants[0]
  const gid = `gid://shopify/Product/${product.id}`

  return {
    id: gid,
    shopifyProductId: gid,
    sku: mfVal('nalpac_sku'),
    handle: product.handle,
    seoTitle: product.title,
    tagline: mfVal('tagline'),
    fullStory: mfVal('full_story') || product.body_html,
    worksForHim: mfVal('works_for_him'),
    worksForHer: mfVal('works_for_her'),
    boxContents: mfJSON<string[]>('box_contents', []),
    images: product.images.map(img => ({ url: img.src, altText: img.alt ?? '' })),
    videos,
    ...(mfVal('mood_image_url') ? { moodImageUrl: mfVal('mood_image_url') } : {}),
    dealPrice: parseFloat(variant?.price ?? '0'),
    msrp: parseFloat(mfVal('original_price') || (variant?.compare_at_price ?? '0')),
    wholesaleCost: parseFloat(mfVal('wholesale_cost') || '0'),
    mapPrice: parseFloat(mfVal('map_price') || '0'),
    brand: product.vendor,
    category: parseCategory(mfVal('category')),
    qty: variant?.inventory_quantity ?? 0,
    tags: product.tags ? product.tags.split(', ').filter(Boolean) : [],
    accessoryProductIds: mfJSON<string[]>('accessory_product_ids', []),
    ...(((): { specifications?: string[] } => {
      const bullets = parseSpecificationsBullets(mfVal('specifications'))
      return bullets.length > 0 ? { specifications: bullets } : {}
    })()),
    metaDescription: mfVal('seo_meta_description'),
    ...(mfVal('original_description') ? { rawDescription: mfVal('original_description') } : {}),
    ...(mfVal('deal_score') ? { dealScore: parseFloat(mfVal('deal_score')) } : {}),
    ...(mfVal('nalpac_sku') ? { nalpacSku: mfVal('nalpac_sku') } : {}),
    ...(emmaHero ? { emmaHero } : {}),
    ...(quietEndorsementCopy ? { quietEndorsementCopy } : {}),
    ...(pairBundleCopy ? { pairBundleCopy } : {}),
    ...(endorsementCopy ? { endorsementCopy } : {}),
    ...(productTypeDialAdmin ? { productTypeDial: productTypeDialAdmin } : {}),
    ...(Object.keys(legacyDialAdmin).length > 0 ? { sensationDial: legacyDialAdmin } : {}),
    ...(sensationDialV2Admin ? { sensationDialV2: sensationDialV2Admin } : {}),
    ...(careInstructionsAdmin ? { careInstructions: careInstructionsAdmin } : {}),
    ...(pairingWhyAdmin && Object.keys(pairingWhyAdmin).length > 0 ? { pairingWhy: pairingWhyAdmin } : {}),
    ...(product.body_html ? { descriptionHtml: product.body_html } : {}),
    mapRestricted,
    variantId: variant ? `gid://shopify/ProductVariant/${variant.id}` : '',
    variants: product.variants.map(v => {
      // Reconstruct selectedOptions from option1/option2/option3 + product.options
      const selectedOptions: { name: string; value: string }[] = []
      const optionSlots = [v.option1, v.option2, v.option3]
      product.options.forEach((opt, i) => {
        const val = optionSlots[i]
        if (val) selectedOptions.push({ name: opt.name, value: val })
      })
      // Find variant image from product images
      const variantImage = v.image_id
        ? product.images.find(img => img.id === v.image_id)
        : undefined
      return {
        id: `gid://shopify/ProductVariant/${v.id}`,
        title: v.title,
        selectedOptions,
        ...(variantImage ? { image: { url: variantImage.src, altText: variantImage.alt ?? '' } } : {}),
        price: v.price,
        compareAtPrice: v.compare_at_price,
        availableForSale: (v.inventory_quantity ?? 0) > 0,
        quantityAvailable: v.inventory_quantity ?? 0,
        ...(v.barcode ? { barcode: v.barcode } : {}),
      }
    }),
    options: product.options,
  }
}

/** Wall-clock budget for the single-product Storefront lookup. */
const DEAL_FETCH_TIMEOUT_MS = 5000

export async function getDealByHandle(handle: string): Promise<Deal | null> {
  return cached(`shopify:deal:byhandle:${handle}`, READ_TTL, async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new StorefrontUnavailableError(
          `product lookup timed out after ${DEAL_FETCH_TIMEOUT_MS}ms`, handle,
        )),
        DEAL_FETCH_TIMEOUT_MS,
      )
    })
    const fetch = storefront<{ product: ShopifyProductNode | null }>(`
      query GetDealByHandle($handle: String!) {
        product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
      }
    `, { handle }).catch((err: unknown) => {
      throw new StorefrontUnavailableError(
        err instanceof Error ? err.message : String(err), handle, err,
      )
    })
    try {
      const result = await Promise.race([fetch, timeout])
      // Shopify answered and has no such product: a real, cacheable 404.
      if (!result.product) return null
      return nodeToDeal(result.product)
    } finally {
      // The old code left this timer pending for the full 5s on every hit,
      // which keeps a serverless invocation alive past its own response.
      if (timer) clearTimeout(timer)
    }
  })
}

/**
 * Is any variant of this product available for sale, right now?
 *
 * Accepts either a bare numeric Shopify product id or a full
 * `gid://shopify/Product/...` string (normalized internally). Returns `null`
 * when the product does not resolve on the Storefront API at all (archived,
 * draft, deleted, or an unknown id) — distinct from "every variant is out of
 * stock" and, like `isProductSellable` in social-publish-gate.server.ts,
 * something callers should treat as unverifiable and fail closed on, not as
 * in-stock by default.
 *
 * Used by the social-publish stock guard (ticket #2212) to re-check a linked
 * product at actual publish time, independent of any gate-time snapshot.
 */
export async function isProductAvailableForSaleById(shopifyProductId: string): Promise<boolean | null> {
  const gid = shopifyProductId.startsWith('gid://')
    ? shopifyProductId
    : `gid://shopify/Product/${shopifyProductId}`
  const [product] = await getProductsByIds([gid])
  if (!product) return null
  return product.variants.some(v => v.availableForSale)
}

export async function getProductsByIds(ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return []
  // `nodes` yields null for any id the Storefront API cannot resolve, which is
  // what a deleted or unpublished product looks like once something still holds
  // its gid. Accessory and pairing metafields hold exactly those gids and are
  // never cleaned up when a product goes away, so an unguarded `n.__typename`
  // threw and took the whole PDP down with a 500. It was doing that in
  // production on /products/diy-vibrating-dildo-kit-light-skin-tone.
  const data = await storefront<{ nodes: (({ __typename: string } & ShopifyProductNode) | null)[] }>(`
    query GetProductsByIds($ids: [ID!]!) {
      nodes(ids: $ids) {
        __typename
        ... on Product { ${PRODUCT_CORE_FRAGMENT} }
      }
    }
  `, { ids })
  return (data.nodes ?? [])
    .filter((n): n is { __typename: string } & ShopifyProductNode => n?.__typename === 'Product')
    .map(n => nodeToProduct(n))
}

export async function getProductsByTag(tag: string, limit = 6): Promise<Product[]> {
  return cached(`shopify:tag:${tag}:${limit}`, READ_TTL, async () => {
    const data = await storefront<{
      products: { edges: { node: ShopifyProductNode }[] }
    }>(`
      query GetProductsByTag($query: String!, $first: Int!) {
        products(first: $first, query: $query) {
          edges { node { ${PRODUCT_CORE_FRAGMENT} } }
        }
      }
    `, {
      // The tag value MUST be quoted. Our taxonomy tags are namespaced with a
      // colon ("brand:shots", "section:play"), and Shopify's search parser
      // reads an unquoted colon as a field separator, so `tag:brand:shots`
      // silently matched nothing. That broke the cold-start recommendation
      // fallback on every PDP, since `tags[0]` is always the `brand:` tag.
      // Verified 2026-07-27 against the live Storefront API: quoting fixes
      // `brand:*` and `section:*` (0 -> 5 results) and regresses nothing.
      query: `tag:${JSON.stringify(tag)}`,
      first: limit,
    })
    return data.products.edges.map(e => nodeToProduct(e.node))
  })
}

/**
 * Newest-updated products, no tag filter. The broad evergreen fallback pool for
 * callers that need "some real products" when a narrower query comes up short.
 *
 * Replaces the old `tag:deal-status-archived` (vault) fallback, which only ever
 * matched products that had cycled through the retired daily-deal rotation.
 */
export async function getRecentProducts(limit = 40): Promise<Product[]> {
  return cached(`shopify:recent:${limit}`, READ_TTL, async () => {
    const data = await storefront<{
      products: { edges: { node: ShopifyProductNode }[] }
    }>(`
      query GetRecentProducts($first: Int!) {
        products(first: $first, sortKey: UPDATED_AT, reverse: true) {
          edges { node { ${PRODUCT_CORE_FRAGMENT} } }
        }
      }
    `, { first: limit })
    return data.products.edges.map(e => nodeToProduct(e.node))
  })
}

/**
 * Union loader for body-routed pages (/for-him, /for-her). Implements the
 * Phase 7a.2 union-logic contract from TAXONOMY_SPEC v2.2 §7: filter by
 * product_type ∈ types OR tag:{tag}. Keeps the legacy tag branch live while
 * the new type-driven mapping is applied; once 7c drops, the tag branch can
 * be removed.
 *
 * Types are matched verbatim against Shopify's product_type field
 * (e.g., "Stroker", "Cock Ring"). Use the spec §5 Type sets.
 */
export async function getProductsByTypesOrTag(
  types: readonly string[],
  tag: string,
  limit = 6,
): Promise<Product[]> {
  const typesKey = [...types].sort().join('|')
  return cached(`shopify:types-or-tag:${typesKey}:${tag}:${limit}`, READ_TTL, async () => {
    const sanitize = (s: string) => s.replace(/[:()*"]/g, '').trim()
    const typeClauses = types
      .map(sanitize)
      .filter(Boolean)
      .map(t => `product_type:"${t}"`)
    const tagClause = `tag:${sanitize(tag)}`
    const query = `(${[...typeClauses, tagClause].join(' OR ')})`

    const data = await storefront<{
      products: { edges: { node: ShopifyProductNode }[] }
    }>(`
      query GetProductsForBodyRoute($query: String!, $first: Int!) {
        products(first: $first, query: $query) {
          edges { node { ${PRODUCT_CORE_FRAGMENT} } }
        }
      }
    `, { query, first: limit })

    // De-dupe in case the same product matches both branches.
    const seen = new Set<string>()
    const products: Product[] = []
    for (const edge of data.products.edges) {
      const p = nodeToProduct(edge.node)
      if (seen.has(p.id)) continue
      seen.add(p.id)
      products.push(p)
    }
    return products
  })
}

export async function getCollectionProducts(handle: string, limit = 8): Promise<Product[]> {
  return cached(`shopify:col:${handle}:${limit}`, READ_TTL, async () => {
    const data = await storefront<{
      collection: { products: { edges: { node: ShopifyProductNode }[] } } | null
    }>(`
      query GetCollectionProducts($handle: String!, $first: Int!) {
        collection(handle: $handle) {
          products(first: $first, sortKey: MANUAL) {
            edges { node { ${PRODUCT_CORE_FRAGMENT} } }
          }
        }
      }
    `, { handle, first: limit })
    return (data.collection?.products.edges ?? []).map(e => nodeToProduct(e.node))
  })
}

export async function getProductsByHandles(handles: string[]): Promise<Product[]> {
  if (handles.length === 0) return []
  const results = await Promise.all(handles.map(h => getProductByHandle(h)))
  return results.filter((p): p is Product => p !== null)
}

// ─── Curated upsell attach source (SMS/voice UPSELL stage) ────────────────────

export interface CuratedUpsellCandidate {
  handle: string
  title: string
  price: number
  /** True when at least one variant is purchasable. */
  inStock: boolean
  /**
   * Emma-voice pairing blurb from the PITCHED product's xdipx.pairing_why,
   * correlated to this accessory by GID — the same key the PDP Pairs-with grid
   * reads (`deal.pairingWhy?.[p.id]`). Undefined when the pitched product has no
   * authored blurb for this accessory.
   */
  pairingWhy?: string
}

export interface CuratedUpsellData {
  /** Pitched product's lowercased Shopify tags — the UPSELL handler classifies
   *  the category-aware lube fallback from these. Empty when the product could
   *  not be resolved. */
  pitchedTags: string[]
  /** Pitched product's xdipx.product_type_dial, when set. */
  pitchedTypeDial?: string
  /** Curated accessories from the pitched product's xdipx.accessory_product_ids,
   *  in curation order, each correlated to its pairing_why blurb. */
  candidates: CuratedUpsellCandidate[]
}

/**
 * Curated attach source for the deterministic UPSELL stage (#3516).
 *
 * The pitched product's own `xdipx.accessory_product_ids` (hand-curated by
 * editorial) are the primary upsell candidates, each correlated to the pitched
 * product's `xdipx.pairing_why` blurb by GID so Emma can speak the curated
 * pairing rationale instead of a generic template. Also returns the pitched
 * product's tags and type dial so the caller can pick a category-aware lube
 * fallback when no curated accessory is available (never anal lube for a
 * non-anal pitch — the production failure this replaces).
 *
 * Degrades gracefully: an unresolved product or a resolver failure returns
 * empty candidates so the caller falls back to category search. Never throws.
 */
export async function getCuratedUpsellCandidates(pitchedHandle: string): Promise<CuratedUpsellData> {
  const empty: CuratedUpsellData = { pitchedTags: [], candidates: [] }
  try {
    const deal = await getDealByHandle(pitchedHandle)
    if (!deal) return empty

    const base: CuratedUpsellData = {
      pitchedTags: deal.tags.map((t) => t.toLowerCase()),
      candidates: [],
      ...(deal.productTypeDial ? { pitchedTypeDial: deal.productTypeDial } : {}),
    }

    if (deal.accessoryProductIds.length === 0) return base

    const pairing = deal.pairingWhy ?? {}
    const products = await getProductsByIds(deal.accessoryProductIds)
    base.candidates = products.map((p) => {
      const candidate: CuratedUpsellCandidate = {
        handle: p.handle,
        title: p.title,
        price: p.price,
        inStock: (p.variants ?? []).some((v) => v.availableForSale),
      }
      const blurb = pairing[p.id]
      if (blurb && blurb.trim()) candidate.pairingWhy = blurb.trim()
      return candidate
    })
    return base
  } catch (err) {
    console.error('[shopify] getCuratedUpsellCandidates failed for', pitchedHandle, err)
    return empty
  }
}

export interface PairingCandidate {
  productId:       string  // GID
  handle:          string
  title:           string
  brand?:          string
  productTypeDial?: string
  category?:       string
  price:           number
  image?:          string
}

/**
 * Resolve up to 3 pairing-candidate sibling products for a freshly-imported
 * product. Used by the orchestrator's `proposePairingWhy` tool so Emma can
 * write per-accessory copy without needing the product to be in a curated
 * collection yet.
 *
 * Strategy (in order — first non-empty wins):
 *   1. Same primary collection (manual sort, first 6 minus self)
 *   2. Same `category` tag (e.g. for-her, couples) — Shopify tag query
 *   3. Same `cat:` sub-category tag (legacy seed)
 *
 * Excludes the product itself. Returns up to `limit` candidates (default 3).
 */
export async function getPairingCandidates(opts: {
  shopifyProductId: string
  /** Phase 2 — accepts the multi-select array. The function picks a primary
   *  category for shopify-tag filtering. */
  category?:        ReadonlyArray<'for-him' | 'for-her' | 'couples'> | string
  primaryCollectionHandle?: string
  subCategories?:   string[]
  limit?:           number
}): Promise<PairingCandidate[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 3, 8))
  const selfId = opts.shopifyProductId.replace('gid://shopify/Product/', '')
  const seen = new Set<string>([selfId])

  const toCandidate = (p: Product): PairingCandidate | null => {
    const numericId = p.id.replace('gid://shopify/Product/', '')
    if (seen.has(numericId)) return null
    seen.add(numericId)
    const candidate: PairingCandidate = {
      productId: p.id,
      handle:    p.handle,
      title:     p.title,
      price:     p.price,
    }
    if (p.brand)              candidate.brand           = p.brand
    if (p.category)           candidate.category        = p.category
    if (p.images?.[0]?.url)   candidate.image           = p.images[0].url
    return candidate
  }

  // 1. Primary collection
  const out: PairingCandidate[] = []
  if (opts.primaryCollectionHandle) {
    try {
      const inCollection = await getCollectionProducts(opts.primaryCollectionHandle, 6)
      for (const p of inCollection) {
        const c = toCandidate(p)
        if (c) out.push(c)
        if (out.length >= limit) return out
      }
    } catch { /* fall through */ }
  }

  // 2. Category tag — broad, evergreen pool. Phase 2 — accepts an array;
  // pick the first entry as the primary tag for Shopify-tag filtering.
  const primaryCategoryTag = Array.isArray(opts.category) ? opts.category[0] : opts.category
  if (out.length < limit && primaryCategoryTag) {
    try {
      const byCategory = await getProductsByTag(primaryCategoryTag, 8)
      for (const p of byCategory) {
        const c = toCandidate(p)
        if (c) out.push(c)
        if (out.length >= limit) return out
      }
    } catch { /* fall through */ }
  }

  // 3. Sub-category tags — narrow but more specific
  if (out.length < limit) {
    for (const sub of (opts.subCategories ?? []).slice(0, 3)) {
      try {
        const slug = sub.toLowerCase().replace(/\s+/g, '-')
        const bySub = await getProductsByTag(`cat:${slug}`, 6)
        for (const p of bySub) {
          const c = toCandidate(p)
          if (c) out.push(c)
          if (out.length >= limit) return out
        }
      } catch { /* fall through */ }
    }
  }

  return out
}

/** Storefront pages of 250 to walk before giving up. ~2x the current catalog. */
const CATALOG_PAGE_CAP = 40

/**
 * Handles that /products/$slug will actually serve a 200 for.
 *
 * The sitemap's product list comes from Sanity `productPage` docs, but the PDP
 * route resolves against Shopify: a handle the Storefront API does not return
 * 404s. Nothing reconciled the two, so the sitemap shipped URLs that were dead
 * on arrival: 183 of them on 2026-07-29. That is crawl budget spent to learn
 * nothing on a property with very little of it, and every dead entry costs the
 * sitemap some of the trust that makes the rest worth crawling.
 *
 * The Storefront API is now the only gate. There used to be a second one —
 * `deal_status === 'archived'` — which suppressed 17 active, sellable products
 * from the sitemap because they had once been daily deals.
 *
 * Deliberately not routed through cached(): the result is a ~4,500-entry set,
 * and KV is the wrong home for a payload that size (the sitemap module keeps
 * its assembled URL set in-process for the same reason). buildSitemapSegments
 * memoizes the whole assembly for an hour, which is the caching that matters.
 */
export async function getIndexableProductHandles(): Promise<Set<string>> {
  const handles = new Set<string>()
  let cursor: string | null = null

  for (let page = 0; page < CATALOG_PAGE_CAP; page++) {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        edges: Array<{ node: { handle: string } }>
      }
    } = await storefront(`
      query IndexableProductHandles($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          edges {
            node { handle }
          }
        }
      }
    `, { first: 250, after: cursor })

    for (const edge of data.products.edges) {
      handles.add(edge.node.handle)
    }

    if (!data.products.pageInfo.hasNextPage) return handles
    cursor = data.products.pageInfo.endCursor
    if (!cursor) return handles
  }

  // Only reachable if the catalog outgrew the cap. Returning a short set would
  // silently suppress real products, so say so loudly. The caller's drop-ratio
  // guard is what actually stops the truncated set from being used.
  console.warn(`[shopify] getIndexableProductHandles hit the ${CATALOG_PAGE_CAP}-page cap; catalog may be truncated`)
  return handles
}

export interface SitemapProductImages {
  title:  string
  images: Array<{ url: string; altText: string | null }>
}

/**
 * Bulk lightweight fetch for the XML sitemap. Returns a handle → images map
 * for every published product. Skips metafields, variants, and media to keep
 * the payload small — the sitemap only needs handle, title, and image URLs.
 * Capped at 3 images per product (primary + 2 alts) to keep the sitemap lean.
 *
 * Cached for 1 hour, matching the sitemap response cache.
 */
export async function getProductImagesForSitemap(): Promise<Map<string, SitemapProductImages>> {
  // cached() round-trips through KV as JSON, where a Map serializes to {}.
  // Cache a plain entries array and rebuild the Map on the way out. Key is
  // versioned (:v2) so instances skip the old poisoned {} entry in KV.
  const entries = await cached('shopify:sitemap:product-images:v2', 3600, async (): Promise<Array<[string, SitemapProductImages]>> => {
    const map = new Map<string, SitemapProductImages>()
    let cursor: string | null = null
    // Storefront API hard-caps `first` at 250 per page. Two pages = up to 500
    // products, plenty of headroom for the current catalog.
    for (let page = 0; page < 4; page++) {
      const data: {
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          edges: Array<{
            node: {
              handle: string
              title:  string
              images: { edges: Array<{ node: { url: string; altText: string | null } }> }
            }
          }>
        }
      } = await storefront(`
        query SitemapProductImages($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                handle
                title
                images(first: 3) { edges { node { url altText } } }
              }
            }
          }
        }
      `, { first: 250, after: cursor })

      for (const edge of data.products.edges) {
        const images = edge.node.images.edges.map(e => ({
          url:     e.node.url,
          altText: e.node.altText ?? null,
        }))
        map.set(edge.node.handle, { title: edge.node.title, images })
      }

      if (!data.products.pageInfo.hasNextPage) break
      cursor = data.products.pageInfo.endCursor
      if (!cursor) break
    }
    return Array.from(map.entries())
  })
  return new Map(entries)
}

export interface SitemapCollection {
  handle:    string
  updatedAt: string
  image?:    { url: string; altText: string | null } | null
}

export interface CollectionMeta {
  id:              string
  handle:          string
  title:           string
  description:     string
  descriptionHtml: string
  seoTitle:        string | null
  seoDescription:  string | null
  image:           { url: string; altText: string | null; width: number | null; height: number | null } | null
  updatedAt:       string
  productsCount:   number | null
}

/**
 * Fetch full collection metadata for SEO + PLP rendering. Returns null if the
 * collection is unpublished or does not exist (loader translates that to a
 * 404). Cached for the same READ_TTL as products so admin edits surface
 * within ~60s.
 */
export async function getCollection(handle: string): Promise<CollectionMeta | null> {
  return cached(`shopify:col-meta:${handle}`, READ_TTL, async () => {
    const data = await storefront<{
      collection: {
        id:              string
        handle:          string
        title:           string
        description:     string
        descriptionHtml: string
        updatedAt:       string
        seo:             { title: string | null; description: string | null }
        image:           { url: string; altText: string | null; width: number | null; height: number | null } | null
        products:        { edges: { node: { id: string } }[]; pageInfo: { hasNextPage: boolean } }
      } | null
    }>(`
      query GetCollectionMeta($handle: String!) {
        collection(handle: $handle) {
          id
          handle
          title
          description
          descriptionHtml
          updatedAt
          seo { title description }
          image { url altText width height }
          products(first: 50) {
            pageInfo { hasNextPage }
            edges { node { id } }
          }
        }
      }
    `, { handle })

    const c = data.collection
    if (!c) return null

    const productsCount = c.products.pageInfo.hasNextPage ? null : c.products.edges.length

    return {
      id:              c.id,
      handle:          c.handle,
      title:           c.title,
      description:     c.description ?? '',
      descriptionHtml: c.descriptionHtml ?? '',
      seoTitle:        c.seo?.title ?? null,
      seoDescription:  c.seo?.description ?? null,
      image:           c.image,
      updatedAt:       c.updatedAt,
      productsCount,
    }
  })
}

/**
 * Bulk lightweight fetch for the XML sitemap. Returns every published
 * collection's handle + updatedAt so /collections/$handle URLs can be
 * advertised to Google. Cached for 1 hour, matching the sitemap response.
 */
export async function getCollectionsForSitemap(): Promise<SitemapCollection[]> {
  return cached('shopify:sitemap:collections', 3600, async () => {
    const out: SitemapCollection[] = []
    let cursor: string | null = null
    for (let page = 0; page < 4; page++) {
      const data: {
        collections: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          edges: Array<{ node: {
            handle: string
            updatedAt: string
            image: { url: string; altText: string | null } | null
          } }>
        }
      } = await storefront(`
        query SitemapCollections($first: Int!, $after: String) {
          collections(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges { node { handle updatedAt image { url altText } } }
          }
        }
      `, { first: 250, after: cursor })

      for (const edge of data.collections.edges) {
        out.push({
          handle: edge.node.handle,
          updatedAt: edge.node.updatedAt,
          image: edge.node.image,
        })
      }

      if (!data.collections.pageInfo.hasNextPage) break
      cursor = data.collections.pageInfo.endCursor
      if (!cursor) break
    }
    return out
  })
}

export async function getBonusDeal(): Promise<Product | null> {
  return cached('shopify:bonus-deal', READ_TTL, async () => {
    const data = await storefront<{
      collection: { products: { edges: { node: ShopifyProductNode }[] } } | null
    }>(`
      query GetBonusDeal {
        collection(handle: "bonus-deal") {
          products(first: 1) {
            edges { node { ${PRODUCT_CORE_FRAGMENT} } }
          }
        }
      }
    `)
    const node = data.collection?.products.edges[0]?.node
    if (!node) return null
    return nodeToProduct(node)
  })
}

// ─── GMC Feed ─────────────────────────────────────────────────────────────
//
// Separate fragment + type + mapper so the feed can fetch extra metafields
// without touching the lightweight PRODUCT_CARD_FRAGMENT used by vault/PLPs.

const GMC_FEED_METAFIELDS_FRAGMENT = `
  metafields(identifiers: [
    { namespace: "xdipx", key: "original_price" }
    { namespace: "xdipx", key: "map_price" }
    { namespace: "xdipx", key: "map_restricted" }
    { namespace: "xdipx", key: "category" }
    { namespace: "xdipx", key: "mood_tags" }
    { namespace: "xdipx", key: "audience_tags" }
    { namespace: "xdipx", key: "matters_tags" }
    { namespace: "xdipx", key: "hero_video" }
    { namespace: "xdipx", key: "seo_meta_description" }
    { namespace: "xdipx", key: "mood_image_url" }
    { namespace: "xdipx", key: "feature_bullets" }
    { namespace: "xdipx", key: "specifications" }
    { namespace: "xdipx", key: "product_type_dial" }
    { namespace: "xdipx", key: "deal_score" }
    { namespace: "xdipx", key: "nalpac_sku" }
    { namespace: "mm-google-shopping", key: "google_product_category" }
    { namespace: "mm-google-shopping", key: "age_group" }
    { namespace: "mm-google-shopping", key: "gender" }
    { namespace: "mm-google-shopping", key: "mpn" }
    { namespace: "mm-google-shopping", key: "color" }
    { namespace: "mm-google-shopping", key: "material" }
    { namespace: "mm-google-shopping", key: "size" }
    { namespace: "mm-google-shopping", key: "custom_label_0" }
    { namespace: "mm-google-shopping", key: "custom_label_1" }
    { namespace: "mm-google-shopping", key: "custom_label_2" }
    { namespace: "mm-google-shopping", key: "custom_label_3" }
    { namespace: "mm-google-shopping", key: "custom_label_4" }
  ]) {
    namespace key value
  }
`

const GMC_FEED_CARD_FRAGMENT = `
  id handle title vendor tags
  options { name values }
  images(first: 10) {
    edges { node { url altText } }
  }
  variants(first: 1) {
    edges {
      node {
        id
        price { amount }
        compareAtPrice { amount }
        quantityAvailable
        availableForSale
        barcode
      }
    }
  }
  ${GMC_FEED_METAFIELDS_FRAGMENT}
`

interface ShopifyFeedProductNode {
  id: string
  handle: string
  title: string
  vendor: string
  tags: string[]
  options?: { name: string; values: string[] }[]
  images: { edges: { node: { url: string; altText: string | null } }[] }
  variants: {
    edges: {
      node: {
        id: string
        price: { amount: string }
        compareAtPrice: { amount: string } | null
        quantityAvailable: number
        availableForSale: boolean
        barcode: string | null
      }
    }[]
  }
  metafields: ({ namespace: string; key: string; value: string } | null)[]
}

function parseMetafieldByNsKey(
  metafields: ({ namespace: string; key: string; value: string } | null)[],
  namespace: string,
  key: string,
): string | null {
  return metafields.find(m => m?.namespace === namespace && m?.key === key)?.value ?? null
}

function nodeToFeedDeal(node: ShopifyFeedProductNode): VaultDeal {
  const mf = node.metafields
  const variantEdges = node.variants.edges
  const variant = variantEdges[0]?.node
  const dealPrice = parseFloat(variant?.price.amount ?? '0')
  const moodTags     = parseMetafieldJSON<string[]>(mf, 'mood_tags',     [])
  const audienceTags = parseMetafieldJSON<string[]>(mf, 'audience_tags', [])
  const mattersTags  = parseMetafieldJSON<string[]>(mf, 'matters_tags',  [])
  const heroVideo    = parseMetafieldJSON<{ src?: string; poster?: string; duration?: number }>(mf, 'hero_video', {})

  const featureBullets = parseMetafieldJSON<string[]>(mf, 'feature_bullets', [])
  const specifications = parseMetafieldJSON<string[]>(mf, 'specifications', [])

  const variantSavings = variantEdges
    .map(e => {
      const p  = parseFloat(e.node.price.amount)
      const ca = parseFloat(e.node.compareAtPrice?.amount ?? '0')
      return ca > p && p > 0
        ? { amount: ca - p, percent: Math.round(((ca - p) / ca) * 100) }
        : null
    })
    .filter((s): s is { amount: number; percent: number } => s !== null)
  const maxSavingsAmount  = variantSavings.length > 0 ? Math.max(...variantSavings.map(s => s.amount))  : 0
  const maxSavingsPercent = variantSavings.length > 0 ? Math.max(...variantSavings.map(s => s.percent)) : 0

  // xdipx namespace
  const seoDesc       = parseMetafieldByNsKey(mf, 'xdipx', 'seo_meta_description')
  const moodImageUrl  = parseMetafieldByNsKey(mf, 'xdipx', 'mood_image_url')
  const originalPrice = parseMetafieldByNsKey(mf, 'xdipx', 'original_price')
  const mapPriceRaw   = parseMetafieldByNsKey(mf, 'xdipx', 'map_price')
  const mapPriceNum   = mapPriceRaw ? parseFloat(mapPriceRaw) : null
  const mapRestricted = parseMetafieldByNsKey(mf, 'xdipx', 'map_restricted') === 'true'
  const productTypeDial = parseMetafieldByNsKey(mf, 'xdipx', 'product_type_dial')
  const dealScoreRaw   = parseMetafieldByNsKey(mf, 'xdipx', 'deal_score')
  const dealScoreNum   = dealScoreRaw ? parseFloat(dealScoreRaw) : null
  const nalpacSku      = parseMetafieldByNsKey(mf, 'xdipx', 'nalpac_sku')

  // mm-google-shopping namespace
  const gmcCategory = parseMetafieldByNsKey(mf, 'mm-google-shopping', 'google_product_category')
  const gmcAgeGroup = parseMetafieldByNsKey(mf, 'mm-google-shopping', 'age_group')
  const gmcGender   = parseMetafieldByNsKey(mf, 'mm-google-shopping', 'gender')
  const gmcMpn      = parseMetafieldByNsKey(mf, 'mm-google-shopping', 'mpn')
  const gmcColor    = parseMetafieldByNsKey(mf, 'mm-google-shopping', 'color')
  const gmcMaterial = parseMetafieldByNsKey(mf, 'mm-google-shopping', 'material')
  const gmcSize     = parseMetafieldByNsKey(mf, 'mm-google-shopping', 'size')
  const gmcLabel0   = parseMetafieldByNsKey(mf, 'mm-google-shopping', 'custom_label_0')
  const gmcLabel1   = parseMetafieldByNsKey(mf, 'mm-google-shopping', 'custom_label_1')
  const gmcLabel2   = parseMetafieldByNsKey(mf, 'mm-google-shopping', 'custom_label_2')
  const gmcLabel3   = parseMetafieldByNsKey(mf, 'mm-google-shopping', 'custom_label_3')
  const gmcLabel4   = parseMetafieldByNsKey(mf, 'mm-google-shopping', 'custom_label_4')

  return {
    id: node.id,
    handle: node.handle,
    seoTitle: node.title,
    dealPrice,
    msrp: parseFloat(originalPrice || (variant?.compareAtPrice?.amount ?? '0')),
    images: parseImages(node.images.edges),
    brand: node.vendor,
    category: parseCategory(parseMetafield(mf, 'category')),
    qty: variant?.quantityAvailable ?? 0,
    defaultVariantId:    variant?.id ?? null,
    hasMultipleVariants: variantEdges.length > 1,
    ...(maxSavingsAmount > 0 ? { maxSavingsAmount, maxSavingsPercent } : {}),
    ...(moodTags.length     > 0 ? { moodTags }     : {}),
    ...(audienceTags.length > 0 ? { audienceTags } : {}),
    ...(mattersTags.length  > 0 ? { mattersTags }  : {}),
    ...(heroVideo?.src && typeof heroVideo.duration === 'number'
      ? { heroVideo: { src: heroVideo.src, duration: heroVideo.duration, ...(heroVideo.poster ? { poster: heroVideo.poster } : {}) } }
      : {}),
    // GMC fields
    ...(variant?.barcode != null ? { barcode: variant.barcode } : {}),
    ...(seoDesc       != null ? { seoDesc }       : {}),
    ...(moodImageUrl  != null ? { moodImageUrl }  : {}),
    ...(featureBullets.length > 0 ? { featureBullets } : {}),
    ...(specifications.length > 0 ? { specifications } : {}),
    ...(productTypeDial != null ? { productTypeDial } : {}),
    ...(originalPrice   != null ? { originalPrice }   : {}),
    ...(mapPriceNum !== null && !isNaN(mapPriceNum) ? { mapPrice: mapPriceNum } : {}),
    ...(mapRestricted ? { mapRestricted } : {}),
    ...(nalpacSku != null ? { nalpacSku } : {}),
    ...(gmcCategory  != null ? { gmcCategory }  : {}),
    ...(gmcAgeGroup  != null ? { gmcAgeGroup }  : {}),
    ...(gmcGender    != null ? { gmcGender }    : {}),
    ...(gmcMpn       != null ? { gmcMpn }       : {}),
    ...(gmcColor     != null ? { gmcColor }     : {}),
    ...(gmcMaterial  != null ? { gmcMaterial }  : {}),
    ...(gmcSize      != null ? { gmcSize }      : {}),
    ...(gmcLabel0    != null ? { gmcLabel0 }    : {}),
    ...(gmcLabel1    != null ? { gmcLabel1 }    : {}),
    ...(gmcLabel2    != null ? { gmcLabel2 }    : {}),
    ...(gmcLabel3    != null ? { gmcLabel3 }    : {}),
    ...(gmcLabel4    != null ? { gmcLabel4 }    : {}),
    ...(dealScoreNum !== null && !isNaN(dealScoreNum) ? { dealScore: dealScoreNum } : {}),
  }
}

export async function getFeedDeals(after: string | null = null, limit = 50): Promise<{ deals: VaultDeal[]; hasNextPage: boolean; endCursor: string | null }> {
  const data = await storefront<{
    products: {
      edges: { node: ShopifyFeedProductNode }[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    }
  }>(`
    query GetFeedPage($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        edges {
          node { ${GMC_FEED_CARD_FRAGMENT} }
        }
      }
    }
  `, { first: limit, after })

  return {
    deals: data.products.edges.map(e => nodeToFeedDeal(e.node)),
    hasNextPage: data.products.pageInfo.hasNextPage,
    endCursor: data.products.pageInfo.endCursor,
  }
}

// ─── GMC Feed — full catalog (lean) ───────────────────────────────────────
//
// The deal entries above carry the full GMC treatment (highlights, specs,
// custom labels). The rest of the ~4k-product catalog goes into the feed with
// a lean per-item shape so the response stays a manageable size for agentic
// shopping crawlers.

export interface FeedCatalogProduct {
  id:              string
  handle:          string
  title:           string
  brand:           string
  /** Plain-text description, truncated at fetch time to keep the feed lean. */
  description:     string
  imageUrl:        string | null
  availableForSale: boolean
  price:           number
  compareAtPrice:  number | null
  barcode:         string | null
  /** xdipx.original_price — regular price if the current price is a markdown. */
  originalPrice:   number | null
  /** xdipx.map_price — 0/null means no MAP constraint. */
  mapPrice:        number | null
  /** xdipx.map_restricted — true suppresses any advertised-discount framing. */
  mapRestricted:   boolean
  productTypeDial: string | null
  gmcCategory:     string | null
  /** xdipx.nalpac_sku — g:mpn fallback when no barcode/GTIN exists. */
  nalpacSku:       string | null
  /** xdipx.specifications — JSON array of "Label: Value" strings. */
  specifications:  string[]
  /** mm-google-shopping.mpn — explicit override, preferred over nalpacSku. */
  gmcMpn:          string | null
  gmcColor:        string | null
  gmcMaterial:     string | null
  gmcSize:         string | null
}

export async function getFeedCatalogProducts(): Promise<FeedCatalogProduct[]> {
  const out: FeedCatalogProduct[] = []
  let cursor: string | null = null
  // 250 per page (Storefront API cap) × 40 pages = 10k product headroom.
  for (let page = 0; page < 40; page++) {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        edges: Array<{ node: {
          id:            string
          handle:        string
          title:         string
          vendor:        string
          description:   string
          featuredImage: { url: string } | null
          variants: { edges: Array<{ node: {
            price:            { amount: string }
            compareAtPrice:   { amount: string } | null
            availableForSale: boolean
            barcode:          string | null
          } }> }
          metafields: ({ namespace: string; key: string; value: string } | null)[]
        } }>
      }
    } = await storefront(`
      query FeedCatalog($first: Int!, $after: String) {
        products(first: $first, after: $after, query: "available_for_sale:true") {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              handle
              title
              vendor
              description(truncateAt: 600)
              featuredImage { url }
              variants(first: 1) {
                edges { node { price { amount } compareAtPrice { amount } availableForSale barcode } }
              }
              metafields(identifiers: [
                { namespace: "xdipx", key: "original_price" }
                { namespace: "xdipx", key: "map_price" }
                { namespace: "xdipx", key: "map_restricted" }
                { namespace: "xdipx", key: "product_type_dial" }
                { namespace: "xdipx", key: "seo_meta_description" }
                { namespace: "xdipx", key: "nalpac_sku" }
                { namespace: "xdipx", key: "specifications" }
                { namespace: "mm-google-shopping", key: "google_product_category" }
                { namespace: "mm-google-shopping", key: "mpn" }
                { namespace: "mm-google-shopping", key: "color" }
                { namespace: "mm-google-shopping", key: "material" }
                { namespace: "mm-google-shopping", key: "size" }
              ]) {
                namespace key value
              }
            }
          }
        }
      }
    `, { first: 250, after: cursor })

    for (const { node } of data.products.edges) {
      const variant = node.variants.edges[0]?.node
      if (!variant) continue
      const mf = node.metafields
      const originalPriceRaw = parseMetafieldByNsKey(mf, 'xdipx', 'original_price')
      const mapPriceRaw      = parseMetafieldByNsKey(mf, 'xdipx', 'map_price')
      const originalPrice    = originalPriceRaw ? parseFloat(originalPriceRaw) : NaN
      const mapPrice         = mapPriceRaw ? parseFloat(mapPriceRaw) : NaN
      const seoDesc          = parseMetafieldByNsKey(mf, 'xdipx', 'seo_meta_description')
      const specifications   = parseMetafieldJSON<string[]>(mf, 'specifications', [])
      out.push({
        id:               node.id,
        handle:           node.handle,
        title:            node.title,
        brand:            node.vendor,
        description:      (seoDesc ?? '').trim() || node.description,
        imageUrl:         node.featuredImage?.url ?? null,
        availableForSale: variant.availableForSale,
        price:            parseFloat(variant.price.amount),
        compareAtPrice:   variant.compareAtPrice ? parseFloat(variant.compareAtPrice.amount) : null,
        barcode:          variant.barcode,
        originalPrice:    Number.isFinite(originalPrice) ? originalPrice : null,
        mapPrice:         Number.isFinite(mapPrice) ? mapPrice : null,
        mapRestricted:    parseMetafieldByNsKey(mf, 'xdipx', 'map_restricted') === 'true',
        productTypeDial:  parseMetafieldByNsKey(mf, 'xdipx', 'product_type_dial'),
        gmcCategory:      parseMetafieldByNsKey(mf, 'mm-google-shopping', 'google_product_category'),
        nalpacSku:        parseMetafieldByNsKey(mf, 'xdipx', 'nalpac_sku'),
        specifications,
        gmcMpn:           parseMetafieldByNsKey(mf, 'mm-google-shopping', 'mpn'),
        gmcColor:         parseMetafieldByNsKey(mf, 'mm-google-shopping', 'color'),
        gmcMaterial:      parseMetafieldByNsKey(mf, 'mm-google-shopping', 'material'),
        gmcSize:          parseMetafieldByNsKey(mf, 'mm-google-shopping', 'size'),
      })
    }

    if (!data.products.pageInfo.hasNextPage) break
    cursor = data.products.pageInfo.endCursor
    if (!cursor) break
  }
  return out
}

export type CollectionSort = 'manual' | 'newest' | 'price-asc' | 'price-desc'

function sortToStorefront(sort: CollectionSort): { sortKey: string; reverse: boolean } {
  switch (sort) {
    case 'newest':     return { sortKey: 'CREATED',  reverse: true  }
    case 'price-asc':  return { sortKey: 'PRICE',    reverse: false }
    case 'price-desc': return { sortKey: 'PRICE',    reverse: true  }
    case 'manual':
    default:           return { sortKey: 'MANUAL',   reverse: false }
  }
}

export async function getCollectionDeals(
  handle: string,
  page = 1,
  limit = 20,
  sort: CollectionSort = 'manual',
): Promise<{ deals: VaultDeal[]; hasNextPage: boolean }> {
  const { sortKey, reverse } = sortToStorefront(sort)
  let after: string | null = null
  if (page > 1) {
    const cached = await kvGet<string>(KV_KEYS.collectionCursor(handle, page, sort))
    if (cached) {
      after = cached
    } else {
      for (let p = 1; p < page; p++) {
        const skip: { collection: { products: { edges: { cursor: string }[] } } | null } = await storefront<{
          collection: {
            products: { edges: { cursor: string }[] }
          } | null
        }>(`
          query SkipPage($handle: String!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys!, $reverse: Boolean!) {
            collection(handle: $handle) {
              products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
                edges { cursor }
              }
            }
          }
        `, { handle, first: limit, after, sortKey, reverse })
        const edges = skip.collection?.products.edges
        if (!edges?.length) return { deals: [], hasNextPage: false }
        after = edges[edges.length - 1]!.cursor
        await kvSet(KV_KEYS.collectionCursor(handle, p + 1, sort), after, COLLECTION_CURSOR_TTL)
      }
    }
  }

  const data = await storefront<{
    collection: {
      products: {
        pageInfo: { hasNextPage: boolean }
        edges: { cursor: string; node: ShopifyProductCardNode }[]
      }
    } | null
  }>(`
    query GetCollectionDeals($handle: String!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys!, $reverse: Boolean!) {
      collection(handle: $handle) {
        products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
          pageInfo { hasNextPage }
          edges { cursor node { ${PRODUCT_CARD_FRAGMENT} } }
        }
      }
    }
  `, { handle, first: limit, after, sortKey, reverse })

  if (!data.collection) return { deals: [], hasNextPage: false }
  return {
    deals: data.collection.products.edges.map(e => nodeToVaultDeal(e.node)),
    hasNextPage: data.collection.products.pageInfo.hasNextPage,
  }
}

// Ticket #3889: Ask Emma facets (mood/audience/matters tags, budgetMax) are
// list.text metafields. Shopify Storefront API's `productMetafield` filter on
// `collection.products(filters:)` only supports exact-value match against the
// raw metafield value — unusable for "any of these tags" list semantics or a
// numeric budget ceiling — so there is no query-level way to push these
// facets into the Shopify request. Fetching the whole collection and
// filtering server-side (instead of trusting the client to filter whatever
// single page happened to load) is the documented fallback for an
// enrichment-dependent field a query-level filter can't reach.
const COLLECTION_FULL_TTL = 300 // 5 min — matches COLLECTION_CURSOR_TTL's "stable short-term" assumption
const COLLECTION_FULL_PAGE_SIZE = 250 // Storefront API's per-request cap
const COLLECTION_FULL_MAX_PAGES = 4 // safety cap: 1000 products/collection ceiling per fetch

/**
 * Full, unpaginated product list for one collection — every product Shopify
 * has for `handle`, not just one page. KV-cached (short TTL) so a burst of
 * filtered requests against the same collection+sort pays the full-collection
 * fetch cost once per cache window rather than once per request.
 */
export async function getCollectionAllDeals(
  handle: string,
  sort: CollectionSort = 'manual',
): Promise<VaultDeal[]> {
  const cacheKey = KV_KEYS.collectionFull(handle, sort)
  const cached = await kvGet<VaultDeal[]>(cacheKey)
  if (cached) return cached

  const { sortKey, reverse } = sortToStorefront(sort)
  const out: VaultDeal[] = []
  let after: string | null = null

  for (let page = 0; page < COLLECTION_FULL_MAX_PAGES; page++) {
    const data: {
      collection: {
        products: {
          pageInfo: { hasNextPage: boolean }
          edges: { cursor: string; node: ShopifyProductCardNode }[]
        }
      } | null
    } = await storefront(`
      query GetCollectionAllDeals($handle: String!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys!, $reverse: Boolean!) {
        collection(handle: $handle) {
          products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
            pageInfo { hasNextPage }
            edges { cursor node { ${PRODUCT_CARD_FRAGMENT} } }
          }
        }
      }
    `, { handle, first: COLLECTION_FULL_PAGE_SIZE, after, sortKey, reverse })

    if (!data.collection) break
    const edges = data.collection.products.edges
    out.push(...edges.map(e => nodeToVaultDeal(e.node)))
    if (!data.collection.products.pageInfo.hasNextPage || edges.length === 0) break
    after = edges[edges.length - 1]!.cursor
  }

  await kvSet(cacheKey, out, COLLECTION_FULL_TTL)
  return out
}

/**
 * Paginated, newest-first product list scoped to a Shopify tag rather than a
 * Collection object. Powers /new (New Arrivals, tag:new-arrival) and any
 * future tag-only browse surface. Mirrors getCollectionDeals's KV cursor-skip
 * pagination (same cache-key builder, same cursor TTL), just querying the
 * top-level `products(query:)` connection instead of `collection(handle)`.
 */
export async function getProductsByTagPaged(
  tag: string,
  page = 1,
  limit = 20,
): Promise<{ deals: VaultDeal[]; hasNextPage: boolean }> {
  const query = `tag:${tag}`
  // Reuse the collection-cursor cache-key builder with a `tag:` prefixed
  // pseudo-handle so this never collides with a real collection's cursors.
  const cacheHandle = `tag:${tag}`
  const cacheSort = 'newest'

  let after: string | null = null
  if (page > 1) {
    const cachedCursor = await kvGet<string>(KV_KEYS.collectionCursor(cacheHandle, page, cacheSort))
    if (cachedCursor) {
      after = cachedCursor
    } else {
      for (let p = 1; p < page; p++) {
        const skip: { products: { edges: { cursor: string }[] } } = await storefront<{
          products: { edges: { cursor: string }[] }
        }>(`
          query SkipTagPage($query: String!, $first: Int!, $after: String) {
            products(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
              edges { cursor }
            }
          }
        `, { query, first: limit, after })
        const edges = skip.products.edges
        if (!edges.length) return { deals: [], hasNextPage: false }
        after = edges[edges.length - 1]!.cursor
        await kvSet(KV_KEYS.collectionCursor(cacheHandle, p + 1, cacheSort), after, COLLECTION_CURSOR_TTL)
      }
    }
  }

  const data = await storefront<{
    products: {
      pageInfo: { hasNextPage: boolean }
      edges: { cursor: string; node: ShopifyProductCardNode }[]
    }
  }>(`
    query GetProductsByTagPaged($query: String!, $first: Int!, $after: String) {
      products(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage }
        edges { cursor node { ${PRODUCT_CARD_FRAGMENT} } }
      }
    }
  `, { query, first: limit, after })

  return {
    deals: data.products.edges.map(e => nodeToVaultDeal(e.node)),
    hasNextPage: data.products.pageInfo.hasNextPage,
  }
}

// ─── Navigation Menu ─────────────────────────────────────────────────────

export interface ShopifyMenuItem {
  title: string
  url: string
  items: ShopifyMenuItem[]
}

export async function getMainMenu(): Promise<ShopifyMenuItem[]> {
  // Menu is site-wide — cache longer (5 min). Admin menu edits are rare.
  return cached('shopify:menu:main-menu', 300, async () => {
    const data = await storefront<{
      menu: { items: ShopifyMenuItem[] } | null
    }>(`
      query GetMenu {
        menu(handle: "main-menu") {
          items {
            title
            url
            items {
              title
              url
              items {
                title
                url
              }
            }
          }
        }
      }
    `)
    return data.menu?.items ?? []
  })
}

export interface CollectionListItem {
  handle:        string
  title:         string
  description:   string
  image:         { url: string; altText: string | null } | null
  productsCount: number | null
}

/**
 * Public Storefront-API list of every published collection — drives the
 * /collections hub PLP. Cached for 5 minutes (admin edits propagate then).
 */
export async function getCollectionList(): Promise<CollectionListItem[]> {
  return cached('shopify:collection-list:public', 300, async () => {
    const out: CollectionListItem[] = []
    let cursor: string | null = null
    for (let page = 0; page < 4; page++) {
      const data: {
        collections: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          edges: Array<{ node: {
            handle:      string
            title:       string
            description: string
            image:       { url: string; altText: string | null } | null
            products:    { edges: { node: { id: string } }[]; pageInfo: { hasNextPage: boolean } }
          } }>
        }
      } = await storefront(`
        query CollectionList($first: Int!, $after: String) {
          collections(first: $first, after: $after, sortKey: TITLE) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                handle
                title
                description
                image { url altText }
                products(first: 1) {
                  pageInfo { hasNextPage }
                  edges { node { id } }
                }
              }
            }
          }
        }
      `, { first: 100, after: cursor })

      for (const edge of data.collections.edges) {
        const n = edge.node
        // Filter out empty collections — they pollute the hub and rank poorly.
        const hasProducts = n.products.edges.length > 0 || n.products.pageInfo.hasNextPage
        if (!hasProducts) continue
        out.push({
          handle:        n.handle,
          title:         n.title,
          description:   n.description ?? '',
          image:         n.image,
          productsCount: n.products.pageInfo.hasNextPage ? null : n.products.edges.length,
        })
      }

      if (!data.collections.pageInfo.hasNextPage) break
      cursor = data.collections.pageInfo.endCursor
      if (!cursor) break
    }
    return out
  })
}

// Fetch all Shopify collections for the admin collection picker.
export interface ShopifyCollectionSummary {
  id: string
  handle: string
  title: string
  descriptionHtml: string
  productsCount: number
  image: { url: string; altText: string | null } | null
}

export async function getShopifyCollections(): Promise<ShopifyCollectionSummary[]> {
  const data = await adminGraphQL<{
    collections: {
      edges: {
        node: {
          id: string
          handle: string
          title: string
          descriptionHtml: string
          productsCount: { count: number } | null
          image: { url: string; altText: string | null } | null
        }
      }[]
    }
  }>(`
    query GetCollections {
      collections(first: 100, sortKey: TITLE) {
        edges {
          node {
            id
            handle
            title
            descriptionHtml
            productsCount { count }
            image { url altText }
          }
        }
      }
    }
  `)
  return data.collections.edges.map(e => ({
    id:              e.node.id,
    handle:          e.node.handle,
    title:           e.node.title,
    descriptionHtml: e.node.descriptionHtml,
    productsCount:   e.node.productsCount?.count ?? 0,
    image:           e.node.image,
  }))
}

export async function getAccessoryProducts(ids: string[]): Promise<Product[]> {
  if (!ids.length) return []
  const sortedKey = [...ids].sort().join(',')
  return cached(`shopify:acc:${sortedKey}`, READ_TTL, async () => {
    const queries = ids.map((id, i) => `p${i}: product(id: "${id}") { ${PRODUCT_CORE_FRAGMENT} }`).join('\n')
    const data = await storefront<Record<string, ShopifyProductNode | null>>(`query { ${queries} }`)
    return Object.values(data).filter((n): n is ShopifyProductNode => n !== null).map(n => nodeToProduct(n))
  })
}

// ─── Admin Product Search (for admin pickers) ─────────────────────────────

export interface AdminProductSearchResult {
  id: string
  title: string
  handle: string
  image: string | null
  price: number
  compareAtPrice: number | null
  inventoryQuantity: number
  sku: string
  wholesaleCost: number | null
  mapPrice: number | null
}

export async function searchAdminProducts(query: string, limit = 20): Promise<AdminProductSearchResult[]> {
  const gqlQuery = query.trim() ? `title:*${query.trim()}*` : 'status:active'
  const data = await adminGraphQL<{
    products: {
      nodes: Array<{
        id: string
        title: string
        handle: string
        featuredImage: { url: string } | null
        variants: { nodes: Array<{ price: string; compareAtPrice: string | null; inventoryQuantity: number; sku: string }> }
        wholesaleCostMf: { value: string } | null
        mapPriceMf:      { value: string } | null
      }>
    }
  }>(`
    query SearchProducts($query: String!, $first: Int!) {
      products(query: $query, first: $first, sortKey: TITLE) {
        nodes {
          id title handle
          featuredImage { url }
          variants(first: 1) {
            nodes { price compareAtPrice inventoryQuantity sku }
          }
          wholesaleCostMf: metafield(namespace: "xdipx", key: "wholesale_cost") { value }
          mapPriceMf:      metafield(namespace: "xdipx", key: "map_price")      { value }
        }
      }
    }
  `, { query: gqlQuery, first: limit })

  return (data.products.nodes ?? []).map(node => {
    const variant = node.variants.nodes[0]
    return {
      id:                node.id,
      title:             node.title,
      handle:            node.handle,
      image:             node.featuredImage?.url ?? null,
      price:             parseFloat(variant?.price ?? '0'),
      compareAtPrice:    variant?.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
      inventoryQuantity: variant?.inventoryQuantity ?? 0,
      sku:               variant?.sku ?? '',
      wholesaleCost:     node.wholesaleCostMf ? parseFloat(node.wholesaleCostMf.value) : null,
      mapPrice:          node.mapPriceMf      ? parseFloat(node.mapPriceMf.value)      : null,
    }
  })
}

// Batch-fetch variant prices for a list of numeric product IDs via Admin API.
// Uses Admin API so draft/unpublished products are included.
export async function getAdminProductPrices(numericIds: string[]): Promise<Record<string, number>> {
  if (numericIds.length === 0) return {}
  const gids = numericIds.map(id => `gid://shopify/Product/${id}`)
  const data = await adminGraphQL<{
    nodes: Array<{ id: string; variants: { nodes: Array<{ price: string }> } } | null>
  }>(`
    query GetProductPrices($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          variants(first: 1) { nodes { price } }
        }
      }
    }
  `, { ids: gids })
  const result: Record<string, number> = {}
  for (const node of data.nodes ?? []) {
    if (!node) continue
    const numericId = node.id.replace('gid://shopify/Product/', '')
    const price = node.variants.nodes[0]?.price
    if (price != null) result[numericId] = parseFloat(price)
  }
  return result
}

// Batch-fetch price + all images for a list of numeric product IDs via Admin API.
export async function getAdminProductData(
  numericIds: string[],
): Promise<Record<string, { price: number | null; images: string[] }>> {
  if (numericIds.length === 0) return {}
  const gids = numericIds.map(id => `gid://shopify/Product/${id}`)
  const data = await adminGraphQL<{
    nodes: Array<{
      id: string
      variants: { nodes: Array<{ price: string }> }
      images: { nodes: Array<{ url: string }> }
    } | null>
  }>(`
    query GetProductData($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          variants(first: 1) { nodes { price } }
          images(first: 12) { nodes { url } }
        }
      }
    }
  `, { ids: gids })
  const result: Record<string, { price: number | null; images: string[] }> = {}
  for (const node of data.nodes ?? []) {
    if (!node) continue
    const numericId = node.id.replace('gid://shopify/Product/', '')
    const price = node.variants.nodes[0]?.price
    result[numericId] = {
      price:  price != null ? parseFloat(price) : null,
      images: node.images.nodes.map(img => img.url),
    }
  }
  return result
}

// ─── Cart Mutations ───────────────────────────────────────────────────────

const CART_FRAGMENT = `
  id checkoutUrl totalQuantity
  lines(first: 50) {
    edges {
      node {
        id quantity
        merchandise {
          ... on ProductVariant {
            id title
            price { amount currencyCode }
            product { id title handle images(first: 1) { edges { node { url altText } } } }
          }
        }
        sellingPlanAllocation {
          sellingPlan { id name }
          priceAdjustments {
            compareAtPrice { amount currencyCode }
            price          { amount currencyCode }
          }
        }
      }
    }
  }
  cost {
    subtotalAmount { amount currencyCode }
    totalAmount    { amount currencyCode }
  }
`

interface CartResponse { cart: RawCart }
interface RawCartLineSellingPlanAllocation {
  sellingPlan: { id: string; name: string }
  priceAdjustments: Array<{
    compareAtPrice: { amount: string; currencyCode: string }
    price:          { amount: string; currencyCode: string }
  }>
}
interface RawCart {
  id: string; checkoutUrl: string; totalQuantity: number
  lines: { edges: { node: { id: string; quantity: number; merchandise: { id: string; title: string; price: { amount: string; currencyCode: string }; product: { id: string; title: string; handle: string; images: { edges: { node: { url: string; altText: string | null } }[] } } }; sellingPlanAllocation: RawCartLineSellingPlanAllocation | null } }[] }
  cost: { subtotalAmount: { amount: string; currencyCode: string }; totalAmount: { amount: string; currencyCode: string } }
}

function mapSellingPlanAllocation(
  raw: RawCartLineSellingPlanAllocation | null,
): CartLine['sellingPlanAllocation'] {
  if (!raw) return undefined
  const adj = raw.priceAdjustments[0]
  const allocation: NonNullable<CartLine['sellingPlanAllocation']> = {
    sellingPlan: { id: raw.sellingPlan.id, name: raw.sellingPlan.name },
  }
  if (adj) {
    const compareAt = parseFloat(adj.compareAtPrice.amount)
    const price     = parseFloat(adj.price.amount)
    if (compareAt > 0 && price < compareAt) {
      allocation.discountPct = Math.round(((compareAt - price) / compareAt) * 100)
    }
  }
  return allocation
}

function rawCartToCart(raw: RawCart): Cart {
  return {
    id: raw.id,
    checkoutUrl: raw.checkoutUrl,
    totalQuantity: raw.totalQuantity,
    lines: raw.lines.edges.map((e): CartLine => {
      const allocation = mapSellingPlanAllocation(e.node.sellingPlanAllocation)
      const line: CartLine = {
        id: e.node.id,
        quantity: e.node.quantity,
        merchandise: {
          id: e.node.merchandise.id,
          title: e.node.merchandise.title,
          price: e.node.merchandise.price,
          product: {
            id: e.node.merchandise.product.id,
            title: e.node.merchandise.product.title,
            handle: e.node.merchandise.product.handle,
            images: parseImages(e.node.merchandise.product.images.edges),
          },
        },
      }
      if (allocation) line.sellingPlanAllocation = allocation
      return line
    }),
    cost: raw.cost,
  }
}

export async function createCart(): Promise<Cart> {
  const data = await storefront<{ cartCreate: CartResponse }>(`
    mutation CartCreate {
      cartCreate { cart { ${CART_FRAGMENT} } }
    }
  `)
  return rawCartToCart(data.cartCreate.cart)
}

/**
 * Create a cart pre-populated with line items and return it.
 * Used by the chat agent's buildCheckoutLink tool — we can't use `/cart/VAR:QTY`
 * permalinks because Shopify disables those while the storefront is password-
 * protected (returns 410). A Storefront-API-created cart works regardless.
 */
export async function createCartWithLines(
  lines: { variantId: string; quantity: number }[],
): Promise<Cart> {
  const data = await storefront<{ cartCreate: { cart: RawCart | null; userErrors: { field: string[]; message: string }[] } }>(
    `mutation CartCreateWithLines($lines: [CartLineInput!]!) {
       cartCreate(input: { lines: $lines }) {
         cart { ${CART_FRAGMENT} }
         userErrors { field message }
       }
     }`,
    {
      lines: lines.map((l) => ({ merchandiseId: l.variantId, quantity: l.quantity })),
    },
  )
  if (!data.cartCreate.cart) {
    const msg = data.cartCreate.userErrors?.[0]?.message || 'cart_create_failed'
    throw new Error(msg)
  }
  return rawCartToCart(data.cartCreate.cart)
}

export async function getCart(cartId: string): Promise<Cart | null> {
  const data = await storefront<{ cart: RawCart | null }>(`
    query GetCart($id: ID!) { cart(id: $id) { ${CART_FRAGMENT} } }
  `, { id: cartId })
  if (!data.cart) return null
  return rawCartToCart(data.cart)
}

export async function addToCart(cartId: string, variantId: string, quantity: number, sellingPlanId?: string): Promise<Cart> {
  const line: Record<string, unknown> = { merchandiseId: variantId, quantity }
  if (sellingPlanId) line['sellingPlanId'] = sellingPlanId
  const data = await storefront<{ cartLinesAdd: { cart: RawCart | null } }>(`
    mutation AddToCart($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ${CART_FRAGMENT} }
        userErrors { field message }
      }
    }
  `, { cartId, lines: [line] })
  if (!data.cartLinesAdd.cart) throw new Error('Cart not found or line could not be added')
  return rawCartToCart(data.cartLinesAdd.cart)
}

export async function addLinesToCart(
  cartId: string,
  lines: { variantId: string; quantity: number }[],
): Promise<Cart> {
  const data = await storefront<{ cartLinesAdd: { cart: RawCart | null } }>(`
    mutation AddLinesToCart($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ${CART_FRAGMENT} }
        userErrors { field message }
      }
    }
  `, {
    cartId,
    lines: lines.map(l => ({ merchandiseId: l.variantId, quantity: l.quantity })),
  })
  if (!data.cartLinesAdd.cart) throw new Error('Cart not found or lines could not be added')
  return rawCartToCart(data.cartLinesAdd.cart)
}

/**
 * Merge custom attributes onto a cart. Used to tag carts for Shopify Automatic
 * Discount rules (e.g. pair_bundle=live triggers a pre-configured % off rule)
 * and to carry attribution (_fbp, _fbc, _ga_cid, utm) across the domain
 * boundary into the order's note_attributes, which is the only channel that
 * survives the handoff to Shopify's checkout.
 *
 * Merge, not replace. Shopify's cartAttributesUpdate overwrites the entire
 * attribute set, so the previous read-free implementation silently dropped
 * whatever it did not happen to be passed. A second add-to-cart after a cookie
 * expired would wipe the attribution captured by the first, and the order would
 * arrive unattributable.
 *
 * userErrors are read and thrown. They used to be requested and ignored, so a
 * rejected mutation was indistinguishable from a successful one.
 */
export async function setCartAttributes(
  cartId: string,
  attributes: { key: string; value: string }[],
): Promise<void> {
  // Read current attributes with a dedicated query rather than widening
  // CART_FRAGMENT, which every cart read shares.
  let existing: { key: string; value: string }[] = []
  try {
    const current = await storefront<{ cart: { attributes: { key: string; value: string | null }[] } | null }>(`
      query CartAttributes($cartId: ID!) {
        cart(id: $cartId) { attributes { key value } }
      }
    `, { cartId })
    existing = (current.cart?.attributes ?? [])
      .filter((a): a is { key: string; value: string } => typeof a.value === 'string')
  } catch {
    // A failed read must not cost us the write. Worst case we fall back to the
    // old replace behavior for this call.
  }

  const merged = new Map<string, string>()
  for (const a of existing)   merged.set(a.key, a.value)
  for (const a of attributes) merged.set(a.key, a.value)

  const data = await storefront<{ cartAttributesUpdate: { userErrors: { field: string[] | null; message: string }[] } }>(`
    mutation CartAttributesUpdate($cartId: ID!, $attributes: [AttributeInput!]!) {
      cartAttributesUpdate(cartId: $cartId, attributes: $attributes) {
        cart { id }
        userErrors { field message }
      }
    }
  `, { cartId, attributes: Array.from(merged, ([key, value]) => ({ key, value })) })

  const errs = data.cartAttributesUpdate?.userErrors ?? []
  if (errs.length > 0) {
    throw new Error(`cartAttributesUpdate: ${errs.map(e => `${(e.field ?? []).join('.')} ${e.message}`).join('; ')}`)
  }
}

export async function removeFromCart(cartId: string, lineIds: string[]): Promise<Cart> {
  const data = await storefront<{ cartLinesRemove: CartResponse }>(`
    mutation RemoveFromCart($cartId: ID!, $lineIds: [ID!]!) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
        cart { ${CART_FRAGMENT} }
      }
    }
  `, { cartId, lineIds })
  return rawCartToCart(data.cartLinesRemove.cart)
}

export async function updateCartLine(cartId: string, lineId: string, quantity: number): Promise<Cart> {
  const data = await storefront<{ cartLinesUpdate: CartResponse }>(`
    mutation UpdateCartLine($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart { ${CART_FRAGMENT} }
      }
    }
  `, { cartId, lines: [{ id: lineId, quantity }] })
  return rawCartToCart(data.cartLinesUpdate.cart)
}

// ─── Admin API helpers ────────────────────────────────────────────────────

export async function updateProductMetafield(
  productId: string,
  key: string,
  value: string,
  type = 'single_line_text_field',
  namespace = 'xdipx',
): Promise<void> {
  const numericId = productId.replace('gid://shopify/Product/', '')
  await shopifyAdmin(`/products/${numericId}/metafields.json`, 'POST', {
    metafield: { namespace, key, value, type },
  })
  invalidateCache(`shopify:deal:byid:${numericId}`)
  invalidateCache('shopify:deal:byhandle:')
  invalidateCache(`shopify:p:`)
}

/** Update the canonical Shopify product.descriptionHtml (body_html). */
export async function updateProductDescriptionHtml(
  productId: string,
  bodyHtml: string,
): Promise<void> {
  const numericId = productId.replace('gid://shopify/Product/', '')
  await shopifyAdmin(`/products/${numericId}.json`, 'PUT', {
    product: { id: Number(numericId), body_html: bodyHtml },
  })
  invalidateCache(`shopify:deal:byid:${numericId}`)
  invalidateCache('shopify:deal:byhandle:')
  invalidateCache(`shopify:p:`)
}

/**
 * Write Emma-voice pairing_why blurbs to a product's xdipx.pairing_why metafield.
 * Stored as a JSON object keyed by accessory product GID. Merges into existing
 * blurbs — the admin can curate per-accessory copy without losing other entries.
 */
export async function setPairingWhy(
  productId: string,
  blurbs: Record<string, string>,
  opts: { merge?: boolean } = { merge: true },
): Promise<void> {
  const numericId = productId.replace('gid://shopify/Product/', '')
  let merged = blurbs
  if (opts.merge !== false) {
    const { metafields } = await shopifyAdmin<{
      metafields: { namespace: string; key: string; value: string }[]
    }>(`/products/${numericId}/metafields.json?namespace=xdipx&key=pairing_why`)
    const existing = metafields?.[0]?.value
    if (existing) {
      try {
        const prev = JSON.parse(existing) as Record<string, string>
        merged = { ...prev, ...blurbs }
      } catch {
        // Malformed JSON — overwrite cleanly
      }
    }
  }
  await updateProductMetafield(productId, 'pairing_why', JSON.stringify(merged), 'json')
}

export async function getVariantCost(variantGid: string): Promise<number | null> {
  const id = variantGid.replace('gid://shopify/ProductVariant/', '')
  const { variant } = await shopifyAdmin<{ variant: { inventory_item_id: string } }>(`/variants/${id}.json`)
  if (!variant?.inventory_item_id) return null
  const { inventory_item } = await shopifyAdmin<{ inventory_item: { cost: string | null } }>(
    `/inventory_items/${variant.inventory_item_id}.json`,
  )
  const cost = parseFloat(inventory_item?.cost ?? '')
  return isNaN(cost) ? null : cost
}

/** Returns every variant GID for a product. Used to sync pricing across all variants. */
export async function getProductVariantGids(shopifyProductId: string): Promise<string[]> {
  const numericId = shopifyProductId.replace('gid://shopify/Product/', '')
  const { product } = await shopifyAdmin<{
    product: { variants: { id: number }[] } | null
  }>(`/products/${numericId}.json?fields=variants`)
  return (product?.variants ?? []).map(v => `gid://shopify/ProductVariant/${v.id}`)
}

/**
 * Resolve an inventory_item_id (as delivered by an inventory_levels/update
 * webhook) to its parent product's storefront-facing fields. Returns null when
 * the item has no variant or product (e.g. a deleted product) so callers can
 * skip quietly. Used by the inventory webhook's back-in-stock branch.
 */
export async function getProductByInventoryItemId(
  inventoryItemId: string,
): Promise<{ handle: string; title: string; sku?: string; imageUrl?: string; price?: number } | null> {
  const gid = inventoryItemId.startsWith('gid://')
    ? inventoryItemId
    : `gid://shopify/InventoryItem/${inventoryItemId}`
  const data = await adminGraphQL<{
    inventoryItem: {
      sku: string | null
      variant: {
        price: string | null
        product: { handle: string; title: string; featuredImage: { url: string } | null } | null
      } | null
    } | null
  }>(
    `query ProductByInventoryItem($id: ID!) {
      inventoryItem(id: $id) {
        sku
        variant {
          price
          product { handle title featuredImage { url } }
        }
      }
    }`,
    { id: gid },
  )

  const product = data.inventoryItem?.variant?.product
  if (!product?.handle) return null

  const result: { handle: string; title: string; sku?: string; imageUrl?: string; price?: number } = {
    handle: product.handle,
    title:  product.title,
  }
  // SKU keys the pricing_audit_log lookups the restock -> social gate needs
  // (#4361). InventoryItem.sku is the variant SKU for this inventory item.
  if (data.inventoryItem?.sku) result.sku = data.inventoryItem.sku
  if (product.featuredImage?.url) result.imageUrl = product.featuredImage.url
  const price = data.inventoryItem?.variant?.price ? parseFloat(data.inventoryItem.variant.price) : NaN
  if (Number.isFinite(price)) result.price = price
  return result
}

export async function updateVariantPricing(variantGid: string, price: string, compareAtPrice: string, wholesaleCost?: string): Promise<void> {
  const id = variantGid.replace('gid://shopify/ProductVariant/', '')
  const { variant } = await shopifyAdmin<{ variant: { inventory_item_id: string } }>(`/variants/${id}.json`, 'PUT', {
    variant: { id, price, compare_at_price: compareAtPrice || null },
  })
  if (wholesaleCost && variant?.inventory_item_id) {
    await shopifyAdmin(`/inventory_items/${variant.inventory_item_id}.json`, 'PUT', {
      inventory_item: { id: variant.inventory_item_id, cost: wholesaleCost },
    })
  }
}

/**
 * Archive a Shopify product so it stops appearing in storefront/search.
 *
 *   - Sets the Shopify product `status` to ARCHIVED via Admin GraphQL, which is
 *     the only archive signal now. It also removes the product from the
 *     Storefront API, so the PDP 404s on its own.
 *   - Returns the resolved handle so callers can mirror to Sanity.
 *
 * Idempotent — calling on an already-archived product is a no-op (the GraphQL
 * call still goes through but Shopify accepts re-setting the same status).
 */
export async function archiveShopifyProduct(
  productId: string,
  reason?: string,
): Promise<{ handle: string | null }> {
  const numericId = productId.replace('gid://shopify/Product/', '')
  const gid = `gid://shopify/Product/${numericId}`

  // 1. Set product.status = ARCHIVED via Admin GraphQL.
  const updateResult = await adminGraphQL<{
    productUpdate: { product: { handle: string } | null; userErrors: { field: string[]; message: string }[] }
  }>(`
    mutation ArchiveProduct($input: ProductInput!) {
      productUpdate(input: $input) {
        product { handle }
        userErrors { field message }
      }
    }
  `, { input: { id: gid, status: 'ARCHIVED' } })

  if (updateResult.productUpdate.userErrors.length > 0) {
    const errs = updateResult.productUpdate.userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
    throw new Error(`archiveShopifyProduct: ${errs}`)
  }

  const handle = updateResult.productUpdate.product?.handle ?? await getProductHandleById(numericId)

  if (reason) {
    console.info(`[archiveShopifyProduct] ${numericId} archived: ${reason}`)
  }
  return { handle }
}

export async function createDraftProduct(data: {
  title: string
  handle: string
  bodyHtml: string
  vendor: string
  tags: string[]
  variantPrice: string
  variantCompareAtPrice: string
  images: { src: string; alt: string }[]
  metafields: { namespace: string; key: string; value: string; type: string }[]
}): Promise<string> {
  const res = await shopifyAdmin<{ product: { id: string } }>('/products.json', 'POST', {
    product: {
      title: data.title,
      handle: data.handle,
      body_html: data.bodyHtml,
      vendor: data.vendor,
      tags: data.tags.join(', '),
      status: 'draft',
      variants: [{ price: data.variantPrice, compare_at_price: data.variantCompareAtPrice }],
      images: data.images.map(img => ({ src: img.src, alt: img.alt })),
      metafields: data.metafields,
    },
  })
  return res.product.id
}

export async function getHandleByProductId(productId: string | number): Promise<string | null> {
  try {
    const res = await shopifyAdmin<{ product?: { handle?: string } }>(
      `/products/${productId}.json`,
      'GET',
    )
    return res?.product?.handle ?? null
  } catch {
    return null
  }
}

/**
 * Wholesale cost for a SKU, or `null` when it genuinely cannot be resolved.
 *
 * Returning `null` (UNKNOWN) rather than `0` is load-bearing. The order-created
 * webhook writes this into the `xdipx.profit_<sku>` order metafield, and a
 * fabricated `0` is indistinguishable from a real zero cost — it silently
 * inflates a line to 100% margin. The product is located by a `nalpac-sku-<sku>`
 * tag search, which only some products carry, so a miss is common and must be
 * reported as UNKNOWN so the profit summary can exclude the line instead of
 * counting it as pure margin (see costsFromOrderMetafields / costLineItem in
 * profit.server.ts). Callers must treat `null` as "no cost known", never as 0.
 */
export async function getWholesaleCostBySKU(sku: string): Promise<number | null> {
  const data = await storefront<{
    products: { edges: { node: { metafields: { key: string; value: string }[] } }[] }
  }>(`
    query GetWholesaleBySKU($query: String!) {
      products(first: 1, query: $query) {
        edges {
          node {
            metafields(identifiers: [{ namespace: "xdipx", key: "wholesale_cost" }]) {
              key value
            }
          }
        }
      }
    }
  `, { query: `tag:nalpac-sku-${sku}` })
  const raw = data.products.edges[0]?.node.metafields.find(m => m.key === 'wholesale_cost')?.value
  // No product matched the tag, or the product carries no wholesale_cost
  // metafield: the cost is unknown, not zero.
  if (raw == null) return null
  const parsed = parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : null
}

// ─── Sanity → Shopify push ─────────────────────────────────────────────────

export interface ProductPageDoc {
  shopifyProductId: string
  title?: string | undefined
  vendor?: string | undefined
  /** Editorial sub-category labels only (e.g. "Restraints"). Merged into the
   *  product's existing tags by pushProductToShopify, which preserves operational
   *  tags (cat:*, brand:*, price:*, nalpac-sku-*, for-*). Do NOT
   *  pass operational tags here. */
  tags?: string[] | undefined
  description?: unknown        // string (legacy) or portable text blocks
  seoTitle?: string | undefined
  seoDescription?: string | undefined
  tagline?: string | undefined
  fullStory?: unknown           // string (legacy) or portable text blocks
  worksForHim?: unknown        // string (legacy) or portable text blocks
  worksForHer?: unknown        // string (legacy) or portable text blocks
  boxContents?: string[] | undefined
  moodImageUrl?: string | undefined
  /** Phase 2 — multi-select audience tags. Stored as JSON string[] on Shopify. */
  category?: Array<'for-him' | 'for-her' | 'couples'> | undefined
  originalPrice?: number | undefined
  wholesaleCost?: number | undefined
  mapPrice?: number | undefined
  nalpacSku?: string | undefined
  dealScore?: number | undefined
  accessoryProductIds?: string[] | undefined
  seoMetaDescription?: string | undefined
  specifications?: string[] | undefined
  rawDescription?: string | undefined
  // v2 redesign — Emma agentic content
  descriptionHtml?: string | undefined            // Shopify body_html (Emma's take)
  careInstructions?: string[] | undefined         // xdipx.care_instructions (json)
  sensationDialV2?: SensationDialV2 | undefined   // xdipx.sensation_dial_v2 (json)
  productTypeDial?: string | undefined            // xdipx.product_type_dial (single_line_text_field)
  /** Phase 1 D1 — per-parent subtype scoped to productTypeDial. Written to
   *  custom.product_subtype_dial (the only non-xdipx-namespace metafield in
   *  this push path). Empty/undefined for sex-machine and unclassified products. */
  productSubtypeDial?: string | null | undefined  // custom.product_subtype_dial (single_line_text_field)
  moodTags?: string[] | undefined                 // xdipx.mood_tags (list.text)
  audienceTags?: string[] | undefined             // xdipx.audience_tags (list.text)
  mattersTags?: string[] | undefined              // xdipx.matters_tags (list.text)
  /** Top-level menu section — exactly one of pleasure|play|body|wear.
   *  Written to custom.section_tags (list.single_line_text_field, one value). */
  sectionTags?: string[] | undefined
  emmaHero?: EmmaHeroCopy | undefined             // xdipx.emma_hero (json)
  // Brand-aware title augmentation
  originalTitle?: string | undefined              // xdipx.original_title (single_line_text_field) — manufacturer's pre-augmented title
  // Pairing copy — keyed by accessory GID
  pairingWhy?: Record<string, string> | undefined // xdipx.pairing_why (json)
  /** When false, an empty tagline is allowed (no required-field assertion).
   *  Used by the Phase 1 raw-import path that defers enrichment. Defaults to true. */
  requireTagline?: boolean | undefined
}

export async function pushProductToShopify(doc: ProductPageDoc): Promise<void> {
  const gid = `gid://shopify/Product/${doc.shopifyProductId}`

  // doc.tags carries EDITORIAL sub-category labels only. Shopify product tags
  // also carry operational tags (cat:*, brand:*, price:*, nalpac-sku-*,
  // for-him/for-her/for-couples) that drive search and the
  // lifecycle. A naive replace would clobber them, so merge: keep the current
  // operational tags, replace the editorial set with the supplied labels, and
  // drop the "(uncategorized)" sentinel.
  let mergedTags: string[] | undefined
  if (doc.tags !== undefined) {
    const numericId = doc.shopifyProductId.replace('gid://shopify/Product/', '')
    const { product } = await shopifyAdmin<{ product: { tags: string } | null }>(`/products/${numericId}.json?fields=tags`)
    const currentTags = product?.tags ? product.tags.split(',').map(t => t.trim()).filter(Boolean) : []
    const operational = currentTags.filter(isOperationalTag)
    const editorial = editorialTagsOnly(doc.tags).filter(t => t !== UNCATEGORIZED_SENTINEL)
    mergedTags = Array.from(new Set([...operational, ...editorial]))
  }

  // 1. Update standard product fields
  const updateResult = await adminGraphQL<{
    productUpdate: { userErrors: { field: string[]; message: string }[] }
  }>(`
    mutation ProductUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        userErrors { field message }
      }
    }
  `, {
    input: {
      id: gid,
      ...(doc.title      !== undefined ? { title:    doc.title                } : {}),
      ...(doc.vendor     !== undefined ? { vendor:   doc.vendor               } : {}),
      ...(mergedTags     !== undefined ? { tags:     mergedTags               } : {}),
      ...(doc.descriptionHtml !== undefined
        ? { descriptionHtml: doc.descriptionHtml }
        : doc.description !== undefined ? { descriptionHtml: ptToHtml(doc.description) } : {}),
      ...((doc.seoTitle || doc.seoDescription) ? {
        seo: {
          ...(doc.seoTitle       ? { title:       doc.seoTitle       } : {}),
          ...(doc.seoDescription ? { description: doc.seoDescription } : {}),
        },
      } : {}),
    },
  })
  if (updateResult.productUpdate.userErrors.length > 0) {
    const errs = updateResult.productUpdate.userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
    console.error('[pushProductToShopify] productUpdate userErrors:', errs)
    throw new Error(`Shopify product update rejected: ${errs}`)
  }

  // 2. Upsert xdipx metafields (metafieldsSet creates or updates by namespace+key)
  type MetafieldInput = { namespace: string; key: string; value: string; type: string; ownerId: string }
  const metafields: MetafieldInput[] = []

  const add = (key: string, value: string | undefined, type: string, required = false) => {
    // Shopify rejects newlines in single_line_text_field — strip them silently
    let v = value
    if (v && type === 'single_line_text_field') v = v.replace(/[\r\n]+/g, ' ').trim()
    if (!v || v === '') {
      if (required) throw new Error(`pushProductToShopify: required field "${key}" is empty`)
      return
    }
    metafields.push({ namespace: 'xdipx', key, value: v, type, ownerId: gid })
  }

  /** Phase 1 D1 — sibling helper for the `custom` namespace. Currently only
   *  product_subtype_dial lives there (the rest are xdipx). */
  const addCustom = (key: string, value: string | null | undefined, type: string) => {
    let v = value
    if (v && type === 'single_line_text_field') v = v.replace(/[\r\n]+/g, ' ').trim()
    if (!v || v === '') return
    metafields.push({ namespace: 'custom', key, value: v, type, ownerId: gid })
  }

  add('tagline',          doc.tagline,               'single_line_text_field', doc.requireTagline !== false)
  // @deprecated — legacy field, no longer generated by the bulk-import orchestrator. Editors may hand-fill on legacy products.
  add('full_story',       ptToHtml(doc.fullStory),   'multi_line_text_field')
  // @deprecated — v2 PDP redesign removed the "Both Ways" tab; Emma's take in body_html replaced these.
  // Kept optional so editor hand-fills on legacy products still write through.
  add('works_for_him',    ptToHtml(doc.worksForHim), 'multi_line_text_field')
  add('works_for_her',    ptToHtml(doc.worksForHer), 'multi_line_text_field')
  add('mood_image_url',   doc.moodImageUrl,                    'single_line_text_field')
  add('product_type_dial', doc.productTypeDial,                'single_line_text_field')
  // Phase 1 D1 — hierarchical taxonomy subtype scoped to product_type_dial.
  // Lives in custom namespace per metafield-defs registry.
  addCustom('product_subtype_dial', doc.productSubtypeDial ?? undefined, 'single_line_text_field')
  add('original_title',   doc.originalTitle,                   'single_line_text_field')
  // Phase 2 — category stored as JSON string[] (mirrors care/box/specs).
  // Legacy single-value strings still parse via parseCategory on read.
  if (doc.category && doc.category.length > 0) {
    metafields.push({
      namespace: 'xdipx', key: 'category', ownerId: gid,
      value: JSON.stringify(doc.category),
      type: 'single_line_text_field',
    })
  }
  add('nalpac_sku',       doc.nalpacSku,                       'single_line_text_field')
  add('original_price',   doc.originalPrice?.toString(),       'number_decimal')
  add('wholesale_cost',   doc.wholesaleCost?.toString(),       'number_decimal')
  add('map_price',        doc.mapPrice?.toString(),            'number_decimal')

  // box_contents is optional — orchestrator legitimately omits it for some types (e.g. lube).
  if (doc.boxContents?.length) {
    metafields.push({
      namespace: 'xdipx', key: 'box_contents', ownerId: gid,
      value: JSON.stringify(doc.boxContents),
      type: 'json',
    })
  }

  if (doc.accessoryProductIds !== undefined) {
    metafields.push({
      namespace: 'xdipx', key: 'accessory_product_ids', ownerId: gid,
      value: JSON.stringify(doc.accessoryProductIds),
      type: 'json',
    })
  }
  add('deal_score',           doc.dealScore?.toString(),        'number_decimal')
  // Optional — Shopify-native product.seo.description (set above) is the canonical SEO field; this metafield is supplementary.
  add('seo_meta_description', doc.seoMetaDescription,           'multi_line_text_field')
  // Phase 2 — specifications stored as JSON string[] of "Label: Value" bullets,
  // matching care_instructions / box_contents shape. Optional; varies by type
  // (lubes have minimal specs; toys have full dimension/material lists). The
  // Shopify metafield definition currently advertises type=multi_line_text_field
  // (legacy), but the value is JSON-stringified — readers use
  // parseSpecificationsBullets which handles both formats during the migration.
  if (doc.specifications?.length) {
    metafields.push({
      namespace: 'xdipx', key: 'specifications', ownerId: gid,
      value: JSON.stringify(doc.specifications),
      type: 'multi_line_text_field',
    })
  }

  // v2 redesign — Emma agentic content metafields
  if (doc.careInstructions?.length) {
    metafields.push({
      namespace: 'xdipx', key: 'care_instructions', ownerId: gid,
      value: JSON.stringify(doc.careInstructions),
      type: 'json',
    })
  }
  if (doc.sensationDialV2?.items?.length) {
    metafields.push({
      namespace: 'xdipx', key: 'sensation_dial_v2', ownerId: gid,
      value: JSON.stringify(doc.sensationDialV2),
      type: 'json',
    })
  }
  if (doc.moodTags?.length) {
    metafields.push({
      namespace: 'xdipx', key: 'mood_tags', ownerId: gid,
      value: JSON.stringify(doc.moodTags),
      type: 'list.single_line_text_field',
    })
  }
  if (doc.audienceTags?.length) {
    metafields.push({
      namespace: 'xdipx', key: 'audience_tags', ownerId: gid,
      value: JSON.stringify(doc.audienceTags),
      type: 'list.single_line_text_field',
    })
  }
  if (doc.mattersTags?.length) {
    metafields.push({
      namespace: 'xdipx', key: 'matters_tags', ownerId: gid,
      value: JSON.stringify(doc.mattersTags),
      type: 'list.single_line_text_field',
    })
  }
  // Top-level menu section — custom namespace, exactly one value (stored as a
  // single-element list for schema parity with the other taxonomy metafields).
  if (doc.sectionTags?.length) {
    metafields.push({
      namespace: 'custom', key: 'section_tags', ownerId: gid,
      value: JSON.stringify(doc.sectionTags),
      type: 'list.single_line_text_field',
    })
  }
  if (doc.emmaHero) {
    metafields.push({
      namespace: 'xdipx', key: 'emma_hero', ownerId: gid,
      value: JSON.stringify(doc.emmaHero),
      type: 'json',
    })
  }
  if (doc.pairingWhy && Object.keys(doc.pairingWhy).length > 0) {
    metafields.push({
      namespace: 'xdipx', key: 'pairing_why', ownerId: gid,
      value: JSON.stringify(doc.pairingWhy),
      type: 'json',
    })
  }

  // Store original Nalpac description in the custom namespace metafield
  if (doc.rawDescription) {
    metafields.push({ namespace: 'custom', key: 'original_description', value: doc.rawDescription, type: 'multi_line_text_field', ownerId: gid })
  }

  // Google Merchant Center adult-content flag. xdipx is an adult-only catalog,
  // so every product imported via this pipeline gets adult=yes. The Shopify
  // Google & YouTube channel reads this from the mm-google-shopping namespace
  // and forwards it as the `adult` attribute in the Merchant feed.
  metafields.push({ namespace: 'mm-google-shopping', key: 'adult', value: 'yes', type: 'single_line_text_field', ownerId: gid })

  if (metafields.length > 0) {
    const mfResult = await adminGraphQL<{
      metafieldsSet: { userErrors: { field: string[]; message: string }[] }
    }>(`
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `, { metafields })
    if (mfResult.metafieldsSet.userErrors.length > 0) {
      const errs = mfResult.metafieldsSet.userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
      console.error('[pushProductToShopify] metafieldsSet userErrors:', errs)
      throw new Error(`Shopify metafields rejected: ${errs}`)
    }
  }
}

/**
 * Set a single metafield on any owner (Product or ProductVariant), overwriting
 * any existing value at the same namespace+key. Idempotent.
 *
 * Caller passes a fully-qualified GID like `gid://shopify/Product/123` or
 * `gid://shopify/ProductVariant/456`.
 */
export async function setMetafield(
  ownerGid: string,
  namespace: string,
  key: string,
  type: string,
  value: string,
): Promise<void> {
  if (!ownerGid.startsWith('gid://')) {
    throw new Error(`setMetafield requires a fully-qualified GID, got ${ownerGid}`)
  }
  const res = await adminGraphQL<{
    metafieldsSet: { userErrors: { field: string[]; message: string }[] }
  }>(`
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }
  `, { metafields: [{ namespace, key, type, value, ownerId: ownerGid }] })
  if (res.metafieldsSet.userErrors.length > 0) {
    const errs = res.metafieldsSet.userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
    throw new Error(`metafieldsSet rejected ${namespace}.${key}: ${errs}`)
  }
}

/**
 * Look up a Shopify variant GID by its SKU. Returns null if no match.
 */
export async function findVariantBySKU(sku: string): Promise<string | null> {
  const data = await adminGraphQL<{
    productVariants: { edges: { node: { id: string } }[] }
  }>(`
    query FindVariantBySKU($query: String!) {
      productVariants(first: 1, query: $query) {
        edges { node { id } }
      }
    }
  `, { query: `sku:${sku}` })
  return data.productVariants.edges[0]?.node.id ?? null
}

/**
 * Ensure a metafield definition exists for the given owner type. Idempotent —
 * if a definition already exists at the same namespace+key+ownerType, returns
 * without creating a duplicate.
 */
export async function ensureMetafieldDefinition(input: {
  namespace: string
  key: string
  type: string
  name: string
  ownerType: 'PRODUCT' | 'PRODUCTVARIANT'
  description?: string
  storefrontAccess?: boolean
}): Promise<{ created: boolean }> {
  const res = await adminGraphQL<{
    metafieldDefinitionCreate: {
      createdDefinition: { id: string } | null
      userErrors: { field: string[]; message: string; code: string }[]
    }
  }>(`
    mutation CreateDef($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id }
        userErrors { field message code }
      }
    }
  `, {
    definition: {
      namespace: input.namespace,
      key:       input.key,
      name:      input.name,
      ...(input.description ? { description: input.description } : {}),
      type:      input.type,
      ownerType: input.ownerType,
      access:    input.storefrontAccess === false
        ? { storefront: 'NONE' }
        : { storefront: 'PUBLIC_READ' },
    },
  })
  if (res.metafieldDefinitionCreate.createdDefinition) return { created: true }
  const alreadyExists = res.metafieldDefinitionCreate.userErrors.some(
    e => e.code === 'TAKEN' || /already exists|already taken/i.test(e.message),
  )
  if (alreadyExists) return { created: false }
  const errs = res.metafieldDefinitionCreate.userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
  throw new Error(`metafieldDefinitionCreate failed for ${input.namespace}.${input.key}: ${errs}`)
}

// ─── Pipeline helpers ─────────────────────────────────────────────────────

/**
 * Set a Shopify product's status to 'active' and publish it to the xdipx sales
 * channels (excluding Point of Sale). Required before the Storefront API can
 * return the product.
 */
export async function activateShopifyProduct(numericId: string): Promise<void> {
  const id = numericId.replace('gid://shopify/Product/', '')

  // 1. Set product status to active.
  await shopifyAdmin(`/products/${id}.json`, 'PUT', {
    product: { id, status: 'active' },
  })

  // 2. Publish to the curated xdipx channels; unpublish from excluded ones.
  await publishProductToXdipxChannels(id)

  // 3. WS2c — clear the mirrored Sanity productPage's `hiddenUntilLive` import-stub
  //    flag, if one exists. This function is the universal chokepoint every
  //    activation path funnels through (import publish, admin force-activate),
  //    so wiring the clear here — rather
  //    than in just one caller — guarantees a draft-stage import stub stops
  //    leaking into sitemap.xml / on-site search the moment it actually becomes
  //    purchasable, no matter which path activated it. Best-effort: a Sanity
  //    hiccup must never unwind the Shopify activation that already succeeded above.
  try {
    const { markProductPageLive } = await import('~/lib/sanity.server')
    await markProductPageLive(id)
  } catch (err) {
    console.warn(`[activateShopifyProduct] markProductPageLive failed for ${id} (non-blocking):`, err instanceof Error ? err.message : err)
  }
}

// ─── xdipx fulfillment locations + sales channels ─────────────────────────

/**
 * Shopify Location GIDs that every imported product is stocked at. Quantities
 * are NOT set at import time; the daily Nalpac/Entrenue feeds populate them.
 */
export const XDIPX_LOCATION_IDS = [
  'gid://shopify/Location/85557510315', // Entrenue
  'gid://shopify/Location/85557477547', // Nalpac
] as const

/**
 * Sales-channel publication names imported products are published to. Matched
 * by name because publication GIDs are not stable across stores/environments.
 */
const XDIPX_PUBLICATION_NAMES = [
  'Online Store',
  'Shop',
  'Storefront Admin',
  'Shopify GraphiQL App',
  'Google & YouTube',
  'ChatGPT',
]

/**
 * Channels we never want products on. Point of Sale auto-attaches new products
 * at the store level, so we explicitly unpublish from it.
 */
const XDIPX_EXCLUDED_PUBLICATION_NAMES = [
  'Point of Sale',
]

/**
 * Activate every variant's inventory item at both xdipx fulfillment locations
 * so the daily feeds can set quantities. No quantity is set here (left blank).
 * Idempotent: activating an already-active location is a no-op.
 */
export async function activateProductInventoryAtLocations(numericId: string): Promise<void> {
  const id = numericId.replace('gid://shopify/Product/', '')
  const data = await adminGraphQL<{
    product: { variants: { edges: { node: { inventoryItem: { id: string } } }[] } } | null
  }>(`
    query ProductInventoryItems($id: ID!) {
      product(id: $id) {
        variants(first: 100) { edges { node { inventoryItem { id } } } }
      }
    }
  `, { id: `gid://shopify/Product/${id}` })

  const itemIds = (data.product?.variants.edges ?? []).map(e => e.node.inventoryItem.id)
  for (const inventoryItemId of itemIds) {
    for (const locationId of XDIPX_LOCATION_IDS) {
      const res = await adminGraphQL<{
        inventoryActivate: { userErrors: { field: string[]; message: string }[] }
      }>(`
        mutation ActivateInventory($inventoryItemId: ID!, $locationId: ID!) {
          inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
            userErrors { field message }
          }
        }
      `, { inventoryItemId, locationId })
      const errs = res.inventoryActivate?.userErrors ?? []
      if (errs.length) {
        console.warn(`[shopify] inventoryActivate ${inventoryItemId} @ ${locationId}:`, errs.map(e => e.message).join('; '))
      }
      await new Promise(r => setTimeout(r, 200))
    }
  }
}

/**
 * Publish a product to the xdipx sales channels (XDIPX_PUBLICATION_NAMES) and
 * unpublish it from any excluded channel (XDIPX_EXCLUDED_PUBLICATION_NAMES, e.g.
 * Point of Sale, which auto-attaches new products). Safe to call on draft
 * products; they surface on each channel once active.
 */
export async function publishProductToXdipxChannels(numericId: string): Promise<void> {
  const id = numericId.replace('gid://shopify/Product/', '')
  const gid = `gid://shopify/Product/${id}`

  const { publications } = await adminGraphQL<{
    publications: { edges: { node: { id: string; name: string } }[] }
  }>(`query GetPublications { publications(first: 30) { edges { node { id name } } } }`)

  const wanted   = new Set(XDIPX_PUBLICATION_NAMES)
  const excluded = new Set(XDIPX_EXCLUDED_PUBLICATION_NAMES)
  const toPublish   = publications.edges.filter(e => wanted.has(e.node.name)).map(e => e.node.id)
  const toUnpublish = publications.edges.filter(e => excluded.has(e.node.name)).map(e => e.node.id)

  if (toPublish.length > 0) {
    const res = await adminGraphQL<{
      publishablePublish: { userErrors: { field: string[]; message: string }[] }
    }>(`
      mutation PublishProduct($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }
    `, { id: gid, input: toPublish.map(pid => ({ publicationId: pid })) })
    const errs = res.publishablePublish?.userErrors ?? []
    if (errs.length) console.warn('[shopify] publishablePublish:', errs.map(e => e.message).join('; '))
  }

  if (toUnpublish.length > 0) {
    const res = await adminGraphQL<{
      publishableUnpublish: { userErrors: { field: string[]; message: string }[] }
    }>(`
      mutation UnpublishProduct($id: ID!, $input: [PublicationInput!]!) {
        publishableUnpublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }
    `, { id: gid, input: toUnpublish.map(pid => ({ publicationId: pid })) })
    const errs = res.publishableUnpublish?.userErrors ?? []
    if (errs.length) console.warn('[shopify] publishableUnpublish:', errs.map(e => e.message).join('; '))
  }
}

/**
 * Search for a Shopify product by variant SKU via Admin GraphQL.
 * Returns the GID (`gid://shopify/Product/...`) or null if not found.
 */
export async function findProductBySKU(sku: string): Promise<string | null> {
  const data = await adminGraphQL<{
    products: { edges: { node: { id: string } }[] }
  }>(`
    query FindProductBySKU($query: String!) {
      products(first: 1, query: $query) {
        edges { node { id } }
      }
    }
  `, { query: `sku:${sku}` })
  return data.products.edges[0]?.node.id ?? null
}

/**
 * Slugify a string into a Shopify product handle. Phase 1 rebuild — extracted
 * here so legacy callers (`bulk-import`) keep auto-slugify
 * behavior at the call site, while new callers (importNewProduct entry point)
 * accept handle as a required input from the product-management agent.
 *
 * Per CLAUDE.md, the canonical product URL is `/products/{handle}` and the
 * handle should never change once set. Use this helper only as a default for
 * legacy paths; prefer accepting an explicit handle from the caller.
 */
export function slugifyHandle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200)
}

/**
 * Create a new Shopify product (DRAFT status) from a scored Nalpac feed product.
 * Returns the numeric product ID (not GID) as a string.
 *
 * Phase 1 rebuild — `handle` is now a REQUIRED input. The caller picks the
 * handle (typically via `slugifyHandle(product.title)` for legacy parity, or
 * an explicit value from the product-management agent for new imports).
 * Auto-slugify-from-title was removed because the resulting handle is the
 * canonical URL and CLAUDE.md forbids implicit URL generation.
 */
export async function createShopifyProductFromFeed(product: ProductScore, handle: string): Promise<string> {
  const tags = buildProductTags(product)

  // Pricing engine v2 resolves margin rules by product_type — a product created
  // without one prices on the global fallback rule (the 2026-07-21 incident).
  const derived = deriveProductType({ categories: product.categories, title: product.title })
  if (!derived.productType) {
    console.warn(`[product-type] ${product.sku} created without a derivable product_type (categories=${JSON.stringify(product.categories)}) — pricing falls through to the global rule until one is set`)
  }

  const res = await shopifyAdmin<{ product: { id: string; variants: { id: string; inventory_item_id: string }[] } }>('/products.json', 'POST', {
    product: {
      title:   product.title,
      handle,
      vendor:  product.brand,
      tags:    tags.join(', '),
      ...(derived.productType ? { product_type: derived.productType } : {}),
      status:  'draft',
      variants: [{
        sku:                  product.sku,
        price:                product.dealPrice.toFixed(2),
        compare_at_price:     product.msrp.toFixed(2),
        inventory_management: 'shopify',
        inventory_quantity:   product.qty,
      }],
      images: product.images.slice(0, 10).map(src => ({ src })),
    },
  })

  // Set wholesale cost on the inventory item (populates Shopify's native cost field)
  const inventoryItemId = res.product.variants[0]?.inventory_item_id
  if (inventoryItemId) {
    await shopifyAdmin(`/inventory_items/${inventoryItemId}.json`, 'PUT', {
      inventory_item: { id: inventoryItemId, cost: product.wholesaleCost.toFixed(2) },
    })
  }

  return String(res.product.id)
}

/** Read a product's Shopify product_type. Returns null when unset. */
export async function getShopifyProductType(numericProductId: string): Promise<string | null> {
  const res = await shopifyAdmin<{ product: { id: number; product_type: string } }>(
    `/products/${numericProductId}.json?fields=id,product_type`, 'GET',
  )
  const pt = res.product.product_type?.trim()
  return pt ? pt : null
}

/** Set a product's Shopify product_type (pricing engine v2 resolves margin
 *  rules by this field via pricing_product_type_map). */
export async function setShopifyProductType(numericProductId: string, productType: string): Promise<void> {
  await shopifyAdmin(`/products/${numericProductId}.json`, 'PUT', {
    product: { id: Number(numericProductId), product_type: productType },
  })
}

/**
 * Create a Shopify product (DRAFT) with multiple variants for bulk import.
 * Each variant maps to one BulkVariantRow. Returns the numeric product ID.
 */
/**
 * Phase 1 rebuild — `handle` is a REQUIRED input. See `slugifyHandle` and the
 * notes on createShopifyProductFromFeed for why auto-slugify was removed from
 * the create paths.
 */
export async function createShopifyProductWithVariants(
  master: {
    title: string
    brand: string
    sku: string
    images: string[]
    msrp: number
    categories: string[]
  },
  variants: import('~/types').BulkVariantRow[],
  optionNames: string[],
  handle: string,
): Promise<string> {
  if (optionNames.length === 0 || optionNames.length > 2) {
    throw new Error(`createShopifyProductWithVariants: optionNames must have 1 or 2 entries, got ${optionNames.length}`)
  }

  const tags: string[] = [
    `brand:${master.brand.toLowerCase().replace(/\s+/g, '-')}`,
    `nalpac-sku-${master.sku}`,
    ...(master.msrp < 25  ? ['price:under-25']  :
        master.msrp < 50  ? ['price:25-50']      :
        master.msrp < 100 ? ['price:50-100']     : ['price:100-plus']),
    ...master.categories.map(c => `cat:${c.toLowerCase().replace(/\s+/g, '-')}`),
  ]

  // See createShopifyProductFromFeed — product_type drives pricing rule resolution.
  const derived = deriveProductType({ categories: master.categories, title: master.title })
  if (!derived.productType) {
    console.warn(`[product-type] ${master.sku} created without a derivable product_type (categories=${JSON.stringify(master.categories)}) — pricing falls through to the global rule until one is set`)
  }

  const res = await shopifyAdmin<{
    product: {
      id: string
      variants: { id: string; sku: string; inventory_item_id: string }[]
      images: { id: string; src: string }[]
    }
  }>('/products.json', 'POST', {
    product: {
      title:   master.title,
      handle,
      vendor:  master.brand,
      tags:    tags.join(', '),
      ...(derived.productType ? { product_type: derived.productType } : {}),
      status:  'draft',
      options: optionNames.map((name, i) => ({
        name,
        values: [...new Set(variants.map(v => v.optionValues[i]).filter(Boolean))],
      })),
      variants: variants.map(v => ({
        sku:                  v.sku,
        option1:              v.optionValues[0],
        ...(optionNames.length > 1 ? { option2: v.optionValues[1] } : {}),
        price:                v.price.toFixed(2),
        compare_at_price:     v.compareAtPrice.toFixed(2),
        inventory_management: 'shopify',
        inventory_quantity:   v.qty,
      })),
      images: master.images.slice(0, 10).map(src => ({ src })),
    },
  })

  // Per-variant image linkage. The product was created with master.images as
  // the gallery; here we link each variant's first image (variants[i].images[0])
  // to its variant. If the URL is already in the gallery (common when the master
  // row is also variant #1), PUT variant.image_id to the existing image. If it's
  // a new URL, POST a new image with variant_ids so it's both galleried and linked.
  const galleryByUrl = new Map<string, string>()
  for (const img of res.product.images ?? []) galleryByUrl.set(img.src, img.id)

  for (let i = 0; i < res.product.variants.length; i++) {
    const sv = res.product.variants[i]
    const bv = variants[i]
    if (!sv || !bv || bv.images.length === 0) continue
    const firstImage = bv.images[0]
    if (!firstImage) continue
    try {
      const existingId = galleryByUrl.get(firstImage)
      if (existingId) {
        await shopifyAdmin(`/variants/${sv.id}.json`, 'PUT', {
          variant: { id: Number(sv.id), image_id: Number(existingId) },
        })
      } else {
        const imgRes = await shopifyAdmin<{ image: { id: string; src: string } }>(
          `/products/${res.product.id}/images.json`,
          'POST',
          { image: { src: firstImage, variant_ids: [Number(sv.id)] } },
        )
        galleryByUrl.set(firstImage, imgRes.image.id)
      }
    } catch (err) {
      console.warn(`[shopify] variant image linkage failed for ${bv.sku}:`, err instanceof Error ? err.message : err)
    }
    await new Promise(r => setTimeout(r, 250))
  }

  // Set wholesale cost on each variant's inventory item
  for (let i = 0; i < res.product.variants.length; i++) {
    const shopifyVariant = res.product.variants[i]
    const bulkVariant    = variants[i]
    if (shopifyVariant?.inventory_item_id && bulkVariant) {
      await shopifyAdmin(`/inventory_items/${shopifyVariant.inventory_item_id}.json`, 'PUT', {
        inventory_item: {
          id:   shopifyVariant.inventory_item_id,
          cost: bulkVariant.wholesale.toFixed(2),
        },
      })
      // 250ms delay between inventory item updates to avoid rate limiting
      if (i < res.product.variants.length - 1) {
        await new Promise(r => setTimeout(r, 250))
      }
    }
  }

  return String(res.product.id)
}

// ─── Video / Media upload ─────────────────────────────────────────────────────

interface StagedTarget {
  url: string
  resourceUrl: string
  parameters: { name: string; value: string }[]
}

/**
 * Step 1 of Shopify media upload: request a presigned staged upload URL.
 * Returns the staged target including the upload URL and final resource URL.
 */
export async function createStagedVideoUpload(filename: string, fileSizeBytes: number): Promise<StagedTarget> {
  const data = await adminGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: StagedTarget[]
      userErrors: { field: string[]; message: string }[]
    }
  }>(`
    mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
  `, {
    input: [{
      filename,
      mimeType: 'video/mp4',
      httpMethod: 'POST',
      resource: 'VIDEO',
      fileSize: String(fileSizeBytes),
    }],
  })

  if (data.stagedUploadsCreate.userErrors.length > 0) {
    const errs = data.stagedUploadsCreate.userErrors.map(e => e.message).join('; ')
    throw new Error(`Shopify stagedUploadsCreate error: ${errs}`)
  }

  const target = data.stagedUploadsCreate.stagedTargets[0]
  if (!target) throw new Error('Shopify returned no staged upload target')
  return target
}

/**
 * Step 2: attach the staged video to a Shopify product via productCreateMedia.
 * Returns the new media GID.
 */
export async function attachVideoToProduct(
  shopifyProductGid: string,
  resourceUrl: string,
  altText: string,
): Promise<string> {
  const data = await adminGraphQL<{
    productCreateMedia: {
      media: { id: string; status: string }[]
      mediaUserErrors: { field: string[]; message: string }[]
    }
  }>(`
    mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          ... on Video { id status }
          ... on ExternalVideo { id status }
          ... on MediaImage { id status }
        }
        mediaUserErrors { field message }
      }
    }
  `, {
    productId: shopifyProductGid,
    media: [{
      originalSource: resourceUrl,
      alt: altText,
      mediaContentType: 'VIDEO',
    }],
  })

  if (data.productCreateMedia.mediaUserErrors.length > 0) {
    const errs = data.productCreateMedia.mediaUserErrors.map(e => e.message).join('; ')
    throw new Error(`Shopify productCreateMedia error: ${errs}`)
  }

  const mediaId = data.productCreateMedia.media[0]?.id
  if (!mediaId) throw new Error('Shopify returned no media ID after productCreateMedia')
  return mediaId
}

/**
 * Step 3: poll until the media status is READY (or timeout after 90s).
 * Returns true if READY, false on timeout (caller should log and continue).
 */
export async function pollMediaReady(
  shopifyProductGid: string,
  mediaId: string,
  maxWaitMs = 90_000,
): Promise<boolean> {
  const interval = 10_000
  const deadline = Date.now() + maxWaitMs

  while (Date.now() < deadline) {
    const data = await adminGraphQL<{
      product: {
        media: {
          edges: {
            node: { id: string; status: string }
          }[]
        }
      } | null
    }>(`
      query PollMediaStatus($productId: ID!) {
        product(id: $productId) {
          media(first: 20) {
            edges {
              node {
                ... on Video { id status }
                ... on ExternalVideo { id status }
                ... on MediaImage { id status }
              }
            }
          }
        }
      }
    `, { productId: shopifyProductGid })

    const node = data.product?.media.edges.find(e => e.node.id === mediaId)?.node
    if (node?.status === 'READY') return true

    await new Promise(r => setTimeout(r, interval))
  }

  return false // timed out
}

/**
 * Reorder product media so a specific media ID is first (primary thumbnail).
 * Shopify uses productReorderMedia for this.
 */
export async function setMediaAsPrimary(shopifyProductGid: string, mediaId: string): Promise<void> {
  await adminGraphQL<unknown>(`
    mutation ReorderMedia($id: ID!, $moves: [MoveInput!]!) {
      productReorderMedia(id: $id, moves: $moves) {
        mediaUserErrors { field message }
      }
    }
  `, {
    id: shopifyProductGid,
    moves: [{ id: mediaId, newPosition: '0' }],
  })
}

/**
 * Upload an image buffer to Shopify as a product image via staged upload.
 * Returns the new media GID. `mimeType` defaults to `image/jpeg` for
 * backwards compatibility; pass `image/png` for images with transparency.
 */
export async function uploadThumbnailToProduct(
  shopifyProductGid: string,
  imageBuffer: Buffer,
  filename: string,
  altText: string,
  mimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<string> {
  // 1. Create staged upload target for the image
  const staged = await adminGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: StagedTarget[]
      userErrors: { field: string[]; message: string }[]
    }
  }>(`
    mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }
  `, {
    input: [{
      filename,
      mimeType,
      httpMethod: 'POST',
      resource:   'IMAGE',
      fileSize:   String(imageBuffer.length),
    }],
  })

  if (staged.stagedUploadsCreate.userErrors.length > 0) {
    const errs = staged.stagedUploadsCreate.userErrors.map(e => e.message).join('; ')
    throw new Error(`Shopify stagedUploadsCreate (image) error: ${errs}`)
  }

  const target = staged.stagedUploadsCreate.stagedTargets[0]
  if (!target) throw new Error('Shopify returned no staged upload target for image')

  // 2. POST image to staged URL
  const form = new FormData()
  for (const param of target.parameters) form.append(param.name, param.value)
  form.append('file', new Blob([new Uint8Array(imageBuffer)], { type: mimeType }), filename)

  const uploadRes = await fetch(target.url, { method: 'POST', body: form })
  if (!uploadRes.ok) {
    throw new Error(`Staged image upload failed: ${uploadRes.status} ${await uploadRes.text()}`)
  }

  // 3. Attach to product as IMAGE media
  const data = await adminGraphQL<{
    productCreateMedia: {
      media: { id: string }[]
      mediaUserErrors: { field: string[]; message: string }[]
    }
  }>(`
    mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { ... on MediaImage { id } }
        mediaUserErrors { field message }
      }
    }
  `, {
    productId: shopifyProductGid,
    media: [{
      originalSource:   target.resourceUrl,
      alt:              altText,
      mediaContentType: 'IMAGE',
    }],
  })

  if (data.productCreateMedia.mediaUserErrors.length > 0) {
    const errs = data.productCreateMedia.mediaUserErrors.map(e => e.message).join('; ')
    throw new Error(`Shopify productCreateMedia (image) error: ${errs}`)
  }

  const mediaId = data.productCreateMedia.media[0]?.id
  if (!mediaId) throw new Error('Shopify returned no media ID after image upload')
  return mediaId
}

export interface ShopifyFileUpload {
  url: string
  /** The Shopify Files GID (`gid://shopify/GenericFile/…` or MediaImage), for
   *  a future deterministic purge. Null only if Shopify's response omitted it,
   *  which should not happen in practice. */
  fileId: string | null
}

/**
 * Upload a JPEG buffer to Shopify Files (not attached to any product) and
 * return its public CDN URL plus the Shopify Files GID. Used by the
 * bulk-import orchestrator's mood-image tool: the resulting URL is written to
 * the product's xdipx.mood_image_url metafield so the PDP hero can render it
 * as a full-bleed background.
 */
export async function uploadMoodImageToShopifyFilesWithId(
  imageBuffer: Buffer,
  filename: string,
): Promise<ShopifyFileUpload> {
  const staged = await adminGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: StagedTarget[]
      userErrors: { field: string[]; message: string }[]
    }
  }>(`
    mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }
  `, {
    input: [{
      filename,
      mimeType:   'image/jpeg',
      httpMethod: 'POST',
      resource:   'FILE',
      fileSize:   String(imageBuffer.length),
    }],
  })

  if (staged.stagedUploadsCreate.userErrors.length > 0) {
    const errs = staged.stagedUploadsCreate.userErrors.map(e => e.message).join('; ')
    throw new Error(`Shopify stagedUploadsCreate (mood image file) error: ${errs}`)
  }

  const target = staged.stagedUploadsCreate.stagedTargets[0]
  if (!target) throw new Error('Shopify returned no staged upload target for mood image')

  const form = new FormData()
  for (const param of target.parameters) form.append(param.name, param.value)
  form.append('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), filename)

  const uploadRes = await fetch(target.url, { method: 'POST', body: form })
  if (!uploadRes.ok) {
    throw new Error(`Staged mood-image upload failed: ${uploadRes.status} ${await uploadRes.text()}`)
  }

  // Register as a Generic File so it gets a permanent CDN URL.
  const created = await adminGraphQL<{
    fileCreate: {
      files: { id: string; fileStatus: string; url?: string; image?: { url: string } }[]
      userErrors: { field: string[]; message: string }[]
    }
  }>(`
    mutation FileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          ... on GenericFile { url }
          ... on MediaImage { image { url } }
        }
        userErrors { field message }
      }
    }
  `, {
    files: [{
      originalSource:   target.resourceUrl,
      contentType:      'IMAGE',
      alt:              filename,
    }],
  })

  if (created.fileCreate.userErrors.length > 0) {
    const errs = created.fileCreate.userErrors.map(e => e.message).join('; ')
    throw new Error(`Shopify fileCreate (mood image) error: ${errs}`)
  }

  const file = created.fileCreate.files[0] as
    | { id: string; url?: string; image?: { url?: string } }
    | undefined
  const fileId = file?.id ?? null
  const url = file?.url ?? file?.image?.url
  if (!url) {
    // The file was created but has not yet been processed. Poll once briefly.
    if (!fileId) throw new Error('Shopify fileCreate returned no file id')
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500))
      const polled = await adminGraphQL<{
        node: { id: string; url?: string; image?: { url?: string } } | null
      }>(`
        query PollFile($id: ID!) {
          node(id: $id) {
            ... on GenericFile { id url }
            ... on MediaImage  { id image { url } }
          }
        }
      `, { id: fileId })
      const u = polled.node?.url ?? polled.node?.image?.url
      if (u) return { url: u, fileId }
    }
    throw new Error('Shopify fileCreate: no URL after polling')
  }
  return { url, fileId }
}

/**
 * Backward-compatible wrapper: same upload, url-only return. Existing callers
 * that only need the CDN url (and do not care about the Shopify Files GID)
 * keep compiling unchanged. New callers that want `shopify_file_id` for a
 * future deterministic purge (ticket #5426) should call
 * `uploadMoodImageToShopifyFilesWithId` instead.
 */
export async function uploadMoodImageToShopifyFiles(
  imageBuffer: Buffer,
  filename: string,
): Promise<string> {
  const { url } = await uploadMoodImageToShopifyFilesWithId(imageBuffer, filename)
  return url
}

/**
 * Upload a finished social/ad video as a Shopify FILE (not product media): a
 * stable public CDN URL for admin preview + manual download, WITHOUT touching
 * the product's customer-facing gallery. Reserve attachVideoToProduct for
 * clips that genuinely belong on the PDP.
 *
 * FileCreateInput carries no tags field; reuse metadata rides the structured
 * FILENAME (social-{handle}-{persona}-{platform}-{yyyymmdd}.mp4) + alt text.
 */
export async function uploadVideoToShopifyFiles(
  videoBuffer: Buffer,
  filename: string,
  opts: { alt?: string } = {},
): Promise<string> {
  const staged = await createStagedVideoUpload(filename, videoBuffer.length)

  const form = new FormData()
  for (const param of staged.parameters) form.append(param.name, param.value)
  form.append('file', new Blob([new Uint8Array(videoBuffer)], { type: 'video/mp4' }), filename)
  const uploadRes = await fetch(staged.url, { method: 'POST', body: form })
  if (!uploadRes.ok) {
    throw new Error(`Staged video-file upload failed: ${uploadRes.status} ${await uploadRes.text()}`)
  }

  const created = await adminGraphQL<{
    fileCreate: {
      files: { id: string; fileStatus: string }[]
      userErrors: { field: string[]; message: string }[]
    }
  }>(`
    mutation FileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus }
        userErrors { field message }
      }
    }
  `, {
    files: [{
      originalSource: staged.resourceUrl,
      contentType:    'VIDEO',
      alt:            opts.alt ?? filename,
    }],
  })
  if (created.fileCreate.userErrors.length > 0) {
    const errs = created.fileCreate.userErrors.map(e => e.message).join('; ')
    throw new Error(`Shopify fileCreate (video) error: ${errs}`)
  }
  const fileId = created.fileCreate.files[0]?.id
  if (!fileId) throw new Error('Shopify fileCreate (video) returned no file id')

  // Video files process asynchronously; poll for the CDN source URL.
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const polled = await adminGraphQL<{
      node: { id: string; fileStatus?: string; sources?: { url: string; format?: string }[] } | null
    }>(`
      query PollVideoFile($id: ID!) {
        node(id: $id) {
          ... on Video { id fileStatus sources { url format } }
        }
      }
    `, { id: fileId })
    const sources = polled.node?.sources ?? []
    const mp4 = sources.find(s => s.format === 'mp4') ?? sources[0]
    if (polled.node?.fileStatus === 'READY' && mp4?.url) return mp4.url
    if (polled.node?.fileStatus === 'FAILED') throw new Error('Shopify video file processing FAILED')
  }
  throw new Error('Shopify video file: no CDN URL after 60s of polling')
}

/**
 * Write the xdipx.hero_video metafield ({ src, poster, duration } JSON) that
 * ProductCard/CardMediaCarousel autoplay and the PDP gallery read. This is the
 * ONLY writer — until now the metafield was set by hand in Shopify admin.
 */
export async function setHeroVideoMetafield(
  productGid: string,
  video: { src: string; poster?: string; duration?: number },
): Promise<void> {
  await setMetafield(productGid, 'xdipx', 'hero_video', 'json', JSON.stringify(video))
}

// ─── Admin Image Management ───────────────────────────────────────────────────

export interface AdminProductImage {
  id: number
  position: number
  src: string
  alt: string | null
  width?: number
  height?: number
}

export async function getProductAdminImages(numericId: string): Promise<AdminProductImage[]> {
  const id = numericId.replace('gid://shopify/Product/', '')
  const data = await shopifyAdmin<{ images: AdminProductImage[] }>(`/products/${id}/images.json?limit=250`)
  return data.images ?? []
}

export async function deleteProductImage(numericProductId: string, imageId: number): Promise<void> {
  const id = numericProductId.replace('gid://shopify/Product/', '')
  await shopifyAdmin<unknown>(`/products/${id}/images/${imageId}.json`, 'DELETE')
}

/**
 * Delete media (images/videos) from a product by GID. Use this for media created
 * via productCreateMedia — the REST /products/{id}/images/{id}.json path does not
 * accept media GIDs.
 */
export async function deleteProductMedia(
  shopifyProductGid: string,
  mediaGids: string[],
): Promise<void> {
  if (mediaGids.length === 0) return
  const data = await adminGraphQL<{
    productDeleteMedia: {
      deletedMediaIds: string[]
      mediaUserErrors: { field: string[]; message: string }[]
    }
  }>(`
    mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
      productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
        deletedMediaIds
        mediaUserErrors { field message }
      }
    }
  `, { productId: shopifyProductGid, mediaIds: mediaGids })

  if (data.productDeleteMedia.mediaUserErrors.length > 0) {
    const errs = data.productDeleteMedia.mediaUserErrors.map(e => e.message).join('; ')
    throw new Error(`Shopify productDeleteMedia error: ${errs}`)
  }
}

export async function reorderProductImages(
  numericProductId: string,
  imagePositions: { id: number; position: number }[],
): Promise<void> {
  const id = numericProductId.replace('gid://shopify/Product/', '')
  await Promise.all(
    imagePositions.map(img =>
      shopifyAdmin<unknown>(`/products/${id}/images/${img.id}.json`, 'PUT', {
        image: { id: img.id, position: img.position },
      }),
    ),
  )
}

export async function associateImageWithVariant(
  _numericProductId: string,
  numericVariantId: string,
  imageId: number,
): Promise<void> {
  const vid = numericVariantId.replace('gid://shopify/ProductVariant/', '')
  await shopifyAdmin<unknown>(`/variants/${vid}.json`, 'PUT', {
    variant: { id: parseInt(vid), image_id: imageId },
  })
}

// ─── Customer Auth (Storefront API) ──────────────────────────────────────────

export interface StorefrontCustomer {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  orders: StorefrontOrder[]
}

export interface StorefrontOrder {
  id: string
  orderNumber: number
  processedAt: string
  financialStatus: string
  fulfillmentStatus: string
  totalPrice: { amount: string; currencyCode: string }
  lineItems: {
    title: string
    quantity: number
    imageUrl: string | null
    price: string
  }[]
}

export async function createCustomerAccessToken(
  email: string,
  password: string,
): Promise<{ accessToken: string; expiresAt: string } | { error: string }> {
  const data = await storefront<{
    customerAccessTokenCreate: {
      customerAccessToken: { accessToken: string; expiresAt: string } | null
      customerUserErrors: { message: string }[]
    }
  }>(`
    mutation CustomerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
      customerAccessTokenCreate(input: $input) {
        customerAccessToken { accessToken expiresAt }
        customerUserErrors { message }
      }
    }
  `, { input: { email, password } })

  const { customerAccessToken, customerUserErrors } = data.customerAccessTokenCreate
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? 'Login failed' }
  }
  if (!customerAccessToken) return { error: 'Login failed' }
  return customerAccessToken
}

export async function getStorefrontCustomer(
  accessToken: string,
): Promise<StorefrontCustomer | null> {
  const data = await storefront<{
    customer: {
      id: string; firstName: string; lastName: string
      email: string; phone: string | null
      orders: {
        edges: {
          node: {
            id: string; orderNumber: number; processedAt: string
            financialStatus: string; fulfillmentStatus: string
            currentTotalPrice: { amount: string; currencyCode: string }
            lineItems: {
              edges: {
                node: {
                  title: string; quantity: number
                  variant: {
                    image: { url: string } | null
                    price: { amount: string }
                  } | null
                }
              }[]
            }
          }
        }[]
      }
    } | null
  }>(`
    query GetCustomer($customerAccessToken: String!) {
      customer(customerAccessToken: $customerAccessToken) {
        id firstName lastName email phone
        orders(first: 20, sortKey: PROCESSED_AT, reverse: true) {
          edges {
            node {
              id orderNumber processedAt financialStatus fulfillmentStatus
              currentTotalPrice { amount currencyCode }
              lineItems(first: 5) {
                edges {
                  node {
                    title quantity
                    variant {
                      image { url }
                      price { amount }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `, { customerAccessToken: accessToken }).catch(() => ({ customer: null }))

  const c = data?.customer
  if (!c) return null

  return {
    id:        c.id,
    firstName: c.firstName,
    lastName:  c.lastName,
    email:     c.email,
    phone:     c.phone,
    orders:    c.orders.edges.map(({ node: o }) => ({
      id:                o.id,
      orderNumber:       o.orderNumber,
      processedAt:       o.processedAt,
      financialStatus:   o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      totalPrice:        o.currentTotalPrice,
      lineItems:         o.lineItems.edges.map(({ node: li }) => ({
        title:    li.title,
        quantity: li.quantity,
        imageUrl: li.variant?.image?.url ?? null,
        price:    li.variant?.price.amount ?? '0',
      })),
    })),
  }
}

// ─── Customer API Surface (Phase 0A) ──────────────────────────────────────────
//
// Full customer API surface for the /account space. All Storefront API
// mutations surface user errors as `{ error: string }`. See the existing
// `createCustomerAccessToken` (above) for the pattern.

export interface CustomerAddress {
  id: string
  firstName: string | null
  lastName: string | null
  company: string | null
  address1: string | null
  address2: string | null
  city: string | null
  province: string | null
  provinceCode: string | null
  country: string | null
  countryCodeV2: string | null
  zip: string | null
  phone: string | null
  formatted: string[]
}

export interface CustomerProfile {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  acceptsMarketing: boolean
  createdAt: string
  defaultAddressId: string | null
  addresses: CustomerAddress[]
  orders: StorefrontOrder[] // lean list for dashboard (first 10)
}

export interface FulfillmentTracking {
  number: string | null
  url: string | null
  company: string | null
}

export interface Fulfillment {
  trackingCompany: string | null
  trackingInfo: FulfillmentTracking[]
}

export interface OrderDetail {
  id: string
  orderNumber: number
  processedAt: string
  financialStatus: string
  fulfillmentStatus: string
  statusUrl: string | null
  email: string | null
  phone: string | null
  canceledAt: string | null
  cancelReason: string | null
  shippingAddress: CustomerAddress | null
  subtotalPrice: { amount: string; currencyCode: string } | null
  totalShippingPrice: { amount: string; currencyCode: string } | null
  totalTax: { amount: string; currencyCode: string } | null
  totalPrice: { amount: string; currencyCode: string }
  successfulFulfillments: Fulfillment[]
  lineItems: {
    title: string
    quantity: number
    variantId: string | null
    variantTitle: string | null
    imageUrl: string | null
    unitPrice: { amount: string; currencyCode: string } | null
  }[]
}

export interface PaginatedOrders {
  orders: StorefrontOrder[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
}

// ─── Subscription Contract types ─────────────────────────────────────────────

export interface SubscriptionContractLine {
  id: string
  title: string
  variantTitle: string | null
  quantity: number
  currentPrice: { amount: string; currencyCode: string }
  imageUrl: string | null
  productId: string | null
}

export interface SubscriptionIntervalPolicy {
  interval: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | string
  intervalCount: number
}

export interface SubscriptionContract {
  id: string
  status: string // ACTIVE | PAUSED | CANCELLED | EXPIRED | STALE | FAILED
  createdAt: string
  nextBillingDate: string | null
  currencyCode: string
  customerId: string
  billingPolicy: SubscriptionIntervalPolicy | null
  deliveryPolicy: SubscriptionIntervalPolicy | null
  lines: SubscriptionContractLine[]
  subtotalAmount: { amount: string; currencyCode: string } | null
  shippingAddress: {
    firstName: string | null
    lastName: string | null
    address1: string | null
    address2: string | null
    city: string | null
    province: string | null
    country: string | null
    zip: string | null
    phone: string | null
  } | null
}

export interface Country {
  isoCode: string
  name: string
  unitSystem: string
  currency: { isoCode: string; symbol: string; name: string }
}

export interface CustomerCreateInput {
  firstName?: string
  lastName?: string
  email: string
  password: string
  phone?: string
  acceptsMarketing?: boolean
}

export interface CustomerUpdateInput {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  password?: string
  acceptsMarketing?: boolean
}

export interface CustomerAddressInput {
  firstName?: string
  lastName?: string
  company?: string
  address1?: string
  address2?: string
  city?: string
  province?: string // use full name; Shopify returns provinceCode derived
  country?: string // full country name
  zip?: string
  phone?: string
}

// ─── Shared GraphQL fragments for customer queries ─────────────────────────────

const CUSTOMER_ADDRESS_FRAGMENT = `
  id
  firstName
  lastName
  company
  address1
  address2
  city
  province
  provinceCode
  country
  countryCodeV2
  zip
  phone
  formatted
`

const STOREFRONT_ORDER_LEAN_FRAGMENT = `
  id orderNumber processedAt financialStatus fulfillmentStatus
  currentTotalPrice { amount currencyCode }
  lineItems(first: 5) {
    edges {
      node {
        title quantity
        variant {
          image { url }
          price { amount }
        }
      }
    }
  }
`

// ─── Raw shape helpers ─────────────────────────────────────────────────────────

interface RawCustomerAddress {
  id: string
  firstName: string | null
  lastName: string | null
  company: string | null
  address1: string | null
  address2: string | null
  city: string | null
  province: string | null
  provinceCode: string | null
  country: string | null
  countryCodeV2: string | null
  zip: string | null
  phone: string | null
  formatted: string[]
}

interface RawStorefrontOrderLean {
  id: string
  orderNumber: number
  processedAt: string
  financialStatus: string
  fulfillmentStatus: string
  currentTotalPrice: { amount: string; currencyCode: string }
  lineItems: {
    edges: {
      node: {
        title: string
        quantity: number
        variant: {
          image: { url: string } | null
          price: { amount: string }
        } | null
      }
    }[]
  }
}

function mapCustomerAddress(a: RawCustomerAddress): CustomerAddress {
  return {
    id: a.id,
    firstName: a.firstName,
    lastName: a.lastName,
    company: a.company,
    address1: a.address1,
    address2: a.address2,
    city: a.city,
    province: a.province,
    provinceCode: a.provinceCode,
    country: a.country,
    countryCodeV2: a.countryCodeV2,
    zip: a.zip,
    phone: a.phone,
    formatted: a.formatted,
  }
}

function mapLeanOrder(o: RawStorefrontOrderLean): StorefrontOrder {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    processedAt: o.processedAt,
    financialStatus: o.financialStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    totalPrice: o.currentTotalPrice,
    lineItems: o.lineItems.edges.map(({ node: li }) => ({
      title: li.title,
      quantity: li.quantity,
      imageUrl: li.variant?.image?.url ?? null,
      price: li.variant?.price.amount ?? '0',
    })),
  }
}

// ─── Customer Queries ──────────────────────────────────────────────────────────

export async function getCustomerProfile(
  accessToken: string,
): Promise<CustomerProfile | null> {
  const data = await storefront<{
    customer: {
      id: string
      firstName: string | null
      lastName: string | null
      email: string
      phone: string | null
      acceptsMarketing: boolean
      createdAt: string
      defaultAddress: { id: string } | null
      addresses: { edges: { node: RawCustomerAddress }[] }
      orders: { edges: { node: RawStorefrontOrderLean }[] }
    } | null
  }>(`
    query GetCustomerProfile($customerAccessToken: String!) {
      customer(customerAccessToken: $customerAccessToken) {
        id firstName lastName email phone acceptsMarketing createdAt
        defaultAddress { id }
        addresses(first: 20) {
          edges { node { ${CUSTOMER_ADDRESS_FRAGMENT} } }
        }
        orders(first: 10, sortKey: PROCESSED_AT, reverse: true) {
          edges { node { ${STOREFRONT_ORDER_LEAN_FRAGMENT} } }
        }
      }
    }
  `, { customerAccessToken: accessToken }).catch(() => ({ customer: null }))

  const c = data?.customer
  if (!c) return null

  return {
    id: c.id,
    firstName: c.firstName ?? '',
    lastName: c.lastName ?? '',
    email: c.email,
    phone: c.phone,
    acceptsMarketing: c.acceptsMarketing,
    createdAt: c.createdAt,
    defaultAddressId: c.defaultAddress?.id ?? null,
    addresses: c.addresses.edges.map(e => mapCustomerAddress(e.node)),
    orders: c.orders.edges.map(e => mapLeanOrder(e.node)),
  }
}

export async function getCustomerOrders(
  accessToken: string,
  opts: { first?: number; after?: string | null; query?: string } = {},
): Promise<PaginatedOrders> {
  const first = opts.first ?? 10
  const after = opts.after ?? null
  const query = opts.query ?? null

  const data = await storefront<{
    customer: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        edges: { node: RawStorefrontOrderLean }[]
      }
    } | null
  }>(`
    query GetCustomerOrders($customerAccessToken: String!, $first: Int!, $after: String, $query: String) {
      customer(customerAccessToken: $customerAccessToken) {
        orders(first: $first, after: $after, sortKey: PROCESSED_AT, reverse: true, query: $query) {
          pageInfo { hasNextPage endCursor }
          edges { node { ${STOREFRONT_ORDER_LEAN_FRAGMENT} } }
        }
      }
    }
  `, { customerAccessToken: accessToken, first, after, query })

  const c = data?.customer
  if (!c) {
    return { orders: [], pageInfo: { hasNextPage: false, endCursor: null } }
  }

  return {
    orders: c.orders.edges.map(e => mapLeanOrder(e.node)),
    pageInfo: c.orders.pageInfo,
  }
}

interface RawOrderDetail {
  id: string
  orderNumber: number
  processedAt: string
  financialStatus: string
  fulfillmentStatus: string
  statusUrl: string | null
  email: string | null
  phone: string | null
  canceledAt: string | null
  cancelReason: string | null
  shippingAddress: RawCustomerAddress | null
  subtotalPriceV2: { amount: string; currencyCode: string } | null
  totalShippingPriceV2: { amount: string; currencyCode: string } | null
  totalTaxV2: { amount: string; currencyCode: string } | null
  totalPriceV2: { amount: string; currencyCode: string }
  successfulFulfillments: {
    trackingCompany: string | null
    trackingInfo: { number: string | null; url: string | null }[]
  }[]
  lineItems: {
    edges: {
      node: {
        title: string
        quantity: number
        variant: {
          id: string
          title: string | null
          image: { url: string } | null
          price: { amount: string; currencyCode: string }
        } | null
      }
    }[]
  }
}

function mapOrderDetail(o: RawOrderDetail): OrderDetail {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    processedAt: o.processedAt,
    financialStatus: o.financialStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    statusUrl: o.statusUrl,
    email: o.email,
    phone: o.phone,
    canceledAt: o.canceledAt,
    cancelReason: o.cancelReason,
    shippingAddress: o.shippingAddress ? mapCustomerAddress(o.shippingAddress) : null,
    subtotalPrice: o.subtotalPriceV2,
    totalShippingPrice: o.totalShippingPriceV2,
    totalTax: o.totalTaxV2,
    totalPrice: o.totalPriceV2,
    successfulFulfillments: o.successfulFulfillments.map(f => ({
      trackingCompany: f.trackingCompany,
      trackingInfo: f.trackingInfo.map(t => ({
        number: t.number,
        url: t.url,
        company: f.trackingCompany,
      })),
    })),
    lineItems: o.lineItems.edges.map(({ node: li }) => ({
      title: li.title,
      quantity: li.quantity,
      variantId: li.variant?.id ?? null,
      variantTitle: li.variant?.title ?? null,
      imageUrl: li.variant?.image?.url ?? null,
      unitPrice: li.variant?.price
        ? { amount: li.variant.price.amount, currencyCode: li.variant.price.currencyCode }
        : null,
    })),
  }
}

export async function getCustomerOrder(
  accessToken: string,
  orderId: string,
): Promise<OrderDetail | null> {
  // Storefront customer.orders query syntax does not support id lookup
  // reliably, so we fetch a wide page and filter client-side. Acceptable
  // for account UX; revisit if perf becomes an issue.
  const data = await storefront<{
    customer: {
      orders: {
        edges: { node: RawOrderDetail }[]
      }
    } | null
  }>(`
    query GetCustomerOrder($customerAccessToken: String!) {
      customer(customerAccessToken: $customerAccessToken) {
        orders(first: 250, sortKey: PROCESSED_AT, reverse: true) {
          edges {
            node {
              id orderNumber processedAt financialStatus fulfillmentStatus
              statusUrl email phone canceledAt cancelReason
              shippingAddress { ${CUSTOMER_ADDRESS_FRAGMENT} }
              subtotalPriceV2 { amount currencyCode }
              totalShippingPriceV2 { amount currencyCode }
              totalTaxV2 { amount currencyCode }
              totalPriceV2 { amount currencyCode }
              successfulFulfillments(first: 10) {
                trackingCompany
                trackingInfo(first: 10) { number url }
              }
              lineItems(first: 50) {
                edges {
                  node {
                    title quantity
                    variant {
                      id
                      title
                      image { url }
                      price { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `, { customerAccessToken: accessToken }).catch(() => ({ customer: null }))

  const c = data?.customer
  if (!c) return null

  const match = c.orders.edges.find(e => e.node.id === orderId)
  if (!match) return null
  return mapOrderDetail(match.node)
}

export async function getCustomerAddresses(
  accessToken: string,
): Promise<CustomerAddress[]> {
  const data = await storefront<{
    customer: {
      addresses: { edges: { node: RawCustomerAddress }[] }
    } | null
  }>(`
    query GetCustomerAddresses($customerAccessToken: String!) {
      customer(customerAccessToken: $customerAccessToken) {
        addresses(first: 50) {
          edges { node { ${CUSTOMER_ADDRESS_FRAGMENT} } }
        }
      }
    }
  `, { customerAccessToken: accessToken }).catch(() => ({ customer: null }))

  const c = data?.customer
  if (!c) return []
  return c.addresses.edges.map(e => mapCustomerAddress(e.node))
}

export async function getCountries(): Promise<Country[]> {
  const data = await storefront<{
    localization: {
      availableCountries: {
        isoCode: string
        name: string
        unitSystem: string
        currency: { isoCode: string; symbol: string; name: string }
      }[]
    }
  }>(`
    query GetCountries {
      localization {
        availableCountries {
          isoCode
          name
          unitSystem
          currency { isoCode symbol name }
        }
      }
    }
  `)

  return [...data.localization.availableCountries].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

// ─── Customer Mutations ────────────────────────────────────────────────────────

export async function customerCreate(
  input: CustomerCreateInput,
): Promise<{ customer: { id: string; email: string } } | { error: string }> {
  const data = await storefront<{
    customerCreate: {
      customer: { id: string; email: string } | null
      customerUserErrors: { message: string }[]
    }
  }>(`
    mutation CustomerCreate($input: CustomerCreateInput!) {
      customerCreate(input: $input) {
        customer { id email }
        customerUserErrors { message }
      }
    }
  `, { input })

  const { customer, customerUserErrors } = data.customerCreate
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? 'Account creation failed' }
  }
  if (!customer) return { error: 'Account creation failed' }
  return { customer }
}

/**
 * Given a social login identity (email + provider-scoped user ID), derives a
 * deterministic Shopify password via HMAC, creates the customer if needed, and
 * returns a Storefront API access token.
 *
 * The password is never stored — it is reproduced on every login from the
 * stable provider user ID and the OAUTH_PASSWORD_SECRET env var.
 */
export async function loginWithSocialIdentity(params: {
  email: string
  firstName: string
  lastName: string
  provider: 'google' | 'facebook'
  providerId: string
}): Promise<{ accessToken: string; expiresAt: string } | { error: string }> {
  const secret = process.env['OAUTH_PASSWORD_SECRET'] ?? 'oauth-secret-change-me'
  const password = crypto
    .createHmac('sha256', secret)
    .update(`${params.provider}:${params.providerId}`)
    .digest('base64url')
    .slice(0, 32)

  // Try to get existing token first (returning customer)
  const tokenResult = await createCustomerAccessToken(params.email, password)
  if ('accessToken' in tokenResult) return tokenResult

  // Customer doesn't exist yet — create them
  const createResult = await customerCreate({
    email:            params.email,
    password,
    firstName:        params.firstName,
    lastName:         params.lastName,
    acceptsMarketing: false,
  })
  if ('error' in createResult) return { error: createResult.error }

  return createCustomerAccessToken(params.email, password)
}

export async function customerRecover(
  email: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const data = await storefront<{
      customerRecover: {
        customerUserErrors: { message: string }[]
      }
    }>(`
      mutation CustomerRecover($email: String!) {
        customerRecover(email: $email) {
          customerUserErrors { message }
        }
      }
    `, { email })

    // Intentionally swallow errors to prevent account enumeration —
    // always return ok so callers can't distinguish "unknown email" from success.
    if (data.customerRecover.customerUserErrors.length > 0) {
      console.error('[customerRecover] user errors:', data.customerRecover.customerUserErrors)
    }
  } catch (err) {
    console.error('[customerRecover] request failed:', err)
  }
  return { ok: true }
}

export async function customerReset(
  id: string,
  resetToken: string,
  password: string,
): Promise<{ accessToken: string } | { error: string }> {
  const data = await storefront<{
    customerReset: {
      customerAccessToken: { accessToken: string } | null
      customerUserErrors: { message: string }[]
    }
  }>(`
    mutation CustomerReset($id: ID!, $input: CustomerResetInput!) {
      customerReset(id: $id, input: $input) {
        customerAccessToken { accessToken }
        customerUserErrors { message }
      }
    }
  `, { id, input: { resetToken, password } })

  const { customerAccessToken, customerUserErrors } = data.customerReset
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? 'Password reset failed' }
  }
  if (!customerAccessToken) return { error: 'Password reset failed' }
  return { accessToken: customerAccessToken.accessToken }
}

export async function customerResetByUrl(
  resetUrl: string,
  password: string,
): Promise<{ accessToken: string } | { error: string }> {
  const data = await storefront<{
    customerResetByUrl: {
      customerAccessToken: { accessToken: string } | null
      customerUserErrors: { message: string }[]
    }
  }>(`
    mutation CustomerResetByUrl($resetUrl: URL!, $password: String!) {
      customerResetByUrl(resetUrl: $resetUrl, password: $password) {
        customerAccessToken { accessToken }
        customerUserErrors { message }
      }
    }
  `, { resetUrl, password })

  const { customerAccessToken, customerUserErrors } = data.customerResetByUrl
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? 'Password reset failed' }
  }
  if (!customerAccessToken) return { error: 'Password reset failed' }
  return { accessToken: customerAccessToken.accessToken }
}

export async function customerActivate(
  id: string,
  activationToken: string,
  password: string,
): Promise<{ accessToken: string } | { error: string }> {
  const data = await storefront<{
    customerActivate: {
      customerAccessToken: { accessToken: string } | null
      customerUserErrors: { message: string }[]
    }
  }>(`
    mutation CustomerActivate($id: ID!, $input: CustomerActivateInput!) {
      customerActivate(id: $id, input: $input) {
        customerAccessToken { accessToken }
        customerUserErrors { message }
      }
    }
  `, { id, input: { activationToken, password } })

  const { customerAccessToken, customerUserErrors } = data.customerActivate
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? 'Activation failed' }
  }
  if (!customerAccessToken) return { error: 'Activation failed' }
  return { accessToken: customerAccessToken.accessToken }
}

export async function customerActivateByUrl(
  activationUrl: string,
  password: string,
): Promise<{ accessToken: string } | { error: string }> {
  const data = await storefront<{
    customerActivateByUrl: {
      customerAccessToken: { accessToken: string } | null
      customerUserErrors: { message: string }[]
    }
  }>(`
    mutation CustomerActivateByUrl($activationUrl: URL!, $password: String!) {
      customerActivateByUrl(activationUrl: $activationUrl, password: $password) {
        customerAccessToken { accessToken }
        customerUserErrors { message }
      }
    }
  `, { activationUrl, password })

  const { customerAccessToken, customerUserErrors } = data.customerActivateByUrl
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? 'Activation failed' }
  }
  if (!customerAccessToken) return { error: 'Activation failed' }
  return { accessToken: customerAccessToken.accessToken }
}

export async function customerUpdate(
  accessToken: string,
  input: CustomerUpdateInput,
): Promise<
  | { customer: CustomerProfile; accessToken: string | null }
  | { error: string }
> {
  const data = await storefront<{
    customerUpdate: {
      customer: { id: string } | null
      customerAccessToken: { accessToken: string; expiresAt: string } | null
      customerUserErrors: { message: string }[]
    }
  }>(`
    mutation CustomerUpdate($customerAccessToken: String!, $customer: CustomerUpdateInput!) {
      customerUpdate(customerAccessToken: $customerAccessToken, customer: $customer) {
        customer { id }
        customerAccessToken { accessToken expiresAt }
        customerUserErrors { message }
      }
    }
  `, { customerAccessToken: accessToken, customer: input })

  const { customer, customerAccessToken, customerUserErrors } = data.customerUpdate
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? 'Update failed' }
  }
  if (!customer) return { error: 'Update failed' }

  const newToken = customerAccessToken?.accessToken ?? null
  const tokenForRefetch = newToken ?? accessToken
  const profile = await getCustomerProfile(tokenForRefetch)
  if (!profile) return { error: 'Update succeeded but profile refetch failed' }

  return { customer: profile, accessToken: newToken }
}

export async function customerAddressCreate(
  accessToken: string,
  address: CustomerAddressInput,
): Promise<{ address: CustomerAddress } | { error: string }> {
  const data = await storefront<{
    customerAddressCreate: {
      customerAddress: RawCustomerAddress | null
      customerUserErrors: { message: string }[]
    }
  }>(`
    mutation CustomerAddressCreate($customerAccessToken: String!, $address: MailingAddressInput!) {
      customerAddressCreate(customerAccessToken: $customerAccessToken, address: $address) {
        customerAddress { ${CUSTOMER_ADDRESS_FRAGMENT} }
        customerUserErrors { message }
      }
    }
  `, { customerAccessToken: accessToken, address })

  const { customerAddress, customerUserErrors } = data.customerAddressCreate
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? 'Address create failed' }
  }
  if (!customerAddress) return { error: 'Address create failed' }
  return { address: mapCustomerAddress(customerAddress) }
}

export async function customerAddressUpdate(
  accessToken: string,
  id: string,
  address: CustomerAddressInput,
): Promise<{ address: CustomerAddress } | { error: string }> {
  const data = await storefront<{
    customerAddressUpdate: {
      customerAddress: RawCustomerAddress | null
      customerUserErrors: { message: string }[]
    }
  }>(`
    mutation CustomerAddressUpdate($customerAccessToken: String!, $id: ID!, $address: MailingAddressInput!) {
      customerAddressUpdate(customerAccessToken: $customerAccessToken, id: $id, address: $address) {
        customerAddress { ${CUSTOMER_ADDRESS_FRAGMENT} }
        customerUserErrors { message }
      }
    }
  `, { customerAccessToken: accessToken, id, address })

  const { customerAddress, customerUserErrors } = data.customerAddressUpdate
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? 'Address update failed' }
  }
  if (!customerAddress) return { error: 'Address update failed' }
  return { address: mapCustomerAddress(customerAddress) }
}

export async function customerAddressDelete(
  accessToken: string,
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const data = await storefront<{
    customerAddressDelete: {
      deletedCustomerAddressId: string | null
      customerUserErrors: { message: string }[]
    }
  }>(`
    mutation CustomerAddressDelete($customerAccessToken: String!, $id: ID!) {
      customerAddressDelete(customerAccessToken: $customerAccessToken, id: $id) {
        deletedCustomerAddressId
        customerUserErrors { message }
      }
    }
  `, { customerAccessToken: accessToken, id })

  const { deletedCustomerAddressId, customerUserErrors } = data.customerAddressDelete
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? 'Address delete failed' }
  }
  if (!deletedCustomerAddressId) return { error: 'Address delete failed' }
  return { ok: true }
}

export async function customerDefaultAddressUpdate(
  accessToken: string,
  addressId: string,
): Promise<{ ok: true } | { error: string }> {
  const data = await storefront<{
    customerDefaultAddressUpdate: {
      customer: { id: string } | null
      customerUserErrors: { message: string }[]
    }
  }>(`
    mutation CustomerDefaultAddressUpdate($customerAccessToken: String!, $addressId: ID!) {
      customerDefaultAddressUpdate(customerAccessToken: $customerAccessToken, addressId: $addressId) {
        customer { id }
        customerUserErrors { message }
      }
    }
  `, { customerAccessToken: accessToken, addressId })

  const { customer, customerUserErrors } = data.customerDefaultAddressUpdate
  if (customerUserErrors.length > 0) {
    return { error: customerUserErrors[0]?.message ?? 'Default address update failed' }
  }
  if (!customer) return { error: 'Default address update failed' }
  return { ok: true }
}

export async function cartBuyerIdentityUpdate(
  cartId: string,
  identity: {
    customerAccessToken?: string | null
    email?: string | null
    countryCode?: string | null
  },
): Promise<Cart | null> {
  try {
    const data = await storefront<{
      cartBuyerIdentityUpdate: {
        cart: RawCart | null
        userErrors: { message: string }[]
      }
    }>(`
      mutation CartBuyerIdentityUpdate($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
        cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
          cart { ${CART_FRAGMENT} }
          userErrors { message }
        }
      }
    `, {
      cartId,
      buyerIdentity: {
        customerAccessToken: identity.customerAccessToken ?? null,
        email: identity.email ?? null,
        countryCode: identity.countryCode ?? null,
      },
    })

    const { cart, userErrors } = data.cartBuyerIdentityUpdate
    if (userErrors.length > 0) {
      console.error('[cartBuyerIdentityUpdate] user errors:', userErrors)
      return await getCart(cartId)
    }
    return cart ? rawCartToCart(cart) : await getCart(cartId)
  } catch (err) {
    console.error('[cartBuyerIdentityUpdate] request failed:', err)
    return await getCart(cartId)
  }
}

// ─── Admin REST: hard delete customer ──────────────────────────────────────────

export async function adminCustomerDelete(customerGid: string): Promise<void> {
  const id = customerGid.replace('gid://shopify/Customer/', '')
  await shopifyAdmin(`/customers/${id}.json`, 'DELETE')
}

// ─── Admin GraphQL: Subscription Contracts ───────────────────────────────────

interface RawSubscriptionContractLine {
  id: string
  title: string
  variantTitle: string | null
  quantity: number
  currentPrice: { amount: string; currencyCode: string }
  variantImage: { url: string } | null
  productId: string | null
}

interface RawSubscriptionContractNode {
  id: string
  status: string
  createdAt: string
  nextBillingDate: string | null
  currencyCode: string
  billingPolicy: { interval: string; intervalCount: number } | null
  deliveryPolicy: { interval: string; intervalCount: number } | null
  customer: { id: string }
  deliveryMethod: {
    __typename: string
    address?: {
      firstName: string | null
      lastName: string | null
      address1: string | null
      address2: string | null
      city: string | null
      province: string | null
      country: string | null
      zip: string | null
      phone: string | null
    }
  } | null
  lines: {
    edges: { node: RawSubscriptionContractLine }[]
  }
}

const SUBSCRIPTION_CONTRACT_FRAGMENT = `
  id
  status
  createdAt
  nextBillingDate
  currencyCode
  billingPolicy { interval intervalCount }
  deliveryPolicy { interval intervalCount }
  customer { id }
  deliveryMethod {
    __typename
    ... on SubscriptionDeliveryMethodShipping {
      address {
        firstName lastName address1 address2
        city province country zip phone
      }
    }
  }
  lines(first: 20) {
    edges {
      node {
        id title variantTitle quantity
        currentPrice { amount currencyCode }
        variantImage { url }
        productId
      }
    }
  }
`

function mapSubscriptionContract(raw: RawSubscriptionContractNode): SubscriptionContract {
  const lines: SubscriptionContractLine[] = raw.lines.edges.map((e) => ({
    id: e.node.id,
    title: e.node.title,
    variantTitle: e.node.variantTitle,
    quantity: e.node.quantity,
    currentPrice: e.node.currentPrice,
    imageUrl: e.node.variantImage?.url ?? null,
    productId: e.node.productId,
  }))

  // Compute subtotal from line items; currency comes from the contract node.
  const currencyCode = raw.currencyCode
  const subtotalNum = lines.reduce(
    (acc, line) => acc + parseFloat(line.currentPrice.amount) * line.quantity,
    0,
  )

  const shippingAddr =
    raw.deliveryMethod?.__typename === 'SubscriptionDeliveryMethodShipping' &&
    raw.deliveryMethod.address
      ? raw.deliveryMethod.address
      : null

  return {
    id: raw.id,
    status: raw.status,
    createdAt: raw.createdAt,
    nextBillingDate: raw.nextBillingDate,
    currencyCode,
    customerId: raw.customer.id,
    billingPolicy: raw.billingPolicy,
    deliveryPolicy: raw.deliveryPolicy,
    lines,
    subtotalAmount:
      lines.length > 0
        ? { amount: subtotalNum.toFixed(2), currencyCode }
        : null,
    shippingAddress: shippingAddr
      ? {
          firstName: shippingAddr.firstName ?? null,
          lastName: shippingAddr.lastName ?? null,
          address1: shippingAddr.address1 ?? null,
          address2: shippingAddr.address2 ?? null,
          city: shippingAddr.city ?? null,
          province: shippingAddr.province ?? null,
          country: shippingAddr.country ?? null,
          zip: shippingAddr.zip ?? null,
          phone: shippingAddr.phone ?? null,
        }
      : null,
  }
}

export async function adminGetCustomerSubscriptions(
  customerGid: string,
): Promise<SubscriptionContract[]> {
  try {
    const data = await adminGraphQL<{
      customer: {
        subscriptionContracts: {
          edges: { node: RawSubscriptionContractNode }[]
        }
      } | null
    }>(
      `query CustomerSubscriptions($id: ID!) {
        customer(id: $id) {
          subscriptionContracts(first: 20) {
            edges {
              node { ${SUBSCRIPTION_CONTRACT_FRAGMENT} }
            }
          }
        }
      }`,
      { id: customerGid },
    )

    if (!data.customer) return []
    return data.customer.subscriptionContracts.edges.map((e) =>
      mapSubscriptionContract(e.node),
    )
  } catch (err) {
    console.error('[adminGetCustomerSubscriptions] failed:', err)
    return []
  }
}

export async function adminGetSubscriptionContract(
  contractGid: string,
): Promise<SubscriptionContract | null> {
  try {
    const data = await adminGraphQL<{
      subscriptionContract: RawSubscriptionContractNode | null
    }>(
      `query SubscriptionContractDetail($id: ID!) {
        subscriptionContract(id: $id) {
          ${SUBSCRIPTION_CONTRACT_FRAGMENT}
        }
      }`,
      { id: contractGid },
    )

    if (!data.subscriptionContract) return null
    return mapSubscriptionContract(data.subscriptionContract)
  } catch (err) {
    console.error('[adminGetSubscriptionContract] failed:', err)
    return null
  }
}

function buildProductTags(product: ProductScore): string[] {
  const tags: string[] = product.categories.map(c =>
    `cat:${c.toLowerCase().replace(/\s+/g, '-')}`,
  )
  const forHimCats  = ['Vagina Strokers', 'Body Molds', 'Prostate Toys', 'Masturbators', 'Hands-Free Masturbators']
  const forHerCats  = ['Dual Action and Rabbits', 'Finger and Clit', 'Air Pulse and Suction', 'Bullets and Eggs']
  const coupleCats  = ['Couples and Wearable', 'Remote', 'Top Couples Toys', 'Restraints']
  if (product.categories.some(c => forHimCats.includes(c))) tags.push('for-him')
  if (product.categories.some(c => forHerCats.includes(c))) tags.push('for-her')
  if (product.categories.some(c => coupleCats.includes(c))) tags.push('for-couples')
  tags.push(`brand:${product.brand.toLowerCase().replace(/\s+/g, '-')}`)
  tags.push(`nalpac-sku-${product.sku}`)
  tags.push(
    product.msrp < 25  ? 'price:under-25'  :
    product.msrp < 50  ? 'price:25-50'     :
    product.msrp < 100 ? 'price:50-100'    : 'price:100-plus',
  )
  return tags
}


export async function updateCollectionImage(
  _collectionId: string,
  _imageBuffer: Buffer,
  _filename: string,
  _alt: string,
): Promise<string> {
  console.warn('updateCollectionImage: not yet implemented')
  return ''
}

export async function getAccessoryProductsAdmin(
  productIds: string[],
): Promise<Product[]> {
  if (productIds.length === 0) return []
  // Normalize to GIDs
  const gids = productIds.map(id =>
    id.startsWith('gid://') ? id : `gid://shopify/Product/${id}`,
  )
  const data = await adminGraphQL<{
    nodes: Array<{
      id: string
      handle: string
      title: string
      vendor: string
      tags: string[]
      images: { nodes: Array<{ url: string; altText: string | null }> }
      variants: { nodes: Array<{ id: string; title: string; price: string; compareAtPrice: string | null; inventoryQuantity: number }> }
    } | null>
  }>(`
    query GetAccessoryProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id handle title vendor tags
          images(first: 5) { nodes { url altText } }
          variants(first: 10) {
            nodes {
              id title price compareAtPrice
              inventoryQuantity
            }
          }
        }
      }
    }
  `, { ids: gids })

  return (data.nodes ?? []).flatMap(node => {
    if (!node) return []
    const variant = node.variants.nodes[0]
    const product: Product = {
      id: node.id,
      handle: node.handle,
      title: node.title,
      images: node.images.nodes.map(img => ({ url: img.url, altText: img.altText ?? '' })),
      videos: [],
      variants: node.variants.nodes.map(v => ({
        id: v.id,
        title: v.title,
        selectedOptions: [],
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        availableForSale: (v.inventoryQuantity ?? 0) > 0,
        quantityAvailable: v.inventoryQuantity ?? 0,
      })),
      price: parseFloat(variant?.price ?? '0'),
      ...(variant?.compareAtPrice ? { compareAtPrice: parseFloat(variant.compareAtPrice) } : {}),
      brand: node.vendor,
      tags: node.tags,
    }
    return [product]
  })
}

export async function updateCollectionDescription(..._args: unknown[]): Promise<void> {
  console.warn('updateCollectionDescription: not yet implemented')
}

export async function updateProductTags(productId: string, tags: string[]): Promise<void> {
  const id = productId.replace('gid://shopify/Product/', '')
  await shopifyAdmin(`/products/${id}.json`, 'PUT', {
    product: { id, tags: tags.join(', ') },
  })
}

export async function appendProductTag(productId: string, tag: string): Promise<void> {
  const id = productId.replace('gid://shopify/Product/', '')
  const { product } = await shopifyAdmin<{ product: { tags: string } | null }>(`/products/${id}.json?fields=tags`)
  if (!product) return
  const current = product.tags.split(',').map((t) => t.trim()).filter(Boolean)
  if (current.includes(tag)) return
  current.push(tag)
  await shopifyAdmin(`/products/${id}.json`, 'PUT', {
    product: { id, tags: current.join(', ') },
  })
}

export interface FetchedDealProduct {
  shopifyProductId: string
  sku: string
  nalpacSku?: string
  title: string
  vendor: string
  category?: string
  wholesaleCost?: number
  dealPrice: number
  msrp?: number
  mapPrice?: number
  inventoryQuantity: number
  dealScore?: number
}

export async function fetchAllDealProducts(): Promise<{ products: FetchedDealProduct[]; totalScanned: number }> {
  interface AdminVariantNode { price: string; inventoryQuantity: number }
  interface AdminMetafieldNode { key: string; value: string }
  interface AdminProductNode {
    id: string
    title: string
    vendor: string
    variants: { nodes: AdminVariantNode[] }
    metafields: { nodes: AdminMetafieldNode[] }
  }
  interface PageInfo { hasNextPage: boolean; endCursor: string | null }

  const products: FetchedDealProduct[] = []
  let totalScanned = 0
  let cursor: string | null = null
  let hasNextPage = true

  type FetchResult = { products: { pageInfo: PageInfo; nodes: AdminProductNode[] } }

  while (hasNextPage) {
    const data: FetchResult = await adminGraphQL<FetchResult>(`
      query FetchDealProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title vendor
            variants(first: 1) { nodes { price inventoryQuantity } }
            metafields(namespace: "xdipx", first: 20) {
              nodes { key value }
            }
          }
        }
      }
    `, { first: 50, after: cursor })

    const page: FetchResult['products'] = data.products
    hasNextPage = page.pageInfo.hasNextPage
    cursor = page.pageInfo.endCursor
    totalScanned += page.nodes.length

    for (const node of page.nodes) {
      const mf = node.metafields.nodes
      const mfVal = (key: string) => mf.find((m: AdminMetafieldNode) => m.key === key)?.value ?? ''

      // Only imported products (they carry a nalpac_sku).
      if (!mfVal('nalpac_sku')) continue

      const numericId = node.id.replace('gid://shopify/Product/', '')
      const variant = node.variants.nodes[0]
      const wholesaleCost = parseFloat(mfVal('wholesale_cost'))
      const msrp = parseFloat(mfVal('original_price'))
      const mapPrice = parseFloat(mfVal('map_price'))
      const dealScore = parseFloat(mfVal('deal_score'))

      products.push({
        shopifyProductId: numericId,
        sku: mfVal('nalpac_sku') || numericId,
        ...(mfVal('nalpac_sku') ? { nalpacSku: mfVal('nalpac_sku') } : {}),
        title: node.title,
        vendor: node.vendor,
        ...(mfVal('category') ? { category: mfVal('category') } : {}),
        ...(!isNaN(wholesaleCost) ? { wholesaleCost } : {}),
        dealPrice: parseFloat(variant?.price ?? '0'),
        ...(!isNaN(msrp) ? { msrp } : {}),
        ...(!isNaN(mapPrice) ? { mapPrice } : {}),
        inventoryQuantity: variant?.inventoryQuantity ?? 0,
        ...(!isNaN(dealScore) ? { dealScore } : {}),
      })
    }
  }

  return { products, totalScanned }
}

// ─── Storefront Search (Search & Discovery app) ───────────────────────────

export interface SearchProduct {
  id: string
  handle: string
  title: string
  vendor: string
  tags: string[]
  availableForSale: boolean
  featuredImage: { url: string; altText: string | null } | null
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } }
  // Bug fix: Storefront API field is maxVariantPrice (not maxVariantCompareAtPrice)
  compareAtPriceRange: { maxVariantPrice: { amount: string; currencyCode: string } | null }
}

export interface SearchFilter {
  id: string
  label: string
  type: string
  values: { id: string; label: string; count: number; input: string }[]
}

const SEARCH_PRODUCT_FRAGMENT = `
  id handle title vendor tags availableForSale
  featuredImage { url altText }
  priceRange { minVariantPrice { amount currencyCode } }
  compareAtPriceRange { maxVariantPrice { amount currencyCode } }
`

export interface PredictiveCollection {
  id: string
  handle: string
  title: string
}

export interface PredictiveSearchResult {
  products: SearchProduct[]
  collections: PredictiveCollection[]
}

export async function predictiveSearch(query: string): Promise<PredictiveSearchResult> {
  const data = await storefront<{
    predictiveSearch: {
      products: SearchProduct[]
      collections: PredictiveCollection[]
    }
  }>(`
    query PredictiveSearch($query: String!) {
      predictiveSearch(query: $query, limit: 6, types: [PRODUCT, COLLECTION]) {
        products { ${SEARCH_PRODUCT_FRAGMENT} }
        collections { id handle title }
      }
    }
  `, { query })
  return {
    products: data.predictiveSearch.products,
    collections: data.predictiveSearch.collections,
  }
}

// Bug fix: Shopify Storefront search query only supports RELEVANCE and PRICE sort keys.
// UPDATED_AT, BEST_SELLING, etc. are not valid for the search query (only for products query).
export type SearchSortKey = 'RELEVANCE' | 'PRICE'

export async function searchProducts(params: {
  query: string
  first?: number
  after?: string
  sortKey?: SearchSortKey
  reverse?: boolean
  productFilters?: Record<string, unknown>[]
}): Promise<{
  products: SearchProduct[]
  totalCount: number
  filters: SearchFilter[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
}> {
  const { query, first = 24, after, sortKey = 'RELEVANCE', reverse = false, productFilters = [] } = params
  const data = await storefront<{
    search: {
      totalCount: number
      productFilters: SearchFilter[]
      edges: { cursor: string; node: SearchProduct }[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    }
  }>(`
    query SearchProducts(
      $query: String!
      $first: Int!
      $after: String
      $sortKey: SearchSortKeys
      $reverse: Boolean
      $productFilters: [ProductFilter!]
    ) {
      search(
        query: $query
        first: $first
        after: $after
        sortKey: $sortKey
        reverse: $reverse
        productFilters: $productFilters
        types: [PRODUCT]
      ) {
        totalCount
        productFilters {
          id label type
          values { id label count input }
        }
        edges {
          cursor
          node {
            ... on Product { ${SEARCH_PRODUCT_FRAGMENT} }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `, { query, first, after: after ?? null, sortKey, reverse, productFilters })

  return {
    products: data.search.edges.map(e => e.node),
    totalCount: data.search.totalCount,
    filters: data.search.productFilters,
    pageInfo: data.search.pageInfo,
  }
}

// ─── Returns / RMA (Admin API 2024-10) ────────────────────────────────────
//
// Self-service returns flow: customer picks items → Shopify `returnCreate`
// (return starts in OPEN state, customer already approved) →
// `reverseDeliveryCreateWithShipping` generates the prepaid label →
// on warehouse receipt `refundCreate` issues refund minus label cost →
// `returnClose` finalizes. See app/lib/returns.server.ts for orchestration.
//
// These wrappers throw on GraphQL errors; callers are expected to also
// inspect `userErrors` on the payload and translate to user-facing messages.

export type ReturnReasonCode =
  | 'COLOR'
  | 'DEFECTIVE'
  | 'NOT_AS_DESCRIBED'
  | 'OTHER'
  | 'SIZE_TOO_LARGE'
  | 'SIZE_TOO_SMALL'
  | 'STYLE'
  | 'UNKNOWN'
  | 'UNWANTED'
  | 'WRONG_ITEM'

export interface ReturnableLineItem {
  fulfillmentLineItemId: string
  orderLineItemId:       string           // order LineItem id — needed for refundCreate
  quantity:              number
  title:                 string
  variantTitle:          string | null
  imageUrl:              string | null
  unitPrice:             { amount: string; currencyCode: string } | null
}

export interface ReturnableFulfillment {
  id:                   string           // ReturnableFulfillment id
  fulfillmentId:        string
  lineItems:            ReturnableLineItem[]
  reverseFulfillmentOrderId: string | null
}

/**
 * Fetch returnable fulfillments + associated reverseFulfillmentOrder for an order.
 * This tells us what can still be returned (excluding items already in a return).
 */
export async function getReturnableFulfillments(
  orderId: string,
): Promise<ReturnableFulfillment[]> {
  // `returnableFulfillments` is a ROOT query (takes orderId as an argument),
  // not a field on Order. We don't pre-fetch reverseFulfillmentOrderId here —
  // it comes back in the returnCreate mutation response.
  const data = await adminGraphQL<{
    returnableFulfillments: {
      edges: {
        node: {
          id: string
          fulfillment: { id: string }
          returnableFulfillmentLineItems: {
            edges: {
              node: {
                quantity: number
                fulfillmentLineItem: {
                  id: string
                  lineItem: {
                    id: string
                    title: string
                    variantTitle: string | null
                    image: { url: string } | null
                    originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } }
                  }
                }
              }
            }[]
          }
        }
      }[]
    }
  }>(`
    query ReturnableFulfillments($orderId: ID!) {
      returnableFulfillments(first: 10, orderId: $orderId) {
        edges {
          node {
            id
            fulfillment { id }
            returnableFulfillmentLineItems(first: 50) {
              edges {
                node {
                  quantity
                  fulfillmentLineItem {
                    id
                    lineItem {
                      id
                      title
                      variantTitle
                      image { url }
                      originalUnitPriceSet { shopMoney { amount currencyCode } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `, { orderId })

  return data.returnableFulfillments.edges.map(({ node: rf }) => {
    const lineItems: ReturnableLineItem[] = rf.returnableFulfillmentLineItems.edges.map(
      ({ node: rfli }) => ({
        fulfillmentLineItemId: rfli.fulfillmentLineItem.id,
        orderLineItemId:       rfli.fulfillmentLineItem.lineItem.id,
        quantity:              rfli.quantity,
        title:                 rfli.fulfillmentLineItem.lineItem.title,
        variantTitle:          rfli.fulfillmentLineItem.lineItem.variantTitle,
        imageUrl:              rfli.fulfillmentLineItem.lineItem.image?.url ?? null,
        unitPrice:             {
          amount:       rfli.fulfillmentLineItem.lineItem.originalUnitPriceSet.shopMoney.amount,
          currencyCode: rfli.fulfillmentLineItem.lineItem.originalUnitPriceSet.shopMoney.currencyCode,
        },
      }),
    )
    // reverseFulfillmentOrderId is populated by returnCreate's response, not here.
    return {
      id:            rf.id,
      fulfillmentId: rf.fulfillment.id,
      lineItems,
      reverseFulfillmentOrderId: null,
    }
  })
}

export interface CreateReturnInput {
  orderId: string
  lineItems: Array<{
    fulfillmentLineItemId: string
    quantity:              number
    returnReason:          ReturnReasonCode
    returnReasonNote?:     string
  }>
  notifyCustomer?: boolean
}

export interface CreateReturnResult {
  returnId:                  string
  reverseFulfillmentOrderId: string | null
  /** Map of fulfillmentLineItem.id → reverseFulfillmentOrderLineItem.id for this return. */
  fliToRfoLineItemId: Record<string, string>
}

/**
 * Create a return in OPEN state. Call AFTER the customer has confirmed in the
 * wizard (no separate approve step needed).
 */
export async function createReturn(
  input: CreateReturnInput,
): Promise<{ ok: true; data: CreateReturnResult } | { ok: false; error: string }> {
  const data = await adminGraphQL<{
    returnCreate: {
      return: {
        id: string
        reverseFulfillmentOrders: {
          edges: {
            node: {
              id: string
              lineItems: {
                edges: {
                  node: {
                    id: string
                    fulfillmentLineItem: { id: string }
                  }
                }[]
              }
            }
          }[]
        }
      } | null
      userErrors: { field: string[] | null; message: string }[]
    }
  }>(`
    mutation ReturnCreate($returnInput: ReturnInput!) {
      returnCreate(returnInput: $returnInput) {
        return {
          id
          reverseFulfillmentOrders(first: 1) {
            edges {
              node {
                id
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      fulfillmentLineItem { id }
                    }
                  }
                }
              }
            }
          }
        }
        userErrors { field message }
      }
    }
  `, {
    returnInput: {
      orderId: input.orderId,
      returnLineItems: input.lineItems.map(li => ({
        fulfillmentLineItemId: li.fulfillmentLineItemId,
        quantity:              li.quantity,
        returnReason:          li.returnReason,
        returnReasonNote:      li.returnReasonNote ?? '',
      })),
      notifyCustomer: input.notifyCustomer ?? false,
    },
  })

  const err = data.returnCreate.userErrors[0]
  if (err) return { ok: false, error: err.message }
  if (!data.returnCreate.return) return { ok: false, error: 'returnCreate returned no return' }

  const rfoNode = data.returnCreate.return.reverseFulfillmentOrders.edges[0]?.node
  const fliToRfoLineItemId: Record<string, string> = {}
  for (const { node: li } of rfoNode?.lineItems.edges ?? []) {
    fliToRfoLineItemId[li.fulfillmentLineItem.id] = li.id
  }

  return {
    ok: true,
    data: {
      returnId:                  data.returnCreate.return.id,
      reverseFulfillmentOrderId: rfoNode?.id ?? null,
      fliToRfoLineItemId,
    },
  }
}

export interface RegisterReverseDeliveryInput {
  reverseFulfillmentOrderId: string
  reverseDeliveryLineItems: Array<{
    /** reverseFulfillmentOrderLineItem.id — NOT fulfillmentLineItem.id */
    reverseFulfillmentOrderLineItemId: string
    quantity:                          number
  }>
  /** URL of the EasyPost-purchased label PDF. */
  labelFileUrl: string
  /** Carrier tracking number from EasyPost. */
  trackingNumber: string
  /** Public tracking URL from EasyPost. */
  trackingUrl?: string
  /** Carrier identifier, e.g. "USPS". */
  carrierIdentifier?: string
  notifyCustomer?: boolean
}

export interface RegisterReverseDeliveryResult {
  reverseDeliveryId: string
}

/**
 * Register an externally-purchased return label (from EasyPost) with Shopify.
 *
 * Shopify's `reverseDeliveryCreateWithShipping` does NOT buy Shopify Shipping
 * labels via public API — it only records a label file URL and/or tracking
 * info. We purchase via EasyPost (see app/lib/easypost.server.ts) then call
 * this to attach the label + tracking to the Shopify return so merchants see
 * it in the admin and customers see it in their notifications.
 */
export async function registerReverseDelivery(
  input: RegisterReverseDeliveryInput,
): Promise<{ ok: true; data: RegisterReverseDeliveryResult } | { ok: false; error: string }> {
  const data = await adminGraphQL<{
    reverseDeliveryCreateWithShipping: {
      reverseDelivery: { id: string } | null
      userErrors: { field: string[] | null; message: string }[]
    }
  }>(`
    mutation ReverseDeliveryCreateWithShipping(
      $reverseFulfillmentOrderId: ID!
      $reverseDeliveryLineItems: [ReverseDeliveryLineItemInput!]!
      $labelInput: ReverseDeliveryLabelInput
      $trackingInput: ReverseDeliveryTrackingInput
      $notifyCustomer: Boolean
    ) {
      reverseDeliveryCreateWithShipping(
        reverseFulfillmentOrderId: $reverseFulfillmentOrderId
        reverseDeliveryLineItems: $reverseDeliveryLineItems
        labelInput: $labelInput
        trackingInput: $trackingInput
        notifyCustomer: $notifyCustomer
      ) {
        reverseDelivery { id }
        userErrors { field message }
      }
    }
  `, {
    reverseFulfillmentOrderId: input.reverseFulfillmentOrderId,
    reverseDeliveryLineItems: input.reverseDeliveryLineItems.map(li => ({
      reverseFulfillmentOrderLineItemId: li.reverseFulfillmentOrderLineItemId,
      quantity: li.quantity,
    })),
    labelInput: { fileUrl: input.labelFileUrl },
    trackingInput: {
      number: input.trackingNumber,
      ...(input.trackingUrl ? { url: input.trackingUrl } : {}),
      ...(input.carrierIdentifier ? { carrierIdentifier: input.carrierIdentifier } : {}),
    },
    notifyCustomer: input.notifyCustomer ?? false,
  })

  const err = data.reverseDeliveryCreateWithShipping.userErrors[0]
  if (err) return { ok: false, error: err.message }

  const rd = data.reverseDeliveryCreateWithShipping.reverseDelivery
  if (!rd) return { ok: false, error: 'reverseDeliveryCreateWithShipping returned no delivery' }

  return { ok: true, data: { reverseDeliveryId: rd.id } }
}

export interface CreateRefundInput {
  orderId: string
  note?:   string
  refundLineItems: Array<{
    lineItemId:   string         // Order line item id (NOT fulfillmentLineItemId)
    quantity:     number
    restockType?: 'NO_RESTOCK' | 'RETURN' | 'CANCEL'
    locationId?:  string
  }>
  /** Positive number in major currency units (e.g. dollars). Undefined → no shipping refund. */
  shippingAmount?: number
  currencyCode:   string
  notify?:        boolean
}

/**
 * Issue a refund. For return-minus-label flow, pass refundLineItems with the
 * item totals and OMIT shippingAmount (we keep shipping on the customer side).
 * To deduct the label cost, subtract it from the line-item amounts before
 * building refundLineItems (or use a negative adjustment transaction — see
 * returns.server.ts issueRefund helper).
 */
export async function createRefund(
  input: CreateRefundInput,
): Promise<{ ok: true; refundId: string } | { ok: false; error: string }> {
  const data = await adminGraphQL<{
    refundCreate: {
      refund: { id: string } | null
      userErrors: { field: string[] | null; message: string }[]
    }
  }>(`
    mutation RefundCreate($input: RefundInput!) {
      refundCreate(input: $input) {
        refund { id }
        userErrors { field message }
      }
    }
  `, {
    input: {
      orderId: input.orderId,
      note:    input.note ?? 'xdipx self-service return',
      notify:  input.notify ?? true,
      currency: input.currencyCode,
      refundLineItems: input.refundLineItems.map(li => ({
        lineItemId:  li.lineItemId,
        quantity:    li.quantity,
        restockType: li.restockType ?? 'RETURN',
        ...(li.locationId ? { locationId: li.locationId } : {}),
      })),
      ...(input.shippingAmount != null
        ? { shipping: { amount: input.shippingAmount.toFixed(2) } }
        : {}),
    },
  })

  const err = data.refundCreate.userErrors[0]
  if (err) return { ok: false, error: err.message }
  if (!data.refundCreate.refund) return { ok: false, error: 'refundCreate returned no refund' }

  return { ok: true, refundId: data.refundCreate.refund.id }
}

/**
 * Close a return once the refund has been issued.
 */
export async function closeReturn(
  returnId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const data = await adminGraphQL<{
    returnClose: {
      return: { id: string; status: string } | null
      userErrors: { field: string[] | null; message: string }[]
    }
  }>(`
    mutation ReturnClose($id: ID!) {
      returnClose(id: $id) {
        return { id status }
        userErrors { field message }
      }
    }
  `, { id: returnId })

  const err = data.returnClose.userErrors[0]
  if (err) return { ok: false, error: err.message }
  return { ok: true }
}

/**
 * Fetch a return's current state (used by webhook + admin lookups).
 */
export async function getReturn(returnId: string): Promise<{
  id: string
  status: string
  reverseDeliveries: Array<{
    id: string
    trackingNumber: string | null
    trackingUrl:    string | null
    deliveredAt:    string | null
  }>
} | null> {
  const data = await adminGraphQL<{
    return: {
      id: string
      status: string
      reverseDeliveries: {
        edges: {
          node: {
            id: string
            deliverable: {
              __typename: string
              tracking?: { number: string | null; url: string | null } | null
            } | null
          }
        }[]
      }
    } | null
  }>(`
    query GetReturn($id: ID!) {
      return(id: $id) {
        id
        status
        reverseDeliveries(first: 5) {
          edges {
            node {
              id
              deliverable {
                __typename
                ... on ReverseDeliveryShippingDeliverable {
                  tracking { number url }
                }
              }
            }
          }
        }
      }
    }
  `, { id: returnId })

  if (!data.return) return null
  return {
    id: data.return.id,
    status: data.return.status,
    reverseDeliveries: data.return.reverseDeliveries.edges.map(({ node }) => ({
      id:             node.id,
      trackingNumber: node.deliverable?.tracking?.number ?? null,
      trackingUrl:    node.deliverable?.tracking?.url ?? null,
      deliveredAt:    null, // Shopify exposes delivery state via webhook, not query
    })),
  }
}

// Returns storefront collections (id included for productFilters usage).
// Shop has ~100+ collections (category + brand), so default bumped from 50 → 150.
export async function getStorefrontCollections(
  first = 150,
): Promise<{ id: string; handle: string; title: string }[]> {
  return cached(`shopify:collections:${first}`, READ_TTL, async () => {
    const data = await storefront<{
      collections: { edges: { node: { id: string; handle: string; title: string } }[] }
    }>(`
      query GetStorefrontCollections($first: Int!) {
        collections(first: $first, sortKey: TITLE) {
          edges { node { id handle title } }
        }
      }
    `, { first })
    return data.collections.edges.map(e => e.node)
  })
}

// Keyword-match storefront collections by handle + title. Used by Emma's
// findCollection tool to route shoppers to the right category/brand PLP
// (e.g. "lingerie" → "lingerie", "lelo" → "lelo", "bondage" → "all-bondage").
// Ranks exact-handle > starts-with > includes and drops collections with no
// products so we never point a shopper at an empty page.
export async function findCollectionsByQuery(
  query: string,
  limit = 5,
): Promise<{ handle: string; title: string; productCount: number }[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const all = await getStorefrontCollections(150)
  const matches = all
    .map((c) => {
      const handle = c.handle.toLowerCase()
      const title = c.title.toLowerCase()
      let score = 0
      if (handle === q) score = 100
      else if (handle.startsWith(q)) score = 70
      else if (handle.includes(q)) score = 50
      if (title === q) score = Math.max(score, 95)
      else if (title.startsWith(q)) score = Math.max(score, 65)
      else if (title.includes(q)) score = Math.max(score, 45)
      return { c, score }
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 2) // pull extras so we can drop empties
  const hydrated: { handle: string; title: string; productCount: number }[] = []
  for (const m of matches) {
    const products = await getCollectionProducts(m.c.handle, 1)
    if (products.length === 0) continue
    hydrated.push({ handle: m.c.handle, title: m.c.title, productCount: products.length })
    if (hydrated.length >= limit) break
  }
  return hydrated
}

// ─── Draft Orders (phone/SMS ordering) ────────────────────────────────────

export interface DraftOrderCustomer {
  email: string
  name: string
  phone?: string
}

export interface DraftOrderShipping {
  address1: string
  address2?: string
  city: string
  province: string
  zip: string
  country?: string
}

export interface DraftOrderLineInput {
  variantId: string
  quantity: number
}

export interface DraftOrderResult {
  id: string
  name: string
  invoiceUrl: string | null
  subtotalPriceCents: number
  totalPriceCents: number
  lineItems: Array<{ variantId: string; title: string; quantity: number; unitPriceCents: number }>
}

export async function findCustomerByPhone(phone: string): Promise<{
  id: string
  email: string | null
  firstName: string | null
  lastName: string | null
  defaultAddress: { address1: string; city: string; province: string; zip: string; country: string } | null
} | null> {
  const data = await adminGraphQL<{
    customers: { nodes: Array<{
      id: string
      email: string | null
      firstName: string | null
      lastName: string | null
      defaultAddress: { address1: string | null; city: string | null; province: string | null; zip: string | null; country: string | null } | null
    }> }
  }>(`
    query FindCustomer($q: String!) {
      customers(first: 1, query: $q) {
        nodes {
          id email firstName lastName
          defaultAddress { address1 city province zip country }
        }
      }
    }
  `, { q: `phone:${phone}` })
  const c = data.customers.nodes[0]
  if (!c) return null
  const addr = c.defaultAddress
  return {
    id: c.id,
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
    defaultAddress: addr && addr.address1 && addr.city && addr.province && addr.zip
      ? { address1: addr.address1, city: addr.city, province: addr.province, zip: addr.zip, country: addr.country ?? 'US' }
      : null,
  }
}

export async function createDraftOrder(input: {
  lineItems: DraftOrderLineInput[]
  customer: DraftOrderCustomer
  shipping: DraftOrderShipping
  note?: string
  channel: 'voice' | 'sms'
}): Promise<DraftOrderResult> {
  const [firstName, ...rest] = input.customer.name.trim().split(/\s+/)
  const lastName = rest.join(' ') || firstName || ''
  const res = await adminGraphQL<{
    draftOrderCreate: {
      draftOrder: {
        id: string
        name: string
        invoiceUrl: string | null
        subtotalPriceSet: { shopMoney: { amount: string } }
        totalPriceSet:    { shopMoney: { amount: string } }
        lineItems: { nodes: Array<{ variant: { id: string } | null; title: string; quantity: number; originalUnitPriceSet: { shopMoney: { amount: string } } }> }
      } | null
      userErrors: { field: string[] | null; message: string }[]
    }
  }>(`
    mutation CreateDraft($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id name invoiceUrl
          subtotalPriceSet { shopMoney { amount } }
          totalPriceSet    { shopMoney { amount } }
          lineItems(first: 20) {
            nodes {
              title quantity
              variant { id }
              originalUnitPriceSet { shopMoney { amount } }
            }
          }
        }
        userErrors { field message }
      }
    }
  `, {
    input: {
      email: input.customer.email,
      phone: input.customer.phone,
      note: input.note ?? `xdipx ${input.channel} order`,
      tags: [
        `channel:${input.channel}`,
        'phone-order',
        ...(input.channel === 'voice' ? ['emma-order-ivr'] : []),
      ],
      lineItems: input.lineItems.map(li => ({ variantId: li.variantId, quantity: li.quantity })),
      shippingAddress: {
        firstName: firstName ?? '',
        lastName,
        address1: input.shipping.address1,
        address2: input.shipping.address2 ?? '',
        city: input.shipping.city,
        province: input.shipping.province,
        zip: input.shipping.zip,
        country: input.shipping.country ?? 'US',
        phone: input.customer.phone,
      },
      useCustomerDefaultAddress: false,
    },
  })
  if (res.draftOrderCreate.userErrors.length > 0) {
    throw new Error(`draftOrderCreate: ${res.draftOrderCreate.userErrors.map(e => e.message).join('; ')}`)
  }
  const d = res.draftOrderCreate.draftOrder
  if (!d) throw new Error('draftOrderCreate returned null')
  return {
    id: d.id,
    name: d.name,
    invoiceUrl: d.invoiceUrl,
    subtotalPriceCents: Math.round(parseFloat(d.subtotalPriceSet.shopMoney.amount) * 100),
    totalPriceCents:    Math.round(parseFloat(d.totalPriceSet.shopMoney.amount) * 100),
    lineItems: d.lineItems.nodes.map(n => ({
      variantId: n.variant?.id ?? '',
      title: n.title,
      quantity: n.quantity,
      unitPriceCents: Math.round(parseFloat(n.originalUnitPriceSet.shopMoney.amount) * 100),
    })),
  }
}

export async function sendDraftOrderInvoice(
  draftOrderId: string,
  opts?: { to?: string; customMessage?: string },
): Promise<{ invoiceUrl: string | null }> {
  const emailInput = opts?.to || opts?.customMessage
    ? { to: opts?.to, customMessage: opts?.customMessage }
    : undefined
  const res = await adminGraphQL<{
    draftOrderInvoiceSend: {
      draftOrder: { invoiceUrl: string | null } | null
      userErrors: { message: string }[]
    }
  }>(`
    mutation SendInvoice($id: ID!, $email: EmailInput) {
      draftOrderInvoiceSend(id: $id, email: $email) {
        draftOrder { invoiceUrl }
        userErrors { message }
      }
    }
  `, { id: draftOrderId, email: emailInput })
  if (res.draftOrderInvoiceSend.userErrors.length > 0) {
    throw new Error(`draftOrderInvoiceSend: ${res.draftOrderInvoiceSend.userErrors.map(e => e.message).join('; ')}`)
  }
  return { invoiceUrl: res.draftOrderInvoiceSend.draftOrder?.invoiceUrl ?? null }
}

// ─── Emma Chat Catalog Helpers ────────────────────────────────────────────
//
// Read-only helpers consumed by the /admin/chat/emma tool executors.
// All Shopify calls stay in this file (Oxygen migration seam).
// List calls are wrapped in cached() to dedupe repeated tool invocations
// within a single chat session.

/**
 * Build a Shopify Storefront `products(query: …)` search string from structured
 * filters. All clauses are joined with AND.
 *
 * Examples:
 *   buildShopifyQuery({ keyword: 'wand', tags: ['for-her'], priceMax: 100 })
 *   // → 'title:*wand* AND tag:for-her AND variants.price:<=100'
 *
 *   buildShopifyQuery({ productType: 'vibrator', priceMin: 20, priceMax: 80 })
 *   // → 'product_type:vibrator AND variants.price:>=20 AND variants.price:<=80'
 *
 *   buildShopifyQuery({})
 *   // → ''
 */
export function buildShopifyQuery(input: {
  keyword?: string
  tags?: string[]
  productType?: string
  priceMin?: number
  priceMax?: number
}): string {
  // Strip Shopify query special chars from any user-supplied string
  const sanitize = (s: string) => s.replace(/[:()*"]/g, '').trim().toLowerCase()

  const clauses: string[] = []

  if (input.keyword) {
    const kw = sanitize(input.keyword)
    if (kw) clauses.push(`title:*${kw}*`)
  }

  if (input.tags && input.tags.length > 0) {
    for (const tag of input.tags) {
      const t = sanitize(tag)
      if (t) clauses.push(`tag:${t}`)
    }
  }

  if (input.productType) {
    const pt = sanitize(input.productType)
    if (pt) clauses.push(`product_type:${pt}`)
  }

  if (typeof input.priceMin === 'number' && input.priceMin > 0) {
    clauses.push(`variants.price:>=${input.priceMin}`)
  }

  if (typeof input.priceMax === 'number') {
    clauses.push(`variants.price:<=${input.priceMax}`)
  }

  return clauses.join(' AND ')
}

// Stable hash of a search input object for use as a cache key.
function hashSearchInput(input: Record<string, unknown>): string {
  const stable = JSON.stringify(input, Object.keys(input).sort())
  return crypto.createHash('sha1').update(stable).digest('hex').slice(0, 16)
}

export interface EmmaProductCard {
  handle: string
  url: string                    // 'https://xdipx.com/products/${handle}'
  title: string
  productType: string | null
  priceUsd: number               // numeric, from first variant priceRange
  compareAtUsd: number | null
  available: boolean             // true if any variant is available
  mapRestricted: boolean         // from xdipx.map_restricted metafield
  tagline: string | null
  productTypeDial: string | null // xdipx.product_type_dial
  audienceTags: string[]         // xdipx.audience_tags (list.text, JSON-encoded)
  moodTags: string[]             // xdipx.mood_tags
  mattersTags: string[]          // xdipx.matters_tags
}

// Map a SearchProduct node (from searchProducts()) to an EmmaProductCard.
// SearchProduct carries no metafields, so tag/dial fields will be empty/null
// unless the node was enriched. The detail helper fills those in.
function searchNodeToEmmaCard(node: SearchProduct): EmmaProductCard {
  const priceUsd = parseFloat(node.priceRange.minVariantPrice.amount)
  const compareAtRaw = node.compareAtPriceRange.maxVariantPrice?.amount
  return {
    handle: node.handle,
    url: `https://xdipx.com/products/${node.handle}`,
    title: node.title,
    productType: null,       // not in SearchProduct fragment
    priceUsd: isNaN(priceUsd) ? 0 : priceUsd,
    compareAtUsd: compareAtRaw ? parseFloat(compareAtRaw) : null,
    available: node.availableForSale,
    mapRestricted: false,    // not in SearchProduct fragment
    tagline: null,
    productTypeDial: null,
    audienceTags: [],
    moodTags: [],
    mattersTags: [],
  }
}

// Map a full ShopifyProductNode (from getProductByHandle / getProductsByIds)
// to an EmmaProductCard, using all available metafields.
function productNodeToEmmaCard(node: ShopifyProductNode): EmmaProductCard {
  const mf = node.metafields
  const variant = node.variants.edges[0]?.node
  const priceUsd = parseFloat(variant?.price.amount ?? '0')
  const compareAtRaw = variant?.compareAtPrice?.amount
  const mapRestrictedRaw = parseMetafield(mf, 'map_restricted')
  const available = node.variants.edges.some(e => e.node.availableForSale)
  return {
    handle: node.handle,
    url: `https://xdipx.com/products/${node.handle}`,
    title: node.title,
    productType: null,   // Shopify productType field is not in PRODUCT_CORE_FRAGMENT
    priceUsd: isNaN(priceUsd) ? 0 : priceUsd,
    compareAtUsd: compareAtRaw ? parseFloat(compareAtRaw) : null,
    available,
    mapRestricted: mapRestrictedRaw === 'true',
    tagline: parseMetafield(mf, 'tagline') || null,
    productTypeDial: parseMetafield(mf, 'product_type_dial') || null,
    audienceTags: parseMetafieldJSON<string[]>(mf, 'audience_tags', []),
    moodTags: parseMetafieldJSON<string[]>(mf, 'mood_tags', []),
    mattersTags: parseMetafieldJSON<string[]>(mf, 'matters_tags', []),
  }
}

/**
 * Search the live catalog and return compact product cards for Claude tool use.
 * Results are cached for READ_TTL seconds so repeated identical tool calls
 * within one chat session are O(1) on the second hit.
 *
 * limit defaults to 12, hard max 20.
 */
export async function searchCatalogForEmma(input: {
  keyword?: string
  tags?: string[]
  productType?: string
  priceMin?: number
  priceMax?: number
  limit?: number
}): Promise<EmmaProductCard[]> {
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 20)
  const cacheKey = `emma-search:${hashSearchInput({ ...input, limit })}`

  return cached(cacheKey, READ_TTL, async () => {
    // Storefront `query` only handles keyword (title:*foo*) reliably.
    // Tags + price filters MUST go through `productFilters` — the `tag:` and
    // `variants.price:>=N` query-string forms silently return zero rows in
    // Storefront 2024-10. Mirrors the canonical pattern in search.server.ts.
    const queryInput: Parameters<typeof buildShopifyQuery>[0] = {}
    if (input.keyword !== undefined) queryInput.keyword = input.keyword
    if (input.productType !== undefined) queryInput.productType = input.productType
    const query = buildShopifyQuery(queryInput) || (input.keyword ?? 'wellness')

    const productFilters: Record<string, unknown>[] = []
    for (const tag of input.tags ?? []) productFilters.push({ tag })
    if (input.priceMin !== undefined || input.priceMax !== undefined) {
      const price: { min?: number; max?: number } = {}
      if (input.priceMin !== undefined) price.min = input.priceMin
      if (input.priceMax !== undefined) price.max = input.priceMax
      productFilters.push({ price })
    }

    const result = await searchProducts({ query, first: limit, productFilters })
    return result.products.map(searchNodeToEmmaCard)
  })
}

/**
 * Hydrate an ordered list of handles into display-correct EmmaProductCards,
 * preserving the input order and dropping handles the Storefront no longer
 * returns (archived / unpublished). Uses the same PRODUCT_CORE_FRAGMENT +
 * productNodeToEmmaCard path as getProductDetailForEmma, so the taxonomy
 * metafields (tagline, product_type_dial, mood/audience/matters tags,
 * map_restricted) are populated — unlike searchNodeToEmmaCard, which leaves
 * them empty because SearchProduct carries no metafields.
 *
 * The web-chat search path uses this to render cards for handles that were
 * already ranked and filtered by the shared voice/SMS search core
 * (searchForIvrWithDiagnostics), so the two channels surface the same catalog
 * without inheriting the voice card's TTS-normalized title/tagline.
 */
export async function getEmmaCardsByHandles(handles: string[]): Promise<EmmaProductCard[]> {
  if (handles.length === 0) return []
  const nodes = await Promise.all(
    handles.map(async (handle) => {
      const data = await storefront<{ product: ShopifyProductNode | null }>(`
        query GetEmmaCard($handle: String!) {
          product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
        }
      `, { handle })
      return data.product
    }),
  )
  const byHandle = new Map<string, EmmaProductCard>()
  for (const node of nodes) {
    if (node) byHandle.set(node.handle, productNodeToEmmaCard(node))
  }
  return handles
    .map((h) => byHandle.get(h))
    .filter((c): c is EmmaProductCard => c !== undefined)
}

export interface EmmaProductDetail extends EmmaProductCard {
  fullStory: string | null
  featureBullets: string[] | null
  sensationDial: Record<string, number> | null
  pairingWhy: Record<string, string> | null
  accessoryHandles: string[]
  imageUrl: string | null
  variants: Array<{ id: string; title: string; priceUsd: number; available: boolean; originalDescription?: string }>
}

/**
 * Fetch full product enrichment for a single product handle.
 * Resolves accessory GIDs to handles via getProductsByIds().
 * Returns null if the product does not exist.
 */
export async function getProductDetailForEmma(handle: string): Promise<EmmaProductDetail | null> {
  const product = await getProductByHandle(handle)
  if (!product) return null

  // getProductByHandle returns a Product (our internal type), not the raw node.
  // Re-fetch the raw node via storefront so we can use productNodeToEmmaCard
  // and access the full metafield set.
  const data = await storefront<{ product: ShopifyProductNode | null }>(`
    query GetProductForEmma($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
    }
  `, { handle })

  const node = data.product
  if (!node) return null

  const mf = node.metafields
  const baseCard = productNodeToEmmaCard(node)

  // Parse sensation_dial as Record<string,number> for Claude legibility
  const sensationDialRaw = parseMetafieldJSON<Record<string, unknown>>(mf, 'sensation_dial', {})
  const sensationDial: Record<string, number> | null = (() => {
    const entries = Object.entries(sensationDialRaw).filter(([, v]) => typeof v === 'number')
    return entries.length > 0
      ? Object.fromEntries(entries as [string, number][])
      : null
  })()

  const pairingWhyRaw = parseMetafieldJSON<Record<string, string>>(mf, 'pairing_why', {})
  const pairingWhy = Object.keys(pairingWhyRaw).length > 0 ? pairingWhyRaw : null

  const accessoryIds = parseMetafieldJSON<string[]>(mf, 'accessory_product_ids', [])
  let accessoryHandles: string[] = []
  if (accessoryIds.length > 0) {
    const accessories = await getProductsByIds(accessoryIds)
    accessoryHandles = accessories.map(p => p.handle)
  }

  const featureBulletsRaw = parseMetafield(mf, 'feature_bullets')
  const featureBullets: string[] | null = (() => {
    if (!featureBulletsRaw) return null
    try {
      const parsed = JSON.parse(featureBulletsRaw)
      if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string')
    } catch { /* fall through */ }
    return null
  })()

  const imageUrl = node.images.edges[0]?.node.url ?? null

  const variants = node.variants.edges.map(e => ({
    id: e.node.id,
    title: e.node.title,
    priceUsd: parseFloat(e.node.price.amount),
    available: e.node.availableForSale,
    ...(e.node.metafields?.[0]?.value ? { originalDescription: e.node.metafields[0].value } : {}),
  }))

  return {
    ...baseCard,
    fullStory: parseMetafield(mf, 'full_story') || node.description || null,
    featureBullets,
    sensationDial,
    pairingWhy,
    accessoryHandles,
    imageUrl,
    variants,
  }
}

// https://shopify.dev/docs/api/admin-graphql/2024-10/objects/Product
export async function getProductsForMerge(productIds: string[]): Promise<Record<string, {
  id: string
  title: string
  handle: string
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT'
  options: Array<{ name: string; values: string[] }>
  firstVariant: {
    id: string
    price: string
    compareAtPrice: string | null
    sku: string | null
    barcode: string | null
    inventoryQuantity: number
  } | null
  images: Array<{ url: string; altText: string | null }>
}>> {
  const gids = productIds.map(id =>
    id.startsWith('gid://') ? id : `gid://shopify/Product/${id}`
  )
  const res = await adminGraphQL<{
    nodes: Array<{
      __typename: string
      id: string
      title: string
      handle: string
      status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT'
      options: Array<{ name: string; values: string[] }>
      variants: { nodes: Array<{ id: string; price: string; compareAtPrice: string | null; sku: string | null; barcode: string | null; inventoryQuantity: number }> }
      images: { nodes: Array<{ url: string; altText: string | null }> }
    } | null>
  }>(`
    query GetProductsForMerge($ids: [ID!]!) {
      nodes(ids: $ids) {
        __typename
        ... on Product {
          id
          title
          handle
          status
          options { name values }
          variants(first: 1) {
            nodes { id price compareAtPrice sku barcode inventoryQuantity }
          }
          images(first: 20) {
            nodes { url altText }
          }
        }
      }
    }
  `, { ids: gids })

  const result: Record<string, {
    id: string
    title: string
    handle: string
    status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT'
    options: Array<{ name: string; values: string[] }>
    firstVariant: {
      id: string
      price: string
      compareAtPrice: string | null
      sku: string | null
      barcode: string | null
      inventoryQuantity: number
    } | null
    images: Array<{ url: string; altText: string | null }>
  }> = {}

  for (const node of res.nodes) {
    if (!node || node.__typename !== 'Product') continue
    const numericId = node.id.replace('gid://shopify/Product/', '')
    result[numericId] = {
      id: node.id,
      title: node.title,
      handle: node.handle,
      status: node.status,
      options: node.options,
      firstVariant: node.variants.nodes[0] ?? null,
      images: node.images.nodes,
    }
  }
  return result
}

// ============ Merge Variants Helpers ============

function toProductGid(productId: string): string {
  return productId.startsWith('gid://') ? productId : `gid://shopify/Product/${productId}`
}

// https://shopify.dev/docs/api/admin-graphql/2024-10/mutations/productUpdate
export async function updateProductTitle(productId: string, newTitle: string): Promise<void> {
  const gid = toProductGid(productId)
  const res = await adminGraphQL<{
    productUpdate: { userErrors: { field: string[]; message: string }[] }
  }>(`
    mutation MergeUpdateTitle($input: ProductInput!) {
      productUpdate(input: $input) {
        userErrors { field message }
      }
    }
  `, { input: { id: gid, title: newTitle } })
  if (res.productUpdate.userErrors.length > 0) {
    const errs = res.productUpdate.userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
    throw new Error(`updateProductTitle: ${errs}`)
  }
}

// https://shopify.dev/docs/api/admin-graphql/2024-10/mutations/productUpdate
export async function archiveProduct(productId: string): Promise<void> {
  const gid = toProductGid(productId)
  const res = await adminGraphQL<{
    productUpdate: { userErrors: { field: string[]; message: string }[] }
  }>(`
    mutation MergeArchiveProduct($input: ProductInput!) {
      productUpdate(input: $input) {
        userErrors { field message }
      }
    }
  `, { input: { id: gid, status: 'ARCHIVED' } })
  if (res.productUpdate.userErrors.length > 0) {
    const errs = res.productUpdate.userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
    throw new Error(`archiveProduct: ${errs}`)
  }
}

// https://shopify.dev/docs/api/admin-graphql/2024-10/mutations/urlRedirectCreate
export async function createUrlRedirect(fromPath: string, toPath: string): Promise<{ id: string }> {
  const path = fromPath.startsWith('/') ? fromPath : `/${fromPath}`
  const res = await adminGraphQL<{
    urlRedirectCreate: {
      urlRedirect: { id: string; path: string; target: string } | null
      userErrors: { field: string[]; message: string }[]
    }
  }>(`
    mutation MergeCreateRedirect($urlRedirect: UrlRedirectInput!) {
      urlRedirectCreate(urlRedirect: $urlRedirect) {
        urlRedirect { id path target }
        userErrors { field message }
      }
    }
  `, { urlRedirect: { path, target: toPath } })
  if (res.urlRedirectCreate.userErrors.length > 0) {
    const msgs = res.urlRedirectCreate.userErrors.map(e => e.message)
    // Non-fatal if a redirect for this path already exists — surface warning, return placeholder.
    const isDuplicate = msgs.some(m => /already exist|duplicate/i.test(m))
    if (isDuplicate) {
      console.warn(`[createUrlRedirect] redirect already exists for ${path}: ${msgs.join('; ')}`)
      return { id: '' }
    }
    const errs = res.urlRedirectCreate.userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
    throw new Error(`createUrlRedirect: ${errs}`)
  }
  return { id: res.urlRedirectCreate.urlRedirect!.id }
}

// https://shopify.dev/docs/api/admin-graphql/2024-10/mutations/productCreateMedia
export async function copyMediaToProduct(
  masterProductId: string,
  mediaSources: { originalSrc: string; alt?: string }[],
): Promise<{ mediaId: string; originalSrc: string }[]> {
  if (mediaSources.length === 0) return []
  const gid = toProductGid(masterProductId)
  const res = await adminGraphQL<{
    productCreateMedia: {
      media: { id: string; status: string; mediaErrors: { message: string }[] }[]
      mediaUserErrors: { field: string[]; message: string }[]
    }
  }>(`
    mutation MergeCopyMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id status mediaErrors { message } }
        mediaUserErrors { field message }
      }
    }
  `, {
    productId: gid,
    media: mediaSources.map(s => ({
      originalSource: s.originalSrc,
      mediaContentType: 'IMAGE',
      alt: s.alt ?? '',
    })),
  })
  if (res.productCreateMedia.mediaUserErrors.length > 0) {
    const errs = res.productCreateMedia.mediaUserErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
    throw new Error(`copyMediaToProduct: ${errs}`)
  }
  const created = res.productCreateMedia.media

  // Poll each media item until READY or FAILED (30s timeout per image, 1s interval).
  const results: { mediaId: string; originalSrc: string }[] = []
  for (let i = 0; i < created.length; i++) {
    const deadline = Date.now() + 30_000
    let item = created[i]!
    while (item.status !== 'READY' && item.status !== 'FAILED') {
      if (Date.now() > deadline) throw new Error(`copyMediaToProduct: timeout polling media ${item.id}`)
      await new Promise(r => setTimeout(r, 1000))
      const poll = await adminGraphQL<{
        node: { id: string; status: string; mediaErrors: { message: string }[] } | null
      }>(`
        query MergeMediaStatus($id: ID!) {
          node(id: $id) {
            ... on MediaImage { id status mediaErrors { message } }
          }
        }
      `, { id: item.id })
      if (poll.node) item = poll.node as typeof item
    }
    if (item.status === 'FAILED') {
      const errMsg = item.mediaErrors?.[0]?.message ?? 'unknown'
      throw new Error(`copyMediaToProduct: media ${item.id} failed — ${errMsg}`)
    }
    results.push({ mediaId: item.id, originalSrc: mediaSources[i]!.originalSrc })
  }
  return results
}

// Assumes single-location Shopify store; cache is per-process (serverless cold starts re-query).
// Lazy cache — fetched once per server process to avoid repeated round-trips.
let _primaryLocationId: string | null = null
async function getPrimaryLocationId(): Promise<string> {
  if (_primaryLocationId) return _primaryLocationId
  const res = await adminGraphQL<{
    locations: { edges: { node: { id: string } }[] }
  }>(`
    query MergePrimaryLocation {
      locations(first: 1, query: "active:true") {
        edges { node { id } }
      }
    }
  `)
  const id = res.locations.edges[0]?.node.id
  if (!id) throw new Error('addVariantsToProduct: no active Shopify location found')
  _primaryLocationId = id
  return id
}

// https://shopify.dev/docs/api/admin-graphql/2024-10/mutations/productOptionsCreate
// https://shopify.dev/docs/api/admin-graphql/2024-10/mutations/productOptionUpdate
// https://shopify.dev/docs/api/admin-graphql/2024-10/mutations/productVariantsBulkCreate
export async function addVariantsToProduct(
  masterProductId: string,
  optionName: string,
  variants: Array<{
    optionValue: string
    price: string
    compareAtPrice?: string | null
    sku?: string | null
    barcode?: string | null
    inventoryQuantity?: number
    mediaId?: string | null
  }>,
): Promise<void> {
  const gid = toProductGid(masterProductId)

  // Read current options to decide whether to create or extend.
  const productRes = await adminGraphQL<{
    product: {
      options: { id: string; name: string; optionValues: { id: string; name: string }[] }[]
    } | null
  }>(`
    query MergeProductOptions($id: ID!) {
      product(id: $id) {
        options { id name optionValues { id name } }
      }
    }
  `, { id: gid })

  const existingOptions = productRes.product?.options ?? []
  const isDefaultOnly =
    existingOptions.length === 1 &&
    existingOptions[0]!.name === 'Title' &&
    existingOptions[0]!.optionValues.length === 1 &&
    existingOptions[0]!.optionValues[0]!.name === 'Default Title'

  const existingOption = existingOptions.find(o => o.name === optionName)

  if (isDefaultOnly) {
    // Create the option from scratch; variantStrategy CREATE also removes the default variant.
    const createRes = await adminGraphQL<{
      productOptionsCreate: { userErrors: { field: string[]; message: string }[] }
    }>(`
      mutation MergeOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!, $variantStrategy: ProductOptionCreateVariantStrategy) {
        productOptionsCreate(productId: $productId, options: $options, variantStrategy: $variantStrategy) {
          userErrors { field message }
        }
      }
    `, {
      productId: gid,
      options: [{ name: optionName, values: variants.map(v => ({ name: v.optionValue })) }],
      variantStrategy: 'CREATE',
    })
    if (createRes.productOptionsCreate.userErrors.length > 0) {
      const errs = createRes.productOptionsCreate.userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
      throw new Error(`addVariantsToProduct productOptionsCreate: ${errs}`)
    }
  } else if (existingOption) {
    // Append any new option values not already present.
    const existingNames = new Set(existingOption.optionValues.map(v => v.name))
    const newValues = variants.filter(v => !existingNames.has(v.optionValue))
    if (newValues.length > 0) {
      const updateRes = await adminGraphQL<{
        productOptionUpdate: { userErrors: { field: string[]; message: string }[] }
      }>(`
        mutation MergeOptionUpdate($productId: ID!, $option: OptionUpdateInput!, $optionValuesToAdd: [OptionValueCreateInput!]) {
          productOptionUpdate(productId: $productId, option: $option, optionValuesToAdd: $optionValuesToAdd) {
            userErrors { field message }
          }
        }
      `, {
        productId: gid,
        option: { id: existingOption.id },
        optionValuesToAdd: newValues.map(v => ({ name: v.optionValue })),
      })
      if (updateRes.productOptionUpdate.userErrors.length > 0) {
        const errs = updateRes.productOptionUpdate.userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
        throw new Error(`addVariantsToProduct productOptionUpdate: ${errs}`)
      }
    }
  }

  // Filter out variants whose optionValue already exists on the master product to make this retry-safe.
  const existingVariantsRes = await adminGraphQL<{
    product: { variants: { nodes: { id: string; selectedOptions: { name: string; value: string }[] }[] } } | null
  }>(`
    query MergeExistingVariants($id: ID!) {
      product(id: $id) {
        variants(first: 100) {
          nodes { id selectedOptions { name value } }
        }
      }
    }
  `, { id: gid })
  const existingOptionValues = new Set(
    (existingVariantsRes.product?.variants.nodes ?? [])
      .flatMap(v => v.selectedOptions)
      .filter(o => o.name === optionName)
      .map(o => o.value),
  )
  const variantsToCreate = variants.filter(v => !existingOptionValues.has(v.optionValue))
  if (variantsToCreate.length === 0) return

  const locationId = await getPrimaryLocationId()

  const bulkRes = await adminGraphQL<{
    productVariantsBulkCreate: {
      productVariants: { id: string }[]
      userErrors: { field: string[]; message: string }[]
    }
  }>(`
    mutation MergeBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
      productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
        productVariants { id }
        userErrors { field message }
      }
    }
  `, {
    productId: gid,
    strategy: isDefaultOnly ? 'REMOVE_STANDALONE_VARIANT' : 'DEFAULT',
    variants: variantsToCreate.map(v => ({
      price: v.price,
      ...(v.compareAtPrice != null ? { compareAtPrice: v.compareAtPrice } : {}),
      optionValues: [{ name: v.optionValue, optionName }],
      inventoryItem: { sku: v.sku ?? null },
      ...(v.barcode != null ? { barcode: v.barcode } : {}),
      ...(v.mediaId != null ? { mediaId: v.mediaId } : {}),
      ...((v.inventoryQuantity ?? 0) > 0
        ? { inventoryQuantities: [{ availableQuantity: v.inventoryQuantity!, locationId }] }
        : {}),
    })),
  })
  if (bulkRes.productVariantsBulkCreate.userErrors.length > 0) {
    const errs = bulkRes.productVariantsBulkCreate.userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
    throw new Error(`addVariantsToProduct productVariantsBulkCreate: ${errs}`)
  }
}

// ─── Pricing Agent Bulk Fetch ─────────────────────────────────────────────

export interface PricingProductSnapshot {
  productId: string
  productGid: string
  handle: string
  title: string
  vendor: string | null
  productType: string | null
  variants: Array<{
    variantId: string
    sku: string
    title: string
    price: number
    compareAtPrice: number | null
    inventoryItemId: string | null
    unitCost: number | null
  }>
  metafields: {
    nalpacSku: string | null
    wholesaleCost: number | null
    mapPrice: number | null
    originalPrice: number | null
    mapRestricted: boolean
    discontinuedAt: Date | null
  }
}

const PRICING_PRODUCTS_QUERY = `
  query PricingProducts($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        handle
        title
        vendor
        productType
        variants(first: 100) {
          nodes {
            id
            sku
            title
            price
            compareAtPrice
            inventoryItem {
              id
              unitCost { amount }
            }
          }
        }
        metafields(keys: ["xdipx.nalpac_sku", "xdipx.wholesale_cost", "xdipx.map_price", "xdipx.original_price", "xdipx.map_restricted", "xdipx.discontinued_at"], first: 10) {
          nodes {
            namespace
            key
            value
          }
        }
      }
    }
  }
`

interface PricingQueryResult {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes: Array<{
      id: string
      handle: string
      title: string
      vendor: string | null
      productType: string | null
      variants: {
        nodes: Array<{
          id: string
          sku: string | null
          title: string
          price: string
          compareAtPrice: string | null
          inventoryItem: {
            id: string
            unitCost: { amount: string } | null
          } | null
        }>
      }
      metafields: { nodes: Array<{ namespace: string; key: string; value: string }> }
    }>
  }
}

// Shopify's Admin API returns metafield `key` as the bare name ("map_price")
// when metafields are queried without a `keys` filter, but as the fully
// qualified "namespace.key" form ("xdipx.map_price") when queried WITH a
// `keys: [...]` filter, which is how every pricing query asks for them. A
// lookup map keyed on the bare name alone misses every fully qualified key
// and silently returns null for MAP price, original price, and wholesale
// cost on every product. Normalize using the `namespace` field Shopify
// already returns alongside `key`, so this works regardless of which shape
// a given query style produces and cannot silently regress if that shape
// changes again.
export function normalizeMetafieldKey(mf: { namespace: string; key: string }): string {
  const prefix = `${mf.namespace}.`
  return mf.key.startsWith(prefix) ? mf.key.slice(prefix.length) : mf.key
}

export function parsePricingSnapshot(raw: PricingQueryResult['products']['nodes'][number]): PricingProductSnapshot | null {
  const mfMap = new Map<string, string>()
  for (const mf of raw.metafields.nodes) {
    mfMap.set(normalizeMetafieldKey(mf), mf.value)
  }

  const variants = raw.variants.nodes.map(v => ({
    variantId: v.id,
    sku: v.sku ?? '',
    title: v.title,
    price: parseFloat(v.price),
    compareAtPrice: v.compareAtPrice != null ? parseFloat(v.compareAtPrice) : null,
    inventoryItemId: v.inventoryItem?.id ?? null,
    unitCost: v.inventoryItem?.unitCost?.amount != null ? parseFloat(v.inventoryItem.unitCost.amount) : null,
  }))

  if (variants.every(v => v.sku === '')) return null

  const wholesaleCostRaw = mfMap.get('wholesale_cost')
  const mapPriceRaw = mfMap.get('map_price')
  const originalPriceRaw = mfMap.get('original_price')
  const discontinuedAtRaw = mfMap.get('discontinued_at')
  const discontinuedAt = discontinuedAtRaw ? new Date(discontinuedAtRaw) : null

  return {
    productId: raw.id,
    productGid: raw.id,
    handle: raw.handle,
    title: raw.title,
    vendor: raw.vendor ?? null,
    productType: raw.productType ?? null,
    variants,
    metafields: {
      nalpacSku: mfMap.get('nalpac_sku') ?? null,
      wholesaleCost: wholesaleCostRaw != null ? parseFloat(wholesaleCostRaw) : null,
      mapPrice: mapPriceRaw != null ? parseFloat(mapPriceRaw) : null,
      originalPrice: originalPriceRaw != null ? parseFloat(originalPriceRaw) : null,
      mapRestricted: mfMap.get('map_restricted') === 'true',
      discontinuedAt,
    },
  }
}

// Smaller pages paced apart, rather than 100-product pages fired back to
// back: a full-catalog recompute is ~25-35 pages regardless, and cost is
// billed on nodes actually returned, so this trades a few extra seconds of
// runtime for headroom in Shopify's leaky-bucket rate limit. Needed because
// adminGraphQL's own THROTTLED retry (4 attempts, capped backoff) isn't
// enough when the bucket is already low going in — that exhausted the batch
// recompute's very first page on 2026-07-28 before any product was fetched.
const PRICING_FETCH_PAGE_SIZE = 50
const PRICING_FETCH_PAGE_DELAY_MS = 500

// A single throttled page must not abandon the whole daily recompute. Because
// bulkFetchProductsForPricing reads every page up front (recomputeCatalog only
// enters its per-variant loop afterward), one exhausted retry throws all the
// way out and the recompute writes zero pricing rows — the 2026-07-30 failure.
// adminGraphQL already makes 4 short (<=5s) THROTTLED retries per call; when
// those are spent it throws "Throttled". Here we give the leaky bucket a
// longer, escalating rest and re-fetch the same page before giving up. The
// batch runs once daily at 07:00 UTC, so tens of seconds of extra wait is free,
// and a non-throttle error still fails fast and unchanged.
const PRICING_FETCH_THROTTLE_RETRIES = 4
const PRICING_FETCH_THROTTLE_BACKOFF_MS = 5000
// One page's rest is capped so a pathological throttle can't eat the whole
// cron budget, but it is well above adminGraphQL's own 5s cap: the point is to
// give the bucket a single wait long enough to actually refill, which the
// 2026-08-19 failure never got because every layer capped its wait at 5s and
// gave up before the bucket recovered.
const PRICING_FETCH_THROTTLE_MAX_WAIT_MS = 30_000

/**
 * How long to rest before re-fetching a throttled pricing page. Prefers
 * Shopify's own refill estimate (carried on ShopifyThrottleError), floors it
 * with an escalating rest so a missing or short estimate still backs off, and
 * caps it so one page can't run away with the cron budget.
 */
export function pricingThrottleWaitMs(retryAfterMsHint: number, attempt: number): number {
  const escalating = attempt * PRICING_FETCH_THROTTLE_BACKOFF_MS
  return Math.min(Math.max(retryAfterMsHint, escalating), PRICING_FETCH_THROTTLE_MAX_WAIT_MS)
}

async function fetchPricingPageWithBackoff(
  variables: { first: number; after: string | null; query: string },
): Promise<PricingQueryResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await adminGraphQL<PricingQueryResult>(PRICING_PRODUCTS_QUERY, variables)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const isThrottle = err instanceof ShopifyThrottleError || /throttl/i.test(message)
      if (attempt > PRICING_FETCH_THROTTLE_RETRIES || !isThrottle) throw err
      const hint = err instanceof ShopifyThrottleError ? err.retryAfterMs : 0
      await new Promise(r => setTimeout(r, pricingThrottleWaitMs(hint, attempt)))
    }
  }
}

export async function bulkFetchProductsForPricing(opts?: {
  cursor?: string | null
  limit?: number
}): Promise<PricingProductSnapshot[]> {
  const pageSize = opts?.limit ?? PRICING_FETCH_PAGE_SIZE
  let cursor: string | null = opts?.cursor ?? null
  const results: PricingProductSnapshot[] = []
  let firstPage = true

  do {
    if (!firstPage) {
      await new Promise(r => setTimeout(r, PRICING_FETCH_PAGE_DELAY_MS))
    }
    firstPage = false

    const data = await fetchPricingPageWithBackoff({
      first: pageSize,
      after: cursor ?? null,
      query: 'metafields.xdipx.nalpac_sku:*',
    })

    for (const node of data.products.nodes) {
      const snapshot = parsePricingSnapshot(node)
      if (snapshot) results.push(snapshot)
    }

    cursor = data.products.pageInfo.hasNextPage ? (data.products.pageInfo.endCursor ?? null) : null
  } while (cursor !== null)

  return results
}

// ─── Webhook SKU Lookup ───────────────────────────────────────────────────

export interface VariantSkuMatch {
  productId: string
  productGid: string
  handle: string
  title: string
  vendor: string | null
  productType: string | null
  variant: {
    variantId: string
    sku: string
    title: string
    price: number
    compareAtPrice: number | null
    inventoryItemId: string | null
    unitCost: number | null
  }
  metafields: {
    nalpacSku: string | null
    wholesaleCost: number | null
    mapPrice: number | null
    originalPrice: number | null
    mapRestricted: boolean
    discontinuedAt: Date | null
  }
}

const VARIANTS_BY_SKU_QUERY = `
  query VariantsBySkus($query: String!, $first: Int!) {
    productVariants(first: $first, query: $query) {
      nodes {
        id
        sku
        title
        price
        compareAtPrice
        inventoryItem {
          id
        }
        product {
          id
          handle
          title
          vendor
          productType
          # Admin API: Product.metafields is a MetafieldConnection. It rejects
          # the Storefront-only lookup-by-identifier argument, and it also
          # rejects a namespace argument passed alongside keys ("Providing any of
          # the namespace, withDefinitions, or withoutDefinitions arguments with
          # the keys argument is not supported"). So ask for fully-qualified
          # "namespace.key" strings with no separate namespace argument, exactly
          # as the pricing query above does.
          metafields(keys: [
            "xdipx.nalpac_sku"
            "xdipx.wholesale_cost"
            "xdipx.map_price"
            "xdipx.original_price"
            "xdipx.map_restricted"
          ], first: 10) {
            nodes {
              namespace
              key
              value
            }
          }
        }
      }
    }
  }
`

interface VariantsBySkuResult {
  productVariants: {
    nodes: Array<{
      id: string
      sku: string | null
      title: string
      price: string
      compareAtPrice: string | null
      inventoryItem: { id: string } | null
      product: {
        id: string
        handle: string
        title: string
        vendor: string | null
        productType: string | null
        metafields: { nodes: Array<{ namespace: string; key: string; value: string }> }
      }
    }>
  }
}

export async function findVariantsBySkus(skus: string[]): Promise<VariantSkuMatch[]> {
  if (skus.length === 0) return []

  const results: VariantSkuMatch[] = []
  const BATCH = 50

  for (let i = 0; i < skus.length; i += BATCH) {
    const batch = skus.slice(i, i + BATCH)
    const queryStr = batch.map(s => `sku:'${s.replace(/'/g, "\\'")}'`).join(' OR ')

    const data = await adminGraphQL<VariantsBySkuResult>(VARIANTS_BY_SKU_QUERY, {
      query: queryStr,
      first: batch.length * 2,
    })

    for (const node of data.productVariants.nodes) {
      const mfMap = new Map<string, string>()
      for (const mf of node.product.metafields.nodes) {
        // Queried WITH a `keys: [...]` filter, the Admin API returns `key` in
        // the fully-qualified "xdipx.map_price" form, so normalize to the bare
        // name before mapping. A map keyed on the raw `key` misses every lookup
        // and silently returns null for cost/MAP/original price.
        mfMap.set(normalizeMetafieldKey(mf), mf.value)
      }
      const wholesaleRaw = mfMap.get('wholesale_cost')
      const mapRaw = mfMap.get('map_price')
      const origRaw = mfMap.get('original_price')

      results.push({
        productId: node.product.id,
        productGid: node.product.id,
        handle: node.product.handle,
        title: node.product.title,
        vendor: node.product.vendor ?? null,
        productType: node.product.productType ?? null,
        variant: {
          variantId: node.id,
          sku: node.sku ?? '',
          title: node.title,
          price: parseFloat(node.price),
          compareAtPrice: node.compareAtPrice != null ? parseFloat(node.compareAtPrice) : null,
          inventoryItemId: node.inventoryItem?.id ?? null,
          // unitCost is not fetched by the SKU-lookup query; callers that need
          // it (pricing-apply-v2 recomputeVariant) fetch it via their own
          // inline query against productVariant(id).
          unitCost: null,
        },
        metafields: {
          nalpacSku: mfMap.get('nalpac_sku') ?? null,
          wholesaleCost: wholesaleRaw != null ? parseFloat(wholesaleRaw) : null,
          mapPrice: mapRaw != null ? parseFloat(mapRaw) : null,
          originalPrice: origRaw != null ? parseFloat(origRaw) : null,
          mapRestricted: mfMap.get('map_restricted') === 'true',
          // discontinued_at is not fetched by the SKU-lookup query; callers that
          // need it (pricing-apply-v2) fetch it via their own inline query.
          discontinuedAt: null,
        },
      })
    }
  }

  return results
}

// ─── Product Type Catalog ─────────────────────────────────────────────────

const PRODUCT_TYPES_QUERY = `
  query ProductTypes($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        productType
      }
    }
  }
`

interface ProductTypesResult {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes: Array<{ productType: string | null }>
  }
}

const PRODUCT_TYPES_CACHE_KEY = 'shopify:distinct-product-types'
const PRODUCT_TYPES_CACHE_TTL = 60 * 60 // 1 hour

export async function getDistinctProductTypes(opts?: { force?: boolean }): Promise<Array<{ productType: string; count: number }>> {
  if (!opts?.force) {
    const cached = await kvGet<Array<{ productType: string; count: number }>>(PRODUCT_TYPES_CACHE_KEY)
    if (cached) return cached
  }

  const counts = new Map<string, number>()
  let cursor: string | null = null
  let pages = 0
  const MAX_PAGES = 20 // hard ceiling to prevent runaway loops; 20 × 250 = 5000 products

  do {
    const data: ProductTypesResult = await adminGraphQL<ProductTypesResult>(PRODUCT_TYPES_QUERY, {
      first: 250,
      after: cursor ?? null,
    })

    for (const node of data.products.nodes) {
      const pt = node.productType?.trim()
      if (pt) {
        counts.set(pt, (counts.get(pt) ?? 0) + 1)
      }
    }

    cursor = data.products.pageInfo.hasNextPage ? (data.products.pageInfo.endCursor ?? null) : null
    pages++
  } while (cursor !== null && pages < MAX_PAGES)

  const result = Array.from(counts.entries())
    .map(([productType, count]) => ({ productType, count }))
    .sort((a, b) => b.count - a.count)

  await kvSet(PRODUCT_TYPES_CACHE_KEY, result, PRODUCT_TYPES_CACHE_TTL)
  return result
}

// ---------------------------------------------------------------------------
// Sanity sync: paginate all Shopify products via REST Admin API
// ---------------------------------------------------------------------------

export interface SanitySyncProduct {
  id: number
  handle: string
  title: string
  images: Array<{ src: string }>
}

/**
 * Paginate all products from Shopify REST Admin API for Sanity sync.
 * Iterates active, draft, and archived statuses. Calls `onBatch` for each
 * page so the caller can process incrementally without buffering the full set.
 */
export async function paginateAllProductsForSanity(
  onBatch: (products: SanitySyncProduct[]) => Promise<void>,
): Promise<{ created: number; skipped: number }> {
  let created = 0
  let skipped = 0

  for (const status of ['active', 'draft', 'archived'] as const) {
    let sinceId = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { products } = await shopifyAdmin<{ products: SanitySyncProduct[] }>(
        `/products.json?limit=250&since_id=${sinceId}&status=${status}&fields=id,handle,title,images`,
      )
      console.log(`[sync-sanity] status=${status} page sinceId=${sinceId} count:`, products?.length ?? 0)
      if (!products?.length) break

      await onBatch(products)

      if (products.length < 250) break
      sinceId = products[products.length - 1]!.id
    }
  }

  return { created, skipped }
}

/**
 * Sweep every Shopify product via the REST Admin API and bucket its handle by
 * status. Reuses the same active/draft/archived pagination as
 * `paginateAllProductsForSanity`, but keeps the status so callers can tell a
 * still-sellable product from an archived one.
 *
 *   - `sellable` = status active OR draft (still surfaces / is orderable).
 *   - `archived` = status archived (dropped from the Storefront API).
 *
 * A handle present in neither set is gone from Shopify entirely. Used by the
 * Sanity↔Shopify reconcile to decide which productPage docs no longer have a
 * sellable counterpart.
 */
export async function collectProductHandlesByStatus(): Promise<{
  sellable: Set<string>
  archived: Set<string>
}> {
  const sellable = new Set<string>()
  const archived = new Set<string>()

  for (const status of ['active', 'draft', 'archived'] as const) {
    let sinceId = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { products } = await shopifyAdmin<{ products: Array<{ id: number; handle: string }> }>(
        `/products.json?limit=250&since_id=${sinceId}&status=${status}&fields=id,handle`,
      )
      if (!products?.length) break
      for (const p of products) {
        if (!p.handle) continue
        if (status === 'archived') archived.add(p.handle)
        else sellable.add(p.handle)
      }
      if (products.length < 250) break
      sinceId = products[products.length - 1]!.id
    }
  }

  return { sellable, archived }
}

// ---------------------------------------------------------------------------
// Debug: fetch xdipx metafields for a product (admin route helper)
// ---------------------------------------------------------------------------

export interface ProductMetafieldDebug {
  allKeys: string[]
  emmaHero: { namespace: string; key: string; value: string; type: string } | null
}

/**
 * Fetches all xdipx-namespace metafields for a product by numeric Shopify ID.
 * Returns a structured debug payload for the emma-hero debug route.
 */
export async function getProductMetafieldDebug(numericProductId: string): Promise<ProductMetafieldDebug> {
  type MfRes = { metafields: Array<{ namespace: string; key: string; value: string; type: string }> }
  const result = await shopifyAdmin<MfRes>(
    `/products/${numericProductId}/metafields.json?namespace=xdipx`,
  ).catch((err: Error) => ({ error: err.message }))

  if ('error' in result) {
    return { allKeys: [], emmaHero: null }
  }

  return {
    allKeys: result.metafields.map(m => `${m.namespace}.${m.key}`),
    emmaHero: result.metafields.find(m => m.key === 'emma_hero') ?? null,
  }
}
