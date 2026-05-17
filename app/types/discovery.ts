/**
 * "Find you in a product" — home page discovery types.
 *
 * The chip vocabulary mirrors the design prototype in
 * `docs/discovery-prototype/`. Tags are stored on Shopify products via
 * the `xdipx.mood_tags`, `xdipx.audience_tags`, `xdipx.matters_tags`
 * metafields. Category derives from `xdipx.category` (top-level nav).
 */

export const MOODS = [
  'Sensual',
  'Slow & Intimate',
  'Playful',
  'Adventurous',
  'Bold',
  'Indulgent',
  'Romantic',
  'Curious',
  'Comforting',
  'Energetic',
  'Unhurried Solo',
] as const
export type Mood = (typeof MOODS)[number]

export const AUDIENCES = [
  'Me',
  'Us',
  'A Partner',
  'Date Night',
  'Solo',
  'Gift',
] as const
export type Audience = (typeof AUDIENCES)[number]

/**
 * v1 chip set — the original 12-chip vocabulary that exists in Shopify
 * metafields today (Title-Case-Hyphenated mix). Kept exported for the
 * transition window so the allow-list can accept legacy values until step
 * 5.5 backfill rewrites Shopify with v2 values. After backfill clears, this
 * collapses into MATTERS_V2.
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
 * v2 chip set — Co-Work final sign-off vocabulary, sentence-case.
 * See docs/what-matters-final-signoff.md.
 *
 * Activated via the MATTERS_V2_ENABLED env flag (read by getActiveMatters()
 * in app/lib/feature-flags.server.ts). Until then, this lives in code as the
 * "post-launch" set and the v1 set drives the UI.
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

/**
 * Union of v1 + v2 chip values. Acts as the allow-list (whitelist) used in
 * discovery.server.ts to filter Shopify metafield values — products tagged
 * with EITHER vocabulary pass through during the migration window.
 *
 * After step 5.5 backfill rewrites Shopify with v2 values and the flag flips
 * live, this can collapse to just MATTERS_V2.
 */
export const MATTERS = [...MATTERS_V1, ...MATTERS_V2] as const
export type Matters = (typeof MATTERS)[number]

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

/** Lean shape used by the home page rails — never the full Shopify product. */
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
