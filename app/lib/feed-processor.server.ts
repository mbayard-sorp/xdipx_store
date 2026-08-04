import { parse } from 'csv-parse/sync'
import { kvGet, kvSet, KV_KEYS } from './kv.server'
import { db } from './db.server'
import { dealHistory, pipelineSettings } from '../../db/schema'
import { eq } from 'drizzle-orm'
import type { NalpacProduct, ProductScore } from '~/types'

const FEED_TTL = 23 * 60 * 60 // 23 hours

export async function getPipelineSetting(key: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ value: pipelineSettings.value })
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, key))
      .limit(1)
    return rows[0]?.value ?? null
  } catch {
    return null
  }
}

// ─── Text cleaning ─────────────────────────────────────────────────────────

export function cleanDescription(raw: string): string {
  // Fix apostrophes: "doesn'ft." -> "doesn't"
  let clean = raw.replace(/(\w)ft\./g, "$1'")
  // Fix quotes: `in.` after non-digits -> `"`
  // IMPORTANT: do NOT replace "in." after digits — those are inches
  clean = clean.replace(/(?<!\d)in\./g, '"')
  return clean.replace(/\s+/g, ' ').trim()
}

// ─── Feed fetch ────────────────────────────────────────────────────────────

export async function fetchNalpacFeed(): Promise<NalpacProduct[]> {
  // Try cache first
  const cached = await kvGet<NalpacProduct[]>(KV_KEYS.feedCache)
  if (cached) return cached

  const feedUrl = await getPipelineSetting('feedUrl') || process.env['NALPAC_FEED_URL'] || ''
  if (!feedUrl) throw new Error('No feed URL configured. Set NALPAC_FEED_URL env var or configure in Admin → Settings.')

  const res = await fetch(feedUrl)
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`)
  const csv = await res.text()

  const records = parse(csv, {
    columns:          true,
    skip_empty_lines: true,
    trim:             true,
  }) as NalpacProduct[]

  await kvSet(KV_KEYS.feedCache, records, FEED_TTL)
  await kvSet(KV_KEYS.feedCacheTimestamp, new Date().toISOString())
  return records
}

// ─── Discontinued detection ────────────────────────────────────────────────

/**
 * Nalpac flags products as "discontinued" in the feed when the manufacturer
 * has stopped shipping. We skip these on import and archive any matching
 * already-imported products in the daily cron sweep.
 *
 * Match rules (in order — Sub-Category and Product Type FIRST to reduce
 * false positives from descriptive copy):
 *   - Sub-Category contains case-insensitive `\bdiscontinued\b`
 *   - Product Title contains the marker
 *   - "DISC" or "DC" present as a standalone token (not as part of "disc"
 *     describing a CD-shaped object — require word boundaries)
 *   - Description as a tiebreaker, only when no other field had signal
 */
export function isDiscontinued(product: NalpacProduct | { 'Sub-Category'?: string; 'Product Title'?: string; 'Product Description'?: string }): boolean {
  const fields = [
    product['Sub-Category'] ?? '',
    product['Product Title'] ?? '',
  ]
  for (const f of fields) {
    if (/\bdiscontinued\b/i.test(f)) return true
    if (/\b(DISC|DC)\b/.test(f)) return true
  }
  // Description tiebreaker — only if explicitly says discontinued
  // (avoid false positives like "won't be discontinued any time soon").
  const desc = product['Product Description'] ?? ''
  if (/\bdiscontinued by manufacturer\b/i.test(desc)) return true
  if (/\bproduct (?:has been |is )?discontinued\b/i.test(desc)) return true
  return false
}

// ─── Category helpers ──────────────────────────────────────────────────────

export function parseCategories(raw: string): string[] {
  return raw.split(',').map(c => c.trim()).filter(Boolean)
}

/** The four top-level menu sections. Exactly one applies per product. */
export type Section = 'pleasure' | 'play' | 'body' | 'wear'
export const SECTION_VALUES: readonly Section[] = ['pleasure', 'play', 'body', 'wear'] as const

// Keyword groups, checked in order: play -> wear -> body -> (default) pleasure.
// Distinct/compound terms first so e.g. "strap-on" lands in play before "dildo"
// would pull it to pleasure. Lowercase, matched as substrings.
const SECTION_KEYWORDS: ReadonlyArray<{ section: Section; words: readonly string[] }> = [
  { section: 'play', words: ['bondage', 'bdsm', 'restraint', 'handcuff', 'cuff', 'paddle', 'flogger', 'whip', 'crop', 'gag', 'blindfold', 'collar', 'leash', 'chastity', 'cage', 'harness', 'strap-on', 'strapon', 'rope', 'shibari', 'spank', 'kink', 'fetish play', 'role-play', 'roleplay', 'role play', 'furniture', 'sling', 'swing', 'wartenberg', 'nipple clamp', 'clamp', 'electrostim', 'e-stim', 'game'] },
  { section: 'wear', words: ['lingerie', 'babydoll', 'chemise', 'bodysuit', 'bodystocking', 'teddy', 'corset', 'bustier', 'garter', 'stocking', 'hosiery', 'fishnet', 'pasties', 'pasty', 'panty', 'pantie', 'thong', 'g-string', 'bra ', 'bra-', 'bra set', 'underwear', 'boxer', 'brief', 'jock', 'apparel', 'dress', 'robe', 'kimono', 'fetishwear', 'leatherwear', 'costume'] },
  { section: 'body', words: ['lubricant', 'lube', 'massage oil', 'massage candle', 'candle', 'arousal', 'desensitiz', 'enhancer', 'oral enhancer', 'cleaner', 'toy cleaner', 'pheromone', 'wipe', 'hygiene', 'douche', 'enema', 'kegel', 'extender', 'cbd', 'supplement', ' pill', 'gummies', 'gummy', 'gel', 'cream', 'lotion', 'balm', 'spray', 'oil', 'powder', 'edible body'] },
]

/**
 * Deterministically map a product to exactly one top-level menu section.
 *
 * Section is a function of the Shopify product Type (when set), with a fallback
 * to keyword matching across type + categories + title, and a productTypeDial
 * nudge. Never returns empty — the homepage menu requires one section per
 * product. Default bucket is `pleasure` (the largest catalog segment).
 */
export function deriveSection(input: {
  productType?:     string | null | undefined
  categories?:      readonly string[] | null | undefined
  productTypeDial?: string | null | undefined
  title:            string
}): Section {
  const hay = [
    input.productType ?? '',
    (input.categories ?? []).join(' '),
    input.title ?? '',
  ].join(' ').toLowerCase()

  for (const { section, words } of SECTION_KEYWORDS) {
    if (words.some(w => hay.includes(w))) return section
  }

  // productTypeDial nudge for body/wear when keywords missed (dial has no 'play').
  const dial = (input.productTypeDial ?? '').toLowerCase()
  if (dial === 'lube' || dial === 'massage' || dial === 'enhancer' || dial === 'wellness' || dial === 'condom') return 'body'
  if (dial === 'wear') return 'wear'

  return 'pleasure'
}

function getImages(product: NalpacProduct): string[] {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map(i => product[`Image ${i}` as keyof NalpacProduct] as string)
    .filter(Boolean)
}

const SKU_NEEDS_IMAGEN = new Set<string>()
function flagForImagenGeneration(sku: string): void { SKU_NEEDS_IMAGEN.add(sku) }
export function getSKUsNeedingImagen(): string[] { return [...SKU_NEEDS_IMAGEN] }

// ─── Scoring ───────────────────────────────────────────────────────────────

function isEligible(
  product: NalpacProduct,
  recentSkus: Set<string>,
  blockedBrands: Set<string>,
): boolean {
  const qty      = parseInt(product['Total qty available'] ?? '0')
  const wholesale = parseFloat(product['Wholesale'] ?? '0')
  const msrp     = parseFloat(product['MSRP'] ?? '0')
  const brandBlocked = blockedBrands.has(product.Brand.toLowerCase().trim())
  return qty >= 20 && wholesale > 0 && msrp > 0 && !recentSkus.has(product.SKU) && !brandBlocked
}

export function scoreProduct(
  product: NalpacProduct,
  recentSkus: Set<string>,
  recentCategories: string[][],
  blockedBrands: Set<string> = new Set(),
): ProductScore | null {
  if (!isEligible(product, recentSkus, blockedBrands)) return null

  const wholesale   = parseFloat(product['Wholesale'])
  const msrp        = parseFloat(product['MSRP'])
  const map         = parseFloat(product['MAP'] ?? '0') || 0
  const qty         = parseInt(product['Total qty available'])
  const images      = getImages(product)
  const categories  = parseCategories(product['Sub-Category'])

  // 1. Profitability (35%) — gross margin at MSRP: (MSRP - wholesale) / MSRP = 1 - wholesale/MSRP
  const profScore = (msrp - wholesale) / msrp

  // 2. Deal-ability (30%)
  let dealScore: number
  let dealPrice: number
  let discountPct: number
  let mapType: ProductScore['mapType']

  if (map === 0) {
    dealPrice   = Math.max(wholesale * 1.4, msrp * 0.55)
    discountPct = ((msrp - dealPrice) / msrp) * 100
    dealScore   = 1.0
    mapType     = 'no-map'
  } else if (map < msrp) {
    dealPrice   = map
    discountPct = ((msrp - map) / msrp) * 100
    dealScore   = Math.min(discountPct / 30, 1.0)
    mapType     = 'below-msrp'
  } else {
    // map >= msrp: no advertised discount; price at MAP (covers the odd feed
    // rows where MAP sits above MSRP, which pricing at MSRP would violate)
    dealPrice   = map
    discountPct = 0
    dealScore   = 0.05  // MAP = MSRP — accessories only
    mapType     = 'equals-msrp'
  }

  // 3. Inventory (20%)
  const invScore =
    qty < 50    ? 0.4 :
    qty <= 250  ? 1.0 :
    qty <= 600  ? 0.8 : 0.65

  // 4. Image richness (10%)
  if (images.length < 3) flagForImagenGeneration(product.SKU)
  const imgScore = Math.min(images.length / 8, 1.0)

  // 5. Category freshness (5%)
  const overlap = categories.filter(c =>
    recentCategories.flat().includes(c),
  ).length
  const catScore = Math.pow(0.70, overlap)

  const score = (profScore * 0.35) + (dealScore * 0.30) + (invScore * 0.20)
              + (imgScore * 0.10) + (catScore * 0.05)

  return {
    sku:          product.SKU,
    title:        cleanDescription(product['Product Title']),
    brand:        product.Brand,
    description:  cleanDescription(product['Product Description'] ?? ''),
    score,
    msrp:         Math.round(msrp * 100) / 100,
    wholesaleCost: Math.round(wholesale * 100) / 100,
    mapPrice:     Math.round(map * 100) / 100,
    dealPrice:    Math.round(dealPrice * 100) / 100,
    discountPct:  Math.round(discountPct * 10) / 10,
    profitPerUnit: Math.round((dealPrice - wholesale) * 100) / 100,
    qty,
    mapType,
    images,
    categories,
  }
}

// ─── Main pipeline ─────────────────────────────────────────────────────────

export interface DiscontinuedSweepResult {
  flagged:       number
  archived:      number
  alreadyArchived: number
  notImported:   number
  errors:        Array<{ sku: string; message: string }>
}

/**
 * Nightly catalog hygiene: find every SKU the Nalpac feed now marks
 * discontinued and archive the matching already-imported product.
 *
 * This used to be one step of `dailyFeedProcessor`, which also scored the feed
 * and staged the next day's daily deal into KV. Daily deals are retired, so the
 * scoring half is gone and only the sweep remains. `scoreProduct` is still
 * exported for the product-manager chat tools.
 */
export async function runDiscontinuedSweep(): Promise<{
  discontinuedSkus: string[]
  discontinuedSweep: DiscontinuedSweepResult
}> {
  const products = await fetchNalpacFeed()

  const discontinuedSkus = products.filter(isDiscontinued).map(p => p.SKU)

  const discontinuedSweep = await archiveDiscontinuedProducts(discontinuedSkus)
  console.info(
    `[feed-processor] discontinued sweep: ${discontinuedSweep.flagged} flagged, ` +
    `${discontinuedSweep.archived} archived, ${discontinuedSweep.alreadyArchived} already-archived, ` +
    `${discontinuedSweep.notImported} not-imported, ${discontinuedSweep.errors.length} errors`,
  )

  return { discontinuedSkus, discontinuedSweep }
}

/**
 * For each SKU flagged as discontinued by the latest Nalpac feed, look up the
 * product in dealHistory + Shopify and archive it. Idempotent — products that
 * are already archived are reported as alreadyArchived and not re-written.
 *
 * Best-effort per-product: errors are collected, not thrown, so one bad SKU
 * doesn't kill the cron.
 */
export async function archiveDiscontinuedProducts(skus: string[]): Promise<DiscontinuedSweepResult> {
  const result: DiscontinuedSweepResult = {
    flagged:         skus.length,
    archived:        0,
    alreadyArchived: 0,
    notImported:     0,
    errors:          [],
  }
  if (skus.length === 0) return result

  // Lazy-import to keep this module dependency-free for callers that only
  // want isDiscontinued (e.g. the bulk-import skip path).
  const { archiveShopifyProduct } = await import('./shopify.server')
  const { upsertProductPage } = await import('./sanity.server').catch(() => ({ upsertProductPage: null }))

  for (const sku of skus) {
    try {
      const rows = await db
        .select({
          shopifyProductId: dealHistory.shopifyProductId,
          status:           dealHistory.status,
        })
        .from(dealHistory)
        .where(eq(dealHistory.sku, sku))
        .limit(1)

      const row = rows[0]
      if (!row) {
        result.notImported++
        continue
      }
      if (row.status === 'archived') {
        result.alreadyArchived++
        continue
      }
      if (!row.shopifyProductId) {
        result.errors.push({ sku, message: 'dealHistory row has no shopifyProductId — cannot archive' })
        continue
      }

      // Best-effort: archive Shopify product status + metafield + DB row + Sanity.
      const archived = await archiveShopifyProduct(row.shopifyProductId, 'discontinued by manufacturer')
      await db
        .update(dealHistory)
        .set({ status: 'archived' })
        .where(eq(dealHistory.sku, sku))

      // Mirror to Sanity productPage. Best-effort — Sanity hiccup shouldn't
      // unwind the Shopify archive.
      if (upsertProductPage && archived?.handle) {
        try {
          await upsertProductPage({
            handle:           archived.handle,
            shopifyProductId: `gid://shopify/Product/${row.shopifyProductId}`,
            archived:         true,
          })
        } catch (err) {
          console.warn(`[feed-processor] archive-discontinued: sanity sync ${sku} failed:`, err instanceof Error ? err.message : err)
        }
      }
      result.archived++
    } catch (err) {
      result.errors.push({ sku, message: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}

export function buildTags(product: NalpacProduct): string[] {
  const cats = parseCategories(product['Sub-Category'])
  const tags: string[] = cats.map(c => `cat:${c.toLowerCase().replace(/\s+/g, '-')}`)

  const forHimCats  = ['Vagina Strokers', 'Body Molds', 'Prostate Toys', 'Masturbators', 'Hands-Free Masturbators']
  const forHerCats  = ['Dual Action and Rabbits', 'Finger and Clit', 'Air Pulse and Suction', 'Bullets and Eggs']
  const coupleCats  = ['Couples and Wearable', 'Remote', 'Top Couples Toys', 'Restraints']

  if (cats.some(c => forHimCats.includes(c)))   tags.push('for-him')
  if (cats.some(c => forHerCats.includes(c)))   tags.push('for-her')
  if (cats.some(c => coupleCats.includes(c)))   tags.push('for-couples')

  tags.push(`brand:${product.Brand.toLowerCase().replace(/\s+/g, '-')}`)
  tags.push(`nalpac-sku-${product.SKU}`)

  const price = parseFloat(product['MSRP'])
  tags.push(
    price < 25  ? 'price:under-25'  :
    price < 50  ? 'price:25-50'     :
    price < 100 ? 'price:50-100'    : 'price:100-plus',
  )

  return tags
}
