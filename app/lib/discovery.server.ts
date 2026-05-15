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
import { rankRails } from '~/lib/discovery-emma'
import { normalizeTag } from '~/lib/discovery-tags'

/**
 * Bump when the index shape changes so old cached entries are ignored.
 * KV writes and reads are namespaced by version; old entries expire on TTL.
 */
// v2: tag values are now normalized (Title-Case canonical form) before
// hitting the index, so an old v1 cache with raw mixed-case duplicates
// would render twice. Bumping invalidates any in-flight stale entry.
const INDEX_VERSION = 'v2'
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
 * Map `xdipx.product_type_dial` to the home page's top-level Category +
 * subcategory label. Returns null when the type doesn't fit the discovery
 * surface (e.g. condom, novelty, book-media); those products are skipped.
 *
 * Subcategory labels match the prototype's nav copy exactly.
 */
function mapTypeToCategory(
  dial: ProductTypeDial | '' | undefined,
): { category: Category; subcategory: string } | null {
  switch (dial) {
    case 'vibrator':    return { category: 'Pleasure', subcategory: 'Vibrators' }
    case 'dildo':       return { category: 'Pleasure', subcategory: 'Dildos' }
    case 'anal':        return { category: 'Pleasure', subcategory: 'Anal' }
    case 'cock-ring':
    case 'stroker':
    case 'extender':
    case 'pump':
    case 'sex-machine': return { category: 'Pleasure', subcategory: 'For Him' }
    case 'bondage':     return { category: 'Play',     subcategory: 'Bondage & Kink' }
    case 'couples':     return { category: 'Play',     subcategory: 'Couples' }
    case 'lube':        return { category: 'Body',     subcategory: 'Lubricants' }
    case 'massage':     return { category: 'Body',     subcategory: 'Massage' }
    case 'enhancer':
    case 'wellness':    return { category: 'Body',     subcategory: 'Wellness' }
    case 'wear':        return { category: 'Wear',     subcategory: 'Lingerie' }
    case 'harness':     return { category: 'Wear',     subcategory: 'Accessories' }
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
  featuredImage: { url: string; altText: string | null } | null
  priceRangeV2: { minVariantPrice: { amount: string } }
  productTypeDial:  { value: string | null } | null
  moodTagsRaw:      { value: string | null } | null
  audienceTagsRaw:  { value: string | null } | null
  mattersTagsRaw:   { value: string | null } | null
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
        featuredImage { url altText }
        priceRangeV2 { minVariantPrice { amount } }
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

function nodeToDiscoveryProduct(n: AdminProductNode): DiscoveryProduct | null {
  const dial = (n.productTypeDial?.value as ProductTypeDial | null) ?? ''
  const mapped = mapTypeToCategory(dial)
  if (!mapped) return null

  const price = Number(n.priceRangeV2.minVariantPrice.amount)
  if (!Number.isFinite(price) || price <= 0) return null

  const mood = cleanTagList(parseListMetafield(n.moodTagsRaw?.value))
  const audience = cleanTagList(parseListMetafield(n.audienceTagsRaw?.value))
  const matters = cleanTagList(parseListMetafield(n.mattersTagsRaw?.value))

  return {
    id:          n.id,
    handle:      n.handle,
    title:       n.title,
    price,
    imageUrl:    n.featuredImage?.url ?? null,
    imageAlt:    n.featuredImage?.altText ?? null,
    category:    mapped.category,
    subcategory: mapped.subcategory,
    mood,
    audience,
    matters,
  }
}

/**
 * Fetches every active product, projects to the discovery shape, and drops
 * anything we can't categorize. Heavy call — only invoked on cache miss.
 */
export async function buildDiscoveryIndex(): Promise<DiscoveryProduct[]> {
  const out: DiscoveryProduct[] = []
  let cursor: string | null = null

  while (true) {
    const data: AdminProductsPage = await adminGraphQL<AdminProductsPage>(
      PRODUCTS_PAGE_QUERY,
      { cursor },
    )
    for (const node of data.products.nodes) {
      const dp = nodeToDiscoveryProduct(node)
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
  if (cached && Array.isArray(cached.moods)) return cached

  const idx = await getDiscoveryIndex()
  if (idx.length === 0) return { moods: [], audiences: [], matters: [] }

  const vocab = computeVocab(idx)
  await kvSet(VOCAB_KEY, vocab, VOCAB_TTL_SECONDS)
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
): Promise<{ rails: Rail[]; total: number }> {
  const products = opts.index ?? (await getDiscoveryIndex())
  const rankOpts: { perRail?: number; dropEmpty?: boolean } = {}
  if (opts.perRail   !== undefined) rankOpts.perRail   = opts.perRail
  if (opts.dropEmpty !== undefined) rankOpts.dropEmpty = opts.dropEmpty
  const rails = rankRails(products, state, rankOpts)
  return { rails, total: products.length }
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
