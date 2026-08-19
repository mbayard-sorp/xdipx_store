/**
 * Nº 07 · The Curiosity Shelf — types + constants.
 *
 * Replacement data model for the retired Sensation Map. One question, one row of
 * named "appetites" (the lanes), and a shelf of six real products under each that
 * restocks in place. See docs/homepage-team/discovery-band-redesign-spec.md.
 *
 * The single most important architectural property: the band DOES NOT FETCH.
 * Every lane arrives fully resolved in the SSR payload, so selecting a lane is
 * local state over data already in memory — no `/api/*` round trip, no rate
 * limit, no error path, and therefore no way for a tap to flip a pill without
 * changing the products (the "feels broken" defect this redesign retires).
 *
 * `CuriosityLane` / `CuriosityShelfContent` are the AUTHORED shape (Sanity or the
 * code-side default). `ResolvedLane` / `CuriosityShelfData` are the RESOLVED,
 * JSON-safe shape shipped on the homepage blob — no Map/Set/Date anywhere, same
 * round-trip contract as the rest of `HomepagePayloadB`.
 */

import type { DiscoveryProduct } from '~/types/discovery'
import type { ProductTypeDial } from '~/types'

/** Always exactly six visible cards, every breakpoint — the zero-CLS contract. */
export const SHELF_SLOTS = 6
/** Two pages of six per lane. A full deck is 12; a lane needs ≥ SHELF_SLOTS. */
export const SHELF_DECK = 12
export const SHELF_MAX_LANES = 5
export const SHELF_MIN_LANES = 3
/** Dollars. Per-lane overridable via `backfill.maxPrice`. */
export const SHELF_PRICE_CEILING = 150
/** Hard cap on product records across all lanes (5 × 12). */
export const SHELF_PAYLOAD_CAP = 60
/** price < LOW_BAND reads as an accessible entry point. */
export const LOW_BAND = 40
/** price > HIGH_BAND reads as a splurge. */
export const HIGH_BAND = 80

/**
 * The backfill rule that fills a lane's deck to 12 and keeps it alive on a day
 * nobody curates. `typeDial` is the category floor that makes an absurd result
 * (jeans under a vibrator query) impossible.
 */
export interface CuriosityBackfill {
  /** The category floor. Required unless `productHandles` already fills six. */
  typeDial: ProductTypeDial | null
  /** One mood tag from the live vocab; scored, not filtered hard. */
  mood: string | null
  /** Lane price window (dollars). Null = 0 / SHELF_PRICE_CEILING. */
  minPrice: number | null
  /** Overrides the global shelf ceiling when a lane wants to sell up. */
  maxPrice: number | null
}

/** One authored lane — the pill + its curated deck + its backfill rule. */
export interface CuriosityLane {
  /** The pill label. ≤16 chars keeps two-per-line wrapping at 375px. */
  label: string
  /** Stable id for the default-lane rotation and analytics. */
  key: string
  /** The line under the pills when this lane is selected. Voice-gated. */
  emmaLine: string
  /** Curated deck, in order. Bare Shopify handles. Empty = pure backfill. */
  productHandles: string[]
  backfill: CuriosityBackfill
  /** Bare collection handle for "See the full fit →". */
  seeAllHandle: string
  enabled: boolean
}

/** The authored shelf — Sanity singleton or the code-side `DEFAULT_SHELF_CONTENT`. */
export interface CuriosityShelfContent {
  eyebrow: string
  heading: string
  /** The one plum italic word. Must be a substring of `heading` to render. */
  emphasis: string
  emmaLine: string
  lanes: CuriosityLane[]
}

/**
 * A resolved lane, ready to ship. `deck` is 6..12 real products (the lean
 * DiscoveryProduct the cards already consume). A lane with a full deck of 12
 * offers a second page ("Show me another six"); a thinner lane ships a single
 * honest page of six and hides the reshuffle affordance (no pretence of infinity,
 * no page-2-equals-page-1 no-op).
 */
export interface ResolvedLane {
  label: string
  key: string
  emmaLine: string
  /**
   * Verified `/collections/{handle}`, or `null` when the authored handle is not a
   * live, in-stock collection. A `null` href renders NO "See the full fit" link
   * rather than pointing somewhere plausible: mission brief §1 bans a silent
   * best-sellers fallback for auto-generated modules (its ranking is a different
   * order from the discovery index that fills a lane, so it is structurally
   * guaranteed to mismatch the six the visitor just looked at).
   */
  seeAllHref: string | null
  /** 6..12 products. page0 = deck[0..5]; page1 = deck[6..11] when present. */
  deck: DiscoveryProduct[]
}

/** The resolved, JSON-safe shelf shipped on the homepage B blob. */
export interface CuriosityShelfData {
  eyebrow: string
  heading: string
  emphasis: string
  emmaLine: string
  /** SHELF_MIN_LANES..SHELF_MAX_LANES surviving lanes. */
  lanes: ResolvedLane[]
  /**
   * The lane preselected on SSR, rotated once per UTC day so the band's first
   * impression changes too. An index into `lanes`; the component's initial state
   * must match this so the server renders the final, unflashed default.
   */
  defaultLane: number
}
