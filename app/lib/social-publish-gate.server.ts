/**
 * Deterministic pre-publish checks for Instagram (ticket #2739).
 *
 * Context. The owner directed on 2026-08-11 that he stops approving posts
 * before they ship. His click was the last human check, so what replaces it has
 * to be at least as good at the things a human catches by looking. This module
 * is the half of that which does not need judgment.
 *
 * The split is deliberate, and it came from the voice reviewer's own read on
 * whether it could carry publish authority. Its answer was no: it reviews
 * strings, never opens the images, has no live stock read, and sees one draft
 * in isolation so it cannot see repetition across a feed. It asked for the
 * checkable things to be "a scripted check against Shopify, not an agent's
 * memory". This is that script. The agent judges what needs judgment; this
 * catches what can be caught mechanically, and it cannot be talked out of a
 * verdict by a persuasive draft.
 *
 * Severity has three levels and they mean different things:
 *  - `block`  the post does not publish. A rule was broken that has a known
 *             remedy (redraft, swap the product, regenerate the asset).
 *  - `hold`   publishing pauses for the owner. Reserved for genuine account
 *             risk that no agent should self-certify. He asked not to be a
 *             bottleneck, so this must stay rare and must never be reached for
 *             when `block` would do.
 *  - `warn`   recorded, does not stop anything.
 *
 * Everything here FAILS CLOSED. A check that cannot complete returns a finding
 * rather than silently passing, because "the stock API was down" is not a
 * reason to publish a post about an out-of-stock product.
 */

import { allMediaAreGeneratedSocialAssets, isGeneratedSocialAsset } from './social-media.server'

/**
 * Is this product sellable right now?
 *
 * Availability lives per variant on the Storefront API, not on the product, so
 * a product is sellable when ANY variant is: the same question the PDP's buy
 * button asks. Extracted and exported because the injected-dependency tests
 * below stub the lookup entirely, which means this is exactly the logic they
 * would not have covered.
 */
export function isProductSellable(
  product: { variants: readonly { availableForSale: boolean }[] } | null | undefined,
): boolean | null {
  // null means the Storefront API has no such product, which is how an ARCHIVED
  // or DRAFT product presents: Shopify drops it entirely. Definitively not
  // sellable, and distinct from "every variant is out of stock".
  if (!product) return null
  return product.variants.some(v => v.availableForSale)
}

export type GateSeverity = 'block' | 'hold' | 'warn'

export interface GateFinding {
  /** Stable slug so a verdict can be counted and grepped over time. */
  check: string
  severity: GateSeverity
  detail: string
}

export interface DeterministicGateInput {
  caption: string
  mediaUrls: readonly string[] | null | undefined
  /**
   * Handle of the product the post features, when it features one. License D
   * posts (education, inspiration) legitimately have none, and a missing handle
   * is not a finding on its own.
   *
   * `social_posts` has no product_handle column today, so the caller supplies
   * this. That gap is real and tracked; until it closes, a product post whose
   * handle the caller cannot determine should be treated as unverifiable rather
   * than assumed in stock.
   */
  productHandle?: string | null
  /** Captions of recent posted rows, newest first, for the repetition check. */
  recentCaptions?: readonly string[]
}

export interface DeterministicGateResult {
  findings: GateFinding[]
  /** True when any finding blocks. */
  blocked: boolean
  /** True when any finding needs the owner and nothing blocks outright. */
  held: boolean
}

/**
 * Caption patterns that read as an attempt to sell.
 *
 * This is the gate that matters most on Instagram. Meta's Restricted Goods
 * standard removes content that promotes the use of, or attempts to sell,
 * adult products, and that is an act of commerce rather than an act of
 * raciness: a tasteful photo with a clean caption is removable if the post is
 * selling. These are the machine-detectable forms of selling.
 */
const SALE_PATTERNS: { check: string; re: RegExp; detail: string }[] = [
  {
    check: 'sale-price',
    re: /\$\s?\d/,
    detail: 'Caption names a price. Instagram captions never carry a price.',
  },
  {
    check: 'sale-discount',
    re: /\b\d{1,3}\s?%\s*(off|discount)\b|\b(percent off)\b/i,
    detail: 'Caption offers a discount.',
  },
  {
    check: 'sale-promo-code',
    re: /\b(promo|coupon|discount)\s*code\b|\bcode\s*[:=]?\s*[A-Z0-9]{4,}\b/,
    detail: 'Caption carries a promo code.',
  },
  {
    check: 'sale-cta',
    re: /\b(shop now|buy now|order now|add to cart|swipe up to buy|tap to buy|get yours now)\b/i,
    detail: 'Caption carries a shop CTA. The commerce path is post to profile to link in bio.',
  },
  {
    check: 'sale-pdp-link',
    re: /xdipx\.com\/products\//i,
    detail: 'Caption points at a PDP. Instagram captions route commerce through the bio link only.',
  },
]

/**
 * Emoji the charter bans outright on these platforms. Vocabulary here is
 * moderated by machine, which reads words and not intent, so these are read as
 * anatomy regardless of what was meant.
 */
const BANNED_EMOJI = ['🍑', '🍆', '💦', '🌊', '🍒'] as const

/** Words that make a caption read as lived experience, which Emma never has. */
const LIVED_EXPERIENCE_RE =
  /\bI\s+(tried|tested|used|owned|own|bought|felt|wore)\b|\bmy\s+(favou?rite|go-to)\s+toy\b/i

/** Normalise for shingle comparison: lowercase, strip punctuation, collapse space. */
function normalizeForShingles(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Every n-word window of a caption. */
export function shingles(text: string, n: number): Set<string> {
  const words = normalizeForShingles(text).split(' ').filter(Boolean)
  const out = new Set<string>()
  if (words.length < n) return out
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '))
  return out
}

/**
 * Longest verbatim run shared with any earlier caption, in words.
 *
 * Eight is the threshold rather than three or four because short overlaps are
 * unavoidable in one brand's voice ("a little anatomy your group chat skipped"
 * shares plenty with itself), while an eight-word verbatim run is recycling.
 * The charter's rule is fresh product-specific language every time.
 */
export const REPETITION_SHINGLE = 8

export function findRepeatedRun(
  caption: string,
  recentCaptions: readonly string[],
): string | null {
  const candidate = shingles(caption, REPETITION_SHINGLE)
  if (candidate.size === 0) return null
  for (const prior of recentCaptions) {
    for (const s of shingles(prior, REPETITION_SHINGLE)) {
      if (candidate.has(s)) return s
    }
  }
  return null
}

/**
 * Run every mechanical check. Pure except for the stock read, which is injected
 * so this stays testable without a Shopify round trip.
 *
 * The stock lookup goes through `getProductByHandle`, whose cache TTL is 60s.
 * That staleness is acceptable here and worth naming: the publish path already
 * tolerates a far larger window between a scheduled slot and the actual call,
 * so a minute of cache is not the weak link. Draft-time checking alone was, and
 * that is what put an out-of-stock product on the feed on 2026-08-09.
 */
export async function runDeterministicPublishChecks(
  input: DeterministicGateInput,
  deps?: {
    getAvailability?: (handle: string) => Promise<boolean | null>
  },
): Promise<DeterministicGateResult> {
  const findings: GateFinding[] = []
  const caption = input.caption ?? ''

  // ── Imagery provenance ────────────────────────────────────────────────────
  const media = input.mediaUrls ?? []
  if (!allMediaAreGeneratedSocialAssets(media)) {
    const offenders = media.filter(u => !isGeneratedSocialAsset(u))
    findings.push({
      check: 'image-provenance',
      severity: 'block',
      detail: media.length === 0
        ? 'Post has no media. An Instagram post cannot publish without it.'
        : `Not generated social art: ${offenders.slice(0, 3).join(', ')}. Packshot-only stills are retired.`,
    })
  }

  // ── Stock, re-checked at publish time ─────────────────────────────────────
  if (input.productHandle) {
    const lookup = deps?.getAvailability ?? (async (handle: string) => {
      const { getProductByHandle } = await import('./shopify.server')
      const product = await getProductByHandle(handle)
      return isProductSellable(product)
    })
    let available: boolean | null
    try {
      available = await lookup(input.productHandle)
    } catch {
      available = null
    }
    if (available === null) {
      findings.push({
        check: 'stock-unverifiable',
        severity: 'block',
        detail: `"${input.productHandle}" is not on the storefront (archived, draft, or an unknown handle), or the lookup failed. Either way it is not publishable.`,
      })
    } else if (!available) {
      findings.push({
        check: 'stock-out',
        severity: 'block',
        detail: `"${input.productHandle}" is not available for sale.`,
      })
    }
  }

  // ── Caption: attempts to sell ─────────────────────────────────────────────
  for (const p of SALE_PATTERNS) {
    if (p.re.test(caption)) {
      findings.push({ check: p.check, severity: 'block', detail: p.detail })
    }
  }

  // ── Caption: banned vocabulary ────────────────────────────────────────────
  const foundEmoji = BANNED_EMOJI.filter(e => caption.includes(e))
  if (foundEmoji.length) {
    findings.push({
      check: 'emoji-anatomy',
      severity: 'block',
      detail: `Caption carries banned emoji: ${foundEmoji.join(' ')}.`,
    })
  }
  if (LIVED_EXPERIENCE_RE.test(caption)) {
    findings.push({
      check: 'lived-experience',
      severity: 'block',
      detail: 'Caption claims lived experience. Emma is an AI guide and has none.',
    })
  }

  // ── Repetition across the live feed ───────────────────────────────────────
  const repeated = findRepeatedRun(caption, input.recentCaptions ?? [])
  if (repeated) {
    findings.push({
      check: 'repetition',
      severity: 'block',
      detail: `Repeats a run from an earlier post: "${repeated}". Fresh language every time.`,
    })
  }

  const blocked = findings.some(f => f.severity === 'block')
  const held = !blocked && findings.some(f => f.severity === 'hold')
  return { findings, blocked, held }
}
