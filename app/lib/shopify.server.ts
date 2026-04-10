import type { Deal, Product, VaultDeal, Cart, CartLine, ProductImage, ProductVideo, ProductScore } from '~/types'
import { toHTML } from '@portabletext/to-html'

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

async function adminGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
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
    { namespace: "xdipx", key: "feature_bullets" }
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
    { namespace: "custom", key: "original_description" }
  ]) {
    namespace key value
  }
`

const PRODUCT_CORE_FRAGMENT = `
  id handle title vendor tags description
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
      }
    }
  }
  ${METAFIELDS_FRAGMENT}
`

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

function parseVideos(media?: { edges: { node: ShopifyMediaNode }[] }): ProductVideo[] {
  if (!media) return []
  return media.edges
    .filter(e => e.node.mediaContentType === 'VIDEO' && e.node.previewImage && e.node.sources?.length)
    .map(e => ({
      previewImageUrl: e.node.previewImage!.url,
      sources: (e.node.sources ?? []).map(s => ({ url: s.url, mimeType: s.mimeType })),
    }))
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
}

interface ShopifyMediaNode {
  mediaContentType: string
  previewImage?: { url: string }
  sources?: { url: string; mimeType: string; height: number; width: number }[]
}

interface ShopifyProductNode {
  id: string
  handle: string
  title: string
  vendor: string
  tags: string[]
  description: string
  images: { edges: { node: { url: string; altText: string | null } }[] }
  media?: { edges: { node: ShopifyMediaNode }[] }
  options: { name: string; values: string[] }[]
  variants: { edges: { node: ShopifyVariantNode }[] }
  metafields: ({ namespace: string; key: string; value: string } | null)[]
}

function nodeToProduct(node: ShopifyProductNode): Product {
  const variant = node.variants.edges[0]?.node
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
    })),
    price: parseFloat(variant?.price.amount ?? '0'),
    ...(variant?.compareAtPrice ? { compareAtPrice: parseFloat(variant.compareAtPrice.amount) } : {}),
    brand: node.vendor,
    tags: node.tags,
  }
}

function nodeToDeal(node: ShopifyProductNode): Deal {
  const mf = node.metafields
  const variant = node.variants.edges[0]?.node

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
    featureBullets: parseMetafieldJSON<string[]>(mf, 'feature_bullets', []),
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
    })),
    options: node.options,
    // rating populated by Judge.me integration — omitted until available
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
  const data = await storefront<{ product: ShopifyProductNode | null }>(`
    query GetProduct($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
    }
  `, { handle })
  if (!data.product) return null
  return nodeToProduct(data.product)
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
      sources: e.node.sources!.map(s => ({ url: s.url, mimeType: s.mimeType })),
    }))

  const mf = [...(xdipxMF ?? []), ...(customMF ?? [])]
  const mfVal = (key: string) => mf.find(m => m.key === key)?.value ?? ''
  const mfJSON = <T>(key: string, fallback: T): T => {
    const raw = mfVal(key)
    if (!raw) return fallback
    try { return JSON.parse(raw) as T } catch { return fallback }
  }

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
    featureBullets: mfJSON<string[]>('feature_bullets', []),
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
    accessoryProductIds: mfJSON<string[]>('accessory_product_ids', []),
    ...(mfVal('specifications') ? { specifications: mfVal('specifications') } : {}),
    metaDescription: mfVal('seo_meta_description'),
    ...(mfVal('original_description') ? { rawDescription: mfVal('original_description') } : {}),
    ...(mfVal('deal_score') ? { dealScore: parseFloat(mfVal('deal_score')) } : {}),
    ...(mfVal('nalpac_sku') ? { nalpacSku: mfVal('nalpac_sku') } : {}),
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
}

export async function getCollectionProducts(handle: string, limit = 8): Promise<Product[]> {
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
}

export async function getProductsByHandles(handles: string[]): Promise<Product[]> {
  if (handles.length === 0) return []
  const results = await Promise.all(handles.map(h => getProductByHandle(h)))
  return results.filter((p): p is Product => p !== null)
}

export async function getBonusDeal(): Promise<Product | null> {
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
}

export async function getRecentVaultDeals(limit = 7): Promise<VaultDeal[]> {
  const data = await storefront<{
    products: { edges: { node: ShopifyProductNode }[] }
  }>(`
    query GetVaultDeals($first: Int!) {
      products(first: $first, query: "tag:deal-status-archived", sortKey: UPDATED_AT, reverse: true) {
        edges { node { ${PRODUCT_CORE_FRAGMENT} } }
      }
    }
  `, { first: limit })

  return data.products.edges.map(e => {
    const deal = nodeToDeal(e.node)
    return {
      id: deal.id,
      handle: deal.handle,
      seoTitle: deal.seoTitle,
      dealDate: deal.dealDate,
      dealPrice: deal.dealPrice,
      msrp: deal.msrp,
      images: deal.images,
      brand: deal.brand,
      category: deal.category,
      dealStatus: 'archived' as const,
      qty: deal.qty,
    }
  })
}

export async function getVaultDeals(page = 1, limit = 20): Promise<{ deals: VaultDeal[]; hasNextPage: boolean }> {
  const data = await storefront<{
    products: {
      edges: { node: ShopifyProductNode; cursor: string }[]
      pageInfo: { hasNextPage: boolean }
    }
  }>(`
    query GetVaultPage($first: Int!, $after: String) {
      products(first: $first, after: $after, query: "tag:deal-status-archived", sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage }
        edges {
          cursor
          node { ${PRODUCT_CORE_FRAGMENT} }
        }
      }
    }
  `, { first: limit, after: page > 1 ? btoa(`${(page - 1) * limit}`) : null })

  return {
    deals: data.products.edges.map(e => {
      const deal = nodeToDeal(e.node)
      return { id: deal.id, handle: deal.handle, seoTitle: deal.seoTitle, dealDate: deal.dealDate, dealPrice: deal.dealPrice, msrp: deal.msrp, images: deal.images, brand: deal.brand, category: deal.category, dealStatus: 'archived' as const, qty: deal.qty }
    }),
    hasNextPage: data.products.pageInfo.hasNextPage,
  }
}

export async function getCollectionDeals(
  handle: string,
  page = 1,
  limit = 20,
): Promise<{ deals: VaultDeal[]; hasNextPage: boolean }> {
  // Shopify uses opaque cursors — walk through prior pages to get the cursor
  let after: string | null = null
  for (let p = 1; p < page; p++) {
    const skip = await storefront<{
      collection: {
        products: { edges: { cursor: string }[] }
      } | null
    }>(`
      query SkipPage($handle: String!, $first: Int!, $after: String) {
        collection(handle: $handle) {
          products(first: $first, after: $after, sortKey: MANUAL) {
            edges { cursor }
          }
        }
      }
    `, { handle, first: limit, after })
    const edges = skip.collection?.products.edges
    if (!edges?.length) return { deals: [], hasNextPage: false }
    after = edges[edges.length - 1]!.cursor
  }

  const data = await storefront<{
    collection: {
      products: {
        pageInfo: { hasNextPage: boolean }
        edges: { cursor: string; node: ShopifyProductNode }[]
      }
    } | null
  }>(`
    query GetCollectionDeals($handle: String!, $first: Int!, $after: String) {
      collection(handle: $handle) {
        products(first: $first, after: $after, sortKey: MANUAL) {
          pageInfo { hasNextPage }
          edges { cursor node { ${PRODUCT_CORE_FRAGMENT} } }
        }
      }
    }
  `, { handle, first: limit, after })

  if (!data.collection) return { deals: [], hasNextPage: false }
  return {
    deals: data.collection.products.edges.map(e => {
      const deal = nodeToDeal(e.node)
      return { id: deal.id, handle: deal.handle, seoTitle: deal.seoTitle, dealDate: deal.dealDate, dealPrice: deal.dealPrice, msrp: deal.msrp, images: deal.images, brand: deal.brand, category: deal.category, dealStatus: 'archived' as const, qty: deal.qty }
    }),
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
}

// Fetch all Shopify collections for the admin collection picker.
export async function getShopifyCollections(): Promise<{ handle: string; title: string }[]> {
  const data = await adminGraphQL<{
    collections: { edges: { node: { handle: string; title: string } }[] }
  }>(`
    query GetCollections {
      collections(first: 100, sortKey: TITLE) {
        edges { node { handle title } }
      }
    }
  `)
  return data.collections.edges.map(e => e.node)
}

export async function getAccessoryProducts(ids: string[]): Promise<Product[]> {
  if (!ids.length) return []
  const queries = ids.map((id, i) => `p${i}: product(id: "${id}") { ${PRODUCT_CORE_FRAGMENT} }`).join('\n')
  const data = await storefront<Record<string, ShopifyProductNode | null>>(`query { ${queries} }`)
  return Object.values(data).filter(Boolean).map(n => nodeToProduct(n!))
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
      }
    }
  }
  cost {
    subtotalAmount { amount currencyCode }
    totalAmount    { amount currencyCode }
  }
`

interface CartResponse { cart: RawCart }
interface RawCart {
  id: string; checkoutUrl: string; totalQuantity: number
  lines: { edges: { node: { id: string; quantity: number; merchandise: { id: string; title: string; price: { amount: string; currencyCode: string }; product: { id: string; title: string; handle: string; images: { edges: { node: { url: string; altText: string | null } }[] } } } } }[] }
  cost: { subtotalAmount: { amount: string; currencyCode: string }; totalAmount: { amount: string; currencyCode: string } }
}

function rawCartToCart(raw: RawCart): Cart {
  return {
    id: raw.id,
    checkoutUrl: raw.checkoutUrl,
    totalQuantity: raw.totalQuantity,
    lines: raw.lines.edges.map((e): CartLine => ({
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
    })),
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

export async function getCart(cartId: string): Promise<Cart | null> {
  const data = await storefront<{ cart: RawCart | null }>(`
    query GetCart($id: ID!) { cart(id: $id) { ${CART_FRAGMENT} } }
  `, { id: cartId })
  if (!data.cart) return null
  return rawCartToCart(data.cart)
}

export async function addToCart(cartId: string, variantId: string, quantity: number): Promise<Cart> {
  const data = await storefront<{ cartLinesAdd: CartResponse }>(`
    mutation AddToCart($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ${CART_FRAGMENT} }
      }
    }
  `, { cartId, lines: [{ merchandiseId: variantId, quantity }] })
  return rawCartToCart(data.cartLinesAdd.cart)
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
  const { product } = await shopifyAdmin<{ product: { tags: string } }>(`/products/${numericId}.json`)
  const currentTags = product.tags.split(', ').filter((t: string) => !t.startsWith('deal-status-'))
  currentTags.push(`deal-status-${status}`)
  await shopifyAdmin(`/products/${numericId}.json`, 'PUT', {
    product: { id: numericId, tags: currentTags.join(', ') },
  })
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
  title?: string
  vendor?: string
  tags?: string[]
  description?: unknown        // string (legacy) or portable text blocks
  seoTitle?: string
  seoDescription?: string
  tagline?: string
  fullStory?: unknown           // string (legacy) or portable text blocks
  worksForHim?: unknown        // string (legacy) or portable text blocks
  worksForHer?: unknown        // string (legacy) or portable text blocks
  featureBullets?: string[]
  boxContents?: string[]
  moodImageUrl?: string
  category?: string
  dealStatus?: string
  dealDate?: string
  originalPrice?: number
  wholesaleCost?: number
  mapPrice?: number
  nalpacSku?: string
  dealScore?: number
  accessoryProductIds?: string[]
  seoMetaDescription?: string
  specifications?: string
  rawDescription?: string
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
      ...(doc.description !== undefined ? { descriptionHtml: ptToHtml(doc.description) } : {}),
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

  add('tagline',          doc.tagline,               'single_line_text_field', true)
  add('full_story',       ptToHtml(doc.fullStory),   'multi_line_text_field',  true)
  add('works_for_him',    ptToHtml(doc.worksForHim), 'multi_line_text_field',  true)
  add('works_for_her',    ptToHtml(doc.worksForHer), 'multi_line_text_field',  true)
  add('mood_image_url',   doc.moodImageUrl,                    'single_line_text_field')
  add('category',         doc.category,                        'single_line_text_field')
  add('deal_status',      doc.dealStatus,                      'single_line_text_field')
  add('deal_date',        doc.dealDate,                        'date')
  add('nalpac_sku',       doc.nalpacSku,                       'single_line_text_field')
  add('original_price',   doc.originalPrice?.toString(),       'number_decimal')
  add('wholesale_cost',   doc.wholesaleCost?.toString(),       'number_decimal')
  add('map_price',        doc.mapPrice?.toString(),            'number_decimal')

  if (!doc.featureBullets?.length) throw new Error('pushProductToShopify: featureBullets is empty')
  metafields.push({
    namespace: 'xdipx', key: 'feature_bullets', ownerId: gid,
    value: JSON.stringify(doc.featureBullets),
    type: 'json',
  })

  if (!doc.boxContents?.length) throw new Error('pushProductToShopify: boxContents is empty')
  metafields.push({
    namespace: 'xdipx', key: 'box_contents', ownerId: gid,
    value: JSON.stringify(doc.boxContents),
    type: 'json',
  })

  if (doc.accessoryProductIds !== undefined) {
    metafields.push({
      namespace: 'xdipx', key: 'accessory_product_ids', ownerId: gid,
      value: JSON.stringify(doc.accessoryProductIds),
      type: 'json',
    })
  }
  add('deal_score',           doc.dealScore?.toString(),        'number_decimal')
  add('seo_meta_description', doc.seoMetaDescription,           'multi_line_text_field',  true)
  add('specifications',       doc.specifications,               'multi_line_text_field',  true)

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
 * Create a new Shopify product (DRAFT status) from a scored Nalpac feed product.
 * Returns the numeric product ID (not GID) as a string.
 */
export async function createShopifyProductFromFeed(product: ProductScore): Promise<string> {
  const handle = product.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200)

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

  return res.product.id
}

/**
 * Create a Shopify product (DRAFT) with multiple variants for bulk import.
 * Each variant maps to one BulkVariantRow. Returns the numeric product ID.
 * Includes 'deal-status-pending' in initial tags to avoid a separate setDealStatus call.
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
): Promise<string> {
  const handle = master.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200)

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

  return res.product.id
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
 * Upload a JPEG thumbnail buffer to Shopify as a product image via staged upload.
 * Returns the new media GID.
 */
export async function uploadThumbnailToProduct(
  shopifyProductGid: string,
  imageBuffer: Buffer,
  filename: string,
  altText: string,
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
      mimeType:   'image/jpeg',
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
  form.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }), filename)

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
