/**
 * Today's Pick daily product picker (ticket #3677, instagram-campaigns.md §4b).
 *
 * Owner direction 2026-08-16: pick a product every day that is a high
 * percentage off and post about it, cast member presenting the product.
 * This script is the picker behind that slot: it returns ONE candidate plus
 * the evidence that it passed every filter, so the drafter never shops the
 * storefront grid by hand (the grid does not check MAP, per ticket #3675).
 *
 * Filters, all mandatory and in this order:
 *   1. Inside the ACTIVE campaign's product_scope rule (never a product
 *      rotation with a hashtag, the pattern §3.5 retired by name).
 *   2. Instagram-eligible by category: never a dildo, never an anatomically
 *      realistic product (§2). Applied at SELECTION so no image is ever
 *      generated for an ineligible SKU (the filter post #49 skipped).
 *   3. availableForSale and ACTIVE, per the Step 2.6 stock gate.
 *   4. mapAllowsAdvertisedDiscount() true against the LIVE xdipx.map_price
 *      and xdipx.original_price metafields (the cached discovery index
 *      carries no MAP fields, so this is always a live read).
 *   5. Not featured in a social_posts row in the last 30 days.
 *
 * HONESTY REQUIREMENT (stated in the output): the pricing engine writes
 * compare_at = msrp on every product priced under list, so about 94 percent
 * of the in-stock catalog carries a permanent compare-at discount. The
 * percentage is real and it is the same tomorrow. It is OUR PRICE AGAINST
 * LIST, never today's markdown, and the number itself may NOT go in an
 * Instagram caption at all (§4b: it goes on /social, the bio link, X, email).
 *
 * Usage:
 *   npx tsx scripts/pick-todays-product.ts            # pick + evidence (JSON)
 *   npx tsx scripts/pick-todays-product.ts --limit 5  # show top 5 candidates
 */

import './_load-env'

// ── Pure logic (unit-tested in pick-todays-product.test.ts) ────────────────

export interface PickerProduct {
  handle: string
  title: string
  productType: string
  /** xdipx.product_type_dial metafield: air-pulsation|vibrator|wand|lube|wear */
  productTypeDial: string | null
  vendor: string
  status: string
  availableForSale: boolean
  price: number
  compareAtPrice: number | null
  /** Live xdipx.map_price metafield (null = no MAP on file). */
  mapPrice: number | null
  /** Live xdipx.original_price metafield (MSRP). */
  originalPrice: number | null
  /** Live xdipx.map_restricted metafield. */
  mapRestricted: boolean
  imageUrl: string | null
}

export interface CampaignScope {
  slug: string
  name: string
  /** product_type_dial values in scope; undefined = live-better campaign, any eligible dial. */
  dials?: readonly string[] | undefined
}

/**
 * Mirror of the §5 schedule's product_scope rules, keyed by campaign name as
 * it appears on the 'IG: '-prefixed marketing_calendar row. A calendar row
 * whose assetsJson carries { product_scope: { dials: [...] } } (writable since
 * ticket #2736) overrides this map; the map is the fallback while the doc
 * remains the authority for older rows.
 */
export const CAMPAIGN_SCOPES: Record<string, CampaignScope> = {
  'The Vibrator Field Guide': { slug: 'vibrator-field-guide', name: 'The Vibrator Field Guide', dials: ['vibrator', 'air-pulsation', 'wand'] },
  'Talk Yourself Into It':    { slug: 'talk-yourself-into-it', name: 'Talk Yourself Into It' },
  'Lube, Actually':           { slug: 'lube-actually', name: 'Lube, Actually', dials: ['lube'] },
  'The Orgasm Gap, Closed':   { slug: 'orgasm-gap-closed', name: 'The Orgasm Gap, Closed' },
  'Prostate 101':             { slug: 'prostate-101', name: 'Prostate 101' },
  'Spooky Season, Sensory Play': { slug: 'spooky-sensory', name: 'Spooky Season, Sensory Play' },
  'Aftercare Is Not Optional': { slug: 'aftercare', name: 'Aftercare Is Not Optional' },
}

/**
 * Instagram category eligibility (§2): never a dildo, never an anatomically
 * realistic product. Those do not survive Meta moderation, and a deeply
 * discounted slow mover is disproportionately likely to be exactly this
 * category, which is why the filter runs at selection.
 */
const IG_EXCLUDED_PATTERNS: readonly RegExp[] = [
  /\bdildos?\b/i,
  /\bdongs?\b/i,
  /realistic/i,
  /dual densit/i,
  /triple densit/i,
  /celebrity molded/i,
  /\bpussy\b/i,
  /\bvagina\b/i,
  /anatomically/i,
]

export function isInstagramEligible(p: Pick<PickerProduct, 'title' | 'productType'>): { eligible: boolean; reason: string } {
  const haystack = `${p.productType} ${p.title}`
  for (const re of IG_EXCLUDED_PATTERNS) {
    if (re.test(haystack)) {
      return { eligible: false, reason: `excluded category: matches ${re} in "${haystack.slice(0, 80)}"` }
    }
  }
  return { eligible: true, reason: 'no excluded-category match in product type or title' }
}

export function isInScope(p: Pick<PickerProduct, 'productTypeDial'>, scope: CampaignScope): { inScope: boolean; reason: string } {
  if (!scope.dials || scope.dials.length === 0) {
    return { inScope: true, reason: `campaign "${scope.name}" is live-better: any Instagram-eligible product is in scope` }
  }
  const dial = p.productTypeDial
  if (dial && scope.dials.includes(dial)) {
    return { inScope: true, reason: `product_type_dial "${dial}" is inside campaign scope [${scope.dials.join(', ')}]` }
  }
  return { inScope: false, reason: `product_type_dial "${dial ?? 'unset'}" outside campaign scope [${scope.dials.join(', ')}]` }
}

/**
 * MAP verdict, delegating to the same rule the GMC feed and the storefront
 * cards use (mapAllowsAdvertisedDiscount → mapAllowsDiscountDisplay, ticket
 * #3675 made them one function). A product whose map_price equals its
 * original_price permits no discount framing anywhere: our price sits below
 * MAP, so any value framing would advertise a below-MAP price.
 */
export function mapVerdict(
  p: Pick<PickerProduct, 'mapPrice' | 'mapRestricted' | 'price' | 'originalPrice'>,
  mapAllows: (mapPrice: number | null | undefined, mapRestricted: boolean, regularPrice: number) => boolean,
): { allowed: boolean; verdict: string } {
  const allowed = mapAllows(p.mapPrice, p.mapRestricted, p.price)
  if (allowed) {
    return {
      allowed,
      verdict: p.mapPrice == null || p.mapPrice <= 0
        ? 'no MAP on file: discount framing permitted'
        : `MAP $${p.mapPrice.toFixed(2)} is below our price $${p.price.toFixed(2)}: discount framing permitted`,
    }
  }
  if (p.mapRestricted) return { allowed, verdict: 'map_restricted is true: no discount framing anywhere' }
  return {
    allowed,
    verdict: `MAP $${(p.mapPrice ?? 0).toFixed(2)} >= our price $${p.price.toFixed(2)}` +
      (p.mapPrice != null && p.originalPrice != null && Math.abs(p.mapPrice - p.originalPrice) < 0.005
        ? ' (map_price == original_price: no discount framing anywhere)'
        : '') + ': rejected',
  }
}

export function computeDiscountPct(price: number, compareAtPrice: number | null): number | null {
  if (compareAtPrice == null || compareAtPrice <= 0 || price <= 0 || price >= compareAtPrice) return null
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100)
}

/** Was this handle featured in any social_posts row of the last 30 days? */
export function wasFeaturedRecently(handle: string, recentPostsHaystack: string): boolean {
  return recentPostsHaystack.includes(handle)
}

export interface PickEvidence {
  scope: string
  category: string
  stock: string
  map: string
  recency: string
}

export interface PickResult {
  pick: PickerProduct | null
  evidence: PickEvidence | null
  discountPct: number | null
  /** Why each rejected candidate above the pick fell out, capped for sanity. */
  rejections: Array<{ handle: string; filter: string; reason: string }>
  considered: number
}

/**
 * Applies the five filters in the mandatory order to a discount-sorted
 * candidate list and returns the first survivor plus its evidence.
 */
export function pickTodaysProduct(
  products: readonly PickerProduct[],
  scope: CampaignScope,
  recentPostsHaystack: string,
  mapAllows: (mapPrice: number | null | undefined, mapRestricted: boolean, regularPrice: number) => boolean,
): PickResult {
  const rejections: PickResult['rejections'] = []
  const sorted = [...products].sort((a, b) =>
    (computeDiscountPct(b.price, b.compareAtPrice) ?? -1) - (computeDiscountPct(a.price, a.compareAtPrice) ?? -1))

  for (const p of sorted) {
    // (1) campaign product_scope
    const scopeCheck = isInScope(p, scope)
    if (!scopeCheck.inScope) { rejections.push({ handle: p.handle, filter: 'scope', reason: scopeCheck.reason }); continue }
    // (2) Instagram category eligibility, at selection
    const eligibility = isInstagramEligible(p)
    if (!eligibility.eligible) { rejections.push({ handle: p.handle, filter: 'category', reason: eligibility.reason }); continue }
    // (3) stock gate
    if (p.status.toUpperCase() !== 'ACTIVE' || !p.availableForSale) {
      rejections.push({ handle: p.handle, filter: 'stock', reason: `status=${p.status} availableForSale=${p.availableForSale}` })
      continue
    }
    // (4) MAP, live metafields
    const map = mapVerdict(p, mapAllows)
    if (!map.allowed) { rejections.push({ handle: p.handle, filter: 'map', reason: map.verdict }); continue }
    // (5) not featured in the last 30 days
    if (wasFeaturedRecently(p.handle, recentPostsHaystack)) {
      rejections.push({ handle: p.handle, filter: 'recency', reason: 'featured in a social_posts row within the last 30 days' })
      continue
    }
    return {
      pick: p,
      discountPct: computeDiscountPct(p.price, p.compareAtPrice),
      evidence: {
        scope:    scopeCheck.reason,
        category: eligibility.reason,
        stock:    `status=ACTIVE, availableForSale=true`,
        map:      map.verdict,
        recency:  'not featured in any social_posts row of the last 30 days',
      },
      rejections: rejections.slice(0, 25),
      considered: sorted.length,
    }
  }
  return { pick: null, evidence: null, discountPct: null, rejections: rejections.slice(0, 25), considered: sorted.length }
}

export const HONESTY_STATEMENT =
  'HONESTY: the pricing engine writes compare_at = msrp on every product priced under list, ' +
  'so ~94% of the in-stock catalog (4,059 of 4,335) carries a permanent compare-at discount ' +
  'and roughly 1,006 sit at 30% or more. This percentage is real and it is the same tomorrow. ' +
  'Frame it as OUR PRICE AGAINST LIST, never "today\'s markdown". The number itself may not ' +
  'appear in an Instagram caption at all (instagram-campaigns.md 4b): it belongs on ' +
  'xdipx.com/social, the bio link, X, email, and SMS.'

// ── Live data plumbing ─────────────────────────────────────────────────────

interface AdminProductNode {
  handle: string
  title: string
  vendor: string | null
  productType: string | null
  status: string
  featuredImage: { url: string } | null
  variants: { nodes: Array<{ price: string; compareAtPrice: string | null; availableForSale: boolean }> }
  dial: { value: string } | null
  mapPrice: { value: string } | null
  originalPrice: { value: string } | null
  mapRestricted: { value: string } | null
}

async function fetchLiveCatalog(): Promise<PickerProduct[]> {
  const { adminGraphQL } = await import('../app/lib/shopify.server')
  const out: PickerProduct[] = []
  let cursor: string | null = null
  let pages = 0
  for (;;) {
    // Page size + inter-page sleep are tuned to the Admin API leaky bucket
    // (2,000 points, ~100/s restore): each page costs roughly 8 points per
    // product, and adminGraphQL's own throttle retry caps its wait at 5s, so
    // a 100-product page (~800 points) drains faster than a capped retry can
    // refill and the walk dies mid-catalog. 50 products plus a 3s pause keeps
    // the drain inside what the retry can absorb.
    if (pages > 0) await new Promise(r => setTimeout(r, 3000))
    pages++
    if (pages % 10 === 0) console.error(`[picker] catalog fetch: page ${pages}, ${out.length} products so far`)
    const data: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: AdminProductNode[] }
    } = await adminGraphQL(
      `query PickerCatalog($cursor: String) {
        products(first: 50, after: $cursor, query: "status:active") {
          pageInfo { hasNextPage endCursor }
          nodes {
            handle title vendor productType status
            featuredImage { url }
            variants(first: 1) { nodes { price compareAtPrice availableForSale } }
            dial: metafield(namespace: "xdipx", key: "product_type_dial") { value }
            mapPrice: metafield(namespace: "xdipx", key: "map_price") { value }
            originalPrice: metafield(namespace: "xdipx", key: "original_price") { value }
            mapRestricted: metafield(namespace: "xdipx", key: "map_restricted") { value }
          }
        }
      }`,
      { cursor },
    )
    for (const n of data.products.nodes) {
      const v = n.variants.nodes[0]
      if (!v) continue
      out.push({
        handle:          n.handle,
        title:           n.title,
        productType:     n.productType ?? '',
        productTypeDial: n.dial?.value ?? null,
        vendor:          n.vendor ?? '',
        status:          n.status,
        availableForSale: v.availableForSale,
        price:           parseFloat(v.price),
        compareAtPrice:  v.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
        mapPrice:        n.mapPrice?.value ? parseFloat(n.mapPrice.value) : null,
        originalPrice:   n.originalPrice?.value ? parseFloat(n.originalPrice.value) : null,
        mapRestricted:   n.mapRestricted?.value === 'true',
        imageUrl:        n.featuredImage?.url ?? null,
      })
    }
    if (!data.products.pageInfo.hasNextPage) break
    cursor = data.products.pageInfo.endCursor
  }
  return out
}

/** Resolve today's active 'IG: ' campaign from the calendar, scope from assetsJson or the §5 map. */
async function resolveActiveCampaignScope(): Promise<CampaignScope> {
  const { db } = await import('../app/lib/db.server')
  const { marketingCalendar } = await import('../db/schema')
  const { like, eq, and } = await import('drizzle-orm')
  const rows = await db
    .select()
    .from(marketingCalendar)
    .where(and(like(marketingCalendar.name, 'IG: %'), eq(marketingCalendar.status, 'active')))
  const row = rows[0]
  if (!row) {
    throw new Error(
      'No active "IG: " campaign row on the marketing calendar. The daily social routine ' +
      'reconciles campaign status every day (instagram-campaigns.md §5); run that first, or ' +
      'activate the current campaign row.',
    )
  }
  const name = row.name.replace(/^IG: /, '')
  const assets = row.assetsJson as Record<string, unknown> | null
  const scopeFromAssets = assets && typeof assets === 'object' ? assets['product_scope'] : undefined
  if (scopeFromAssets && typeof scopeFromAssets === 'object' && Array.isArray((scopeFromAssets as Record<string, unknown>)['dials'])) {
    return { slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, dials: (scopeFromAssets as { dials: string[] }).dials }
  }
  const known = CAMPAIGN_SCOPES[name]
  if (known) return known
  return { slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name }
}

/** One haystack of the last 30 days of social posts: tweet text + media URLs. */
async function fetchRecentPostsHaystack(): Promise<string> {
  const { db } = await import('../app/lib/db.server')
  const { socialPosts } = await import('../db/schema')
  const { gte } = await import('drizzle-orm')
  const since = new Date(Date.now() - 30 * 24 * 3600_000)
  const rows = await db
    .select({ tweetText: socialPosts.tweetText, mediaUrls: socialPosts.mediaUrls })
    .from(socialPosts)
    .where(gte(socialPosts.createdAt, since))
  return rows.map(r => `${r.tweetText} ${(r.mediaUrls ?? []).join(' ')}`).join('\n')
}

async function main(): Promise<number> {
  const limitArg = process.argv.indexOf('--limit')
  const limit = limitArg > -1 ? Math.max(1, parseInt(process.argv[limitArg + 1] ?? '1', 10) || 1) : 1

  const { mapAllowsAdvertisedDiscount } = await import('../app/lib/gmc-metafields.server')

  const scope = await resolveActiveCampaignScope()
  console.error(`[picker] active campaign: ${scope.name}${scope.dials ? ` (dials: ${scope.dials.join(', ')})` : ' (live-better, unrestricted scope)'}`)

  const [catalog, haystack] = await Promise.all([fetchLiveCatalog(), fetchRecentPostsHaystack()])
  console.error(`[picker] live catalog: ${catalog.length} active products; recent-post haystack: ${haystack.length} chars`)

  const results: PickResult[] = []
  let pool = catalog
  for (let i = 0; i < limit; i++) {
    const result = pickTodaysProduct(pool, scope, haystack, mapAllowsAdvertisedDiscount)
    results.push(result)
    if (!result.pick) break
    pool = pool.filter(p => p.handle !== result.pick!.handle)
  }

  const first = results[0]
  if (!first?.pick) {
    console.error('[picker] NO candidate passed all five filters. Rejection sample:')
    console.error(JSON.stringify(first?.rejections ?? [], null, 2))
    return 1
  }

  const output = results.filter(r => r.pick).map(r => ({
    handle:        r.pick!.handle,
    title:         r.pick!.title,
    ourPrice:      r.pick!.price,
    compareAtList: r.pick!.compareAtPrice,
    pctOffList:    r.discountPct,
    priceFraming:  'our price against list (permanent price relationship), never todays markdown',
    mapVerdict:    r.evidence!.map,
    packshotUrl:   r.pick!.imageUrl,
    campaign:      scope.name,
    evidence:      r.evidence,
  }))
  console.log(JSON.stringify({ honesty: HONESTY_STATEMENT, picks: output }, null, 2))
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().then(
    code => process.exit(code),
    err => { console.error('[picker] failed:', err); process.exit(1) },
  )
}
