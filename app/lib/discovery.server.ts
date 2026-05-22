/**
 * Server-side discovery infra for the home page "Find you in a product" surface.
 *
 * Builds a lean product index (mood/audience/matters/category) over the
 * Shopify catalog via Admin GraphQL, caches it in KV, and exposes scoring
 * + ranking helpers for the home loader and `/api/discovery`.
 *
 * Stays small (one record per product, no descriptions or HTML) so the full
 * 3K-SKU index fits comfortably in KV and is fast to ship to the client.
 */

import { adminGraphQL } from '~/lib/shopify.server'
import { kvGet, kvSet, kvDel } from '~/lib/kv.server'
import type { ProductTypeDial } from '~/types'
import type {
  Category,
  DiscoveryProduct,
  DiscoveryState,
  Rail,
} from '~/types/discovery'
import { availableToArrays, computeAvailable, rankRails, rankSingleRail } from '~/lib/discovery-emma'
import type { ChipAvailabilityArrays } from '~/lib/discovery-emma'
import type { ScoredProduct } from '~/types/discovery'
import { normalizeTag } from '~/lib/discovery-tags'
import {
  getActiveDiscoveryRules,
  getInventoryMin,
  applyRules,
  fillFallbacks,
  autoLoosen,
  resolveCollectionPins,
} from '~/lib/discovery-rules.server'

/**
 * Bump when the index shape changes so old cached entries are ignored.
 * KV writes and reads are namespaced by version; old entries expire on TTL.
 */
// v6: DiscoveryProduct gained priceMax + compareAtPrice + colorValues +
//     sizeValues for the home-page card savings line and color/size indicators.
//     v5 entries lack these; the card would render no savings/indicators.
// v5: DiscoveryProduct gained totalInventory + productType fields.
//     v4 cached entries lack these; without a bump the rules engine would
//     see undefined for both and the inventory-floor filter would be a no-op.
// v3: category source switched from xdipx.product_type_dial mapping to
//     direct membership in the four top-level Shopify collections
//     (Pleasure / Play / Body / Wear). v2 cached entries reference the
//     old categorization. Bumping invalidates them.
// v2: tag values normalized (Title-Case canonical form) before indexing.
const INDEX_VERSION = 'v6'
const INDEX_KEY = `discovery:index:${INDEX_VERSION}`
const INDEX_TTL_SECONDS = 60 * 60 // 1h

/**
 * Build-lock to avoid thundering-herd on cold-start traffic spikes.
 * If N serverless instances simultaneously miss KV they would otherwise
 * each chain 30+ Admin GraphQL calls and exhaust Shopify's point bucket.
 * The first instance to acquire the lock builds; others see the lock,
 * skip the build, and return [] so the loader renders the empty state.
 */
const BUILD_LOCK_KEY = `discovery:index:building:${INDEX_VERSION}`
const BUILD_LOCK_TTL_SECONDS = 30

/**
 * Vocabulary cache: distinct mood/audience/matters tag values actually
 * present on active products. Derived from the index, cached 24h so the
 * UI picks up new tags Merchandisers add in Shopify within a day without
 * a deploy. Refreshed as a side effect of any index rebuild.
 */
const VOCAB_KEY = `discovery:vocab:${INDEX_VERSION}`
const VOCAB_TTL_SECONDS = 60 * 60 * 24 // 24h

/**
 * Top-level category source of truth: membership in these four Shopify
 * collections. The home page's nav uses these same four buckets, so
 * rail assignment matches what a merchandiser sees in Shopify Admin.
 *
 * If a product is in more than one of these collections, the priority
 * below decides which rail it lands in (Pleasure first, Wear last).
 */
const CATEGORY_COLLECTION_IDS: Record<Category, string> = {
  Pleasure: 'gid://shopify/Collection/330228727979',
  Play:     'gid://shopify/Collection/330228695211',
  Body:     'gid://shopify/Collection/330227581099',
  Wear:     'gid://shopify/Collection/330229514411',
}
/** Tie-breaker order for products that live in multiple top-level collections. */
const CATEGORY_PRIORITY: Category[] = ['Pleasure', 'Play', 'Body', 'Wear']

/**
 * Best-effort subcategory label for the product card caption, derived
 * from `xdipx.product_type_dial`. Falls back to the category name when
 * the dial is unset or doesn't have a mapping. Subcategory is display-
 * only — it does NOT decide which rail a product appears in.
 */
function dialToSubcategory(dial: ProductTypeDial | '' | undefined): string | null {
  switch (dial) {
    case 'vibrator':    return 'Vibrators'
    case 'dildo':       return 'Dildos'
    case 'anal':        return 'Anal'
    case 'cock-ring':
    case 'stroker':
    case 'extender':
    case 'pump':
    case 'sex-machine': return 'For Him'
    case 'bondage':     return 'Bondage & Kink'
    case 'couples':     return 'Couples'
    case 'lube':        return 'Lubricants'
    case 'massage':     return 'Massage'
    case 'enhancer':
    case 'wellness':    return 'Wellness'
    case 'wear':        return 'Lingerie'
    case 'harness':     return 'Accessories'
    default:            return null
  }
}

/**
 * Trim, normalize to canonical Title-Case storage form, and dedupe
 * within a single product's tag list. Merchandisers sometimes tag the
 * same product with `Sensual` AND `sensual`; this collapses them.
 * Display-formatting (hyphen→space, small-word lowercasing) happens
 * downstream in the Chip component via `displayLabel`.
 */
function cleanTagList(arr: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of arr) {
    const v = normalizeTag(raw)
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/* ─── Index builder (Admin GraphQL, paginated) ────────────────────────── */

interface AdminProductNode {
  id:           string
  handle:       string
  title:        string
  status:       string
  productType:  string | null   // Shopify's native "Product organization → Type"
  featuredImage: { url: string; altText: string | null } | null
  priceRangeV2: {
    minVariantPrice: { amount: string }
    maxVariantPrice: { amount: string } | null
  }
  compareAtPriceRange: {
    minVariantCompareAtPrice: { amount: string } | null
  } | null
  options: Array<{ name: string; optionValues: Array<{ name: string }> }>
  totalInventory:   number | null
  originalPriceRaw: { value: string | null } | null
  productTypeDial:  { value: string | null } | null
  moodTagsRaw:      { value: string | null } | null
  audienceTagsRaw:  { value: string | null } | null
  mattersTagsRaw:   { value: string | null } | null
}

/**
 * Derive Color and Size/Length indicator values from a product's own Shopify
 * options. Per-product only (the discovery index is flat — it does NOT run the
 * vault's cross-product master-collapse). Shopify's default single-variant
 * "Title / Default Title" option is ignored because it matches neither axis.
 */
function classifyOptionValues(
  options: Array<{ name: string; optionValues: Array<{ name: string }> }>,
): { colorValues: string[]; sizeValues: string[] } {
  let colorValues: string[] = []
  let sizeValues: string[] = []
  for (const o of options) {
    const name = o.name.toLowerCase()
    const values = o.optionValues.map(v => v.name.trim()).filter(Boolean)
    if (/colou?r/.test(name)) colorValues = values
    else if (/size|length/.test(name)) sizeValues = values
  }
  return { colorValues, sizeValues }
}

/**
 * Derive the card's pricing + variant-indicator fields from an Admin node.
 * `priceMax` is null when it equals (or is below) the min, so the card knows
 * to show a single price rather than a "$min–$max" range. `compareAtPrice` is
 * null unless it sits strictly above the min price (i.e. there's real savings).
 */
function derivePricingAndOptions(n: AdminProductNode, price: number): {
  priceMax: number | null
  compareAtPrice: number | null
  colorValues: string[]
  sizeValues: string[]
} {
  const maxRaw = Number(n.priceRangeV2.maxVariantPrice?.amount)
  const priceMax = Number.isFinite(maxRaw) && maxRaw > price ? maxRaw : null

  // MSRP source mirrors the PLP/VaultCard: prefer the curated
  // `xdipx.original_price` metafield, fall back to Shopify's native
  // compare-at. Only counts as savings when it sits above the live price.
  const originalRaw = Number(n.originalPriceRaw?.value)
  const compareRaw = Number(n.compareAtPriceRange?.minVariantCompareAtPrice?.amount)
  const msrp = Number.isFinite(originalRaw) && originalRaw > 0
    ? originalRaw
    : Number.isFinite(compareRaw) ? compareRaw : NaN
  const compareAtPrice = Number.isFinite(msrp) && msrp > price ? msrp : null

  const { colorValues, sizeValues } = classifyOptionValues(n.options ?? [])
  return { priceMax, compareAtPrice, colorValues, sizeValues }
}

interface AdminProductsPage {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes:    AdminProductNode[]
  }
}

const PRODUCTS_PAGE_QUERY = /* GraphQL */ `
  query DiscoveryIndexPage($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        status
        productType
        featuredImage { url altText }
        priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } }
        compareAtPriceRange { minVariantCompareAtPrice { amount } }
        options(first: 3) { name optionValues { name } }
        totalInventory
        originalPriceRaw: metafield(namespace: "xdipx", key: "original_price")     { value }
        productTypeDial:  metafield(namespace: "xdipx", key: "product_type_dial") { value }
        moodTagsRaw:      metafield(namespace: "xdipx", key: "mood_tags")          { value }
        audienceTagsRaw:  metafield(namespace: "xdipx", key: "audience_tags")      { value }
        mattersTagsRaw:   metafield(namespace: "xdipx", key: "matters_tags")       { value }
      }
    }
  }
`

function parseListMetafield(value: string | null | undefined): string[] {
  if (!value) return []
  // Shopify list.text metafields serialize as JSON arrays.
  if (value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch { return [] }
  }
  // Tolerate legacy single-value or comma-separated payloads.
  return value.split(',').map(s => s.trim()).filter(Boolean)
}

function nodeToDiscoveryProduct(
  n: AdminProductNode,
  categoryMap: Map<string, Category>,
): DiscoveryProduct | null {
  // Source of truth: top-level collection membership. Products that aren't
  // in any of the four nav collections are dropped from the discovery
  // surface entirely (matches the merchandiser's mental model).
  const category = categoryMap.get(n.id)
  if (!category) return null

  const price = Number(n.priceRangeV2.minVariantPrice.amount)
  if (!Number.isFinite(price) || price <= 0) return null

  // Subcategory is display-only (product card caption). Best-effort from
  // the dial; falls back to the category name when the dial is unset.
  const dial = (n.productTypeDial?.value as ProductTypeDial | null) ?? ''
  const subcategory = dialToSubcategory(dial) ?? category

  const mood = cleanTagList(parseListMetafield(n.moodTagsRaw?.value))
  const audience = cleanTagList(parseListMetafield(n.audienceTagsRaw?.value))
  const matters = cleanTagList(parseListMetafield(n.mattersTagsRaw?.value))

  // productType: Shopify's native "Product organization → Type" — the field
  // curators actually edit per product in Shopify admin. Powers exclusion
  // rules ("hide everything with type Discontinued"). Separate from the dial.
  const productType = (n.productType ?? '').trim() || null
  const productTypeDial = dial || null

  const { priceMax, compareAtPrice, colorValues, sizeValues } = derivePricingAndOptions(n, price)

  return {
    id:          n.id,
    handle:      n.handle,
    title:       n.title,
    price,
    priceMax,
    compareAtPrice,
    colorValues,
    sizeValues,
    imageUrl:    n.featuredImage?.url ?? null,
    imageAlt:    n.featuredImage?.altText ?? null,
    category,
    subcategory,
    mood,
    audience,
    matters,
    totalInventory: n.totalInventory ?? null,
    productType,
    productTypeDial,
  }
}

/* ─── Collection-membership lookup ────────────────────────────────────── */

const COLLECTION_PRODUCTS_QUERY = /* GraphQL */ `
  query DiscoveryCollectionProducts($id: ID!, $cursor: String) {
    collection(id: $id) {
      products(first: 250, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id }
      }
    }
  }
`

interface CollectionProductsPage {
  collection: {
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes:    { id: string }[]
    } | null
  } | null
}

async function fetchCollectionProductIds(collectionGid: string): Promise<Set<string>> {
  const ids = new Set<string>()
  let cursor: string | null = null
  while (true) {
    const data: CollectionProductsPage = await adminGraphQL<CollectionProductsPage>(
      COLLECTION_PRODUCTS_QUERY,
      { id: collectionGid, cursor },
    )
    const page = data.collection?.products
    if (!page) break
    for (const n of page.nodes) ids.add(n.id)
    if (!page.pageInfo.hasNextPage) break
    cursor = page.pageInfo.endCursor
    if (!cursor) break
  }
  return ids
}

/* ─── Collection-by-handle lookup (for curator fallback pins) ─────────── */

const COLLECTION_BY_HANDLE_QUERY = /* GraphQL */ `
  query DiscoveryCollectionByHandle($handle: String!) {
    collectionByHandle(handle: $handle) { id }
  }
`

interface CollectionByHandleResponse {
  collectionByHandle: { id: string } | null
}

const COLLECTION_HANDLE_CACHE_TTL = 30 * 60 // 30 min
const collectionHandleKey = (h: string) => `discovery:collection-pin:${INDEX_VERSION}:${h}`

/**
 * Resolve a Shopify collection handle to an ordered array of product IDs in
 * that collection. KV-cached for 30 minutes per handle so a busy admin page
 * isn't hammering the Admin API.
 *
 * Returns an empty array (and caches it) when the handle resolves to no
 * collection — the curator likely typed it wrong, but we don't want the
 * miss to keep round-tripping to Shopify every request.
 */
export async function getProductIdsByCollectionHandle(handle: string): Promise<string[]> {
  const key = handle.trim().toLowerCase()
  if (!key) return []
  const cacheKey = collectionHandleKey(key)
  const cached = await kvGet<string[]>(cacheKey)
  if (cached && Array.isArray(cached)) return cached

  let ids: string[] = []
  try {
    const data: CollectionByHandleResponse = await adminGraphQL<CollectionByHandleResponse>(
      COLLECTION_BY_HANDLE_QUERY,
      { handle: key },
    )
    const gid = data.collectionByHandle?.id
    if (gid) {
      const set = await fetchCollectionProductIds(gid)
      ids = Array.from(set)
    }
  } catch (err) {
    console.error('[discovery] getProductIdsByCollectionHandle error for', key, err)
    return [] // don't cache an error
  }

  await kvSet(cacheKey, ids, COLLECTION_HANDLE_CACHE_TTL)
  return ids
}

/* ─── Honorary-membership fetcher (for collection-pin fallbacks) ────────── */

const NODES_BY_IDS_QUERY = /* GraphQL */ `
  query DiscoveryHonoraryNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
        title
        status
        productType
        featuredImage { url altText }
        priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } }
        compareAtPriceRange { minVariantCompareAtPrice { amount } }
        options(first: 3) { name optionValues { name } }
        totalInventory
        originalPriceRaw: metafield(namespace: "xdipx", key: "original_price")     { value }
        productTypeDial:  metafield(namespace: "xdipx", key: "product_type_dial") { value }
        moodTagsRaw:      metafield(namespace: "xdipx", key: "mood_tags")          { value }
        audienceTagsRaw:  metafield(namespace: "xdipx", key: "audience_tags")      { value }
        mattersTagsRaw:   metafield(namespace: "xdipx", key: "matters_tags")       { value }
      }
    }
  }
`

interface NodesByIdsResponse {
  nodes: Array<AdminProductNode | null>
}

/**
 * Fetch products by Shopify GID for use as collection-pin "honorary members"
 * of a category — pinned products surface in the rail even when they aren't
 * in the corresponding top-level nav collection. The `category` arg is
 * forced onto each returned product so they slot into the right rail.
 *
 * Batches in groups of 100 (the practical Admin GraphQL node-list limit).
 * Returns active products only; inactive ones are dropped silently.
 */
export async function fetchHonoraryProducts(
  ids: string[],
  category: Category,
): Promise<DiscoveryProduct[]> {
  if (ids.length === 0) return []
  const out: DiscoveryProduct[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    let resp: NodesByIdsResponse
    try {
      resp = await adminGraphQL<NodesByIdsResponse>(NODES_BY_IDS_QUERY, { ids: batch })
    } catch (err) {
      console.error('[discovery] fetchHonoraryProducts batch failed:', err)
      continue
    }
    for (const node of resp.nodes) {
      if (!node || node.status !== 'ACTIVE') continue
      const price = Number(node.priceRangeV2.minVariantPrice.amount)
      if (!Number.isFinite(price) || price <= 0) continue
      const dial = (node.productTypeDial?.value as ProductTypeDial | null) ?? ''
      const subcategory = dialToSubcategory(dial) ?? category
      const productType = (node.productType ?? '').trim() || null
      const { priceMax, compareAtPrice, colorValues, sizeValues } = derivePricingAndOptions(node, price)
      out.push({
        id:             node.id,
        handle:         node.handle,
        title:          node.title,
        price,
        priceMax,
        compareAtPrice,
        colorValues,
        sizeValues,
        imageUrl:       node.featuredImage?.url ?? null,
        imageAlt:       node.featuredImage?.altText ?? null,
        category, // honorary — forced to the pinned rail's category
        subcategory,
        mood:           cleanTagList(parseListMetafield(node.moodTagsRaw?.value)),
        audience:       cleanTagList(parseListMetafield(node.audienceTagsRaw?.value)),
        matters:        cleanTagList(parseListMetafield(node.mattersTagsRaw?.value)),
        totalInventory: node.totalInventory ?? null,
        productType,
        productTypeDial: dial || null,
      })
    }
  }
  return out
}

/**
 * Cached wrapper for `fetchHonoraryProducts`. Keyed per (handle, category)
 * with a 30-minute TTL to match the IDs cache. Critical for back-navigation
 * to the home page: without this, every page load hits Shopify Admin to
 * hydrate honorary products from scratch and the loader stalls 1–3s.
 *
 * Curator mutations bust the rules cache (via createDiscoveryRule etc.),
 * which forces the next request to re-resolve pins; the per-handle honorary
 * cache will still serve until its TTL but the *set* of pinned handles is
 * recomputed from fresh rules, so a removed pin stops surfacing immediately.
 */
const HONORARY_CACHE_TTL = 30 * 60 // 30 min
const honoraryCacheKey = (cat: Category, handle: string) =>
  `discovery:honorary:${INDEX_VERSION}:${cat}:${handle}`

export async function getHonoraryProductsForPin(
  handle: string,
  category: Category,
): Promise<DiscoveryProduct[]> {
  const cleaned = handle.trim().toLowerCase()
  if (!cleaned) return []
  const cacheKey = honoraryCacheKey(category, cleaned)
  const cached = await kvGet<DiscoveryProduct[]>(cacheKey)
  if (cached && Array.isArray(cached)) return cached

  const ids = await getProductIdsByCollectionHandle(cleaned)
  if (ids.length === 0) {
    await kvSet(cacheKey, [], HONORARY_CACHE_TTL)
    return []
  }
  const products = await fetchHonoraryProducts(ids, category)
  await kvSet(cacheKey, products, HONORARY_CACHE_TTL)
  return products
}

/**
 * Resolve every product's top-level Category from collection membership.
 * Returns a Map<productId, Category>. Products not in any of the four
 * nav collections are absent from the map (i.e. dropped downstream).
 *
 * Multi-membership: tie-broken by CATEGORY_PRIORITY (Pleasure first).
 */
async function buildCategoryMap(): Promise<Map<string, Category>> {
  const sets = await Promise.all(
    CATEGORY_PRIORITY.map(async cat => ({
      cat,
      ids: await fetchCollectionProductIds(CATEGORY_COLLECTION_IDS[cat]),
    })),
  )
  const map = new Map<string, Category>()
  for (const { cat, ids } of sets) {
    for (const id of ids) {
      // First-write wins → priority order honored
      if (!map.has(id)) map.set(id, cat)
    }
  }
  return map
}

/**
 * Fetches every active product, projects to the discovery shape, and drops
 * anything that isn't in one of the four top-level nav collections. Heavy
 * call — only invoked on cache miss.
 */
export async function buildDiscoveryIndex(): Promise<DiscoveryProduct[]> {
  const categoryMap = await buildCategoryMap()
  const out: DiscoveryProduct[] = []
  let cursor: string | null = null

  while (true) {
    const data: AdminProductsPage = await adminGraphQL<AdminProductsPage>(
      PRODUCTS_PAGE_QUERY,
      { cursor },
    )
    for (const node of data.products.nodes) {
      const dp = nodeToDiscoveryProduct(node, categoryMap)
      if (dp) out.push(dp)
    }
    if (!data.products.pageInfo.hasNextPage) break
    cursor = data.products.pageInfo.endCursor
    if (!cursor) break
  }

  return out
}

/**
 * Cached read. KV miss triggers a full rebuild; concurrent misses each
 * rebuild (acceptable — the call is rare and Shopify rate limits are well
 * above our needs at home-page traffic). Returns `[]` on KV+Shopify failure
 * so the loader can render the empty state instead of crashing.
 */
export async function getDiscoveryIndex(opts: { force?: boolean } = {}): Promise<DiscoveryProduct[]> {
  if (!opts.force) {
    const cached = await kvGet<DiscoveryProduct[]>(INDEX_KEY)
    if (cached && Array.isArray(cached) && cached.length > 0) return cached
  }

  // Best-effort cooperative lock. KV doesn't expose SETNX through the wrapper,
  // so this is a read-then-write race-window — acceptable because losing the
  // race only means one extra full build, not a correctness issue.
  const locked = await kvGet<number>(BUILD_LOCK_KEY)
  if (locked) return []
  await kvSet(BUILD_LOCK_KEY, Date.now(), BUILD_LOCK_TTL_SECONDS)

  try {
    const fresh = await buildDiscoveryIndex()
    if (fresh.length > 0) {
      await kvSet(INDEX_KEY, fresh, INDEX_TTL_SECONDS)
      // Refresh vocab as a side effect — same data, no extra fetch.
      await kvSet(VOCAB_KEY, computeVocab(fresh), VOCAB_TTL_SECONDS)
    }
    return fresh
  } catch {
    return []
  } finally {
    await kvDel(BUILD_LOCK_KEY)
  }
}

/** Manual bust — call from a Shopify product webhook or admin tool. */
export async function invalidateDiscoveryIndex(): Promise<void> {
  await kvSet(INDEX_KEY, null, 1)
  await kvSet(VOCAB_KEY, null, 1)
}

/* ─── Vocabulary (mood / audience / matters chip lists) ────────────────── */

export interface DiscoveryVocab {
  moods:     string[]
  audiences: string[]
  matters:   string[]
}

/**
 * Frequency-sorted distinct values for each chip group. Most-used tag
 * first so the chips a new visitor sees are the ones most likely to
 * land. Stable secondary sort by alpha for tied counts.
 */
function computeVocab(index: DiscoveryProduct[]): DiscoveryVocab {
  const tally = (key: 'mood' | 'audience' | 'matters') => {
    const counts = new Map<string, number>()
    for (const p of index) {
      for (const v of p[key]) counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([v]) => v)
  }
  return {
    moods:     tally('mood'),
    audiences: tally('audience'),
    matters:   tally('matters'),
  }
}

/**
 * Cached read of the chip vocabularies. 24h TTL — a tag a merchandiser
 * adds in Shopify appears as a chip within a day. KV miss falls through
 * to a fresh derivation from the live index (which itself may rebuild
 * from Shopify). Returns empty lists on total failure so the loader can
 * render an empty-chip state instead of crashing.
 */
export async function getDiscoveryVocab(): Promise<DiscoveryVocab> {
  const cached = await kvGet<DiscoveryVocab>(VOCAB_KEY)
  // Treat an empty cached vocab as a miss: a transient cold-start where
  // getDiscoveryIndex() briefly returned [] could otherwise poison the cache
  // with empty arrays for the full 24h TTL, hiding every chip filter even
  // after the index recovers.
  if (cached && Array.isArray(cached.moods) && cached.moods.length > 0) return cached

  const idx = await getDiscoveryIndex()
  if (idx.length === 0) return { moods: [], audiences: [], matters: [] }

  const vocab = computeVocab(idx)
  // Never cache an empty vocab — leave the key unset so the next request
  // rebuilds from a (hopefully populated) index instead of serving emptiness.
  if (vocab.moods.length > 0 || vocab.audiences.length > 0 || vocab.matters.length > 0) {
    await kvSet(VOCAB_KEY, vocab, VOCAB_TTL_SECONDS)
  }
  return vocab
}

/* ─── Public loader-facing API ────────────────────────────────────────── */

export interface GetRailsOptions {
  perRail?:   number
  dropEmpty?: boolean
  /** Inject products instead of pulling from the live index — used by tests. */
  index?:     DiscoveryProduct[]
}

export async function getDiscoveryRails(
  state: DiscoveryState,
  opts: GetRailsOptions = {},
): Promise<{ rails: Rail[]; total: number; available: ChipAvailabilityArrays }> {
  const products = opts.index ?? (await getDiscoveryIndex())
  const perRail = opts.perRail ?? 4

  // Fetch curator rules and inventory threshold in parallel.
  const [rules, inventoryMin] = await Promise.all([
    getActiveDiscoveryRules(),
    getInventoryMin(),
  ])

  // Apply exclusion rules; the ranking functions only see surviving products.
  const filtered = applyRules(products, rules, inventoryMin)

  // Resolve every pin_collection_fallback rule into per-category product IDs.
  // Each unique collection handle is fetched at most once (KV-cached 30 min).
  const collectionPinIds = await resolveCollectionPins(
    rules,
    getProductIdsByCollectionHandle,
  )

  const rankOpts: { perRail?: number; dropEmpty?: boolean } = { perRail }
  if (opts.dropEmpty !== undefined) rankOpts.dropEmpty = opts.dropEmpty

  const rails = rankRails(filtered, state, rankOpts)

  const hasAnySelections =
    state.mood.length > 0 || state.audience.length > 0 || state.matters.length > 0

  // Honorary members: for each pin_collection_fallback rule, hydrate the
  // collection's products with the rule's category forced. The per-(handle,
  // category) fetch is KV-cached 30 min so back-navigation doesn't restart
  // the Shopify roundtrip on every page view. Exclusion rules still apply.
  const indexedIds = new Set(filtered.map(p => p.id))
  const honoraryByCategory: Partial<Record<Category, DiscoveryProduct[]>> = {}
  const collectionPinRules = rules
    .filter(r => r.ruleType === 'pin_collection_fallback' && r.category)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  await Promise.all(
    collectionPinRules.map(async pin => {
      const cat = pin.category as Category
      const products = await getHonoraryProductsForPin(pin.ruleValue, cat)
      // Skip products already in the indexed filtered set — those will be
      // picked up by their indexed copy via collectionPinIds + fillFallbacks.
      const novel = products.filter(p => !indexedIds.has(p.id))
      if (novel.length === 0) return
      const allowed = applyRules(novel, rules, inventoryMin)
      if (allowed.length === 0) return
      const existing = honoraryByCategory[cat] ?? []
      const seen = new Set(existing.map(p => p.id))
      for (const p of allowed) {
        if (!seen.has(p.id)) {
          existing.push(p)
          seen.add(p.id)
        }
      }
      honoraryByCategory[cat] = existing
    }),
  )

  // Post-process rails: fill sparse rails with curator pins, then auto-loosen.
  const includedIds = new Set(
    rails.flatMap(r => r.items.map(sp => sp.product.id)),
  )

  for (const rail of rails) {
    if (rail.items.length < perRail) {
      const filled = fillFallbacks(
        rail,
        rules,
        filtered,
        perRail,
        includedIds,
        collectionPinIds,
        honoraryByCategory,
      )
      for (const sp of filled.items) {
        if (!includedIds.has(sp.product.id)) includedIds.add(sp.product.id)
      }
      rail.items = filled.items
      rail.total = filled.total
    }
  }

  for (const rail of rails) {
    if (rail.items.length === 0 && hasAnySelections) {
      const loosened = autoLoosen(rail.category, state, filtered, perRail)
      if (loosened) {
        rail.items = loosened.items
        rail.total = loosened.items.length
        rail.relaxed = true
        rail.relaxedReason = loosened.reason
      }
    }
  }

  // Compute chip availability against the filtered catalog (not the raw index)
  // so the chip-availability hint reflects active exclusion rules.
  const available = availableToArrays(computeAvailable(filtered, state))
  return { rails, total: filtered.length, available }
}

/**
 * Single-rail paginator. Used by "View more" — returns the next slice for
 * one category without recomputing the other rails.
 *
 * Applies exclusion rules but does NOT run fallback or loosening.
 * Pagination is a continuation of the same brief; if a category has fewer
 * than `limit` matching products on page 2, the caller hides the button.
 */
export async function getDiscoveryRailPage(
  state: DiscoveryState,
  category: Category,
  offset: number,
  limit: number,
  opts: { index?: DiscoveryProduct[] } = {},
): Promise<{ items: ScoredProduct[]; total: number }> {
  const products = opts.index ?? (await getDiscoveryIndex())
  const [rules, inventoryMin] = await Promise.all([
    getActiveDiscoveryRules(),
    getInventoryMin(),
  ])
  const filtered = applyRules(products, rules, inventoryMin)
  return rankSingleRail(filtered, state, category, offset, limit)
}

/* ─── Tag coverage report ─────────────────────────────────────────────── */

export interface CoverageReport {
  total:               number
  withMood:            number
  withAudience:        number
  withMatters:         number
  withAllThree:        number
  withCategoryMapping: number
  byCategory:          Record<Category, number>
}

/**
 * Diagnostic — how many SKUs in the live catalog have the metafields the
 * discovery surface needs. Print before launch to know whether rails will
 * look populated or skeletal.
 */
export async function reportTagCoverage(): Promise<CoverageReport> {
  const idx = await getDiscoveryIndex({ force: true })
  const report: CoverageReport = {
    total:               idx.length,
    withMood:            0,
    withAudience:        0,
    withMatters:         0,
    withAllThree:        0,
    withCategoryMapping: idx.length, // index already requires a category mapping
    byCategory:          { Pleasure: 0, Play: 0, Body: 0, Wear: 0 },
  }
  for (const p of idx) {
    if (p.mood.length     > 0) report.withMood     += 1
    if (p.audience.length > 0) report.withAudience += 1
    if (p.matters.length  > 0) report.withMatters  += 1
    if (p.mood.length > 0 && p.audience.length > 0 && p.matters.length > 0) {
      report.withAllThree += 1
    }
    report.byCategory[p.category] += 1
  }
  return report
}
