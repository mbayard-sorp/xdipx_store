/**
 * "Find you in a product" — home page discovery types.
 *
 * The chip vocabularies (mood, audience, matters) are dynamic — sourced
 * from the live distinct values of these Shopify product metafields:
 *   - xdipx.mood_tags
 *   - xdipx.audience_tags
 *   - xdipx.matters_tags
 *
 * The loader fetches them via `getDiscoveryVocab()` (24h KV-cached) and
 * passes them down to the UI. Editors add a new chip by adding the tag
 * to a product in Shopify — no deploy required.
 *
 * Category is still a closed enum (the top-level nav structure is a
 * product decision, not a merchandiser one).
 */

/** Free-form string aliases; vocabularies are sourced from Shopify at runtime. */
export type Mood     = string
export type Audience = string
export type Matters  = string

/**
 * v1 matters chip set — the original Title-Case-Hyphenated vocabulary that
 * lived in Shopify metafields before the v2 sentence-case migration. Kept
 * exported during the transition window so straggler v1 values still pass
 * any closed-vocab allow-list filtering on the enricher/SMS side.
 */
export const MATTERS_V1 = [
  'Beginner-Friendly',
  'Body-Safe Silicone',
  'Discreet Design',
  'First-Time',
  'Hands-Free',
  'Rechargeable',
  'Soft-Touch',
  'Travel-Size',
  'Waterproof',
  'App-Controlled',
  'Whisper-Quiet',
  'Plus-Size-Friendly',
] as const

/**
 * v2 matters chip set — Co-Work final sign-off vocabulary, sentence-case.
 * Canonical target for the enricher, rules engine, and SMS gate. The home
 * page's runtime display chips are NOT constrained to this set — they're
 * sourced from live Shopify metafield values. See docs/what-matters-final-signoff.md.
 */
export const MATTERS_V2 = [
  'Beginner-friendly',
  'Whisper-quiet',
  'Waterproof',
  'Travel-ready',
  'Discreet',
  'Hands-free',
  'Remote-controlled',
  'Plus-size friendly',
  'Easy to clean',
  'Rechargeable',
  'Soft-touch',
  'Latex-free',
] as const

/** Union of v1 + v2 — allow-list accepting either vocabulary during the transition. */
export const MATTERS = [...MATTERS_V1, ...MATTERS_V2] as const

export const CATEGORIES = ['Pleasure', 'Play', 'Body', 'Wear'] as const
export type Category = (typeof CATEGORIES)[number]

export const SUBCATEGORIES: Record<Category, readonly string[]> = {
  Pleasure: ['Vibrators', 'Dildos', 'For Him', 'Anal'],
  Play:     ['Bondage & Kink', 'Couples'],
  Body:     ['Lubricants', 'Massage', 'Wellness'],
  Wear:     ['Lingerie', 'Accessories'],
}

export interface DiscoveryState {
  mood: Mood[]
  audience: Audience[]
  matters: Matters[]
  /** Dollars. Default 200, slider 20–300. */
  budget: number
  /** Variant B reveal step: 0 intro · 1 mood done · 2 audience done · 3 matters done. */
  step: 0 | 1 | 2 | 3
}

export const DEFAULT_BUDGET = 200
export const BUDGET_MIN = 20
export const BUDGET_MAX = 300

export const EMPTY_STATE: DiscoveryState = {
  mood: [],
  audience: [],
  matters: [],
  budget: DEFAULT_BUDGET,
  step: 0,
}

/**
 * Lean shape used by the home page rails — never the full Shopify product.
 *
 * IMPORTANT: When fields are added / removed / renamed here, bump
 * `INDEX_VERSION` in `app/lib/discovery.server.ts`. KV entries are
 * namespaced by that version; without a bump, a deploy with a new shape
 * will read stale entries with the old shape and silently serve corrupt
 * rail data for up to the TTL window.
 */
export interface DiscoveryProduct {
  id:          string
  handle:      string
  title:       string
  /** Lowest variant price — the "from" price shown on the card. */
  price:       number
  /** Highest variant price; used to show a "$min–$max" range when it differs. */
  priceMax:    number | null
  /**
   * Lowest variant compare-at (MSRP) when on sale, else null. Drives the
   * struck price + "You save $X (Y%)" line, mirroring the PLP VaultCard.
   */
  compareAtPrice: number | null
  /** Distinct Color option values (only meaningful when length > 1). */
  colorValues: string[]
  /** Distinct Size/Length option values (only meaningful when length > 1). */
  sizeValues:  string[]
  /** Featured image URL or null if no media — UI falls back to a tile. */
  imageUrl:    string | null
  imageAlt:    string | null
  category:    Category
  subcategory: string
  mood:        Mood[]
  audience:    Audience[]
  matters:     Matters[]
  /**
   * Shopify total inventory across all locations, or null when Shopify is not
   * tracking inventory for this product. Null items are always allowed through
   * the inventory-floor filter.
   */
  totalInventory: number | null
  /**
   * Shopify's native "Product organization → Type" field as set in the Shopify
   * admin (e.g. "Discontinued", "Vibrator"). This is the curator-facing type
   * that powers `exclude_product_type` rules. Null when unset.
   */
  productType: string | null
  /**
   * The xdipx.product_type_dial metafield value (e.g. "vibrator", "lube"). Used
   * internally to derive the card subcategory caption — NOT the field that
   * exclusion rules match against. Null when the dial is unset or empty.
   */
  productTypeDial: string | null
}

export interface ScoredProduct {
  product: DiscoveryProduct
  score:   number
}

export interface Rail {
  category: Category
  /** Aggregate score across this category's products against the current state. */
  score:    number
  /** Total products in this category before the per-rail slice. */
  total:    number
  items:    ScoredProduct[]
  /**
   * Set to true when the rail was populated by auto-loosening the user's brief
   * because no products matched under the full filter set.
   */
  relaxed?: boolean
  /** Human-readable note surfaced in the rail header when relaxed === true. */
  relaxedReason?: string
}

// ---------------------------------------------------------------------------
// Discovery rules
// ---------------------------------------------------------------------------

/**
 * Curator-defined rule types for the home page discovery rails.
 * The DB stores these as a VARCHAR(40); TypeScript owns the closed union.
 */
export type DiscoveryRuleType =
  | 'exclude_product'
  | 'exclude_product_type'
  | 'exclude_keyword'
  | 'exclude_price_min'
  | 'exclude_price_max'
  /** Single pinned product handle. Backfills the rail in sort_order before any
      collection-based pin is considered. */
  | 'pin_fallback'
  /** Pinned Shopify collection handle. All products in that collection (which
      also live in the discovery index and survive exclusions) are eligible
      backfill, drawn in collection order after product-handle pins. */
  | 'pin_collection_fallback'

/** Mirrors the discovery_rules DB row shape in camelCase. */
export interface DiscoveryRule {
  id:         number
  ruleType:   DiscoveryRuleType
  ruleValue:  string
  /** Null means the rule applies across all categories. */
  category:   Category | null
  sortOrder:  number
  notes:      string | null
  active:     boolean
  createdAt:  Date
  updatedAt:  Date
}

export type HomeVariant = 'a' | 'b'
