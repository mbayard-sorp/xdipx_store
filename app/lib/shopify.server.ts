import type { Deal, Product, VaultDeal, Cart, CartLine, ProductImage } from '~/types'

const STOREFRONT_ENDPOINT = `https://${process.env['SHOPIFY_STORE_DOMAIN']}/api/2024-10/graphql.json`
const ADMIN_ENDPOINT      = `https://${process.env['SHOPIFY_STORE_DOMAIN']}/admin/api/2024-10`

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
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`Shopify Admin API error: ${res.status} ${path}`)
  return res.json() as Promise<T>
}

// ─── GraphQL Fragments ────────────────────────────────────────────────────

const METAFIELDS_FRAGMENT = `
  metafields(identifiers: [
    { namespace: "xdipx", key: "tagline" }
    { namespace: "xdipx", key: "full_story" }
    { namespace: "xdipx", key: "works_for_him" }
    { namespace: "xdipx", key: "works_for_her" }
    { namespace: "xdipx", key: "feature_bullets" }
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
  ]) {
    namespace key value
  }
`

const PRODUCT_CORE_FRAGMENT = `
  id handle title vendor tags
  images(first: 10) {
    edges { node { url altText } }
  }
  variants(first: 1) {
    edges {
      node {
        id
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

interface ShopifyProductNode {
  id: string
  handle: string
  title: string
  vendor: string
  tags: string[]
  images: { edges: { node: { url: string; altText: string | null } }[] }
  variants: { edges: { node: { id: string; price: { amount: string }; compareAtPrice: { amount: string } | null; availableForSale: boolean; quantityAvailable: number } }[] }
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
      price: e.node.price.amount,
      compareAtPrice: e.node.compareAtPrice?.amount ?? null,
      availableForSale: e.node.availableForSale,
      quantityAvailable: e.node.quantityAvailable,
    })),
    price: parseFloat(variant?.price.amount ?? '0'),
    compareAtPrice: variant?.compareAtPrice ? parseFloat(variant.compareAtPrice.amount) : undefined,
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
    fullStory: parseMetafield(mf, 'full_story'),
    worksForHim: parseMetafield(mf, 'works_for_him'),
    worksForHer: parseMetafield(mf, 'works_for_her'),
    featureBullets: parseMetafieldJSON<string[]>(mf, 'feature_bullets', []),
    images: parseImages(node.images.edges),
    moodImageUrl: parseMetafield(mf, 'mood_image_url') || undefined,
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
    metaDescription: parseMetafield(mf, 'seo_meta_description'),
    dealScore: parseFloat(parseMetafield(mf, 'deal_score') || '0') || undefined,
    nalpacSku: parseMetafield(mf, 'nalpac_sku') || undefined,
    variantId: variant?.id ?? '',
    rating: undefined, // populated by Judge.me integration
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

export async function getProductByHandle(handle: string): Promise<Product | null> {
  const data = await storefront<{ product: ShopifyProductNode | null }>(`
    query GetProduct($handle: String!) {
      product(handle: $handle) { ${PRODUCT_CORE_FRAGMENT} }
    }
  `, { handle })
  if (!data.product) return null
  return nodeToProduct(data.product)
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
): Promise<void> {
  const numericId = productId.replace('gid://shopify/Product/', '')
  await shopifyAdmin(`/products/${numericId}/metafields.json`, 'POST', {
    metafield: { namespace: 'xdipx', key, value, type },
  })
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
