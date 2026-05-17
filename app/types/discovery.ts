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
  price:       number
  /** Storefront image URL or null if no media — UI falls back to a tile. */
  imageUrl:    string | null
  imageAlt:    string | null
  category:    Category
  subcategory: string
  mood:        Mood[]
  audience:    Audience[]
  matters:     Matters[]
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
}

export type HomeVariant = 'a' | 'b'
