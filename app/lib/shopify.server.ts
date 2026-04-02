import type { Deal, Product, VaultDeal, Cart, CartLine, ProductImage, ProductScore } from '~/types'
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
  options { name values }
  variants(first: 20) {
    edges {
      node {
        id
        title
        selectedOptions { name value }
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

interface ShopifyVariantNode {
  id: string
  title: string
  selectedOptions: { name: string; value: string }[]
  price: { amount: string }
  compareAtPrice: { amount: string } | null
  availableForSale: boolean
  quantityAvailable: number
}

interface ShopifyProductNode {
  id: string
  handle: string
  title: string
  vendor: string
  tags: string[]
  description: string
  images: { edges: { node: { url: string; altText: string | null } }[] }
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
    variants: node.variants.edges.map(e => ({
      id: e.node.id,
      title: e.node.title,
      selectedOptions: e.node.selectedOptions,
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
  }
  interface RestImage { src: string; alt: string | null }
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
    variants: product.variants.map(v => ({
      id: `gid://shopify/ProductVariant/${v.id}`,
      title: v.title,
      selectedOptions: [],
      price: v.price,
      compareAtPrice: v.compare_at_price,
      availableForSale: (v.inventory_quantity ?? 0) > 0,
      quantityAvailable: v.inventory_quantity ?? 0,
    })),
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

export async function getAccessoryProducts(ids: string[]): Promise<Product[]> {
  if (!ids.length) return []
  const queries = ids.map((id, i) => `p${i}: product(id: "${id}") { ${PRODUCT_CORE_FRAGMENT} }`).join('\n')
  const data = await storefront<Record<string, ShopifyProductNode | null>>(`query { ${queries} }`)
  return Object.values(data).filter(Boolean).map(n => nodeToProduct(n!))
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
