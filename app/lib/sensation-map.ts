/**
 * Pure matching for the homepage Sensation Map instrument.
 *
 * The Sensation Map lets a visitor turn two dials — Type and Feel — and maps the
 * choice, live, to a few real products, each a `/products/{handle}` link. v1
 * invents NO taxonomy: it reuses the live discovery index and the discovery
 * scoring primitive (`scoreProduct`). Dial A (Type) filters on the indexed
 * `productTypeDial`; Dial B (Feel) scores by mood-tag overlap (a single mood
 * from the live vocab).
 *
 * Kept dependency-free (no server, no React) so it's trivially unit-testable and
 * safe to import from both the loader and the resource route, mirroring the
 * `discovery-emma.ts` / `discovery.server.ts` split.
 *
 * "Never a dead pill": a dial state that matches fewer than MIN_RESULTS live
 * products relaxes in tiers (drop Feel, then drop Type) and reports it, so every
 * state resolves to real, clickable product.
 */

import type { DiscoveryProduct } from '~/types/discovery'
import { EMPTY_STATE } from '~/types/discovery'
import { scoreProduct } from '~/lib/discovery-emma'
import type { ProductTypeDial } from '~/types'

/**
 * Friendly labels for the Type dial notches. Keys are the indexed
 * `productTypeDial` values; only types actually present in the live index become
 * notches, so a label gap can never produce a dead notch (unknown values fall
 * back to a de-slugged pass-through).
 */
export const TYPE_LABELS: Record<ProductTypeDial, string> = {
  vibrator:      'Vibrator',
  dildo:         'Dildo',
  anal:          'Anal',
  bondage:       'Bondage',
  'cock-ring':   'Cock ring',
  stroker:       'Stroker',
  couples:       'For two',
  harness:       'Harness',
  extender:      'Extender',
  pump:          'Pump',
  lube:          'Lube',
  massage:       'Massage',
  enhancer:      'Enhancer',
  wear:          'To wear',
  condom:        'Condom',
  wellness:      'Wellness',
  novelty:       'Novelty',
  'book-media':  'Books',
  'sex-machine': 'Sex machine',
}

export const MAX_TYPE_NOTCHES = 5
export const MAX_FEEL_NOTCHES = 4
export const SENSATION_RESULT_COUNT = 3
/** Below this, we relax the brief rather than show a near-empty result. */
const MIN_RESULTS = 2

export interface TypeNotch {
  value: ProductTypeDial
  label: string
  count: number
}

export interface SensationDialState {
  type: ProductTypeDial
  /** A single mood tag from the live vocab, or null for "any feel". */
  feel: string | null
}

export interface SensationMatch {
  items: DiscoveryProduct[]
  /** True when we loosened the requested brief to avoid a dead result. */
  relaxed: boolean
  relaxedReason: string | null
  /** The state we actually resolved to (may differ from the request). */
  resolved: SensationDialState
}

function labelForType(v: string): string {
  return (TYPE_LABELS as Record<string, string>)[v]
    ?? v.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Real savings amount, or 0 when not on sale. */
function savings(p: DiscoveryProduct): number {
  return p.compareAtPrice && p.compareAtPrice > p.price ? p.compareAtPrice - p.price : 0
}

/**
 * Deterministic "best of" ordering used for the Feel-agnostic tiers: products
 * with imagery first (the result cards are the payoff), then bigger savings,
 * then the cheaper entry point, then a stable tie-break by handle.
 *
 * Note the handle tie-break CLUSTERS size variants that a feed imports as
 * separate products (same brand, near-identical handles), which is why the
 * result set is de-duplicated with `collapseVariants` before it is sliced.
 */
function qualityCompare(a: DiscoveryProduct, b: DiscoveryProduct): number {
  const ai = a.imageUrl ? 0 : 1
  const bi = b.imageUrl ? 0 : 1
  if (ai !== bi) return ai - bi
  const s = savings(b) - savings(a)
  if (s !== 0) return s
  if (a.price !== b.price) return a.price - b.price
  return a.handle.localeCompare(b.handle)
}

/** Below this price a product reads as an accessible entry point. */
const ENTRY_PRICE_MAX = 30

/**
 * Strip a trailing size/variant descriptor so the size variants a feed imports
 * as separate products (same brand, titles differing only by size) collapse to
 * one card. Deliberately conservative: it only removes a recognized size token
 * sitting at the very end, so a genuine name that happens to end in a real word
 * (e.g. "Jelle Plus", "System JO") is left intact.
 */
function titleStem(title: string): string {
  // Unambiguous size words, optionally introduced by a separator or "size".
  const sizeWord =
    /\s*[-–,/|(]?\s*(?:size\s*)?(?:x-?small|xx-?small|x-?large|xx-?large|small|medium|large|xs|xl|xxl|xxxl|[2-5]xl)\)?\s*$/i
  // Short/ambiguous tokens (single letters, o/s, petite) only when a separator
  // clearly introduces them, so a name merely ending in "s"/"m"/"l" is kept.
  const sizeDelim = /\s*[-–,/|(]\s*(?:size\s*)?(?:s|m|l|o\/?s|petite)\)?\s*$/i
  let t = title.toLowerCase().trim()
  let prev = ''
  while (t !== prev) {
    prev = t
    t = t.replace(sizeWord, '').replace(sizeDelim, '').trim()
  }
  t = t.replace(/[\s\-–,/|(]+$/, '').trim()
  return t || title.toLowerCase().trim()
}

/** Cluster key for near-identical products: same brand + same title stem. */
function variantKey(p: DiscoveryProduct): string {
  return `${p.brand ?? ''}|${titleStem(p.title)}`
}

/**
 * Collapse near-identical products (same brand + title stem) to a single card,
 * keeping the best-ranked one. Input must already be sorted best-first so the
 * survivor is the strongest of each cluster. Stable; preserves input order.
 */
function collapseVariants(sorted: readonly DiscoveryProduct[]): DiscoveryProduct[] {
  const seen = new Set<string>()
  const out: DiscoveryProduct[] = []
  for (const p of sorted) {
    const k = variantKey(p)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  return out
}

/**
 * Take the top `count` of an already-collapsed, best-first list, guaranteeing at
 * least one accessible entry-price (< $30) card when the pool holds one worth
 * showing. An entry-price item still needs an image to be a real card, so an
 * image-less bargain is not promoted (that would regress the imagery-first
 * ordering). When the top slice is all pricier, its weakest slot is swapped for
 * the best-ranked qualifying entry-price item.
 */
function withEntryPrice(collapsed: readonly DiscoveryProduct[], count: number): DiscoveryProduct[] {
  const top = collapsed.slice(0, count)
  if (top.length < count) return top
  if (top.some(p => p.price < ENTRY_PRICE_MAX)) return top
  const entry = collapsed.find(p => p.price < ENTRY_PRICE_MAX && p.imageUrl)
  if (!entry || top.includes(entry)) return top
  return [...top.slice(0, count - 1), entry]
}

/**
 * The Type dial notches, derived from the live index: distinct `productTypeDial`
 * values ranked by product count, capped so 375px stays calm. Every returned
 * notch maps to ≥1 real product by construction.
 */
export function deriveTypeNotches(
  index: readonly DiscoveryProduct[],
  max = MAX_TYPE_NOTCHES,
): TypeNotch[] {
  const counts = new Map<string, number>()
  for (const p of index) {
    const t = p.productTypeDial
    if (!t) continue
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, max))
    .map(([value, count]) => ({ value: value as ProductTypeDial, label: labelForType(value), count }))
}

/**
 * The Feel dial notches: the most-common live mood tags (already
 * frequency-sorted by the vocab source). Shipped as a small set of NAMED moods
 * rather than a continuous gentle↔intense slider, because the mood tags carry no
 * real ordering — honest to the data (sensation-map concept, open question 1).
 */
export function deriveFeelNotches(
  moods: readonly string[],
  max = MAX_FEEL_NOTCHES,
): string[] {
  return moods.slice(0, Math.max(0, max))
}

/**
 * The default (SSR) dial state: a Type notch + the top Feel, if any.
 *
 * `seed` picks which Type notch is the default (`types[seed % types.length]`),
 * so the same three products don't ship every single day. Omit it (or pass 0)
 * to get the original "always the top notch" behavior — pure and
 * backward-compatible; callers that want daily rotation pass a day-bucket
 * number (see `sensation-map.server.ts`).
 */
export function defaultSensationState(
  types: readonly TypeNotch[],
  feels: readonly string[],
  seed = 0,
): SensationDialState | null {
  if (types.length === 0) return null
  const idx = ((seed % types.length) + types.length) % types.length
  const type = types[idx]!.value
  return { type, feel: feels[0] ?? null }
}

/**
 * Map a dial state onto the live index and resolve it to the top products.
 *
 * Tiers, applied in order until ≥MIN_RESULTS resolve:
 *   1. Exact — products of `type` scored by Feel-mood overlap (`scoreProduct`),
 *      score > 0. Not relaxed.
 *   2. Relax Feel — best of `type`, ignoring Feel. Only counts as "relaxed" when
 *      a Feel was actually requested and dropped.
 *   3. Relax Type — best of the most-populated type (or the whole index). Only
 *      hit when a Type is genuinely too sparse, which the derived notches make
 *      rare.
 */
export function matchSensationMap(
  index: readonly DiscoveryProduct[],
  state: SensationDialState,
  count = SENSATION_RESULT_COUNT,
): SensationMatch {
  const ofType = index.filter(p => p.productTypeDial === state.type)

  // Tier 1 — exact: Type + Feel-mood overlap, best overlap first. Size variants
  // are collapsed, so the tier only holds when >= MIN_RESULTS *distinct*
  // products fit; otherwise it relaxes rather than showing one product thrice.
  if (state.feel) {
    const scoreState = { ...EMPTY_STATE, mood: [state.feel] }
    const scored = ofType
      .map(p => ({ p, s: scoreProduct(p, scoreState) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || qualityCompare(a.p, b.p))
      .map(x => x.p)
    const collapsed = collapseVariants(scored)
    if (collapsed.length >= MIN_RESULTS) {
      return {
        items: withEntryPrice(collapsed, count),
        relaxed: false,
        relaxedReason: null,
        resolved: state,
      }
    }
  }

  // Tier 2 — relax Feel: best of this Type (distinct products).
  const ofTypeRanked = collapseVariants([...ofType].sort(qualityCompare))
  if (ofTypeRanked.length >= MIN_RESULTS) {
    return {
      items: withEntryPrice(ofTypeRanked, count),
      relaxed: !!state.feel, // dropping "any feel" is not a relaxation
      relaxedReason: state.feel ? 'Closest fit' : null,
      resolved: { type: state.type, feel: null },
    }
  }

  // Tier 3 — relax Type: nearest populated type (or whole index) best-of.
  const [topNotch] = deriveTypeNotches(index, 1)
  const fallbackType = topNotch?.value ?? state.type
  const pool = index.filter(p => p.productTypeDial === fallbackType)
  const source = pool.length ? pool : [...index]
  return {
    items: withEntryPrice(collapseVariants([...source].sort(qualityCompare)), count),
    relaxed: true,
    relaxedReason: 'Closest fit',
    resolved: { type: fallbackType, feel: null },
  }
}
