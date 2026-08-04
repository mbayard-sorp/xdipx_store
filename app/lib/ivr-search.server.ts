/**
 * IVR-optimized product search via Sanity GROQ with Shopify price hydration.
 *
 * Returns compact cards (~80-100 tokens each) tuned for voice: title, tagline,
 * category, MAP-cleared price, and variant GIDs. Falls back to Shopify
 * Storefront search if Sanity is unavailable.
 */
import { createClient } from '@sanity/client'
import { buildQueryPatterns, fieldMatchAny } from './search.server'
import { normalizeTag } from './tag-normalize'
import { applyMapRule, type DisplayPrice } from './ai-agent/tools.server'
import { getProductsByHandles, searchProducts as shopifySearch } from './shopify.server'
import { normalizeForTTS } from './tts-normalize'
import { cached } from './kv.server'
import type { Product } from '~/types'

// ─── Sanity client (read-only, CDN) ──────────────────────────────────────────

const projectId = process.env['SANITY_PROJECT_ID']
const dataset = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

function getSanityClient() {
  if (!projectId) return null
  const token = process.env['SANITY_API_TOKEN']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient({ projectId, dataset, apiVersion, useCdn: true, token } as any)
}

// ─── Cached GROQ fetch ───────────────────────────────────────────────────────
// Voice and SMS turns hit this module on every search hop, and on a phone
// call every extra round-trip is audible dead air. Candidate pools change on
// catalog publish cadence (minutes-to-hours), not per turn, so a short TTL is
// safe: price/stock freshness comes from the Shopify hydration layer, which
// has its own cache. Randomized ranking runs on top of the cached pool, so
// consecutive calls still vary their pitches.
const GROQ_CACHE_TTL_SECONDS = 180
// Empty pools expire fast: a transient Sanity blip or a query that raced an
// enrichment window must not pin "we don't carry that" for 3-4 minutes.
const GROQ_EMPTY_TTL_SECONDS = 30

function hashKey(s: string): string {
  // djb2 — tiny, stable, good enough for cache-key dedup (not security).
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

async function cachedGroqFetch<T>(
  client: NonNullable<ReturnType<typeof getSanityClient>>,
  groq: string,
  params: Record<string, unknown>,
): Promise<T> {
  const key = `ivr:groq:v1:${hashKey(`${groq}|${JSON.stringify(params)}`)}`
  return cached(key, GROQ_CACHE_TTL_SECONDS, () => client.fetch<T>(groq, params) as Promise<T>, GROQ_EMPTY_TTL_SECONDS)
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IvrProductCard {
  title: string
  handle: string
  category: string
  tagline: string
  inStock: boolean
  price: number
  pctOff: number
  phrasing: DisplayPrice['phrasing']
  variantId: string
  variantOptions?: { variantId: string; label: string; price: number; inStock: boolean }[]
  // Per-unit dollar margin (price minus wholesale cost). Used internally for
  // ranking; not surfaced to the model.
  margin?: number
}

export interface IvrSearchOpts {
  query: string
  limit?: number | undefined
  category?: string | undefined
  priceMax?: number | undefined
  tags?: string[] | undefined
  /**
   * Preference tags matched against the enriched `mattersTags` field (slugified
   * via normalizeTag before querying). Distinct from `tags`, which matches the
   * raw Nalpac editorial categories.
   */
  mattersTags?: string[] | undefined
  /** Filter to a specific productTypeDial value (e.g. 'vibrator', 'wear', 'anal'). */
  productTypeDial?: string | undefined
  /** Filter to a specific productSubtypeDial value. Only applied when productTypeDial is also set. */
  productSubtypeDial?: string | undefined
}

export interface IvrDiscoverOpts {
  mood?: string[] | undefined
  experience?: string | undefined
  useCase?: string[] | undefined
  features?: string[] | undefined
  category?: string | undefined
  priceMax?: number | undefined
  limit?: number | undefined
  /** Filter to a specific productTypeDial value (e.g. 'vibrator', 'wear', 'plug'). */
  productTypeDial?: string | undefined
  /** Filter to a specific productSubtypeDial value. Only applied when productTypeDial is also set. */
  productSubtypeDial?: string | undefined
}

// ─── Diagnostics return type ──────────────────────────────────────────────────

export interface SearchDiagnostics {
  cards: IvrProductCard[]
  /**
   * - 'matched'           — at least one card was found.
   * - 'filtered-to-zero'  — base results existed but filters (productTypeDial /
   *                         productSubtypeDial / category / priceMax / tags) reduced
   *                         the set to zero. Caller should consider dropping a filter.
   * - 'no-base-results'   — the keyword/discovery query itself returned nothing.
   *                         No filters to blame.
   * - 'sanity-unavailable'— Sanity client could not be reached (env vars missing or
   *                         network error). Shopify fallback may have been used.
   */
  reason: 'matched' | 'filtered-to-zero' | 'no-base-results' | 'sanity-unavailable'
}

// ─── Shopify product → compact IVR card ──────────────────────────────────────

function toIvrCard(
  p: Product,
  sanityFields?: { tagline?: string | undefined; category?: string | undefined },
): IvrProductCard {
  const variantPrice = p.variants[0]?.price
  const price = variantPrice ? Number(variantPrice) : (p.price ?? 0)
  const mapPrice = (p as Product & { mapPrice?: number }).mapPrice ?? 0
  const msrp = p.compareAtPrice ?? price
  const disp = applyMapRule(price, msrp, mapPrice)

  const inStockVariants = p.variants.filter((v) => v.availableForSale)
  const defaultVariant = inStockVariants[0] ?? p.variants[0]
  const variantOptions =
    p.variants.length > 1
      ? p.variants.slice(0, 5).map((v) => ({
          variantId: v.id,
          label: v.title,
          price: Number(v.price),
          inStock: v.availableForSale,
        }))
      : undefined

  // Per-unit dollar margin. Falls back to 0 when wholesale cost isn't set on
  // the product — those will rank below products with known margin.
  const wholesale = (p as Product & { wholesaleCost?: number }).wholesaleCost ?? 0
  const margin = wholesale > 0 ? Math.max(0, disp.price - wholesale) : 0

  // Belt-and-suspenders: normalize on read as well so Sanity docs authored
  // before the write-side fix still sound clean when Claude speaks them.
  return {
    title: normalizeForTTS(p.title),
    handle: p.handle,
    category: sanityFields?.category ?? p.category ?? '',
    tagline: normalizeForTTS(sanityFields?.tagline ?? p.metaDescription ?? ''),
    inStock: inStockVariants.length > 0,
    price: disp.price,
    pctOff: disp.pctOffMsrp,
    phrasing: disp.phrasing,
    variantId: defaultVariant?.id ?? '',
    margin,
    ...(variantOptions ? { variantOptions } : {}),
  }
}

// ─── Keyword search (replaces searchProducts backend) ────────────────────────

// Queries that name a concrete product type — if we match on description
// text alone we return garbage (a massager whose description says "pair with
// lube" gets surfaced for a "lube" search). Restrict these to strict fields
// so the result is actually that kind of product.
const STRICT_CATEGORY_TERMS = new Set([
  'lube', 'lubes', 'lubricant', 'lubricants',
  'vibrator', 'vibrators', 'vibe', 'vibes',
  'dildo', 'dildos',
  'wand', 'wands',
  'rabbit', 'rabbits',
  'plug', 'plugs',
  'ring', 'rings',
  'cleaner', 'cleaners',
  // wear / lingerie
  'outfit', 'outfits', 'lingerie', 'teddy', 'bodysuit', 'bodystocking', 'stockings', 'pasties',
  // bondage / restraint
  'harness', 'harnesses', 'blindfold', 'restraints', 'paddle', 'flogger', 'gag', 'cuffs', 'bondage',
  // anal / prostate
  'anal beads', 'prostate',
  // stroker / masturbator
  'masturbator', 'stroker', 'sleeve',
  // safer-sex
  'condom', 'condoms',
])

/**
 * searchForIvrWithDiagnostics — full result with reason code.
 * Use when the caller needs to distinguish "filtered-to-zero" from
 * "no candidates in Sanity at all" in order to decide whether to retry
 * with a looser filter.
 */
export async function searchForIvrWithDiagnostics(opts: IvrSearchOpts): Promise<SearchDiagnostics> {
  const { query, limit = 3, category, priceMax, tags, mattersTags, productTypeDial, productSubtypeDial } = opts
  const client = getSanityClient()

  if (!client) {
    const cards = shuffle(await shopifyFallback(query, Math.max(limit * 2, 8))).slice(0, limit)
    return { cards, reason: 'sanity-unavailable' }
  }

  // Fetch a wider candidate pool so we can shuffle within similar relevance
  // and avoid pitching the same product on every call. Top-N matches usually
  // have similar scores; shuffling them gives variety without sacrificing
  // quality. The first few results (relevance > everything else) stay near
  // the top thanks to the score ordering before we fetch.
  const candidatePool = Math.max(limit * 3, 12)

  const strictCategory = STRICT_CATEGORY_TERMS.has(query.trim().toLowerCase())

  // Track whether any extra filters beyond the base keyword are active so we
  // can distinguish "filtered-to-zero" from "no-base-results" below.
  const hasExtraFilters = Boolean(
    category || priceMax != null || (tags && tags.length > 0) || (mattersTags && mattersTags.length > 0) || productTypeDial,
  )

  try {
    const patterns = buildQueryPatterns(query)
    if (patterns.length === 0) return { cards: [], reason: 'no-base-results' }

    const paramNames = patterns.map((_, i) => `q${i}`)
    const groqParams: Record<string, unknown> = {}
    patterns.forEach((p, i) => { groqParams[`q${i}`] = p })

    // ── Base conditions (keyword match) ──────────────────────────────────────
    const baseConditions: string[] = [
      '_type == "productPage"',
      'archived != true',
      'hiddenUntilLive != true',
    ]

    const titleMatch = fieldMatchAny('title', paramNames)
    const taglineMatch = fieldMatchAny('tagline', paramNames)
    const vendorMatch = fieldMatchAny('vendor', paramNames)
    const categoryMatch = fieldMatchAny('category', paramNames)
    const descMatch = fieldMatchAny('pt::text(description)', paramNames)
    const seoMatch = fieldMatchAny('seoDescription', paramNames)
    baseConditions.push(
      strictCategory
        ? `(${titleMatch} || ${taglineMatch} || ${vendorMatch} || ${categoryMatch})`
        : `(${titleMatch} || ${taglineMatch} || ${vendorMatch} || ${categoryMatch} || ${descMatch} || ${seoMatch})`,
    )

    // ── Extra filter conditions ───────────────────────────────────────────────
    const filterConditions: string[] = []

    if (category) {
      filterConditions.push('$cat in category')
      groqParams.cat = category
    }
    if (priceMax != null) {
      filterConditions.push('price <= $priceMax')
      groqParams.priceMax = priceMax
    }
    if (tags && tags.length > 0) {
      for (let i = 0; i < tags.length; i++) {
        filterConditions.push(`$tag${i} in tags`)
        groqParams[`tag${i}`] = tags[i]
      }
    }
    if (mattersTags && mattersTags.length > 0) {
      // OR across preference tags: a product matching any stated preference
      // stays in the pool. AND-ing here starves results — un-enriched products
      // have empty mattersTags and preferences are soft signals, not hard specs.
      const slugged = mattersTags.map((t) => normalizeTag(t)).filter(Boolean)
      if (slugged.length > 0) {
        const orClauses = slugged.map((_, i) => `$mt${i} in mattersTags`)
        filterConditions.push(`(${orClauses.join(' || ')})`)
        slugged.forEach((t, i) => { groqParams[`mt${i}`] = t })
      }
    }
    if (productTypeDial) {
      filterConditions.push('productTypeDial == $typeDial')
      groqParams.typeDial = productTypeDial
      if (productSubtypeDial) {
        filterConditions.push('productSubtypeDial == $subtypeDial')
        groqParams.subtypeDial = productSubtypeDial
      }
    }

    const allConditions = [...baseConditions, ...filterConditions]
    const filter = allConditions.join(' && ')
    const boosts = [
      ...paramNames.map((n) => `boost(title match $${n}, 5)`),
      ...paramNames.map((n) => `boost(tagline match $${n}, 3)`),
      ...paramNames.map((n) => `boost(vendor match $${n}, 2)`),
      ...paramNames.map((n) => `boost(category match $${n}, 1)`),
      ...paramNames.map((n) => `boost(pt::text(description) match $${n}, 1)`),
    ].join(', ')

    const groq = `*[${filter}] | score(${boosts}) [0...${candidatePool}] {
      "handle": shopifyHandle,
      title,
      category,
      tagline
    }`

    const sanityResults = await cachedGroqFetch<
      { handle: string; title: string; category: string | null; tagline: string | null }[]
    >(client, groq, groqParams)

    if (!sanityResults || sanityResults.length === 0) {
      if (strictCategory) {
        // Determine whether the base query (without extra filters) would have
        // found anything — if yes, it's filtered-to-zero; otherwise no-base-results.
        if (hasExtraFilters) {
          // Re-query with only base conditions to check if unfiltered results exist
          const baseFilter = baseConditions.join(' && ')
          const baseGroq = `*[${baseFilter}] [0...1] { "handle": shopifyHandle }`
          const baseCheck = await cachedGroqFetch<{ handle: string }[]>(client, baseGroq, groqParams)
          const reason = baseCheck.length > 0 ? 'filtered-to-zero' : 'no-base-results'
          return { cards: [], reason }
        }
        return { cards: [], reason: 'no-base-results' }
      }
      // Non-strict path: try Shopify fallback. If we had extra filters and
      // Shopify is also empty, classify as filtered-to-zero when filters were active.
      const fallback = await shopifyFallback(query, Math.max(limit * 2, 8))
      if (fallback.length === 0 && hasExtraFilters) {
        return { cards: [], reason: 'filtered-to-zero' }
      }
      if (fallback.length === 0) {
        return { cards: [], reason: 'no-base-results' }
      }
      const cards = marginWeightedSelect(fallback, limit)
      return { cards, reason: cards.length > 0 ? 'matched' : 'no-base-results' }
    }

    const handles = sanityResults.map((r) => r.handle).filter(Boolean)
    const shopifyProducts = await getProductsByHandles(handles)
    const shopifyMap = new Map<string, Product>(shopifyProducts.map((p) => [p.handle, p]))

    const cards: IvrProductCard[] = []
    for (const sr of sanityResults) {
      const product = shopifyMap.get(sr.handle)
      if (!product) continue
      cards.push(toIvrCard(product, { tagline: sr.tagline ?? undefined, category: sr.category ?? undefined }))
    }

    // Rank by margin × inventory, with enough randomness to keep variety.
    // Sanity has already filtered for context relevance (the candidate pool
    // is "products that match this query"); within that pool, prefer items
    // that make us money AND are sellable.
    const ranked = marginWeightedSelect(cards, limit)
    return { cards: ranked, reason: ranked.length > 0 ? 'matched' : 'filtered-to-zero' }
  } catch (err) {
    console.error('[ivr-search] Sanity search failed, falling back to Shopify:', err)
    const cards = marginWeightedSelect(await shopifyFallback(query, Math.max(limit * 2, 8)), limit)
    return { cards, reason: 'sanity-unavailable' }
  }
}

/**
 * searchForIvr — backward-compatible wrapper. Returns only the cards array.
 * Existing callers continue to work unchanged.
 */
export async function searchForIvr(opts: IvrSearchOpts): Promise<IvrProductCard[]> {
  const { cards } = await searchForIvrWithDiagnostics(opts)
  return cards
}

/**
 * In-place Fisher-Yates shuffle. Not cryptographically random — Math.random
 * is plenty for picking which lube/vibrator to surface first.
 */
function shuffle<T>(items: T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/**
 * Pick `limit` cards from a relevance-filtered pool, biased toward in-stock
 * and high-margin items, with enough randomness for variety.
 *
 *   1. Split into in-stock and out-of-stock (in-stock always preferred).
 *   2. Within each pool, weight selection by margin: a $40-margin product is
 *      twice as likely as a $20-margin product to land at position 0. This
 *      gives high-margin items a real edge without making the lineup boring.
 *   3. Products with no margin data (wholesale cost not set) get a small
 *      baseline weight so they aren't completely starved out — but they
 *      surface less often than known-margin products.
 *
 * The weighted-random draw means consecutive calls with the same query
 * surface different products, so the model doesn't pitch the same vibrator
 * every conversation.
 */
function marginWeightedSelect(cards: IvrProductCard[], limit: number): IvrProductCard[] {
  if (cards.length <= limit) return shuffle(cards)
  const inStock = cards.filter((c) => c.inStock)
  const outOfStock = cards.filter((c) => !c.inStock)
  // If we have enough in-stock candidates, only use those. Otherwise top off
  // with out-of-stock so we don't return fewer than `limit` cards.
  const primaryPool = inStock.length >= limit ? inStock : [...inStock, ...outOfStock]
  const picked: IvrProductCard[] = []
  const remaining = primaryPool.slice()
  while (picked.length < limit && remaining.length > 0) {
    const i = pickWeightedIndex(remaining)
    picked.push(remaining[i]!)
    remaining.splice(i, 1)
  }
  return picked
}

/**
 * Weighted-random index pick. Weight = max(margin, $1). The floor ensures
 * zero-margin products (wholesale not set, or priced below cost) still have
 * a small chance to appear instead of being permanently invisible.
 */
function pickWeightedIndex(cards: IvrProductCard[]): number {
  if (cards.length === 1) return 0
  const weights = cards.map((c) => Math.max(c.margin ?? 0, 1))
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = Math.random() * total
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!
    if (roll <= 0) return i
  }
  return weights.length - 1
}

// ─── Discovery search (structured filters, no free-text) ─────────────────────

/**
 * discoverForIvrWithDiagnostics — structured-filter discovery with reason code.
 */
export async function discoverForIvrWithDiagnostics(opts: IvrDiscoverOpts): Promise<SearchDiagnostics> {
  const { mood, experience, useCase, features, category, priceMax, limit = 3, productTypeDial, productSubtypeDial } = opts
  const client = getSanityClient()

  if (!client) return { cards: [], reason: 'sanity-unavailable' }

  // Track whether any non-mood/experience/useCase/feature filters are active so
  // we can distinguish "filtered-to-zero" from "no-base-results".
  const hasPrimaryFilters = Boolean(mood?.length || experience || useCase?.length || features?.length)
  const hasNarrowingFilters = Boolean(category || priceMax != null || productTypeDial)

  try {
    const conditions: string[] = [
      '_type == "productPage"',
      'archived != true',
      'hiddenUntilLive != true',
    ]
    const groqParams: Record<string, unknown> = {}
    const boostClauses: string[] = []

    if (mood && mood.length > 0) {
      const moodOr = mood.map((_, i) => `$mood${i} in moodTags`).join(' || ')
      conditions.push(`(${moodOr})`)
      mood.forEach((m, i) => {
        groqParams[`mood${i}`] = m
        boostClauses.push(`boost($mood${i} in moodTags, 3)`)
      })
    }

    if (experience) {
      // Phase 2 — ivrExperience is now string[]. Empty array means "no
      // level constraint" so it matches every filter automatically.
      conditions.push('(count(ivrExperience) == 0 || $exp in ivrExperience)')
      groqParams.exp = experience
      boostClauses.push('boost($exp in ivrExperience, 4)')
    }

    if (useCase && useCase.length > 0) {
      const ucOr = useCase.map((_, i) => `$uc${i} in ivrUseCase`).join(' || ')
      conditions.push(`(${ucOr})`)
      useCase.forEach((u, i) => {
        groqParams[`uc${i}`] = u
        boostClauses.push(`boost($uc${i} in ivrUseCase, 3)`)
      })
    }

    if (features && features.length > 0) {
      const featOr = features.map((_, i) => `$feat${i} in ivrFeatures`).join(' || ')
      conditions.push(`(${featOr})`)
      features.forEach((f, i) => {
        groqParams[`feat${i}`] = f
        boostClauses.push(`boost($feat${i} in ivrFeatures, 2)`)
      })
    }

    if (category) {
      conditions.push('$cat in category')
      groqParams.cat = category
    }

    if (priceMax != null) {
      conditions.push('price <= $priceMax')
      groqParams.priceMax = priceMax
    }

    if (productTypeDial) {
      conditions.push('productTypeDial == $typeDial')
      groqParams.typeDial = productTypeDial
      if (productSubtypeDial) {
        conditions.push('productSubtypeDial == $subtypeDial')
        groqParams.subtypeDial = productSubtypeDial
      }
    }

    const filter = conditions.join(' && ')
    const scoreClause = boostClauses.length > 0
      ? `| score(${boostClauses.join(', ')})`
      : ''

    const groq = `*[${filter}] ${scoreClause} [0...${limit}] {
      "handle": shopifyHandle,
      title,
      category,
      tagline
    }`

    const sanityResults = await cachedGroqFetch<
      { handle: string; title: string; category: string | null; tagline: string | null }[]
    >(client, groq, groqParams)

    if (!sanityResults || sanityResults.length === 0) {
      // Determine whether this is "filtered-to-zero" or truly "no base results".
      // Only worth checking when we have both primary filters (mood/exp/useCase/features)
      // AND narrowing filters (category/price/typeDial).
      if (hasPrimaryFilters && hasNarrowingFilters) {
        const baseConditions = conditions.filter(
          (c) =>
            !c.includes('$cat') &&
            !c.includes('price <=') &&
            !c.includes('productTypeDial') &&
            !c.includes('productSubtypeDial'),
        )
        const baseFilter = baseConditions.join(' && ')
        const baseGroq = `*[${baseFilter}] [0...1] { "handle": shopifyHandle }`
        const baseCheck = await cachedGroqFetch<{ handle: string }[]>(client, baseGroq, groqParams)
        const reason = baseCheck.length > 0 ? 'filtered-to-zero' : 'no-base-results'
        return { cards: [], reason }
      }
      const reason = hasPrimaryFilters || hasNarrowingFilters ? 'no-base-results' : 'no-base-results'
      return { cards: [], reason }
    }

    const handles = sanityResults.map((r) => r.handle).filter(Boolean)
    const shopifyProducts = await getProductsByHandles(handles)
    const shopifyMap = new Map<string, Product>(shopifyProducts.map((p) => [p.handle, p]))

    const cards: IvrProductCard[] = []
    for (const sr of sanityResults) {
      const product = shopifyMap.get(sr.handle)
      if (!product) continue
      cards.push(toIvrCard(product, { tagline: sr.tagline ?? undefined, category: sr.category ?? undefined }))
    }

    return { cards, reason: cards.length > 0 ? 'matched' : 'filtered-to-zero' }
  } catch (err) {
    console.error('[ivr-search] Sanity discover failed:', err)
    return { cards: [], reason: 'sanity-unavailable' }
  }
}

/**
 * discoverForIvr — backward-compatible wrapper. Returns only the cards array.
 * Existing callers continue to work unchanged.
 */
export async function discoverForIvr(opts: IvrDiscoverOpts): Promise<IvrProductCard[]> {
  const { cards } = await discoverForIvrWithDiagnostics(opts)
  return cards
}

// ─── Direct handle lookup (for recommendations) ─────────────────────────────

export async function getIvrCardsByHandles(handles: string[]): Promise<IvrProductCard[]> {
  if (handles.length === 0) return []
  const products = await getProductsByHandles(handles)
  return products.map((p) => toIvrCard(p))
}

// ─── Shopify fallback ────────────────────────────────────────────────────────

async function shopifyFallback(query: string, limit: number): Promise<IvrProductCard[]> {
  try {
    const { products } = await shopifySearch({ query, first: limit })
    const resolved = await getProductsByHandles(products.map((p) => p.handle))
    return resolved.map((p) => toIvrCard(p))
  } catch (err) {
    console.error('[ivr-search] Shopify fallback failed:', err)
    return []
  }
}
