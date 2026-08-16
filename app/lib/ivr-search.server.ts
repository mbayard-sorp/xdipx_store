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
   * - 'relaxed-audience'  — the audience tag filter (for-her / for-him / couples)
   *                         emptied the set, so it was dropped and the search
   *                         retried. Cards ARE relevant to the query and category
   *                         but may not be audience-tagged. Distinct from 'matched'
   *                         so the gap stays visible in telemetry: audience tag
   *                         coverage in the catalog is thin, and this reason firing
   *                         often is the signal to backfill it rather than to keep
   *                         leaning on the fallback.
   * - 'sanity-unavailable'— the Sanity query layer could not be reached (client env
   *                         vars missing, or the GROQ fetch threw), AND the Shopify
   *                         fallback also came back empty. Zero real products.
   * - 'sanity-degraded'   - the Sanity query layer was unavailable, or a strict-category
   *                         keyword search found nothing in Sanity, but the Shopify search
   *                         fallback found real products. Distinct from 'sanity-unavailable'
   *                         on purpose (ticket #1269): that reason tells the model "search is
   *                         degraded, apologize, do not invent products" (see
   *                         searchReasonGuidance), which is the wrong framing when cards ARE
   *                         present and real. Present these normally; the reason exists so the
   *                         degradation stays visible in diagnostics/telemetry even though the
   *                         caller sees a normal result.
   * - 'catalog-unavailable'— Sanity returned candidates, but hydrating them against
   *                         the live Shopify catalog failed. A downstream outage, NOT
   *                         a Sanity one: kept distinct so it is neither mislabeled as
   *                         'sanity-unavailable' nor read by the model as "no results".
   */
  reason:
    | 'matched'
    | 'filtered-to-zero'
    | 'relaxed-audience'
    | 'no-base-results'
    | 'sanity-unavailable'
    | 'sanity-degraded'
    | 'catalog-unavailable'
}

/**
 * Emit an outage signal for a degraded search path. Sentry is a no-op without a
 * DSN (dev/preview), so this is safe to call unconditionally; in production it
 * feeds a rate alert on `search: '<fn>'` + `outage: '<reason>'` (the alert
 * threshold itself is a Sentry-dashboard rule, an owner action, so the code's
 * job is to emit the signal every time so the rate is measurable). Sentry is
 * loaded dynamically (like the owner-alert path in import-enrich.server) so the
 * heavy @sentry/node graph never enters a caller's module-load path. Never
 * throws.
 */
async function captureSearchOutage(
  fn: 'searchForIvr' | 'discoverForIvr',
  reason: 'sanity-unavailable' | 'catalog-unavailable',
  err?: unknown,
): Promise<void> {
  try {
    const { Sentry } = await import('./sentry.server')
    const error = err instanceof Error ? err : new Error(`${fn} ${reason}`)
    Sentry.captureException(error, {
      tags: { search: fn, outage: reason, severity: 'P1' },
    })
  } catch {
    /* never let telemetry break a search */
  }
}

// ─── priceMax (post-hydration) ───────────────────────────────────────────────
// productPage has no price field (prices live in Shopify and change daily), so
// a GROQ `price <= $priceMax` clause compares against a missing field, which
// is false for every doc: any priceMax query returned zero rows. The filter
// now runs after Shopify hydration against live prices. The GROQ pool widens
// 3x (hard cap 60) when priceMax is set so the post-filter has headroom.
function pricedPoolSize(normalPool: number, priceMax: number | undefined): number {
  return priceMax != null ? Math.min(normalPool * 3, 60) : normalPool
}

function applyPriceMax(cards: IvrProductCard[], priceMax: number | undefined): IvrProductCard[] {
  return priceMax != null ? cards.filter((c) => c.price <= priceMax) : cards
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
export const STRICT_CATEGORY_TERMS = new Set([
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
/**
 * Audience values the discovery agent may pass through as `tags`. Only these
 * are droppable on a filtered-to-zero retry — an unrecognised tag is left alone
 * because we can't assume it's a soft preference.
 */
const AUDIENCE_TAGS = new Set(['for-her', 'for-him', 'couples'])

type SanityCandidate = { handle: string; title: string; category: string | null; tagline: string | null }

/**
 * Given the filter conditions built for a search and the `tags` they came from,
 * return the conditions with audience-tag clauses removed — or null when there
 * is nothing to relax (no tags, no audience tags among them, or no matching
 * clause found). Null means "don't retry", so a caller can't loop on an
 * identical query.
 *
 * The `$tag{i} in tags` clause names are positional, matching the order tags
 * were pushed in the main query builder. Kept in lockstep with that loop.
 */
export function dropAudienceTagConditions(
  filterConditions: string[],
  tags: string[] | undefined,
): string[] | null {
  if (!tags || tags.length === 0) return null
  const audienceClauses = new Set(
    tags
      .map((t, i) => (AUDIENCE_TAGS.has(t) ? `$tag${i} in tags` : null))
      .filter((c): c is string => c !== null),
  )
  if (audienceClauses.size === 0) return null
  const kept = filterConditions.filter((c) => !audienceClauses.has(c))
  return kept.length === filterConditions.length ? null : kept
}

/**
 * Re-run the candidate query with audience tags removed from the filter set.
 * Returns null when there was no audience tag to drop (nothing to relax) or the
 * relaxed query is still empty — in both cases the caller reports the original
 * filtered-to-zero rather than inventing results.
 */
async function retryWithoutAudienceTags(args: {
  client: ReturnType<typeof getSanityClient>
  baseConditions: string[]
  filterConditions: string[]
  groqParams: Record<string, unknown>
  tags: string[] | undefined
  boosts: string
  candidatePool: number
}): Promise<SanityCandidate[] | null> {
  const { client, baseConditions, filterConditions, groqParams, tags, boosts, candidatePool } = args
  if (!client) return null

  const kept = dropAudienceTagConditions(filterConditions, tags)
  if (kept === null) return null

  const filter = [...baseConditions, ...kept].join(' && ')
  const groq = `*[${filter}] | score(${boosts}) [0...${candidatePool}] {
      "handle": shopifyHandle,
      title,
      category,
      tagline
    }`
  const results = await cachedGroqFetch<SanityCandidate[]>(client, groq, groqParams)
  return results && results.length > 0 ? results : null
}

/**
 * A Sanity candidate whose `shopifyHandle` did not resolve to a live Shopify
 * product (ticket #1270). Previously these were dropped in the hydration loop
 * with a silent `continue`, no log and no metric, so a growing handle-drift
 * problem (a Sanity doc pointing at a renamed or archived Shopify handle) was
 * invisible until a caller noticed thinner-than-expected results. Logs count
 * plus a small sample so the drift shows up in normal error monitoring instead.
 */
function logHydrationMisses(fn: 'searchForIvr' | 'discoverForIvr', misses: string[]): void {
  if (misses.length === 0) return
  console.error(
    `[ivr-search] ${fn}: ${misses.length} Sanity candidate(s) missed Shopify hydration`,
    misses.slice(0, 5),
  )
}

/**
 * Hydrate Sanity candidates against Shopify, apply the live-price budget filter,
 * and rank. Shared by the normal path and the relaxed-audience retry so the two
 * cannot drift apart.
 */
async function hydrateAndRank(
  sanityResults: SanityCandidate[],
  opts: { limit: number; priceMax: number | undefined; reason: SearchDiagnostics['reason'] },
): Promise<SearchDiagnostics> {
  const handles = sanityResults.map((r) => r.handle).filter(Boolean)
  const shopifyProducts = await getProductsByHandles(handles)
  const shopifyMap = new Map<string, Product>(shopifyProducts.map((p) => [p.handle, p]))

  const cards: IvrProductCard[] = []
  const missed: string[] = []
  for (const sr of sanityResults) {
    const product = shopifyMap.get(sr.handle)
    if (!product) { missed.push(sr.handle); continue }
    cards.push(toIvrCard(product, { tagline: sr.tagline ?? undefined, category: sr.category ?? undefined }))
  }
  logHydrationMisses('searchForIvr', missed)

  const priced = applyPriceMax(cards, opts.priceMax)
  const ranked = marginWeightedSelect(priced, opts.limit)
  return { cards: ranked, reason: ranked.length > 0 ? opts.reason : 'filtered-to-zero' }
}

/**
 * Run the Shopify search fallback and classify the result (ticket #1269).
 * `zeroReason` is what to report when the fallback also finds nothing, the
 * same reason the caller would have returned anyway. When the fallback DOES
 * find products, the reason is 'sanity-degraded', never `zeroReason` or
 * 'matched': real products are present, but the primary Sanity index missed
 * them, and that gap needs to stay visible instead of looking identical to a
 * normal hit.
 *
 * Shopify's Storefront `search` only returns ACTIVE/published products, so the
 * `archived` exclusion carries into the fallback automatically. `hiddenUntilLive`
 * has no Shopify equivalent, it is a Sanity-only publish gate, so it cannot be
 * expressed here; re-querying Sanity to check it would defeat the point of a
 * fallback that exists for when Sanity is the thing that's down.
 */
async function fallbackSearch(
  query: string,
  limit: number,
  priceMax: number | undefined,
  zeroReason: SearchDiagnostics['reason'],
): Promise<SearchDiagnostics> {
  const pool = applyPriceMax(await shopifyFallback(query, Math.max(limit * 2, 8)), priceMax)
  if (pool.length === 0) return { cards: [], reason: zeroReason }
  const cards = marginWeightedSelect(pool, limit)
  return { cards, reason: cards.length > 0 ? 'sanity-degraded' : zeroReason }
}

export async function searchForIvrWithDiagnostics(opts: IvrSearchOpts): Promise<SearchDiagnostics> {
  const { query, limit = 3, category, priceMax, tags, mattersTags, productTypeDial, productSubtypeDial } = opts
  const client = getSanityClient()

  if (!client) {
    await captureSearchOutage('searchForIvr', 'sanity-unavailable')
    const pool = applyPriceMax(await shopifyFallback(query, Math.max(limit * 2, 8)), priceMax)
    if (pool.length === 0) return { cards: [], reason: 'sanity-unavailable' }
    const cards = shuffle(pool).slice(0, limit)
    return { cards, reason: 'sanity-degraded' }
  }

  // Distinguishes a Sanity-layer failure (the GROQ query itself) from a
  // downstream Shopify hydration failure. Flipped true only once every Sanity
  // query has returned and we commit to hydrating against the live catalog, so
  // the catch below never mislabels a Shopify outage as 'sanity-unavailable'.
  let sanityOk = false

  // Fetch a wider candidate pool so we can shuffle within similar relevance
  // and avoid pitching the same product on every call. Top-N matches usually
  // have similar scores; shuffling them gives variety without sacrificing
  // quality. The first few results (relevance > everything else) stay near
  // the top thanks to the score ordering before we fetch.
  const candidatePool = pricedPoolSize(Math.max(limit * 3, 12), priceMax)

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
    // priceMax intentionally absent from GROQ: applied post-hydration below.
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
      // Query the normalized field so both "Plus-size friendly" and
      // "Plus-size-friendly" casings match: mattersTagsNormalized is written
      // through the same canonical slugifier (tag-normalize) as the params here.
      const slugged = mattersTags.map((t) => normalizeTag(t)).filter(Boolean)
      if (slugged.length > 0) {
        const orClauses = slugged.map((_, i) => `$mt${i} in mattersTagsNormalized`)
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
        // found anything: if yes, it's filtered-to-zero; otherwise no-base-results.
        if (hasExtraFilters) {
          // Re-query with only base conditions to check if unfiltered results exist
          const baseFilter = baseConditions.join(' && ')
          const baseGroq = `*[${baseFilter}] [0...1] { "handle": shopifyHandle }`
          const baseCheck = await cachedGroqFetch<{ handle: string }[]>(client, baseGroq, groqParams)
          if (baseCheck.length === 0) {
            // No base match in Sanity either. Ticket #1269: this used to return
            // straight to the caller with zero resilience. Try the Shopify search
            // fallback before giving up: a strict-category term ("lube") is the
            // highest-intent kind of query, so it gets the same fallback as the
            // non-strict path below, not silence.
            return await fallbackSearch(query, limit, priceMax, 'no-base-results')
          }

          // filtered-to-zero: the keyword DID match the catalog and only the
          // extra filters emptied it. Returning nothing here is how a caller
          // saying the two most ordinary things in a row, "a vibrator", "with
          // a partner", got zero results out of 696 vibrators. Audience tag
          // coverage is the reason: 2 of 696 vibrator-dial products carry
          // `couples` and 0 carry `for-him`, so ANDing an audience tag against
          // a category dial is very nearly a guaranteed empty set.
          //
          // Audience is a soft preference, not a hard spec, the same reasoning
          // mattersTags already documents above. Drop it and retry once before
          // giving up. Category, dial and price stay: those are the filters a
          // caller would actually notice being ignored.
          const relaxed = await retryWithoutAudienceTags({
            client, baseConditions, filterConditions, groqParams,
            tags, boosts, candidatePool,
          })
          if (relaxed === null) {
            // Ticket #1269: the relax retry found nothing either. Last resort
            // before returning silence is the Shopify fallback.
            return await fallbackSearch(query, limit, priceMax, 'filtered-to-zero')
          }
          sanityOk = true // past every Sanity query; a throw below is catalog-side
          return await hydrateAndRank(relaxed, { limit, priceMax, reason: 'relaxed-audience' })
        }
        // Ticket #1269: strict-category zero results with no extra filters to
        // blame previously returned straight to the caller. Try Shopify first.
        return await fallbackSearch(query, limit, priceMax, 'no-base-results')
      }
      // Non-strict path: try Shopify fallback. If we had extra filters and
      // Shopify is also empty, classify as filtered-to-zero when filters were active.
      return await fallbackSearch(query, limit, priceMax, hasExtraFilters ? 'filtered-to-zero' : 'no-base-results')
    }

    sanityOk = true // past every Sanity query; anything below is catalog-side
    // Live-price budget filter, then rank by margin × inventory with enough
    // randomness to keep variety. Sanity has already filtered for context
    // relevance (the candidate pool is "products that match this query");
    // within that pool, prefer items that make us money AND are sellable.
    //
    // A non-empty hydrated pool emptied by the price filter is honestly
    // filtered-to-zero, which hydrateAndRank reports.
    return await hydrateAndRank(sanityResults, { limit, priceMax, reason: 'matched' })
  } catch (err) {
    if (sanityOk) {
      // Sanity returned candidates; the throw is a Shopify hydration/pricing
      // failure. Do not mislabel it 'sanity-unavailable', and do not attempt the
      // Shopify fallback that would fail the same way. Surface it as its own
      // outage so the model apologizes instead of claiming there are no results.
      console.error('[ivr-search] catalog hydration failed after Sanity returned:', err)
      await captureSearchOutage('searchForIvr', 'catalog-unavailable', err)
      return { cards: [], reason: 'catalog-unavailable' }
    }
    console.error('[ivr-search] Sanity search failed, falling back to Shopify:', err)
    await captureSearchOutage('searchForIvr', 'sanity-unavailable', err)
    return await fallbackSearch(query, limit, priceMax, 'sanity-unavailable')
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
  const inStock = cards.filter((c) => c.inStock)
  const outOfStock = cards.filter((c) => !c.inStock)
  if (cards.length <= limit) {
    // Ticket #1270: the whole pool fits under `limit`, so nothing is being
    // dropped either way, but out-of-stock items were previously shuffled in
    // among in-stock ones instead of trailing them. When a caller only reads
    // out the first couple of results (voice truncates), that put a sold-out
    // item ahead of a sellable one for no reason. In-stock leads, out-of-stock
    // still shows (never invent products to hit `limit`) but trails so the
    // card/prose can say sold out on it.
    return [...shuffle(inStock), ...shuffle(outOfStock)]
  }
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
 * Discovery has no free-text query, only structured filters, so the Shopify
 * search fallback (ticket #1269) needs a search string built out of the
 * filters that were passed. Joins the terms most likely to match Shopify
 * title/tag/description text: the type dial and category are closest to a
 * real product noun, mood/useCase/features are looser signals. Returns an
 * empty string when there is nothing to search on (a discover call with no
 * filters at all), which the caller treats as "no fallback possible".
 */
function buildDiscoverFallbackQuery(opts: IvrDiscoverOpts): string {
  const terms = [
    opts.productTypeDial,
    opts.category,
    ...(opts.mood ?? []),
    ...(opts.useCase ?? []),
    ...(opts.features ?? []),
  ].filter((t): t is string => Boolean(t && t.trim().length > 0))
  return terms.join(' ')
}

/**
 * discoverForIvrWithDiagnostics — structured-filter discovery with reason code.
 */
export async function discoverForIvrWithDiagnostics(opts: IvrDiscoverOpts): Promise<SearchDiagnostics> {
  const { mood, experience, useCase, features, category, priceMax, limit = 3, productTypeDial, productSubtypeDial } = opts
  const client = getSanityClient()

  if (!client) {
    await captureSearchOutage('discoverForIvr', 'sanity-unavailable')
    // Ticket #1269: discoverForIvrWithDiagnostics used to return straight to
    // the caller with zero resilience when the Sanity client was unavailable.
    // Fall back to a Shopify keyword search built from the structured filters.
    const fallbackQuery = buildDiscoverFallbackQuery(opts)
    if (!fallbackQuery) return { cards: [], reason: 'sanity-unavailable' }
    return await fallbackSearch(fallbackQuery, limit, priceMax, 'sanity-unavailable')
  }

  // Only a NARROWING filter (category / priceMax / productTypeDial) can reduce
  // an otherwise-matching pool to zero, so it is the sole signal for telling
  // "filtered-to-zero" from "no-base-results" below.
  const hasNarrowingFilters = Boolean(category || priceMax != null || productTypeDial)

  // Distinguishes a Sanity-layer failure from a downstream Shopify hydration
  // failure; see the twin flag in searchForIvrWithDiagnostics.
  let sanityOk = false

  try {
    const conditions: string[] = [
      '_type == "productPage"',
      'archived != true',
      'hiddenUntilLive != true',
    ]
    const groqParams: Record<string, unknown> = {}
    const boostClauses: string[] = []

    // Enrichment-dependent filters are soft: an un-enriched product (empty or
    // missing tag array) stays IN the pool rather than being invisible —
    // coverage is partial (57-82% depending on field), so hard AND filters hid
    // large slices of the catalog. coalesce matters: count(missingField) is
    // null in GROQ and null == 0 is false, so without it a doc missing the
    // field entirely fails even the "no constraint" escape. Boost clauses are
    // unchanged, so genuinely-matching enriched products still rank first.
    if (mood && mood.length > 0) {
      const moodOr = mood.map((_, i) => `$mood${i} in moodTags`).join(' || ')
      conditions.push(`(count(coalesce(moodTags, [])) == 0 || ${moodOr})`)
      mood.forEach((m, i) => {
        groqParams[`mood${i}`] = m
        boostClauses.push(`boost($mood${i} in moodTags, 3)`)
      })
    }

    if (experience) {
      conditions.push('(count(coalesce(ivrExperience, [])) == 0 || $exp in ivrExperience)')
      groqParams.exp = experience
      boostClauses.push('boost($exp in ivrExperience, 4)')
    }

    if (useCase && useCase.length > 0) {
      const ucOr = useCase.map((_, i) => `$uc${i} in ivrUseCase`).join(' || ')
      conditions.push(`(count(coalesce(ivrUseCase, [])) == 0 || ${ucOr})`)
      useCase.forEach((u, i) => {
        groqParams[`uc${i}`] = u
        boostClauses.push(`boost($uc${i} in ivrUseCase, 3)`)
      })
    }

    if (features && features.length > 0) {
      const featOr = features.map((_, i) => `$feat${i} in ivrFeatures`).join(' || ')
      conditions.push(`(count(coalesce(ivrFeatures, [])) == 0 || ${featOr})`)
      features.forEach((f, i) => {
        groqParams[`feat${i}`] = f
        boostClauses.push(`boost($feat${i} in ivrFeatures, 2)`)
      })
    }

    if (category) {
      conditions.push('$cat in category')
      groqParams.cat = category
    }

    // priceMax intentionally absent from GROQ: applied post-hydration below.
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

    const groq = `*[${filter}] ${scoreClause} [0...${pricedPoolSize(limit, priceMax)}] {
      "handle": shopifyHandle,
      title,
      category,
      tagline
    }`

    const sanityResults = await cachedGroqFetch<
      { handle: string; title: string; category: string | null; tagline: string | null }[]
    >(client, groq, groqParams)

    if (!sanityResults || sanityResults.length === 0) {
      // 'filtered-to-zero' is only meaningful when a NARROWING filter
      // (category / productTypeDial / subtypeDial) could be the reducer — those
      // are the clauses in the GROQ that can empty an otherwise-matching pool.
      // When one is present, re-run the base query with those clauses stripped:
      // if the base would have matched, the narrowing filters emptied it
      // (filtered-to-zero); if not, there is genuinely no base result. With no
      // narrowing filter there is nothing to blame, so it is 'no-base-results'.
      // (Previously this only ran when BOTH primary and narrowing filters were
      // present, and the else-branch was a dead `x ? a : a` ternary that lost
      // the distinction for narrowing-only queries — the bug this fixes.)
      if (hasNarrowingFilters) {
        const baseConditions = conditions.filter(
          (c) =>
            !c.includes('$cat') &&
            !c.includes('price <=') &&
            !c.includes('productTypeDial') &&
            !c.includes('productSubtypeDial'),
        )
        // baseConditions always retains the _type/archived/hiddenUntilLive
        // guards, so the query is well-formed even with no primary filters.
        const baseFilter = baseConditions.join(' && ')
        const baseGroq = `*[${baseFilter}] [0...1] { "handle": shopifyHandle }`
        const baseCheck = await cachedGroqFetch<{ handle: string }[]>(client, baseGroq, groqParams)
        const reason = baseCheck.length > 0 ? 'filtered-to-zero' : 'no-base-results'
        return { cards: [], reason }
      }
      return { cards: [], reason: 'no-base-results' }
    }

    const handles = sanityResults.map((r) => r.handle).filter(Boolean)
    sanityOk = true // past every Sanity query; anything below is catalog-side
    const shopifyProducts = await getProductsByHandles(handles)
    const shopifyMap = new Map<string, Product>(shopifyProducts.map((p) => [p.handle, p]))

    const cards: IvrProductCard[] = []
    const missed: string[] = []
    for (const sr of sanityResults) {
      const product = shopifyMap.get(sr.handle)
      if (!product) { missed.push(sr.handle); continue }
      cards.push(toIvrCard(product, { tagline: sr.tagline ?? undefined, category: sr.category ?? undefined }))
    }
    logHydrationMisses('discoverForIvr', missed)

    // Ticket #1270: this used to be a plain `.slice(0, limit)` on the
    // Sanity-score-ordered pool, so an out-of-stock item ranked ahead of an
    // in-stock one whenever Sanity's relevance score said so. Route through
    // the same in-stock-first, margin-weighted selection the keyword search
    // uses so stock honesty is not just a searchForIvr behavior.
    const priced = applyPriceMax(cards, priceMax)
    const ranked = marginWeightedSelect(priced, limit)
    // Cards existed but the live-price filter emptied them: filtered-to-zero.
    return { cards: ranked, reason: ranked.length > 0 ? 'matched' : 'filtered-to-zero' }
  } catch (err) {
    if (sanityOk) {
      // Sanity returned candidates; the throw is a Shopify hydration failure, not
      // a Sanity outage. Keep it distinct so it is neither mislabeled nor read as
      // "no results".
      console.error('[ivr-search] catalog hydration failed after Sanity returned (discover):', err)
      await captureSearchOutage('discoverForIvr', 'catalog-unavailable', err)
      return { cards: [], reason: 'catalog-unavailable' }
    }
    console.error('[ivr-search] Sanity discover failed:', err)
    await captureSearchOutage('discoverForIvr', 'sanity-unavailable', err)
    // Ticket #1269: true Sanity failure (not just zero results) used to return
    // straight to the caller too. Same fallback as the client-null branch above.
    const fallbackQuery = buildDiscoverFallbackQuery(opts)
    if (!fallbackQuery) return { cards: [], reason: 'sanity-unavailable' }
    return await fallbackSearch(fallbackQuery, limit, priceMax, 'sanity-unavailable')
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
