/**
 * Unified search module — queries Sanity for products, pages, and blog posts.
 * Falls back to Shopify Storefront search when Sanity is not configured.
 *
 * Products returned from Sanity are hydrated with real-time pricing from
 * Shopify Storefront API via getProductsByHandles().
 */
import { createClient } from '@sanity/client'
import { getProductsByHandles, searchProducts, predictiveSearch as shopifyPredictiveSearch } from './shopify.server'
import type { Product } from '~/types'
import { normalizeTag } from './tag-normalize'

// ─── Sanity client (read-only, CDN) ────────────────────────────────────────

const projectId  = process.env['SANITY_PROJECT_ID']
const dataset    = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

function getSearchClient() {
  if (!projectId) return null
  const token = process.env['SANITY_API_TOKEN']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient({ projectId, dataset, apiVersion, useCdn: true, token } as any)
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SearchProductResult {
  handle: string
  title: string
  vendor: string | null
  tags: string[]
  category: string | null
  previewImageUrl: string | null
  // Hydrated from Shopify
  price: string | null
  compareAtPrice: string | null
  featuredImage: { url: string; altText: string | null } | null
  shopifyId: string | null
  // Variant + video info for PLP tile interactions
  defaultVariantId: string | null
  hasMultipleVariants: boolean
  availableForSale: boolean
  firstVideo: {
    previewUrl: string
    src: string
    aspect: 'portrait' | 'landscape' | 'square' | null
  } | null
  // Ask-Emma taxonomy — projected from Shopify metafields during hydration.
  moodTags?: string[]
  audienceTags?: string[]
  mattersTags?: string[]
}

export interface SearchFacets {
  tagCounts: Record<string, number>
  // Counts for admin-curated compound tags (CSV of parts, OR-matched). Counted
  // once per product across all parts, so a product tagged with multiple parts
  // doesn't double-count.
  compoundTagCounts: Record<string, number>
  vendorCounts: Record<string, number>
  priceBuckets: { under25: number; p25_50: number; p50_100: number; over100: number }
  featureCounts: Record<string, number>
  experienceCounts: Record<string, number>
}

export interface ContentResult {
  _type: 'page' | 'blogPost'
  title: string
  slug: string
  excerpt: string | null
  seoDescription: string | null
  categoryName?: string | null
}

export interface UnifiedSearchResult {
  products: SearchProductResult[]
  pages: ContentResult[]
  blogPosts: ContentResult[]
  totalProducts: number
  hasNextPage: boolean
  facets: SearchFacets
}

export interface PredictiveProduct {
  handle: string
  title: string
  previewImageUrl: string | null
  vendor: string | null
  price: string | null
  compareAtPrice: string | null
  category: string | null
}

export interface PredictiveResult {
  products: PredictiveProduct[]
  pages: { title: string; slug: string }[]
  blogPosts: { title: string; slug: string }[]
  totalProducts: number
  categories: { label: string; count: number }[]
}

// ─── Query helpers ──────────────────────────────────────────────────────────

// Narrow synonym map for category words where prefix matching isn't enough
// (e.g. "lube*" won't match "lubricant"). Keep this short — broad stemming
// belongs in a real search index, not here.
const QUERY_SYNONYMS: Record<string, string[]> = {
  lube: ['lubricant', 'lubricants'],
  lubes: ['lubricant', 'lubricants'],
  lubricant: ['lube'],
  lubricants: ['lube'],
  vibrator: ['vibe', 'vibes'],
  vibrators: ['vibe', 'vibes'],
  vibe: ['vibrator', 'vibrators'],
  vibes: ['vibrator', 'vibrators'],
}

// GROQ `match` does word-prefix matching, not stemming. Typing "dildos" won't
// match products titled "Dildo". Build a small set of prefix patterns that
// covers trailing -s / -es / -ies pluralization in either direction.
export function buildQueryPatterns(query: string): string[] {
  const lower = query.trim().toLowerCase()
  if (!lower) return []
  const patterns = new Set<string>([`${lower}*`])

  // Singular forms of a plural input
  if (lower.length > 4 && lower.endsWith('ies')) patterns.add(`${lower.slice(0, -3)}y*`)
  if (lower.length > 3 && lower.endsWith('es')) patterns.add(`${lower.slice(0, -2)}*`)
  if (lower.length > 3 && lower.endsWith('s'))  patterns.add(`${lower.slice(0, -1)}*`)

  const synonyms = QUERY_SYNONYMS[lower]
  if (synonyms) for (const s of synonyms) patterns.add(`${s}*`)

  return Array.from(patterns)
}

// Render an OR-across-patterns match expression for one field.
// e.g. ["dildos*", "dildo*"], field="title", prefix="q"
// →    "(title match $q0 || title match $q1)"
export function fieldMatchAny(field: string, paramNames: string[]): string {
  return `(${paramNames.map(n => `${field} match $${n}`).join(' || ')})`
}

// ─── IVR keyword → structured field mapping ────────────────────────────────
// Pure dictionary lookup at query time — zero overhead. Translates common
// search terms into their IVR descriptor field + enum value so GROQ boosts
// and filters can leverage the enriched product metadata.

interface IvrTermMatch { field: string; value: string; paramName: string }

const IVR_KEYWORD_MAP: Record<string, { field: string; value: string }> = {
  // Features (array field: ivrFeatures)
  'waterproof':   { field: 'ivrFeatures', value: 'waterproof' },
  'submersible':  { field: 'ivrFeatures', value: 'waterproof' },
  'quiet':        { field: 'ivrFeatures', value: 'quiet' },
  'silent':       { field: 'ivrFeatures', value: 'quiet' },
  'discreet':     { field: 'ivrFeatures', value: 'quiet' },
  'rechargeable': { field: 'ivrFeatures', value: 'rechargeable' },
  'bluetooth':    { field: 'ivrFeatures', value: 'app-controlled' },
  'remote':       { field: 'ivrFeatures', value: 'app-controlled' },
  'body-safe':    { field: 'ivrFeatures', value: 'body-safe' },
  'silicone':     { field: 'ivrFeatures', value: 'body-safe' },
  // Mood (array field: ivrMood)
  'romantic':     { field: 'ivrMood', value: 'romantic' },
  'playful':      { field: 'ivrMood', value: 'playful' },
  'luxurious':    { field: 'ivrMood', value: 'luxurious' },
  'luxury':       { field: 'ivrMood', value: 'luxurious' },
  'adventurous':  { field: 'ivrMood', value: 'adventurous' },
  'relaxing':     { field: 'ivrMood', value: 'relaxing' },
  // Experience (string field: ivrExperience)
  'beginner':     { field: 'ivrExperience', value: 'beginner' },
  'starter':      { field: 'ivrExperience', value: 'beginner' },
  'first time':   { field: 'ivrExperience', value: 'beginner' },
  'advanced':     { field: 'ivrExperience', value: 'advanced' },
  // Use case (array field: ivrUseCase)
  'couples':      { field: 'ivrUseCase', value: 'couples' },
  'couple':       { field: 'ivrUseCase', value: 'couples' },
  'date night':   { field: 'ivrUseCase', value: 'date-night' },
  'gift':         { field: 'ivrUseCase', value: 'gift' },
  'travel':       { field: 'ivrUseCase', value: 'travel' },
  'portable':     { field: 'ivrUseCase', value: 'travel' },
}

// Sorted longest-first so multi-word phrases like "date night" match before "date"
const IVR_KEYWORDS_SORTED = Object.keys(IVR_KEYWORD_MAP).sort((a, b) => b.length - a.length)

// Array fields use `$param in field`; string fields use `field == $param`
const IVR_ARRAY_FIELDS = new Set(['ivrFeatures', 'ivrMood', 'ivrUseCase'])

export function detectIvrTerms(query: string): IvrTermMatch[] {
  const lower = query.toLowerCase()
  const seen = new Set<string>() // dedupe by field+value
  const matches: IvrTermMatch[] = []
  let idx = 0

  for (const keyword of IVR_KEYWORDS_SORTED) {
    if (!lower.includes(keyword)) continue
    const entry = IVR_KEYWORD_MAP[keyword]!
    const key = `${entry.field}:${entry.value}`
    if (seen.has(key)) continue
    seen.add(key)
    matches.push({ field: entry.field, value: entry.value, paramName: `ivr${idx}` })
    idx++
  }

  return matches
}

// ─── Sort helpers ───────────────────────────────────────────────────────────

type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'newest'

function sanitySort(sort: SortOption): string {
  switch (sort) {
    case 'price_asc':  return '| order(price asc)'
    case 'price_desc': return '| order(price desc)'
    case 'newest':     return '| order(_createdAt desc)'
    default:           return '' // relevance = score order (default from score())
  }
}

// ─── Full search ────────────────────────────────────────────────────────────

export async function searchAll(params: {
  query: string
  tags?: string[]
  vendors?: string[]
  features?: string[]
  experience?: string[]
  priceMin?: number | null
  priceMax?: number | null
  // Ask-Emma taxonomy — applied post-hydration against Shopify metafields.
  moods?: string[]
  audiences?: string[]
  matters?: string[]
  budgetMax?: number | null
  // Compound tags (CSV strings) from the admin taxonomy — passed in so the
  // server can count them with proper OR logic (each product counted once).
  compoundTags?: string[]
  sort?: SortOption
  page?: number
  perPage?: number
}): Promise<UnifiedSearchResult> {
  const client = getSearchClient()

  // Fallback to Shopify search if Sanity not configured
  if (!client) return shopifyFallback(params)

  const {
    query,
    tags = [],
    vendors = [],
    features = [],
    experience = [],
    priceMin = null,
    priceMax = null,
    compoundTags = [],
    sort = 'relevance',
    page = 1,
    perPage = 24,
  } = params

  const start = (page - 1) * perPage
  const end = start + perPage + 1 // fetch one extra to detect next page

  // Build filter conditions for products, bucketed by dimension so the facet
  // pipeline can rebuild the filter excluding any single dimension. This is
  // what makes "if I added this filter, what would I get?" counts honest.
  type FacetDim = 'tag' | 'vendor' | 'feature' | 'experience' | 'price'
  // WS2c — exclude draft-stage import stubs (opt-out: unset/false is visible,
  // matching the existing `archived` pattern, so the live catalog needs no backfill).
  const baseClauses: string[] = ['_type == "productPage"', 'archived != true', '(!defined(hiddenUntilLive) || hiddenUntilLive != true)']
  const textClauses: string[] = []
  const tagClauses: string[] = []
  const vendorClauses: string[] = []
  const featureClauses: string[] = []
  const experienceClauses: string[] = []
  const priceClauses: string[] = []
  const groqParams: Record<string, unknown> = {}

  const queryPatterns = query ? buildQueryPatterns(query) : []
  const queryParamNames = queryPatterns.map((_, i) => `q${i}`)
  // Detect IVR descriptor matches from the query (e.g. "waterproof" → ivrFeatures)
  const ivrTerms = query ? detectIvrTerms(query) : []
  for (const term of ivrTerms) {
    groqParams[term.paramName] = term.value
  }

  if (query && queryPatterns.length > 0) {
    queryPatterns.forEach((p, i) => { groqParams[`q${i}`] = p })
    // GROQ `match` does word-prefix matching. We also OR across singular/plural
    // variants (see buildQueryPatterns) so "dildos" matches "Dildo", etc.
    const titleMatch  = fieldMatchAny('title', queryParamNames)
    const taglineMatch = fieldMatchAny('tagline', queryParamNames)
    const vendorMatch  = fieldMatchAny('vendor', queryParamNames)
    const seoMatch     = fieldMatchAny('seoDescription', queryParamNames)
    const categoryMatch = fieldMatchAny('category', queryParamNames)
    const descMatch    = fieldMatchAny('pt::text(description)', queryParamNames)
    const tagInAny     = `(${queryParamNames.map(n => `$${n} in tags`).join(' || ')})`

    // IVR field match conditions — products matching only via descriptors still appear
    const ivrMatchClauses = ivrTerms.map(t =>
      IVR_ARRAY_FIELDS.has(t.field)
        ? `$${t.paramName} in ${t.field}`
        : `${t.field} == $${t.paramName}`
    )
    const ivrMatchOr = ivrMatchClauses.length > 0 ? ` || ${ivrMatchClauses.join(' || ')}` : ''

    textClauses.push(
      `(${titleMatch} || ${taglineMatch} || ${vendorMatch} || ${seoMatch} || ${categoryMatch} || ${tagInAny} || ${descMatch}${ivrMatchOr})`
    )
  } else if (ivrTerms.length > 0) {
    // No text query but IVR terms detected (shouldn't normally happen, but be safe)
    const ivrMatchClauses = ivrTerms.map(t =>
      IVR_ARRAY_FIELDS.has(t.field)
        ? `$${t.paramName} in ${t.field}`
        : `${t.field} == $${t.paramName}`
    )
    textClauses.push(`(${ivrMatchClauses.join(' || ')})`)
  }

  if (tags.length > 0) {
    // All selected tag filters must match (AND between filters)
    // Each filter may be comma-delimited — any part matches (OR within filter).
    // Filter against `normalizedTags` (canonical slug array on each product) so
    // admin-curated taxonomy values like `cat:plugs-and-probes` match real
    // product tags like "Plugs and Probes". User-supplied values run through
    // `normalizeTag` here so both sides of the comparison share the same
    // slugifier — see app/lib/tag-normalize.ts.
    for (let i = 0; i < tags.length; i++) {
      const parts = tags[i]!.split(',').map(s => normalizeTag(s)).filter(Boolean)
      if (parts.length === 1) {
        const paramName = `tag${i}`
        tagClauses.push(`$${paramName} in normalizedTags`)
        groqParams[paramName] = parts[0]
      } else if (parts.length > 1) {
        const orConditions = parts.map((part, j) => {
          const paramName = `tag${i}_${j}`
          groqParams[paramName] = part
          return `$${paramName} in normalizedTags`
        })
        tagClauses.push(`(${orConditions.join(' || ')})`)
      }
    }
  }

  if (vendors.length > 0) {
    const vendorConditions = vendors.map((_, i) => `vendor == $vendor${i}`).join(' || ')
    vendorClauses.push(`(${vendorConditions})`)
    vendors.forEach((v, i) => { groqParams[`vendor${i}`] = v })
  }

  if (features.length > 0) {
    // All selected features must be present (AND)
    for (let i = 0; i < features.length; i++) {
      const paramName = `feat${i}`
      featureClauses.push(`$${paramName} in ivrFeatures`)
      groqParams[paramName] = features[i]
    }
  }

  if (experience.length > 0) {
    // Any selected experience level matches (OR)
    const expConditions = experience.map((_, i) => `ivrExperience == $exp${i}`).join(' || ')
    experienceClauses.push(`(${expConditions})`)
    experience.forEach((e, i) => { groqParams[`exp${i}`] = e })
  }

  if (priceMin != null) {
    priceClauses.push('price >= $priceMin')
    groqParams.priceMin = priceMin
  }
  if (priceMax != null) {
    priceClauses.push('price <= $priceMax')
    groqParams.priceMax = priceMax
  }

  function buildFilter(exclude?: FacetDim): string {
    const parts: string[] = [...baseClauses, ...textClauses]
    if (exclude !== 'tag')        parts.push(...tagClauses)
    if (exclude !== 'vendor')     parts.push(...vendorClauses)
    if (exclude !== 'feature')    parts.push(...featureClauses)
    if (exclude !== 'experience') parts.push(...experienceClauses)
    if (exclude !== 'price')      parts.push(...priceClauses)
    return parts.join(' && ')
  }

  const productFilter = buildFilter()
  const sortClause = sanitySort(sort)

  // Build the GROQ query with score() for relevance ranking.
  // Boost on each query-pattern variant so the original spelling still wins.
  // IVR descriptor boosts (weight 4) sit between title (5) and tagline (3).
  const ivrBoosts = ivrTerms.map(t =>
    IVR_ARRAY_FIELDS.has(t.field)
      ? `boost($${t.paramName} in ${t.field}, 4)`
      : `boost(${t.field} == $${t.paramName}, 4)`
  )
  const boosts = (queryParamNames.length > 0 || ivrBoosts.length > 0)
    ? [
        ...queryParamNames.map(n => `boost(title match $${n}, 5)`),
        ...ivrBoosts,
        ...queryParamNames.map(n => `boost(tagline match $${n}, 3)`),
        ...queryParamNames.map(n => `boost(vendor match $${n}, 2)`),
        ...queryParamNames.map(n => `boost(pt::text(description) match $${n}, 1)`),
        ...queryParamNames.map(n => `boost(seoDescription match $${n}, 1)`),
      ].join(',\n        ')
    : ''
  const productQuery = query
    ? `*[${productFilter}] | score(\n        ${boosts}\n      ) ${sortClause} [${start}...${end}]`
    : `*[${productFilter}] ${sortClause} [${start}...${end}]`

  const productProjection = `{
    "handle": shopifyHandle,
    title,
    vendor,
    tags,
    category,
    previewImageUrl,
    "shopifyId": shopifyProductId,
    _score
  }`

  // Content search (pages + blog posts) — only on first page
  const pageTitleAny = fieldMatchAny('title', queryParamNames)
  const pageSeoTitleAny = fieldMatchAny('seoTitle', queryParamNames)
  const pageSeoDescAny = fieldMatchAny('seoDescription', queryParamNames)
  const postTitleAny = fieldMatchAny('title', queryParamNames)
  const postExcerptAny = fieldMatchAny('excerpt', queryParamNames)
  const postBodyAny = fieldMatchAny('pt::text(body)', queryParamNames)
  const pageBoosts = queryParamNames.length > 0
    ? [
        ...queryParamNames.map(n => `boost(title match $${n}, 3)`),
        ...queryParamNames.map(n => `boost(seoDescription match $${n}, 1)`),
      ].join(', ')
    : ''
  const postBoosts = queryParamNames.length > 0
    ? [
        ...queryParamNames.map(n => `boost(title match $${n}, 3)`),
        ...queryParamNames.map(n => `boost(excerpt match $${n}, 2)`),
      ].join(', ')
    : ''
  const contentQueries = page === 1 && query ? {
    pages: `*[_type == "page" && (${pageTitleAny} || ${pageSeoTitleAny} || ${pageSeoDescAny})] | score(${pageBoosts}) [0...5] {
      _type, title, "slug": slug.current, seoDescription, "excerpt": null
    }`,
    blogPosts: `*[_type == "blogPost" && status == "published" && (${postTitleAny} || ${postExcerptAny} || ${postBodyAny})] | score(${postBoosts}) [0...5] {
      _type, title, "slug": slug.current, excerpt, seoDescription, "categoryName": category->name
    }`,
  } : null

  // Count total products matching the filter
  const countQuery = `count(*[${productFilter}])`

  try {
    // Execute all queries in a single GROQ request
    const combinedQuery = `{
      "products": ${productQuery} ${productProjection},
      "totalProducts": ${countQuery}
      ${contentQueries ? `, "pages": ${contentQueries.pages}, "blogPosts": ${contentQueries.blogPosts}` : ''}
    }`

    const data = await client.fetch<{
      products: (Omit<SearchProductResult, 'price' | 'compareAtPrice' | 'featuredImage'> & { _score?: number })[]
      totalProducts: number
      pages?: ContentResult[]
      blogPosts?: ContentResult[]
    }>(combinedQuery, groqParams)

    // Detect hasNextPage by checking if we got the extra result
    const hasNextPage = data.products.length > perPage
    const sanityProducts = hasNextPage ? data.products.slice(0, perPage) : data.products

    // Hydrate products with real-time Shopify pricing
    const handles = sanityProducts.map(p => p.handle).filter(Boolean)
    const shopifyProducts = handles.length > 0 ? await getProductsByHandles(handles) : []
    const shopifyMap = new Map<string, Product>(shopifyProducts.map(p => [p.handle, p]))

    const products: SearchProductResult[] = sanityProducts.map(sp => {
      const shopify = shopifyMap.get(sp.handle)
      const firstAvailable = shopify?.variants.find(v => v.availableForSale) ?? shopify?.variants[0]
      const firstVid = shopify?.videos?.[0]
      const mp4 = firstVid?.sources.find(s => s.mimeType.includes('mp4')) ?? firstVid?.sources[0]
      return {
        handle: sp.handle,
        title: shopify?.title ?? sp.title ?? '',
        vendor: sp.vendor ?? shopify?.brand ?? null,
        tags: sp.tags ?? shopify?.tags ?? [],
        category: sp.category ?? null,
        previewImageUrl: sp.previewImageUrl ?? null,
        price: shopify ? String(shopify.price) : null,
        compareAtPrice: shopify?.compareAtPrice ? String(shopify.compareAtPrice) : null,
        featuredImage: shopify?.images?.[0]
          ? { url: shopify.images[0].url, altText: shopify.images[0].altText ?? null }
          : sp.previewImageUrl
            ? { url: sp.previewImageUrl, altText: sp.title }
            : null,
        shopifyId: sp.shopifyId ?? null,
        defaultVariantId: firstAvailable?.id ?? null,
        hasMultipleVariants: (shopify?.variants.length ?? 0) > 1,
        availableForSale: firstAvailable?.availableForSale ?? false,
        firstVideo: firstVid && mp4
          ? { previewUrl: firstVid.previewImageUrl, src: mp4.url, aspect: firstVid.aspect ?? null }
          : null,
        ...(shopify?.moodTags?.length     ? { moodTags: shopify.moodTags }         : {}),
        ...(shopify?.audienceTags?.length ? { audienceTags: shopify.audienceTags } : {}),
        ...(shopify?.mattersTags?.length  ? { mattersTags: shopify.mattersTags }   : {}),
      }
    })

    // Ask-Emma taxonomy filter — applied post-hydration since the tags live on
    // Shopify metafields, not Sanity. Kept optional so current callers that
    // don't pass these args are unaffected.
    const emmaFiltered = applyAskEmmaFilter(products, params)

    // Compute facets per-dimension. Each facet excludes its own dimension from
    // the filter so the displayed counts answer "how many results would I get
    // if I picked this?" rather than collapsing to whatever the user already
    // chose. Emma filters are deliberately not included — the curated drawer
    // is its own self-consistent system.
    const facets = await computeFacets(client, {
      filterNoTag:        buildFilter('tag'),
      filterNoVendor:     buildFilter('vendor'),
      filterNoFeature:    buildFilter('feature'),
      filterNoExperience: buildFilter('experience'),
      filterNoPrice:      buildFilter('price'),
    }, groqParams, compoundTags)

    return {
      products: emmaFiltered,
      pages: data.pages ?? [],
      blogPosts: data.blogPosts ?? [],
      totalProducts: data.totalProducts,
      hasNextPage,
      facets,
    }
  } catch (err) {
    console.error('[search] Sanity search failed, falling back to Shopify:', err)
    return shopifyFallback(params)
  }
}

// ─── Ask-Emma taxonomy post-filter ──────────────────────────────────────────
// Mood/audience/matters/budget filters live on Shopify metafields, so we apply
// them after hydration. Mirrors the predicate from AskEmmaRail so the UI chips
// filter consistently across client-side and server-side callers.
function applyAskEmmaFilter(
  products: SearchProductResult[],
  params: { moods?: string[]; audiences?: string[]; matters?: string[]; budgetMax?: number | null },
): SearchProductResult[] {
  const moods     = params.moods ?? []
  const audiences = params.audiences ?? []
  const matters   = params.matters ?? []
  const budgetMax = params.budgetMax ?? null
  if (moods.length === 0 && audiences.length === 0 && matters.length === 0 && budgetMax == null) {
    return products
  }
  return products.filter(p => {
    if (moods.length > 0) {
      if (!p.moodTags?.some(t => moods.includes(t))) return false
    }
    if (audiences.length > 0) {
      if (!p.audienceTags?.some(t => audiences.includes(t))) return false
    }
    if (matters.length > 0) {
      if (!p.mattersTags?.some(t => matters.includes(t))) return false
    }
    if (budgetMax != null && p.price != null) {
      if (parseFloat(p.price) > budgetMax) return false
    }
    return true
  })
}

// ─── Facet computation ──────────────────────────────────────────────────────
// Each facet runs its own query against a filter that *excludes* that facet's
// dimension. The result: counts always answer "if I pick this option, what
// would I get?" Each row contributes at most once to each facet (Set dedupe)
// so a product tagged the same value twice can't inflate the count.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function computeFacets(
  client: any,
  filters: {
    filterNoTag: string
    filterNoVendor: string
    filterNoFeature: string
    filterNoExperience: string
    filterNoPrice: string
  },
  groqParams: Record<string, unknown>,
  compoundTags: string[] = [],
): Promise<SearchFacets> {
  const emptyFacets: SearchFacets = { tagCounts: {}, compoundTagCounts: {}, vendorCounts: {}, priceBuckets: { under25: 0, p25_50: 0, p50_100: 0, over100: 0 }, featureCounts: {}, experienceCounts: {} }
  try {
    const combined = await client.fetch(
      `{
        "tagRows":   *[${filters.filterNoTag}]{ "tags": normalizedTags },
        "vendorRows": *[${filters.filterNoVendor}]{ vendor },
        "featureRows": *[${filters.filterNoFeature}]{ ivrFeatures },
        "experienceRows": *[${filters.filterNoExperience}]{ ivrExperience },
        "priceRows": *[${filters.filterNoPrice}]{ price }
      }`,
      groqParams,
    ) as {
      tagRows: { tags: string[] | null }[]
      vendorRows: { vendor: string | null }[]
      featureRows: { ivrFeatures: string[] | null }[]
      experienceRows: { ivrExperience: string | null }[]
      priceRows: { price: number | null }[]
    }
    const tagCounts: Record<string, number> = {}
    const vendorCounts: Record<string, number> = {}
    const featureCounts: Record<string, number> = {}
    const experienceCounts: Record<string, number> = {}
    const priceBuckets = { under25: 0, p25_50: 0, p50_100: 0, over100: 0 }
    // Pre-split compound tags into part lists so we can scan each row once.
    // Normalize each part so the comparison sees the same slug shape stored in
    // the product's normalizedTags array.
    const compoundParts: { key: string; parts: string[] }[] = compoundTags
      .map(key => ({ key, parts: key.split(',').map(s => normalizeTag(s)).filter(Boolean) }))
      .filter(c => c.parts.length > 1)
    const compoundTagCounts: Record<string, number> = {}
    for (const r of combined.tagRows) {
      if (!r.tags) continue
      // Dedupe per product so a duplicate tag entry can't double-count.
      const seen = new Set(r.tags)
      for (const t of seen) tagCounts[t] = (tagCounts[t] ?? 0) + 1
      // Count each compound once per product if any part matches.
      for (const c of compoundParts) {
        if (c.parts.some(p => seen.has(p))) {
          compoundTagCounts[c.key] = (compoundTagCounts[c.key] ?? 0) + 1
        }
      }
    }
    for (const r of combined.vendorRows) {
      if (r.vendor) vendorCounts[r.vendor] = (vendorCounts[r.vendor] ?? 0) + 1
    }
    for (const r of combined.featureRows) {
      if (!r.ivrFeatures) continue
      const seen = new Set(r.ivrFeatures)
      for (const f of seen) featureCounts[f] = (featureCounts[f] ?? 0) + 1
    }
    for (const r of combined.experienceRows) {
      if (r.ivrExperience) experienceCounts[r.ivrExperience] = (experienceCounts[r.ivrExperience] ?? 0) + 1
    }
    for (const r of combined.priceRows) {
      const p = r.price ?? 0
      if (p < 25) priceBuckets.under25++
      else if (p < 50) priceBuckets.p25_50++
      else if (p < 100) priceBuckets.p50_100++
      else priceBuckets.over100++
    }
    return { tagCounts, compoundTagCounts, vendorCounts, priceBuckets, featureCounts, experienceCounts }
  } catch {
    return emptyFacets
  }
}

// ─── Predictive search ──────────────────────────────────────────────────────

export async function predictiveSearchUnified(query: string): Promise<PredictiveResult> {
  const client = getSearchClient()

  if (!client) {
    // Fallback: use Shopify predictive search
    const result = await shopifyPredictiveSearch(query)
    const products: PredictiveProduct[] = result.products.map(p => ({
      handle: p.handle,
      title: p.title,
      previewImageUrl: p.featuredImage?.url ?? null,
      vendor: p.vendor ?? null,
      price: null,
      compareAtPrice: null,
      category: null,
    }))
    return {
      products,
      pages: [],
      blogPosts: [],
      totalProducts: products.length,
      categories: [],
    }
  }

  const patterns = buildQueryPatterns(query)
  if (patterns.length === 0) {
    return { products: [], pages: [], blogPosts: [], totalProducts: 0, categories: [] }
  }
  const paramNames = patterns.map((_, i) => `q${i}`)
  const groqParams: Record<string, unknown> = {}
  patterns.forEach((p, i) => { groqParams[`q${i}`] = p })

  // IVR descriptor matches for typeahead
  const ivrTerms = detectIvrTerms(query)
  for (const term of ivrTerms) {
    groqParams[term.paramName] = term.value
  }

  // Any of the query-pattern variants matching a given field
  const anyTitle = fieldMatchAny('title', paramNames)
  const anyTagline = fieldMatchAny('tagline', paramNames)
  const anyVendor = fieldMatchAny('vendor', paramNames)
  const anyCategory = fieldMatchAny('category', paramNames)
  const anySeoTitle = fieldMatchAny('seoTitle', paramNames)
  const anyExcerpt = fieldMatchAny('excerpt', paramNames)
  const anyTagIn = `(${paramNames.map(n => `$${n} in tags`).join(' || ')})`

  // IVR field match clauses for filter + count
  const ivrMatchClauses = ivrTerms.map(t =>
    IVR_ARRAY_FIELDS.has(t.field)
      ? `$${t.paramName} in ${t.field}`
      : `${t.field} == $${t.paramName}`
  )
  const ivrMatchOr = ivrMatchClauses.length > 0 ? ` || ${ivrMatchClauses.join(' || ')}` : ''

  const productMatchAny = `(${anyTitle} || ${anyTagline} || ${anyVendor} || ${anyCategory}${ivrMatchOr})`
  const productFullMatchAny = `(${anyTitle} || ${anyTagline} || ${anyVendor} || ${anyCategory} || ${anyTagIn}${ivrMatchOr})`

  const ivrBoosts = ivrTerms.map(t =>
    IVR_ARRAY_FIELDS.has(t.field)
      ? `boost($${t.paramName} in ${t.field}, 4)`
      : `boost(${t.field} == $${t.paramName}, 4)`
  )
  const productBoosts = [
    ...paramNames.map(n => `boost(title match $${n}, 5)`),
    ...ivrBoosts,
    ...paramNames.map(n => `boost(tagline match $${n}, 3)`),
    ...paramNames.map(n => `boost(vendor match $${n}, 2)`),
    ...paramNames.map(n => `boost(category match $${n}, 1)`),
  ].join(', ')

  try {
    const data = await client.fetch<{
      products: { handle: string; title: string; previewImageUrl: string | null; vendor: string | null; category: string[] | null }[]
      totalProducts: number
      categoryRows: { category: string[] | null }[]
      pages: { title: string; slug: string }[]
      blogPosts: { title: string; slug: string }[]
    }>(`{
      "products": *[_type == "productPage" && ${productMatchAny}] | score(${productBoosts}) [0...6] {
        "handle": shopifyHandle, title, previewImageUrl, vendor, category
      },
      "totalProducts": count(*[_type == "productPage" && ${productFullMatchAny}]),
      "categoryRows": *[_type == "productPage" && ${productFullMatchAny} && count(category) > 0]{ category },
      "pages": *[_type == "page" && (${anyTitle} || ${anySeoTitle})] [0...3] {
        title, "slug": slug.current
      },
      "blogPosts": *[_type == "blogPost" && status == "published" && (${anyTitle} || ${anyExcerpt})] [0...3] {
        title, "slug": slug.current
      }
    }`, groqParams)

    // Hydrate top products with Shopify pricing
    const handles = data.products.map(p => p.handle).filter(Boolean)
    const shopifyProducts = handles.length > 0 ? await getProductsByHandles(handles) : []
    const shopifyMap = new Map<string, Product>(shopifyProducts.map(p => [p.handle, p]))

    const products: PredictiveProduct[] = data.products.map(sp => {
      const shopify = shopifyMap.get(sp.handle)
      // Phase 2 — category is multi-select; collapse the array to a primary
      // display label for the dropdown (first entry, or null when empty).
      const cat = Array.isArray(sp.category) ? (sp.category[0] ?? null) : null
      return {
        handle: sp.handle,
        title: shopify?.title ?? sp.title,
        previewImageUrl: sp.previewImageUrl,
        vendor: sp.vendor,
        price: shopify ? String(shopify.price) : null,
        compareAtPrice: shopify?.compareAtPrice ? String(shopify.compareAtPrice) : null,
        category: cat,
      }
    })

    // Aggregate top categories — each entry in a doc's category array counts
    // independently toward the facet (so a [for-him, couples] product
    // contributes one to each).
    const categoryCounts = new Map<string, number>()
    for (const row of data.categoryRows ?? []) {
      const arr = Array.isArray(row.category) ? row.category : []
      for (const c of arr) {
        if (c) categoryCounts.set(c, (categoryCounts.get(c) ?? 0) + 1)
      }
    }
    const categories = Array.from(categoryCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)

    return {
      products,
      pages: data.pages ?? [],
      blogPosts: data.blogPosts ?? [],
      totalProducts: data.totalProducts ?? products.length,
      categories,
    }
  } catch (err) {
    console.error('[search] Sanity predictive search failed:', err)
    return { products: [], pages: [], blogPosts: [], totalProducts: 0, categories: [] }
  }
}

// ─── Vendor list for filters ────────────────────────────────────────────────

export async function getSearchVendors(): Promise<{ vendor: string; count: number }[]> {
  const client = getSearchClient()
  if (!client) return []

  try {
    // Get all unique vendors with counts
    const allProducts = await client.fetch<{ vendor: string }[]>(
      `*[_type == "productPage" && defined(vendor)]{ vendor }`
    )

    const counts = new Map<string, number>()
    for (const p of allProducts) {
      if (p.vendor) counts.set(p.vendor, (counts.get(p.vendor) ?? 0) + 1)
    }

    return Array.from(counts.entries())
      .map(([vendor, count]) => ({ vendor, count }))
      .sort((a, b) => b.count - a.count)
  } catch {
    return []
  }
}

// ─── Tag counts for admin ──────────────────────────────────────────────────

export async function getTagCounts(compoundTags?: string[]): Promise<Record<string, number>> {
  const client = getSearchClient()
  if (!client) return {}

  try {
    const products = await client.fetch<{ tags: string[] }[]>(
      `*[_type == "productPage" && defined(tags)]{ tags }`
    )
    const counts: Record<string, number> = {}

    // Count individual tags
    for (const p of products) {
      for (const tag of p.tags) {
        counts[tag] = (counts[tag] ?? 0) + 1
      }
    }

    // Count compound (comma-delimited) tags — unique products matching ANY part
    if (compoundTags) {
      for (const entry of compoundTags) {
        if (entry in counts) continue // already counted as individual tag
        const parts = entry.split(',').map(s => s.trim()).filter(Boolean)
        if (parts.length <= 1) continue
        let count = 0
        for (const p of products) {
          if (parts.some(part => p.tags.includes(part))) count++
        }
        counts[entry] = count
      }
    }

    return counts
  } catch {
    return {}
  }
}

// ─── Shopify fallback ───────────────────────────────────────────────────────

async function shopifyFallback(params: {
  query: string
  tags?: string[]
  vendors?: string[]
  priceMin?: number | null
  priceMax?: number | null
  moods?: string[]
  audiences?: string[]
  matters?: string[]
  budgetMax?: number | null
  sort?: string
  page?: number
  perPage?: number
}): Promise<UnifiedSearchResult> {
  const {
    query,
    tags = [],
    vendors = [],
    priceMin = null,
    priceMax = null,
    sort = 'relevance',
    perPage = 24,
  } = params

  const productFilters: Record<string, unknown>[] = [
    ...vendors.map(v => ({ productVendor: v })),
    ...tags.map(t => ({ tag: t })),
    ...(priceMin != null || priceMax != null ? [{
      price: {
        min: priceMin ?? undefined,
        max: priceMax ?? undefined,
      },
    }] : []),
  ]

  const sortKey = sort === 'price_asc' || sort === 'price_desc' ? 'PRICE' as const : 'RELEVANCE' as const
  const reverse = sort === 'price_desc'
  const effectiveQuery = query.trim() || 'wellness'

  const result = await searchProducts({
    query: effectiveQuery,
    first: perPage,
    sortKey,
    reverse,
    productFilters,
  })

  const rawProducts: SearchProductResult[] = result.products.map(p => ({
    handle: p.handle,
    title: p.title,
    vendor: p.vendor,
    tags: p.tags,
    category: null,
    previewImageUrl: p.featuredImage?.url ?? null,
    price: p.priceRange.minVariantPrice.amount,
    compareAtPrice: p.compareAtPriceRange.maxVariantPrice?.amount ?? null,
    featuredImage: p.featuredImage,
    shopifyId: p.id,
    defaultVariantId: null,
    hasMultipleVariants: false,
    availableForSale: true,
    firstVideo: null,
  }))
  // Note: fallback path has no metafields hydrated, so mood/audience/matters
  // filters here will exclude every product with those tags unset. This is the
  // correct conservative behavior — we cannot verify the tag without the
  // Shopify hydration that the Sanity path performs.
  return {
    products: applyAskEmmaFilter(rawProducts, params),
    pages: [],
    blogPosts: [],
    totalProducts: result.totalCount,
    hasNextPage: result.pageInfo.hasNextPage,
    facets: { tagCounts: {}, compoundTagCounts: {}, vendorCounts: {}, priceBuckets: { under25: 0, p25_50: 0, p50_100: 0, over100: 0 }, featureCounts: {}, experienceCounts: {} },
  }
}
