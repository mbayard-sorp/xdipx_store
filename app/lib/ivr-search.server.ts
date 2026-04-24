/**
 * IVR-optimized product search via Sanity GROQ with Shopify price hydration.
 *
 * Returns compact cards (~80-100 tokens each) tuned for voice: title, tagline,
 * category, MAP-cleared price, and variant GIDs. Falls back to Shopify
 * Storefront search if Sanity is unavailable.
 */
import { createClient } from '@sanity/client'
import { buildQueryPatterns, fieldMatchAny } from './search.server'
import { applyMapRule, type DisplayPrice } from './ai-agent/tools.server'
import { getProductsByHandles, searchProducts as shopifySearch } from './shopify.server'
import { normalizeForTTS } from './tts-normalize'
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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IvrProductCard {
  title: string
  handle: string
  category: string
  tagline: string
  voiceSummary: string
  inStock: boolean
  price: number
  pctOff: number
  phrasing: DisplayPrice['phrasing']
  variantId: string
  variantOptions?: { variantId: string; label: string; price: number; inStock: boolean }[]
}

export interface IvrSearchOpts {
  query: string
  limit?: number | undefined
  category?: string | undefined
  priceMax?: number | undefined
  tags?: string[] | undefined
}

export interface IvrDiscoverOpts {
  mood?: string[] | undefined
  experience?: string | undefined
  useCase?: string[] | undefined
  features?: string[] | undefined
  category?: string | undefined
  priceMax?: number | undefined
  limit?: number | undefined
}

// ─── Shopify product → compact IVR card ──────────────────────────────────────

function toIvrCard(
  p: Product,
  sanityFields?: { tagline?: string | undefined; category?: string | undefined; voiceSummary?: string | undefined },
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

  // Belt-and-suspenders: normalize on read as well so Sanity docs authored
  // before the write-side fix still sound clean when Claude speaks them.
  return {
    title: normalizeForTTS(p.title),
    handle: p.handle,
    category: sanityFields?.category ?? p.category ?? '',
    tagline: normalizeForTTS(sanityFields?.tagline ?? p.metaDescription ?? ''),
    voiceSummary: normalizeForTTS(sanityFields?.voiceSummary ?? ''),
    inStock: inStockVariants.length > 0,
    price: disp.price,
    pctOff: disp.pctOffMsrp,
    phrasing: disp.phrasing,
    variantId: defaultVariant?.id ?? '',
    ...(variantOptions ? { variantOptions } : {}),
  }
}

// ─── Keyword search (replaces searchProducts backend) ────────────────────────

export async function searchForIvr(opts: IvrSearchOpts): Promise<IvrProductCard[]> {
  const { query, limit = 3, category, priceMax, tags } = opts
  const client = getSanityClient()

  if (!client) return shopifyFallback(query, limit)

  try {
    const patterns = buildQueryPatterns(query)
    if (patterns.length === 0) return []

    const paramNames = patterns.map((_, i) => `q${i}`)
    const groqParams: Record<string, unknown> = {}
    patterns.forEach((p, i) => { groqParams[`q${i}`] = p })

    const conditions: string[] = [
      '_type == "productPage"',
      'archived != true',
    ]

    const titleMatch = fieldMatchAny('title', paramNames)
    const taglineMatch = fieldMatchAny('tagline', paramNames)
    const vendorMatch = fieldMatchAny('vendor', paramNames)
    const categoryMatch = fieldMatchAny('category', paramNames)
    const descMatch = fieldMatchAny('pt::text(description)', paramNames)
    const seoMatch = fieldMatchAny('seoDescription', paramNames)
    conditions.push(
      `(${titleMatch} || ${taglineMatch} || ${vendorMatch} || ${categoryMatch} || ${descMatch} || ${seoMatch})`,
    )

    if (category) {
      conditions.push('category == $cat')
      groqParams.cat = category
    }
    if (priceMax != null) {
      conditions.push('price <= $priceMax')
      groqParams.priceMax = priceMax
    }
    if (tags && tags.length > 0) {
      for (let i = 0; i < tags.length; i++) {
        conditions.push(`$tag${i} in tags`)
        groqParams[`tag${i}`] = tags[i]
      }
    }

    const filter = conditions.join(' && ')
    const boosts = [
      ...paramNames.map((n) => `boost(title match $${n}, 5)`),
      ...paramNames.map((n) => `boost(tagline match $${n}, 3)`),
      ...paramNames.map((n) => `boost(vendor match $${n}, 2)`),
      ...paramNames.map((n) => `boost(category match $${n}, 1)`),
      ...paramNames.map((n) => `boost(pt::text(description) match $${n}, 1)`),
    ].join(', ')

    const groq = `*[${filter}] | score(${boosts}) [0...${limit}] {
      "handle": shopifyHandle,
      title,
      category,
      tagline,
      ivrVoiceSummary
    }`

    const sanityResults = await client.fetch<
      { handle: string; title: string; category: string | null; tagline: string | null; ivrVoiceSummary: string | null }[]
    >(groq, groqParams)

    if (!sanityResults || sanityResults.length === 0) return shopifyFallback(query, limit)

    const handles = sanityResults.map((r) => r.handle).filter(Boolean)
    const shopifyProducts = await getProductsByHandles(handles)
    const shopifyMap = new Map<string, Product>(shopifyProducts.map((p) => [p.handle, p]))

    const cards: IvrProductCard[] = []
    for (const sr of sanityResults) {
      const product = shopifyMap.get(sr.handle)
      if (!product) continue
      cards.push(toIvrCard(product, { tagline: sr.tagline ?? undefined, category: sr.category ?? undefined, voiceSummary: sr.ivrVoiceSummary ?? undefined }))
    }

    return cards
  } catch (err) {
    console.error('[ivr-search] Sanity search failed, falling back to Shopify:', err)
    return shopifyFallback(query, limit)
  }
}

// ─── Discovery search (structured filters, no free-text) ─────────────────────

export async function discoverForIvr(opts: IvrDiscoverOpts): Promise<IvrProductCard[]> {
  const { mood, experience, useCase, features, category, priceMax, limit = 3 } = opts
  const client = getSanityClient()

  if (!client) return []

  try {
    const conditions: string[] = [
      '_type == "productPage"',
      'archived != true',
    ]
    const groqParams: Record<string, unknown> = {}
    const boostClauses: string[] = []

    if (mood && mood.length > 0) {
      const moodOr = mood.map((_, i) => `$mood${i} in ivrMood`).join(' || ')
      conditions.push(`(${moodOr})`)
      mood.forEach((m, i) => {
        groqParams[`mood${i}`] = m
        boostClauses.push(`boost($mood${i} in ivrMood, 3)`)
      })
    }

    if (experience) {
      conditions.push('ivrExperience == $exp')
      groqParams.exp = experience
      boostClauses.push('boost(ivrExperience == $exp, 4)')
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
      conditions.push('category == $cat')
      groqParams.cat = category
    }

    if (priceMax != null) {
      conditions.push('price <= $priceMax')
      groqParams.priceMax = priceMax
    }

    const filter = conditions.join(' && ')
    const scoreClause = boostClauses.length > 0
      ? `| score(${boostClauses.join(', ')})`
      : ''

    const groq = `*[${filter}] ${scoreClause} [0...${limit}] {
      "handle": shopifyHandle,
      title,
      category,
      tagline,
      ivrVoiceSummary
    }`

    const sanityResults = await client.fetch<
      { handle: string; title: string; category: string | null; tagline: string | null; ivrVoiceSummary: string | null }[]
    >(groq, groqParams)

    if (!sanityResults || sanityResults.length === 0) return []

    const handles = sanityResults.map((r) => r.handle).filter(Boolean)
    const shopifyProducts = await getProductsByHandles(handles)
    const shopifyMap = new Map<string, Product>(shopifyProducts.map((p) => [p.handle, p]))

    const cards: IvrProductCard[] = []
    for (const sr of sanityResults) {
      const product = shopifyMap.get(sr.handle)
      if (!product) continue
      cards.push(toIvrCard(product, { tagline: sr.tagline ?? undefined, category: sr.category ?? undefined, voiceSummary: sr.ivrVoiceSummary ?? undefined }))
    }

    return cards
  } catch (err) {
    console.error('[ivr-search] Sanity discover failed:', err)
    return []
  }
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
