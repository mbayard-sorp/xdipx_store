import crypto from 'node:crypto'
import type { Deal, Product, VaultDeal, Cart, CartLine, ProductImage, ProductVideo, ProductScore, ProductTypeDial, SellingPlan, SellingPlanGroup, SensationDial, SensationDialV2, SensationDialItem, DialValue, CareInstructions, EmmaHeroCopy } from '~/types'
import { toHTML } from '@portabletext/to-html'
import { cached, kvGet, kvSet, KV_KEYS } from '~/lib/kv.server'

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
  if (!res.ok) throw new Error(`Shopify Admin API error: ${res.status} ${path}`)
  return res.json() as Promise<T>
}

export async function adminGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(ADMIN_GQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']!,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify Admin GraphQL error: ${res.status}`)
  const { data, errors } = await res.json() as { data: T; errors?: { message: string }[] }
  if (errors?.length) throw new Error(errors[0]?.message ?? 'Shopify Admin GraphQL error')
  return data
}

// ─── GraphQL Fragments ────────────────────────────────────────────────────

const METAFIELDS_FRAGMENT = `
  metafields(identifiers: [
    { namespace: "xdipx", key: "tagline" }
    { namespace: "xdipx", key: "full_story" }
    { namespace: "xdipx", key: "works_for_him" }
    { namespace: "xdipx", key: "works_for_her" }
    { namespace: "xdipx", key: "box_contents" }
    { namespace: "xdipx", key: "deal_status" }
    { namespace: "xdipx", key: "deal_date" }
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
    { namespace: "xdipx", key: "deal_date" }
    { namespace: "xdipx", key: "original_price" }
    { namespace: "xdipx", key: "category" }
    { namespace: "xdipx", key: "deal_status" }
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
  images(first: 1) {
    edges { node { url altText } }
  }
  variants(first: 2) {
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
  return {
    id: node.id,
    handle: node.handle,
    seoTitle: node.title,
    dealDate: parseMetafield(mf, 'deal_date'),
    dealPrice,
    msrp: parseFloat(parseMetafield(mf, 'original_price') || (variant?.compareAtPrice?.amount ?? '0')),
    images: parseImages(node.images.edges),
    brand: node.vendor,
    category: (parseMetafield(mf, 'category') || 'both') as Deal['category'],
    dealStatus: 'archived' as const,
    qty: variant?.quantityAvailable ?? 0,
    defaultVariantId:    variant?.id ?? null,
    hasMultipleVariants: variantEdges.length > 1,
    ...(moodTags.length     > 0 ? { moodTags }     : {}),
    ...(audienceTags.length > 0 ? { audienceTags } : {}),
    ...(mattersTags.length  > 0 ? { mattersTags }  : {}),
    ...(heroVideo?.src && typeof heroVideo.duration === 'number'
      ? { heroVideo: { src: heroVideo.src, duration: heroVideo.duration, ...(heroVideo.poster ? { poster: heroVideo.poster } : {}) } }
      : {}),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseMetafield(metafields: ({ namespace: string; key: string; value: string } | null)[], key: string): string {
  return metafields.find(m => m?.key === key)?.value ?? ''
}

function parseMetafieldJSON<T>(metafields: ({ namespace: string; key: string; value: string } | null)[], key: string, fallback: T): T {
  const raw = parseMetafield(metafields, key)
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
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
    })),
    price: parseFloat(variant?.price.amount ?? '0'),
    ...(variant?.compareAtPrice ? { compareAtPrice: parseFloat(variant.compareAtPrice.amount) } : {}),
    brand: node.vendor,
    tags: node.tags,
    ...(moodTags.length     > 0 ? { moodTags }     : {}),
    ...(audienceTags.length > 0 ? { audienceTags } : {}),
    ...(mattersTags.length  > 0 ? { mattersTags }  : {}),
    ...(heroVideo?.src && typeof heroVideo.duration === 'number'
      ? { heroVideo: { src: heroVideo.src, duration: heroVideo.duration, ...(heroVideo.poster ? { poster: heroVideo.poster } : {}) } }
      : {}),
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
    category: (parseMetafield(mf, 'category') || 'both') as Deal['category'],
    dealStatus: (parseMetafield(mf, 'deal_status') || 'live') as Deal['dealStatus'],
    dealDate: parseMetafield(mf, 'deal_date'),
    qty: variant?.quantityAvailable ?? 0,
    tags: node.tags ?? [],
    accessoryProductIds: parseMetafieldJSON<string[]>(mf, 'accessory_product_ids', []),
    ...(parseMetafield(mf, 'specifications') ? { specifications: parseMetafield(mf, 'specifications') } : {}),
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
    ...(pairBundleCopy?.headline && pairBundleCopy?.body && pairBundleCopy?.pairedHandle
      ? { pairBundleCopy: pairBundleCopy as import('~/types').PairBundleCopy }
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

export async function getDailyDeal(): Promise<Deal | null> {
  // Step 1: find the live deal handle via tag search (metafields not available on search nodes)
  const search = await storefront<{
    products: { edges: { node: { handle: string } }[] }
  }>(`
    query GetDailyDealHandle {
      products(first: 1, query: "tag:deal-status-live") {
        edges { node { handle } }
      }
    }
  `)
  const handle = search.products.edges[0]?.node.handle
  if (!handle) return null

  // Step 2: fetch full product data by handle (metafields work on direct product queries)
  const data = await storefront<{ product: ShopifyProductNode | null }>(`
    query GetDailyDeal($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
    }
  `, { handle })
  if (!data.product) return null
  return nodeToDeal(data.product)
}

/** Lightweight: returns only the live deal's handle. Used by PLPs to flag tiles. */
export async function getLiveDealHandle(): Promise<string | null> {
  const search = await storefront<{
    products: { edges: { node: { handle: string } }[] }
  }>(`
    query GetLiveDealHandle {
      products(first: 1, query: "tag:deal-status-live") {
        edges { node { handle } }
      }
    }
  `).catch(() => null)
  return search?.products.edges[0]?.node.handle ?? null
}

/** Like getDailyDeal but finds the deal-status-approved product so admin can promote it. */
export async function getApprovedDeal(): Promise<Deal | null> {
  const search = await storefront<{
    products: { edges: { node: { handle: string } }[] }
  }>(`
    query GetApprovedDealHandle {
      products(first: 1, query: "tag:deal-status-approved") {
        edges { node { handle } }
      }
    }
  `)
  const handle = search.products.edges[0]?.node.handle
  if (!handle) return null
  const data = await storefront<{ product: ShopifyProductNode | null }>(`
    query GetApprovedDeal($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
    }
  `, { handle })
  if (!data.product) return null
  return nodeToDeal(data.product)
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
  const pairBundleCopy = pairBundleCopyRaw?.headline && pairBundleCopyRaw?.body && pairBundleCopyRaw?.pairedHandle
    ? (pairBundleCopyRaw as import('~/types').PairBundleCopy)
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
    category: (mfVal('category') || 'both') as Deal['category'],
    dealStatus: (mfVal('deal_status') || 'pending') as Deal['dealStatus'],
    dealDate: mfVal('deal_date'),
    qty: variant?.inventory_quantity ?? 0,
    tags: product.tags ? product.tags.split(', ').filter(Boolean) : [],
    accessoryProductIds: mfJSON<string[]>('accessory_product_ids', []),
    ...(mfVal('specifications') ? { specifications: mfVal('specifications') } : {}),
    metaDescription: mfVal('seo_meta_description'),
    ...(mfVal('original_description') ? { rawDescription: mfVal('original_description') } : {}),
    ...(mfVal('deal_score') ? { dealScore: parseFloat(mfVal('deal_score')) } : {}),
    ...(mfVal('nalpac_sku') ? { nalpacSku: mfVal('nalpac_sku') } : {}),
    ...(emmaHero ? { emmaHero } : {}),
    ...(quietEndorsementCopy ? { quietEndorsementCopy } : {}),
    ...(pairBundleCopy ? { pairBundleCopy } : {}),
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

export async function getDealByHandle(handle: string): Promise<Deal | null> {
  const data = await storefront<{ product: ShopifyProductNode | null }>(`
    query GetDealByHandle($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
    }
  `, { handle })
  if (!data.product) return null
  return nodeToDeal(data.product)
}

export async function getProductsByIds(ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return []
  const data = await storefront<{ nodes: ({ __typename: string } & ShopifyProductNode)[] }>(`
    query GetProductsByIds($ids: [ID!]!) {
      nodes(ids: $ids) {
        __typename
        ... on Product { ${PRODUCT_CORE_FRAGMENT} }
      }
    }
  `, { ids })
  return (data.nodes ?? [])
    .filter(n => n.__typename === 'Product')
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
    `, { query: `tag:${tag}`, first: limit })
    return data.products.edges.map(e => nodeToProduct(e.node))
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
  category?:        string
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

  // 2. Category tag — broad, evergreen pool
  if (out.length < limit && opts.category) {
    try {
      const byCategory = await getProductsByTag(opts.category, 8)
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
  return cached('shopify:sitemap:product-images', 3600, async () => {
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
    return map
  })
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

export async function getRecentVaultDeals(limit = 7): Promise<VaultDeal[]> {
  const data = await storefront<{
    products: { edges: { node: ShopifyProductCardNode }[] }
  }>(`
    query GetVaultDeals($first: Int!) {
      products(first: $first, query: "tag:deal-status-archived", sortKey: UPDATED_AT, reverse: true) {
        edges { node { ${PRODUCT_CARD_FRAGMENT} } }
      }
    }
  `, { first: limit })

  return data.products.edges.map(e => nodeToVaultDeal(e.node))
}

export async function getVaultDeals(page = 1, limit = 20): Promise<{ deals: VaultDeal[]; hasNextPage: boolean }> {
  const data = await storefront<{
    products: {
      edges: { node: ShopifyProductCardNode; cursor: string }[]
      pageInfo: { hasNextPage: boolean }
    }
  }>(`
    query GetVaultPage($first: Int!, $after: String) {
      products(first: $first, after: $after, query: "tag:deal-status-archived", sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage }
        edges {
          cursor
          node { ${PRODUCT_CARD_FRAGMENT} }
        }
      }
    }
  `, { first: limit, after: page > 1 ? btoa(`${(page - 1) * limit}`) : null })

  return {
    deals: data.products.edges.map(e => nodeToVaultDeal(e.node)),
    hasNextPage: data.products.pageInfo.hasNextPage,
  }
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
 * Set custom attributes on a cart. Used to tag carts for Shopify Automatic
 * Discount rules (e.g. pair_bundle=live triggers a pre-configured % off rule).
 */
export async function setCartAttributes(
  cartId: string,
  attributes: { key: string; value: string }[],
): Promise<void> {
  await storefront(`
    mutation CartAttributesUpdate($cartId: ID!, $attributes: [AttributeInput!]!) {
      cartAttributesUpdate(cartId: $cartId, attributes: $attributes) {
        cart { id }
        userErrors { field message }
      }
    }
  `, { cartId, attributes })
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

export async function setDealStatus(productId: string, status: string): Promise<void> {
  const numericId = productId.replace('gid://shopify/Product/', '')
  await updateProductMetafield(productId, 'deal_status', status)
  // Mirror status in tags for Storefront API querying
  const { product } = await shopifyAdmin<{ product: { tags: string } | null }>(`/products/${numericId}.json`)
  if (!product) throw new Error(`Product ${numericId} not found when setting deal status`)
  const currentTags = product.tags.split(', ').filter((t: string) => !t.startsWith('deal-status-'))
  currentTags.push(`deal-status-${status}`)
  await shopifyAdmin(`/products/${numericId}.json`, 'PUT', {
    product: { id: numericId, tags: currentTags.join(', ') },
  })
}

/**
 * Archive a Shopify product so it stops appearing in storefront/search.
 *
 *   - Sets the Shopify product `status` to ARCHIVED via Admin GraphQL.
 *   - Sets `xdipx.deal_status='archived'` metafield + mirrors `deal-status-archived` tag.
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

  // 2. Mirror archive state in our metafield + tag — keeps Storefront queries consistent.
  await setDealStatus(productId, 'archived')

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

export async function getWholesaleCostBySKU(sku: string): Promise<number> {
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
  return parseFloat(raw ?? '0')
}

// ─── Sanity → Shopify push ─────────────────────────────────────────────────

export interface ProductPageDoc {
  shopifyProductId: string
  title?: string | undefined
  vendor?: string | undefined
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
  category?: string | undefined
  dealStatus?: string | undefined
  dealDate?: string | undefined
  originalPrice?: number | undefined
  wholesaleCost?: number | undefined
  mapPrice?: number | undefined
  nalpacSku?: string | undefined
  dealScore?: number | undefined
  accessoryProductIds?: string[] | undefined
  seoMetaDescription?: string | undefined
  specifications?: string | undefined
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
  emmaHero?: EmmaHeroCopy | undefined             // xdipx.emma_hero (json)
  // Brand-aware title augmentation
  originalTitle?: string | undefined              // xdipx.original_title (single_line_text_field) — manufacturer's pre-augmented title
  // Pairing copy — keyed by accessory GID
  pairingWhy?: Record<string, string> | undefined // xdipx.pairing_why (json)
}

export async function pushProductToShopify(doc: ProductPageDoc): Promise<void> {
  const gid = `gid://shopify/Product/${doc.shopifyProductId}`

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
      ...(doc.tags       !== undefined ? { tags:     doc.tags                 } : {}),
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

  add('tagline',          doc.tagline,               'single_line_text_field', true)
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
  add('category',         doc.category,                        'single_line_text_field')
  add('deal_status',      doc.dealStatus,                      'single_line_text_field')
  add('deal_date',        doc.dealDate,                        'date')
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
  // Optional — varies by product type (lubes have minimal specs; toys have full dimension/material lists).
  add('specifications',       doc.specifications,               'multi_line_text_field')

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

// ─── Pipeline helpers ─────────────────────────────────────────────────────

/**
 * Set a Shopify product's status to 'active' and publish to all sales channels.
 * Required before the Storefront API can return the product.
 */
export async function activateShopifyProduct(numericId: string): Promise<void> {
  const id = numericId.replace('gid://shopify/Product/', '')
  const gid = `gid://shopify/Product/${id}`

  // 1. Set product status to active
  await shopifyAdmin(`/products/${id}.json`, 'PUT', {
    product: { id, status: 'active' },
  })

  // 2. Fetch all available publications (sales channels)
  const { publications } = await adminGraphQL<{
    publications: { edges: { node: { id: string } }[] }
  }>(`
    query GetPublications {
      publications(first: 20) {
        edges { node { id } }
      }
    }
  `)

  const publicationIds = publications.edges.map(e => e.node.id)
  if (publicationIds.length === 0) return

  // 3. Publish product to all channels
  await adminGraphQL<unknown>(`
    mutation PublishProduct($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }
  `, {
    id: gid,
    input: publicationIds.map(pubId => ({ publicationId: pubId })),
  })
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
 * here so legacy callers (`bulk-import`, `deal-pipeline`) keep auto-slugify
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

  const res = await shopifyAdmin<{ product: { id: string; variants: { id: string; inventory_item_id: string }[] } }>('/products.json', 'POST', {
    product: {
      title:   product.title,
      handle,
      vendor:  product.brand,
      tags:    tags.join(', '),
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

/**
 * Create a Shopify product (DRAFT) with multiple variants for bulk import.
 * Each variant maps to one BulkVariantRow. Returns the numeric product ID.
 * Includes 'deal-status-pending' in initial tags to avoid a separate setDealStatus call.
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
  optionName: string,
  handle: string,
): Promise<string> {

  const tags: string[] = [
    `brand:${master.brand.toLowerCase().replace(/\s+/g, '-')}`,
    `nalpac-sku-${master.sku}`,
    'deal-status-pending',
    ...(master.msrp < 25  ? ['price:under-25']  :
        master.msrp < 50  ? ['price:25-50']      :
        master.msrp < 100 ? ['price:50-100']     : ['price:100-plus']),
    ...master.categories.map(c => `cat:${c.toLowerCase().replace(/\s+/g, '-')}`),
  ]

  const res = await shopifyAdmin<{
    product: {
      id: string
      variants: { id: string; sku: string; inventory_item_id: string }[]
    }
  }>('/products.json', 'POST', {
    product: {
      title:   master.title,
      handle,
      vendor:  master.brand,
      tags:    tags.join(', '),
      status:  'draft',
      options: [{ name: optionName, values: variants.map(v => v.optionValue) }],
      variants: variants.map(v => ({
        sku:                  v.sku,
        option1:              v.optionValue,
        price:                v.price.toFixed(2),
        compare_at_price:     v.compareAtPrice.toFixed(2),
        inventory_management: 'shopify',
        inventory_quantity:   v.qty,
      })),
      images: master.images.slice(0, 10).map(src => ({ src })),
    },
  })

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

/**
 * Upload a JPEG buffer to Shopify Files (not attached to any product) and
 * return its public CDN URL. Used by the bulk-import orchestrator's mood-image
 * tool: the resulting URL is written to the product's xdipx.mood_image_url
 * metafield so the PDP hero can render it as a full-bleed background.
 */
export async function uploadMoodImageToShopifyFiles(
  imageBuffer: Buffer,
  filename: string,
): Promise<string> {
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
  const url = file?.url ?? file?.image?.url
  if (!url) {
    // The file was created but has not yet been processed. Poll once briefly.
    const fileId = file?.id
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
      if (u) return u
    }
    throw new Error('Shopify fileCreate: no URL after polling')
  }
  return url
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
  dealDate?: string
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

      // Only include products that have been set up as deals (have a deal_status metafield)
      if (!mfVal('deal_status') && !mfVal('nalpac_sku')) continue

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
        ...(mfVal('deal_date') ? { dealDate: mfVal('deal_date') } : {}),
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
  id handle title vendor tags
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
