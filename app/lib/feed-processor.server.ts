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
  // IMPORTANT: do NOT replace "in." after digits, those are inches
  clean = clean.replace(/(?<!\d)in\./g, '"')
  return clean.replace(/\s+/g, ' ').trim()
}

// ─── Charter cleanup for already-stored PDP copy ───────────────────────────
// Ticket #3010: the voice charter bans em-dashes everywhere, and Emma is an
// AI guide with no lived experience (never "tried/tested/used/owns it"). Both
// leaked into published product descriptionHtml via the enrichment pipeline.
// This does not touch the Nalpac feed at all, it fixes already-written Emma
// copy, so it lives next to cleanDescription rather than inside it.

// The recurring enrichment template wrote "Pro tip from someone who's tested
// plenty:" as its aside lead-in, which is Emma claiming to have personally
// tested the product. Strip only that clause; the surrounding "Pro tip:" /
// "My tip?" lead-in and the following colon are untouched.
const LIVED_EXPERIENCE_CLAUSE_RE =
  /\s*from someone who(?:'s|\s+is|\s+has been)?\s+[a-z](?:[a-z' ]*[a-z])?(?=[:,.]|<\/em>|<\/strong>)/gi

// Two em-dashes bracketing a short aside ("known for — up to 6,300 RPM —
// with...") read as a parenthetical, so both become commas.
function collapseDoubleDash(input: string): string {
  return input.replace(/\s*—\s*([^—<]{1,120}?)\s*—\s*/g, ', $1, ')
}

// The dominant template pattern is "<em>tip aside</em> — justification
// clause". The clause after the dash is always its own thought, so this
// becomes "<em>tip aside.</em> Justification clause" (capitalized, and no
// double period if the aside already ends in terminal punctuation).
function fixEmphasisCloseDash(input: string): string {
  const re = /([^\s<])(\s*)<\/em>(\s*)—(\s*)/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) {
    out += input.slice(last, m.index)
    const lastChar = m[1]!
    out += (/[.?!]/.test(lastChar) ? lastChar : lastChar + '.') + '</em> '
    last = m.index + m[0].length
  }
  out += input.slice(last)
  return out.replace(/([.?!])<\/em> ([a-z])/g, (_full, punct, ch) => `${punct}</em> ${ch.toUpperCase()}`)
}

// Any remaining single em-dash in this catalog's copy is a mid-sentence
// appositive or modifying phrase (verified against a live sample per ticket
// #3010), so it becomes a comma. Nothing after it starts a new sentence, so
// case is left untouched.
function replaceRemainingDashes(input: string): string {
  return input.replace(/\s*—\s*/g, ', ')
}

function squeezePunctuationWhitespace(input: string): string {
  return input.replace(/ {2,}/g, ' ').replace(/ ,/g, ',').replace(/,\s*,/g, ',')
}

/**
 * Fixes the two live PDP charter violations from ticket #3010 in already-
 * published Shopify product copy (descriptionHtml): em-dashes, and the
 * "from someone who's tested/tried..." lived-experience claim. Deterministic
 * and idempotent, no AI call, safe to re-run.
 */
export function fixCharterCopy(input: string): { text: string; changed: boolean } {
  let text = input
  text = text.replace(LIVED_EXPERIENCE_CLAUSE_RE, '')
  text = collapseDoubleDash(text)
  text = fixEmphasisCloseDash(text)
  text = replaceRemainingDashes(text)
  text = squeezePunctuationWhitespace(text)
  return { text, changed: text !== input }
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
export interface DiscontinuedStateSweep {
  /** Carried (imported, unarchived) SKUs checked against the feeds. */
  carried:        number
  /** SKUs now in the discontinued state (absent past grace, or feed-flagged). */
  discontinued:   number
  /** Absent SKUs still inside the grace window. */
  pendingAbsence: number
  /** `xdipx.discontinued_at` written this run (first time for that SKU). */
  marked:         number
  /** Discontinued SKUs archived this run (zero stock in every location). */
  archived:       number
  /** Discontinued SKUs kept live because stock remains (clearance ladder). */
  keptWithStock:  number
  /** SKUs back in the feed; their discontinued_at was cleared. */
  returned:       number
  graceDays:      number
  errors:         Array<{ sku: string; message: string }>
}

const KV_ABSENCE_LEDGER   = 'pricing:feed-absence-ledger'
const KV_DISCONTINUED_SET = 'pricing:discontinued-written'
const DISCONTINUED_GRACE_SETTING = 'discontinued_grace_days'

/**
 * Nightly discontinued sweep (owner direction 2026-09-25).
 *
 * Old behavior: archive any carried product the feed's discontinued regex
 * matched, stock or no stock. Two problems: Nalpac does not flag discontinued
 * products (the regex matched 1 row of 18,316, a false positive), so real
 * discontinuations were never caught; and archiving hid sellable stock that
 * the clearance ladder exists to sell down.
 *
 * New behavior, in order:
 *   1. A carried SKU absent from every Nalpac feed for `discontinued_grace_days`
 *      consecutive nightly checks (default 3) is discontinued as of the first
 *      missed day. A feed-flagged row is discontinued immediately.
 *   2. Discontinued -> write `xdipx.discontinued_at` once (the v2 engine routes
 *      the product to the discontinued group's rules and starts the ladder).
 *   3. Archive only when the product is discontinued AND every variant has
 *      zero inventory across all Shopify locations. Stock stays on sale.
 *   4. A SKU back in the feed has its discontinued_at cleared.
 */
export async function runDiscontinuedSweep(): Promise<{
  discontinuedSkus: string[]
  discontinuedSweep: DiscontinuedSweepResult
  state: DiscontinuedStateSweep
}> {
  const { fetchAllNalpacFeeds } = await import('./nalpac-feeds.server')
  const { classifyFeedAbsence, DISCONTINUED_GRACE_DAYS_DEFAULT } = await import('./discontinued-state')
  const { adminGraphQL, updateProductMetafield } = await import('./shopify.server')

  const feeds = await fetchAllNalpacFeeds()
  if (feeds.errors.length > 0) {
    console.warn('[feed-processor] discontinued sweep: feed errors', feeds.errors)
  }
  const present = new Set(feeds.snapshots.keys())
  const flagged = new Set<string>()
  for (const [sku, snap] of feeds.snapshots) {
    const row = snap.raw.mainRow ?? snap.raw.saleRow
    if (row && isDiscontinued(row as { 'Sub-Category'?: string; 'Product Title'?: string; 'Product Description'?: string })) flagged.add(sku)
  }

  const graceRaw = await getPipelineSetting(DISCONTINUED_GRACE_SETTING)
  const graceDays = Math.max(1, Math.min(30, parseInt(graceRaw ?? '', 10) || DISCONTINUED_GRACE_DAYS_DEFAULT))

  const carriedRows = await db
    .select({ sku: dealHistory.sku, productId: dealHistory.shopifyProductId, status: dealHistory.status })
    .from(dealHistory)
  const productBySku = new Map<string, string>()
  for (const r of carriedRows) {
    if (r.status !== 'archived' && r.productId) productBySku.set(r.sku, r.productId)
  }
  const carried = [...productBySku.keys()]

  // A main-feed outage must not read as "everything discontinued". If the
  // feeds returned nothing usable, leave the ledger alone and do nothing.
  if (present.size === 0) {
    console.warn('[feed-processor] discontinued sweep: no feed rows; skipping')
    const empty: DiscontinuedStateSweep = { carried: carried.length, discontinued: 0, pendingAbsence: 0, marked: 0, archived: 0, keptWithStock: 0, returned: 0, graceDays, errors: [{ sku: '*', message: 'no feed rows' }] }
    return { discontinuedSkus: [], discontinuedSweep: { flagged: 0, archived: 0, alreadyArchived: 0, notImported: 0, errors: [] }, state: empty }
  }

  const ledger = (await kvGet<Record<string, string>>(KV_ABSENCE_LEDGER)) ?? {}
  const written = new Set((await kvGet<string[]>(KV_DISCONTINUED_SET)) ?? [])
  const today = new Date().toISOString().slice(0, 10)

  const cls = classifyFeedAbsence({ carried, present, flagged, ledger, today, graceDays })
  await kvSet(KV_ABSENCE_LEDGER, cls.ledger)

  const state: DiscontinuedStateSweep = {
    carried: carried.length, discontinued: cls.discontinued.length, pendingAbsence: cls.pending,
    marked: 0, archived: 0, keptWithStock: 0, returned: 0, graceDays, errors: [],
  }

  // 2. Mark the state on Shopify (once per SKU).
  for (const { sku, since } of cls.discontinued) {
    if (written.has(sku)) continue
    const productId = productBySku.get(sku)!
    try {
      await updateProductMetafield(productId, 'discontinued_at', since, 'date')
      written.add(sku)
      state.marked++
    } catch (err) {
      state.errors.push({ sku, message: `discontinued_at write: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  // 4. Back in the feed: clear the state.
  for (const sku of cls.returned) {
    if (!written.has(sku)) continue
    const productId = productBySku.get(sku)!
    try {
      await adminGraphQL(`
        mutation ClearDiscontinued($m: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $m) { userErrors { message } }
        }`, { m: [{ ownerId: `gid://shopify/Product/${productId.replace('gid://shopify/Product/', '')}`, namespace: 'xdipx', key: 'discontinued_at' }] })
      written.delete(sku)
      state.returned++
    } catch (err) {
      state.errors.push({ sku, message: `discontinued_at clear: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
  await kvSet(KV_DISCONTINUED_SET, [...written])

  // 3. Archive only at zero stock in every location. Inventory read in
  // batches of 50 products per call.
  const zeroStockSkus: string[] = []
  const disc = cls.discontinued.map(d => d.sku)
  for (let i = 0; i < disc.length; i += 50) {
    const batch = disc.slice(i, i + 50)
    const ids = batch.map(sku => `gid://shopify/Product/${productBySku.get(sku)!.replace('gid://shopify/Product/', '')}`)
    try {
      const data = await adminGraphQL<{ nodes: Array<{ id: string; status: string; variants: { nodes: Array<{ inventoryQuantity: number | null }> } } | null> }>(`
        query DiscontinuedStock($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Product { id status variants(first: 50) { nodes { inventoryQuantity } } } }
        }`, { ids })
      data.nodes.forEach((node, idx) => {
        const sku = batch[idx]!
        if (!node) return
        if (node.status === 'ARCHIVED') return
        const totalQty = node.variants.nodes.reduce((sum, v) => sum + Math.max(0, v.inventoryQuantity ?? 0), 0)
        if (totalQty === 0) zeroStockSkus.push(sku)
        else state.keptWithStock++
      })
    } catch (err) {
      state.errors.push({ sku: batch.join(','), message: `stock read: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  const discontinuedSweep = await archiveDiscontinuedProducts(zeroStockSkus)
  state.archived = discontinuedSweep.archived
  state.errors.push(...discontinuedSweep.errors)

  console.info(
    `[feed-processor] discontinued sweep: carried=${state.carried} discontinued=${state.discontinued} ` +
    `(grace ${graceDays}d, ${state.pendingAbsence} still in grace) marked=${state.marked} ` +
    `archived=${state.archived} kept-with-stock=${state.keptWithStock} returned=${state.returned} errors=${state.errors.length}`,
  )

  return { discontinuedSkus: disc, discontinuedSweep, state }
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
