/**
 * Pure resolution for the homepage Curiosity Shelf (Nº 07).
 *
 * Everything here runs ON THE SERVER, at payload-build time, in a pure,
 * dependency-free module (no React, no server imports) so it is trivially
 * unit-testable and mirrors the `sensation-map.ts` split it replaces. Nothing in
 * this file runs in the browser: the band ships fully resolved and every runtime
 * interaction is local state over in-memory data.
 *
 * The design spec is docs/homepage-team/discovery-band-redesign-spec.md; the
 * selection and data rules implemented here are its §(e).
 */

import type { DiscoveryProduct } from '~/types/discovery'
import { EMPTY_STATE } from '~/types/discovery'
import { scoreProduct } from '~/lib/discovery-emma'
import type { ProductTypeDial } from '~/types'
import {
  type CuriosityLane,
  type CuriosityShelfContent,
  type CuriosityShelfData,
  type ResolvedLane,
  SHELF_SLOTS,
  SHELF_DECK,
  SHELF_MAX_LANES,
  SHELF_MIN_LANES,
  SHELF_PRICE_CEILING,
  LOW_BAND,
  HIGH_BAND,
} from '~/types/curiosity'

// ─── Ordering ────────────────────────────────────────────────────────────────

/** Real savings amount, or 0 when not on sale. */
function savings(p: DiscoveryProduct): number {
  return p.compareAtPrice && p.compareAtPrice > p.price ? p.compareAtPrice - p.price : 0
}

/**
 * Deterministic "best of" ordering, ported from the retired `sensation-map.ts`
 * (its ordering intent survives the module deletion): products with imagery
 * first (the card IS the payoff), then bigger savings, then the cheaper entry
 * point, then a stable tie-break by handle.
 */
export function qualityCompare(a: DiscoveryProduct, b: DiscoveryProduct): number {
  const ai = a.imageUrl ? 0 : 1
  const bi = b.imageUrl ? 0 : 1
  if (ai !== bi) return ai - bi
  const s = savings(b) - savings(a)
  if (s !== 0) return s
  if (a.price !== b.price) return a.price - b.price
  return a.handle.localeCompare(b.handle)
}

// ─── Family dedupe (§e.4) ────────────────────────────────────────────────────

/**
 * Cluster key for near-identical products a feed imports as separate rows — the
 * three size variants of the same $418.99 jeans, say. Brand + a title stripped
 * of parentheticals, size words, and dimension tokens. Verbatim from spec §e.4.
 */
export function familyKey(p: DiscoveryProduct): string {
  const title = p.title
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(xx?s|s|m|l|xx?l|small|medium|large|x-?large|petite|plus)\b/g, ' ')
    .replace(/\b\d+(\.\d+)?\s?(in|inch|inches|cm|mm|oz|ml)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return `${(p.brand ?? '').toLowerCase()}|${title}`
}

/** Prefer a product with an image, then the cheaper one, then quality order. */
function cheaperWithImage(a: DiscoveryProduct, b: DiscoveryProduct): DiscoveryProduct {
  const ai = a.imageUrl ? 0 : 1
  const bi = b.imageUrl ? 0 : 1
  if (ai !== bi) return ai < bi ? a : b
  if (a.price !== b.price) return a.price < b.price ? a : b
  return qualityCompare(a, b) <= 0 ? a : b
}

/**
 * Collapse a family to a single product, first-seen order preserved.
 *
 * Curated members always beat algorithmic siblings (a merchandiser's explicit
 * pick wins its family, at any price); the first curated member wins ties among
 * curated. Where a family is entirely algorithmic, keep the cheapest member that
 * has an image (spec §e.4). `isCurated` identifies curated products by identity.
 */
export function dedupeByFamily(
  items: readonly DiscoveryProduct[],
  isCurated: (p: DiscoveryProduct) => boolean = () => false,
): DiscoveryProduct[] {
  const winners = new Map<string, DiscoveryProduct>()
  const order: string[] = []
  for (const p of items) {
    const k = familyKey(p)
    const cur = winners.get(k)
    if (!cur) {
      winners.set(k, p)
      order.push(k)
      continue
    }
    const curCurated = isCurated(cur)
    const pCurated = isCurated(p)
    if (curCurated && !pCurated) continue // curated incumbent holds
    if (!curCurated && pCurated) {
      winners.set(k, p) // curated challenger takes the family
      continue
    }
    if (curCurated && pCurated) continue // both curated → first wins
    winners.set(k, cheaperWithImage(cur, p)) // both algorithmic
  }
  return order.map(k => winners.get(k)!)
}

// ─── Category floor (§e.5) ───────────────────────────────────────────────────

/**
 * The hard `typeDial` floor on backfill: a backfilled product MUST match the
 * lane's type. There is no cross-type relaxation tier and no whole-index
 * fallback — the two mechanisms that used to put jeans under a sensation query. A
 * null `typeDial` means the lane is deliberately type-spanning (e.g. an "Under
 * $40" price lane) and every product passes.
 */
export function applySanityFloor(
  pool: readonly DiscoveryProduct[],
  typeDial: ProductTypeDial | null,
): DiscoveryProduct[] {
  if (!typeDial) return [...pool]
  return pool.filter(p => p.productTypeDial === typeDial)
}

// ─── Base filters ────────────────────────────────────────────────────────────

/** Every card needs an image (it is the payoff), stock, and a live product. */
function passesBaseFilters(p: DiscoveryProduct): boolean {
  const inStock = p.totalInventory == null || p.totalInventory > 0
  const live = p.productType !== 'Discontinued'
  return p.imageUrl != null && inStock && live
}

// ─── Price-band mix (§e.7) ───────────────────────────────────────────────────

const isLow = (p: DiscoveryProduct) => p.price < LOW_BAND
const isHigh = (p: DiscoveryProduct) => p.price > HIGH_BAND
const isMid = (p: DiscoveryProduct) => !isLow(p) && !isHigh(p)

/**
 * Compose ONE page of `slots` products from `pool` so it holds at least 2 under
 * $40 and at most 2 over $80 WHEN THE BUCKETS ALLOW, drawing in rank order:
 * guarantee up to two lows, fill the middle with mids then extra lows, add highs
 * up to the cap of two, and only then fall back to the remaining highs. Pure —
 * does not mutate `pool` (spec §e.7). Never reorders into a wall of one price
 * while the buckets can avoid it; takes the closest achievable composition
 * otherwise.
 */
export function mixPriceBands(pool: readonly DiscoveryProduct[], slots: number): DiscoveryProduct[] {
  const lows = pool.filter(isLow)
  const mids = pool.filter(isMid)
  const highs = pool.filter(isHigh)
  const page: DiscoveryProduct[] = []
  const seen = new Set<string>()
  const push = (p: DiscoveryProduct) => {
    if (page.length < slots && !seen.has(p.id)) {
      page.push(p)
      seen.add(p.id)
    }
  }
  // 1. up to two lows
  for (const p of lows.slice(0, 2)) push(p)
  // 2. mids, then any remaining lows
  for (const p of mids) push(p)
  for (const p of lows.slice(2)) push(p)
  // 3. highs up to the cap of two
  for (const p of highs.slice(0, 2)) push(p)
  // 4. last resort: remaining highs (the buckets could not honour the cap)
  for (const p of highs.slice(2)) push(p)
  return page
}

// ─── Rotation (§e.8) ─────────────────────────────────────────────────────────

/** Left-rotate by `by` (wraps, handles negatives). Pure; returns a new array. */
export function rotate<T>(arr: readonly T[], by: number): T[] {
  const n = arr.length
  if (n === 0) return []
  const k = ((by % n) + n) % n
  return [...arr.slice(k), ...arr.slice(0, k)]
}

/** Round-robin split of `items` into `pages` groups, rank order preserved. */
function allocate<T>(items: readonly T[], pages: number): T[][] {
  const out: T[][] = Array.from({ length: pages }, () => [])
  items.forEach((it, i) => out[i % pages]!.push(it))
  return out
}

/**
 * Compose a deck of `pages × SHELF_SLOTS` products from a backfill pool so EVERY
 * page of six satisfies the price-band mix when the buckets allow. Buckets are
 * dealt round-robin across pages first (so one page cannot hoard all the mids and
 * strand another with a wall of highs), each page is composed with
 * `mixPriceBands`, and any page left short by an uneven deal is topped up from
 * the leftover in rank order. Only full pages of six are returned (zero-CLS).
 */
function composeBalanced(pool: readonly DiscoveryProduct[], pages: number): DiscoveryProduct[] {
  const lowPg = allocate(pool.filter(isLow), pages)
  const midPg = allocate(pool.filter(isMid), pages)
  const highPg = allocate(pool.filter(isHigh), pages)
  const built: DiscoveryProduct[][] = []
  const used = new Set<string>()
  for (let pg = 0; pg < pages; pg++) {
    const page = mixPriceBands([...lowPg[pg]!, ...midPg[pg]!, ...highPg[pg]!], SHELF_SLOTS)
    page.forEach(p => used.add(p.id))
    built.push(page)
  }
  // Uneven deal → top up short pages from anything not yet placed.
  const leftover = pool.filter(p => !used.has(p.id))
  let li = 0
  for (const page of built) {
    while (page.length < SHELF_SLOTS && li < leftover.length) {
      const p = leftover[li++]!
      page.push(p)
      used.add(p.id)
    }
  }
  return built.filter(pg => pg.length === SHELF_SLOTS).flat()
}

// ─── Lane + shelf resolution ─────────────────────────────────────────────────

export interface ResolveOptions {
  /** Day-granularity rotation seed (floor(now / 86_400_000)). */
  dayBucket: number
  /** Collection handles that resolve to a real /collections/ page. */
  verifiedCollections: ReadonlySet<string>
}

const FALLBACK_COLLECTION = 'best-sellers'

/**
 * Resolve one lane to a shelf of real products, or `null` when the lane cannot
 * honestly fill six. Curated handles are pinned to the front and never rotated;
 * the backfill tail rotates by `dayBucket + laneIndex` so the visible six change
 * day over day without a deploy. A lane with a full deck of twelve offers a
 * second page; a thinner lane ships a single honest page of six.
 */
export function resolveLane(
  lane: CuriosityLane,
  index: readonly DiscoveryProduct[],
  laneIndex: number,
  opts: ResolveOptions,
): ResolvedLane | null {
  const byHandle = new Map(index.map(p => [p.handle, p]))

  // 1. Curated first, in authored order. Exempt from the price ceiling, but every
  //    other base filter still applies (a curated hole is worse than a drop).
  const curatedSet = new Set<string>()
  const curated: DiscoveryProduct[] = []
  for (const h of lane.productHandles) {
    const p = byHandle.get(h)
    if (p && passesBaseFilters(p) && !curatedSet.has(p.id)) {
      curated.push(p)
      curatedSet.add(p.id)
    }
  }
  const isCurated = (p: DiscoveryProduct) => curatedSet.has(p.id)

  const minPrice = lane.backfill.minPrice ?? 0
  const maxPrice = lane.backfill.maxPrice ?? SHELF_PRICE_CEILING

  const buildBackfill = (withMood: boolean): DiscoveryProduct[] => {
    const base = applySanityFloor(index, lane.backfill.typeDial)
      .filter(p => passesBaseFilters(p) && !curatedSet.has(p.id))
      .filter(p => p.price >= minPrice && p.price <= maxPrice)
    if (withMood && lane.backfill.mood) {
      const scoreState = { ...EMPTY_STATE, mood: [lane.backfill.mood] }
      return [...base].sort(
        (a, b) => scoreProduct(b, scoreState) - scoreProduct(a, scoreState) || qualityCompare(a, b),
      )
    }
    return [...base].sort(qualityCompare)
  }

  // 2–3. Backfill pool, one widening attempt (drop mood, never the typeDial).
  let backfill = buildBackfill(true)
  let combined = dedupeByFamily([...curated, ...backfill], isCurated)
  if (combined.length < SHELF_SLOTS && lane.backfill.mood) {
    backfill = buildBackfill(false)
    combined = dedupeByFamily([...curated, ...backfill], isCurated)
  }

  // 4. A lane that cannot honestly reach six is dropped, not loosened.
  if (combined.length < SHELF_SLOTS) return null

  // 5. Split into pinned curated (front, never rotated) and rotatable backfill.
  const curatedPart = combined.filter(isCurated)
  const backfillPart = rotate(combined.filter(p => !isCurated(p)), opts.dayBucket + laneIndex)

  // 6. Assemble the deck: two pages only when six genuinely-different products
  //    remain beyond page one, so a reshuffle can never wrap to an identical page.
  const wantPages = combined.length >= SHELF_DECK ? 2 : 1
  const head = curatedPart.slice(0, wantPages * SHELF_SLOTS)
  const balanced = composeBalanced(backfillPart, wantPages)
  let deck = [...head, ...balanced].slice(0, wantPages * SHELF_SLOTS)
  // If curated displaced a page-two slot and left the deck short of a full second
  // page, fall back to a single honest page rather than a short one.
  if (deck.length < wantPages * SHELF_SLOTS) deck = deck.slice(0, SHELF_SLOTS)

  // 7. See-all: authored handle when verified, else best-sellers — validated here
  //    so a bad handle can never ship a 404 into the band.
  const seeAllHandle = opts.verifiedCollections.has(lane.seeAllHandle)
    ? lane.seeAllHandle
    : FALLBACK_COLLECTION

  return {
    label: lane.label,
    key: lane.key,
    emmaLine: lane.emmaLine,
    seeAllHref: `/collections/${seeAllHandle}`,
    deck,
  }
}

/**
 * Resolve the whole shelf. Takes the enabled lanes (first SHELF_MAX_LANES),
 * resolves each, drops the ones that cannot fill six, and returns `null` when
 * fewer than SHELF_MIN_LANES survive — the same "lose the section, lose nothing
 * else" shape as the retired band's cold-index skip.
 */
export function resolveShelf(
  content: CuriosityShelfContent,
  index: readonly DiscoveryProduct[],
  opts: ResolveOptions,
): CuriosityShelfData | null {
  const lanes = content.lanes.filter(l => l.enabled).slice(0, SHELF_MAX_LANES)
  const resolved: ResolvedLane[] = []
  lanes.forEach((lane, i) => {
    const r = resolveLane(lane, index, i, opts)
    if (r) resolved.push(r)
  })
  if (resolved.length < SHELF_MIN_LANES) return null
  return {
    eyebrow: content.eyebrow,
    heading: content.heading,
    emphasis: content.emphasis,
    emmaLine: content.emmaLine,
    lanes: resolved,
    defaultLane: defaultLaneIndex(resolved.length, opts.dayBucket),
  }
}

/** The default lane preselected on SSR, rotated once per UTC day (spec §b/§d). */
export function defaultLaneIndex(laneCount: number, dayBucket: number): number {
  if (laneCount <= 0) return 0
  return ((dayBucket % laneCount) + laneCount) % laneCount
}

// ─── Code-side default (Set A, spec §f) ──────────────────────────────────────

/**
 * The evergreen default shelf. Renders when Sanity's `singleton.curiosityShelf`
 * is absent, disabled, or invalid — unpublishing the doc is a complete rollback,
 * exactly like `storefrontHome`. These strings are the spec's Set A direction;
 * the daily merchandiser's Sanity writes route their live copy through
 * `emma-empathy-reviewer` before publish. `backfill.mood` is soft-scored, so a
 * value that matches no live mood tag degrades to plain type-floor ordering
 * rather than emptying the lane.
 */
export const DEFAULT_SHELF_CONTENT: CuriosityShelfContent = {
  eyebrow: "TONIGHT'S CURIOSITIES",
  heading: 'What are you curious about?',
  emphasis: 'curious',
  emmaLine: 'Pick one. I restock the shelf with six that fit.',
  lanes: [
    {
      label: 'Hands free',
      key: 'hands-free',
      emmaLine: 'Set it, lie back, let it work.',
      productHandles: [],
      backfill: { typeDial: 'vibrator', mood: null, minPrice: null, maxPrice: null },
      seeAllHandle: 'vibrators',
      enabled: true,
    },
    {
      label: 'Something that hums',
      key: 'something-that-hums',
      emmaLine: 'Steady, deep, and easy to aim.',
      productHandles: [],
      backfill: { typeDial: 'vibrator', mood: 'intense', minPrice: null, maxPrice: null },
      seeAllHandle: 'vibrators',
      enabled: true,
    },
    {
      label: 'Made for two',
      key: 'made-for-two',
      emmaLine: 'Built to be handed over.',
      productHandles: [],
      backfill: { typeDial: 'couples', mood: null, minPrice: null, maxPrice: null },
      seeAllHandle: 'couples',
      enabled: true,
    },
    {
      label: 'Slick',
      key: 'slick',
      emmaLine: 'Everything else works better wet.',
      productHandles: [],
      backfill: { typeDial: 'lube', mood: null, minPrice: null, maxPrice: null },
      seeAllHandle: 'lubricants',
      enabled: true,
    },
    {
      label: 'Worn, not held',
      key: 'worn-not-held',
      emmaLine: 'It starts before anything comes off.',
      productHandles: [],
      backfill: { typeDial: 'wear', mood: null, minPrice: null, maxPrice: null },
      seeAllHandle: 'wear',
      enabled: true,
    },
  ],
}
