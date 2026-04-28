import type { Deal, ProductTypeDial } from '~/types'

/**
 * Static Emma-voice one-liners keyed by productTypeDial. Used as the fallback
 * when the Claude call errors, times out, or is budget-throttled — and also
 * as the initial render shape for any product with no cached aside yet.
 *
 * Voice rules (per CLAUDE.md):
 * - First-person Emma aside, trusted friend tone
 * - No "Buy now", no countdowns, no clinical language
 * - Suggestive is fine, explicit is not
 * - Optional ♥ at the end
 */

type Pool = readonly string[]

const WAND: Pool = [
  "Wands hit different once you stop being polite about the intensity.",
  "Put the rumble through a pillow the first time — future you will say thanks ♥",
  "I'd say start low. Loud wands deserve a gentle intro.",
  "Built for the nights you want zero subtlety.",
  "If it's your first wand, keep a free hand — the lowest setting is louder than it looks.",
  "The kind of thing you reach for when nothing else is cutting it ♥",
  "Neighbors will know. Worth it.",
]

const VIBRATOR: Pool = [
  "Small, mighty, and weirdly easy to recommend to anyone.",
  "I tested this on a lazy Sunday and then tested it again Monday morning for science ♥",
  "Quiet enough for a roommate situation, loud enough where it counts.",
  "The kind of thing that lives in the top drawer, not the back one.",
  "Honestly the ratio of fuss to payoff here is very in your favor.",
  "If you're new to this category, this is the one I'd hand a friend first.",
  "Discreet shape, not-so-discreet reputation ♥",
]

const AIR_PULSATION: Pool = [
  "Air pulse feels nothing like a regular vibe — ease in, don't grip it like a drill.",
  "Less pressure, not more. I promise.",
  "The first time, I thought it was broken. Then I got the angle right ♥",
  "If you've never tried suction-style, prepare to be confused and then very much not.",
  "Works best when you stop trying to make it work.",
  "A weird little device that ends up being the most-used thing in the drawer.",
]

const LUBE: Pool = [
  "A little goes further than you think — start small, re-apply if needed.",
  "I keep one of these on every nightstand in the house. No shame ♥",
  "Non-negotiable tool, honestly. Don't be a hero about skipping it.",
  "Pairs with literally everything in your drawer.",
  "The quiet MVP of the entire category.",
  "Better sessions, fewer regrets — that's the whole pitch.",
]

const WEAR: Pool = [
  "Fit matters more than the specs. Read the sizing twice ♥",
  "Worn under clothes without anyone clocking it — that's the whole appeal.",
  "The kind of thing that's fun alone and more fun handed over to a partner.",
  "If you're new to wearable stuff, take the first wear slow.",
  "Built to disappear under a hem and show up exactly when you want it to.",
]

const DEFAULT: Pool = [
  "One of the ones I quietly recommend over coffee ♥",
  "Not flashy, just genuinely good at what it does.",
  "The kind of thing you buy once and stop overthinking.",
  "I've been telling people about this combo for a while now.",
  "Weirdly hard to make a bad choice here — it all lands.",
  "Tested, approved, still in rotation ♥",
]

// Phase 1 rebuild — ProductTypeDial expanded to 19 values. Legacy `wand` and
// `air-pulsation` are now subtypes of `vibrator`; their lines are merged into
// the `vibrator` pool. Top-level types without a curated pool fall through to
// DEFAULT — adequate fallback voice until we curate per-type lines.
const POOLS: Partial<Record<ProductTypeDial, Pool>> = {
  vibrator: [...VIBRATOR, ...WAND, ...AIR_PULSATION],
  lube:     LUBE,
  wear:     WEAR,
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/** Deterministic per-product fallback pick. Same product → same line every time. */
export function getFallbackAside(product: Pick<Deal, 'id' | 'productTypeDial'>): string {
  const pool = product.productTypeDial ? POOLS[product.productTypeDial] : DEFAULT
  const lines = pool && pool.length > 0 ? pool : DEFAULT
  const idx = hashString(product.id) % lines.length
  return lines[idx] ?? DEFAULT[0]!
}
