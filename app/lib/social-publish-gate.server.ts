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
 *
 * Provenance burn-in (Social Studio v2 Phase 2, #4937, ADR-013 decision 5).
 * `image-provenance` currently passes a url on EITHER test: the legacy
 * filename-prefix check (`isGeneratedSocialAsset`) OR membership in the
 * `social_media_assets` library (`isLibraryMember`). The prefix check is
 * removed in a later cycle once the library holds a full cycle of rows for
 * every generator and the owner upload path; after that, membership alone
 * decides and a pasted external url that happens to start with `social-`
 * can no longer pass. A membership lookup that throws counts as not a member.
 */

import { allMediaAreGeneratedSocialAssets, isGeneratedSocialAsset } from './social-media.server'
import { X_CAPTION_MAX, T_CO_LENGTH, weightedTweetLength } from './social-publish/x-limits'

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

/**
 * Platforms these checks know how to reason about.
 *
 * Not every rule is universal: what Instagram removes a post for and what X
 * removes a post for differ, and a gate that pretended otherwise would either
 * under-protect Instagram or make X useless. Each divergence is annotated where
 * it appears rather than collected here.
 */
export type GatePlatform = 'instagram' | 'x'

export interface DeterministicGateInput {
  caption: string
  mediaUrls: readonly string[] | null | undefined
  /**
   * Defaults to Instagram, which is what every caller did before X existed.
   * Keeping the default means the Instagram path is byte-identical and its
   * tests never had to learn about this parameter.
   */
  platform?: GatePlatform
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
  /**
   * Text baked into the image the post ships with, when the drafter supplies it.
   * Moderation reads on-image text the same way it reads the caption, so the
   * lexicon check scans it too. `social_posts` has no column for this yet, so
   * like `productHandle` it is caller-supplied and absent means "nothing to
   * scan", never "cleared".
   */
  onImageText?: string | null
  /**
   * Alt text attached to the media. Same story as `onImageText`: caller-supplied
   * today, scanned by the lexicon check when present.
   */
  altText?: string | null
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
const SALE_PATTERNS: {
  check: string
  re: RegExp
  detail: string
  /** Omitted means every platform. */
  appliesTo?: readonly GatePlatform[]
}[] = [
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
    // Instagram only, and the exception is the point rather than an oversight.
    // Instagram has no clickable link in a caption, so a PDP URL there is both
    // useless and a Restricted Goods signal. On X a link is the entire reason
    // the post exists: it is clickable, it is how the account drives traffic,
    // and X's own policy permits it. Blocking it there would leave the platform
    // able to post and unable to sell.
    appliesTo: ['instagram'],
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

/**
 * Patterns that read as the caption narrating its own picture (owner direction
 * 2026-08-22, root-caused from social_posts row 80: "that is jade in the
 * photo, sleeves pushed up at a sunny bathroom sink"). Before migration 085,
 * `social_posts` had no `alt_text` column and the Instagram publisher had
 * nowhere to send an accessibility description, so it was being written into
 * the caption instead. The fix for the column is additive; this is the fix
 * for the symptom that keeps recurring even after a column exists, because a
 * drafter can still write the description into the caption by habit.
 */
const CAPTION_DESCRIBES_IMAGE_PATTERNS: RegExp[] = [
  /\b(in|of) (the|this|that) (photo|picture|image|frame|shot)\b/i,
  /\bthat is (one of our cast|[a-z]+) (in|holding|at|standing|sitting|rinsing|washing)\b/i,
  /^\s*visual description/im,
  /\bso you can see (just )?how\b/i,
  /\bpictured\b/i,
  /\bin the (photo|pic)\b/i,
]

/**
 * Vocabulary that the rented, machine-moderated platforms REMOVE accounts over,
 * not merely age-gate (ticket #4062, narrowed by ticket #5482).
 *
 * Meta's Adult Sexual Solicitation standard
 * (transparency.meta.com/policies/community-standards/sexual-solicitation, last
 * read 2025-05-15) puts explicit or graphic detail about three things —
 * Genitals, States of sexual arousal, and Sexual Encounters — in the PROHIBITED
 * tier, whose remedy is removal. Merely discussing sexual practices in clinical
 * or mechanism terms sits in the RESTRICTED tier (an 18+ age gate), which is not
 * an account risk and is deliberately NOT listed here. The mechanism-and-health
 * vocabulary the drafter should rewrite toward ("stimulation", "pleasure",
 * "sensation", "arousal", "climax", "pelvic floor") passes untouched. This is
 * why the remedy is a redraft, never a coded spelling: docs/ads-policy.md line
 * 100 forbids character substitution and reclaimed hashtags, and Instagram's
 * teen-account search block now extends to misspelled variants, so leetspeak
 * buys nothing and costs discoverability.
 *
 * ticket #5482 (owner-approved 2026-08-25): the original list put every
 * clinical genital noun ("clitoris", "vulva", "vagina", "labia", "penis",
 * "anus") in the same PROHIBITED bucket as crude slang and graphic acts,
 * anchored to the @bellesaco suspension for the word "clitoris" in ORGANIC
 * content. `docs/emma-voice.md` (Instagram section, owner correction
 * 2026-08-22 evening, lines 310-323) says that removal is not evidence of a
 * word ban: "Orgasm", "the orgasm gap", "clitoris", "vulva", "erection" are
 * ordinary nouns in a sentence that states a fact or explains how a product
 * works, and "air pulsation seals over the clitoris and pulses" is the
 * charter's own worked example of a mechanism sentence that must pass. The
 * code was refusing the charter's own example. The audit trail agrees: the
 * only two Instagram rows ever removed by this gate (23 and 80) contain zero
 * lexicon terms between them (row 80 is about washing silicone), so the
 * clinical-noun block has never once caught a real removal, only mechanism
 * copy the charter wants published. The tier split below follows the
 * precedent already set for "arousal" a few lines up: the clinical umbrella
 * word is deliberately absent from the blocking list so mechanism copy is not
 * blocked, while the graphic forms stay listed.
 *
 * Five named, data-driven tiers. Moving a term between tiers is a one-line
 * edit to which array it lives in, never a change to the scan logic below.
 */
type LexiconCategory = 'genitals' | 'sexual-encounters' | 'states-of-arousal'

interface LexiconTerm {
  /** Human-readable label used in the finding detail. */
  label: string
  /** Word-boundaried so "document" never trips "cum" and "peacock" never trips "cock". */
  re: RegExp
  /** Which of Meta's three PROHIBITED-tier categories this belongs to. */
  category: LexiconCategory
}

type LexiconTierName =
  | 'clinical-anatomy'
  | 'crude-slang'
  | 'act-naming'
  | 'arousal-states'
  | 'borderline-acts'

interface LexiconTier {
  name: LexiconTierName
  /** Whether a hit in this tier produces a `caption-lexicon` block finding. */
  blocks: boolean
  terms: readonly LexiconTerm[]
}

// Tier 1: clinical anatomy. NOT blocking (ticket #5482). These are ordinary
// nouns in a mechanism-or-fact sentence per the charter quote above, and the
// audit found no removal ever traced to one of them. Removed from the
// blocking lexicon entirely rather than downgraded to `hold`: a `hold` would
// still stall unattended publishing on every mechanism caption that names a
// body part, which does not satisfy the owner's goal of zero manual editing,
// and the charter disclaims the noun ban outright rather than making it
// owner-reviewable. The JUDGMENT layer (the independent `social-publish-gate`
// reviewer agent, which reads register on every post) stays responsible for
// catching graphic act narration on these words, as distinct from the plain
// vocabulary this scripted check used to refuse.
const CLINICAL_ANATOMY: readonly LexiconTerm[] = [
  { label: 'clitoris', re: /\bclit(oris|oral|s)?\b/i, category: 'genitals' },
  { label: 'vulva', re: /\bvulvas?\b/i, category: 'genitals' },
  { label: 'vagina', re: /\bvaginas?\b|\bvaginal\b/i, category: 'genitals' },
  { label: 'labia', re: /\blabias?\b/i, category: 'genitals' },
  { label: 'penis', re: /\bpenis(es)?\b/i, category: 'genitals' },
  { label: 'anus', re: /\banus\b|\banal\b/i, category: 'genitals' },
]

// Tier 2: crude slang for genitals. Stays blocked; the charter bans crude
// slang outright regardless of framing.
const CRUDE_SLANG: readonly LexiconTerm[] = [
  { label: 'cock', re: /\bcocks?\b/i, category: 'genitals' },
  { label: 'dick', re: /\bdicks?\b/i, category: 'genitals' },
  { label: 'pussy', re: /\bpuss(y|ies)\b/i, category: 'genitals' },
  { label: 'cunt', re: /\bcunts?\b/i, category: 'genitals' },
]

// Tier 3: naming the act. Stays blocked; the charter's Instagram rule is the
// act is implied, never named. The mechanism rewrite ("external stimulation",
// "internal", "solo") is the intended remedy, not a coded spelling.
const ACT_NAMING: readonly LexiconTerm[] = [
  { label: 'blowjob', re: /\bblow\s?jobs?\b/i, category: 'sexual-encounters' },
  { label: 'handjob', re: /\bhand\s?jobs?\b/i, category: 'sexual-encounters' },
  { label: 'cunnilingus', re: /\bcunnilingus\b/i, category: 'sexual-encounters' },
  { label: 'fellatio', re: /\bfellatio\b/i, category: 'sexual-encounters' },
  { label: 'cum', re: /\bcum(ming|s)?\b/i, category: 'sexual-encounters' },
  { label: 'squirt', re: /\bsquirt(s|ed|ing)?\b/i, category: 'sexual-encounters' },
  { label: 'ejaculation', re: /\bejaculat(e|es|ed|ing|ion)\b/i, category: 'sexual-encounters' },
]

// Tier 4: states of sexual arousal, graphic only. Stays blocked. The clinical
// umbrella word "arousal" is RESTRICTED, not removal, and is intentionally
// absent so mechanism copy is not blocked; only the graphic forms are listed.
const AROUSAL_STATES: readonly LexiconTerm[] = [
  { label: 'horny', re: /\bhorny\b/i, category: 'states-of-arousal' },
  { label: 'throbbing', re: /\bthrobbing\b/i, category: 'states-of-arousal' },
]

// Tier 5: borderline. These name acts, not anatomy, so ticket #5482 does not
// move them: the ticket narrows the clinical-anatomy noun ban only. Owner
// explicit direction 2026-08-25: keep these blocked. Recorded here, in their
// own named tier, so a future reader does not mistake the omission from tier
// 1 for an oversight; moving one of these to non-blocking later is a one-line
// change of which array it lives in.
const BORDERLINE_ACTS: readonly LexiconTerm[] = [
  { label: 'intercourse', re: /\bintercourse\b/i, category: 'sexual-encounters' },
  { label: 'masturbation', re: /\bmasturbat(e|es|ed|ing|ion|ory)\b/i, category: 'sexual-encounters' },
  { label: 'penetration', re: /\bpenetrat(e|es|ed|ing|ion|ive)\b/i, category: 'sexual-encounters' },
]

const CAPTION_LEXICON_TIERS: readonly LexiconTier[] = [
  { name: 'clinical-anatomy', blocks: false, terms: CLINICAL_ANATOMY },
  { name: 'crude-slang', blocks: true, terms: CRUDE_SLANG },
  { name: 'act-naming', blocks: true, terms: ACT_NAMING },
  { name: 'arousal-states', blocks: true, terms: AROUSAL_STATES },
  { name: 'borderline-acts', blocks: true, terms: BORDERLINE_ACTS },
]

/**
 * Flattened, tier-tagged view of every term across all five tiers, including
 * the non-blocking clinical-anatomy tier. This is the single, reviewable
 * place to tune the list: edit which tier array a term lives in, not the scan
 * logic. The scan below only acts on entries where `blocks` is true.
 */
export const CAPTION_LEXICON: readonly (LexiconTerm & {
  tier: LexiconTierName
  blocks: boolean
})[] = CAPTION_LEXICON_TIERS.flatMap(tier =>
  tier.terms.map(term => ({ ...term, tier: tier.name, blocks: tier.blocks })),
)

/**
 * Platforms whose automated moderation removes accounts over the vocabulary in
 * CAPTION_LEXICON, so the check runs there and nowhere else.
 *
 * Instagram and TikTok are the rented, machine-moderated surfaces this protects.
 * X is out: its policy permits this vocabulary and blocking it there would gag
 * the account for no safety gain (DONE WHEN #2). The owned channels — email,
 * SMS, the storefront, the Notebook — are out for the opposite reason: plain
 * anatomical language is exactly where it belongs, and none of them route
 * through this gate anyway.
 *
 * TikTok is named in the ticket and belongs in this set, but it is not yet a
 * `GatePlatform`: the approve path 409s a tiktok row before it reaches this gate
 * (see `isGatePlatform` in social-publish-approve.server.ts). It slots into this
 * allowlist automatically the day TikTok becomes gate-eligible. Today the only
 * in-union member is Instagram, and the allowlist form — rather than a
 * `platform !== 'x'` denylist — means a future OWNED platform added to the union
 * is not silently swept in.
 */
const CAPTION_LEXICON_PLATFORMS: readonly GatePlatform[] = ['instagram']

/** Normalise for shingle comparison: strip URLs, lowercase, strip punctuation,
 * collapse space.
 *
 * URLs are removed BEFORE punctuation is collapsed. The repetition check is
 * meant to compare prose, but the punctuation pass turns `= & : /` into spaces,
 * so a tracking link like `https://xdipx.com/p?utm_source=x&utm_medium=social&
 * utm_campaign=aug` tokenizes to `utm source x utm medium social utm campaign` —
 * an eight-word run that is byte-identical on every post carrying the standard
 * UTMs and collides with any prior post using the same source/medium. That
 * false-positived genuinely different X prose (run 438) and pushed drafters to
 * hand-vary utm_medium per post just to dodge the check, degrading GA4
 * attribution consistency. Stripping URLs keeps the comparison on prose only. */
function normalizeForShingles(s: string): string {
  return s
    // Whole URLs (scheme present), including their query strings.
    .replace(/https?:\/\/\S+/gi, ' ')
    // Scheme-less links that still carry a `?key=value` query string, so a link
    // written without http(s):// is handled too. Requires a `=` after the `?`,
    // so prose questions ("really?") are never touched.
    .replace(/\S*\?[^\s?]*=\S*/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
    /** Library membership (#4937). Defaults to the real lookup; a throw is not-a-member. */
    isLibraryMember?: (url: string) => Promise<boolean>
  },
): Promise<DeterministicGateResult> {
  const findings: GateFinding[] = []
  const caption = input.caption ?? ''
  const platform: GatePlatform = input.platform ?? 'instagram'

  // ── Imagery provenance ────────────────────────────────────────────────────
  //
  // Media is required on X as well as Instagram. X would accept a text-only
  // post, but every draft the social team writes is built around a generated
  // asset, and a post that silently loses its image is a content change nothing
  // reviewed. Owner decision 2026-08-16.
  //
  // Burn-in dual check (#4937, see the file header): a url passes on the
  // legacy prefix OR on library membership. The membership lookup is only
  // made for urls the prefix check refuses, so a prefix-named post costs no
  // database read. A lookup that throws is treated as not-a-member.
  const media = input.mediaUrls ?? []
  const memberOf = deps?.isLibraryMember ?? (async (url: string) => {
    const { isLibraryMember } = await import('./social-asset-library.server')
    return isLibraryMember(url)
  })
  const offenders: string[] = []
  if (!allMediaAreGeneratedSocialAssets(media)) {
    for (const u of media.filter(u => !isGeneratedSocialAsset(u))) {
      let member = false
      try {
        member = await memberOf(u)
      } catch (err) {
        console.error(`[social-publish-gate] library membership lookup failed, treating as not a member: ${u}`, err)
      }
      if (!member) offenders.push(u)
    }
  }
  if (media.length === 0 || offenders.length > 0) {
    findings.push({
      check: 'image-provenance',
      severity: 'block',
      detail: media.length === 0
        ? `Post has no media. A ${platform === 'x' ? 'published X' : 'published Instagram'} post cannot go out without it.`
        : `Not generated social art (neither a generated-asset filename nor a social image library row): ${offenders.slice(0, 3).join(', ')}. Packshot-only stills are retired.`,
    })
  }

  // ── Length, X only ────────────────────────────────────────────────────────
  //
  // X rejects an over-length post, and it does so after the media upload has
  // already been billed. Catching it here means the spend is never committed.
  // Instagram's ceiling is 2200 and the publisher truncates to it, so there is
  // nothing to check on that side.
  if (platform === 'x') {
    const length = weightedTweetLength(caption)
    if (length > X_CAPTION_MAX) {
      findings.push({
        check: 'caption-too-long',
        severity: 'block',
        detail: `Post is ${length} characters as X counts them (limit ${X_CAPTION_MAX}; links count as ${T_CO_LENGTH} regardless of real length).`,
      })
    }
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
    if (p.appliesTo && !p.appliesTo.includes(platform)) continue
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

  // ── Caption: removal-tier lexicon (Instagram/TikTok only) ─────────────────
  //
  // Meta and TikTok REMOVE accounts over crude slang and graphic acts, so this
  // scans everything moderation reads, the caption, any on-image text the
  // drafter supplied, and the alt text, and blocks the draft. The remedy is a
  // rewrite in mechanism-and-health framing, never a coded spelling. X and the
  // owned channels are out of scope; see CAPTION_LEXICON_PLATFORMS.
  //
  // CONSEQUENCE (ticket #5482): only tiers where `blocks` is true are scanned
  // here, which as of this ticket excludes clinical-anatomy. That tier's terms
  // ("clitoris", "vulva", "vagina", "labia", "penis", "anus") no longer produce
  // any finding, block or hold, on this path. The hourly unattended autopublish
  // tick refuses on `gate.blocked || gate.held`
  // (social-publish-job.server.ts), while manual owner publish passes a `held`
  // finding through (social-publish/manual-publish-gate.server.ts). Because
  // this tier is not even a `hold`, a caption containing a clinical anatomy
  // noun can now ship on the unattended hourly tick with no owner click at
  // all. That is the approved intent (owner goal: zero manual editing for
  // mechanism copy the charter already allows), not an oversight.
  if (CAPTION_LEXICON_PLATFORMS.includes(platform)) {
    const lexiconText = [caption, input.onImageText ?? '', input.altText ?? ''].join('\n')
    const hits = CAPTION_LEXICON.filter(t => t.blocks && t.re.test(lexiconText))
    if (hits.length) {
      findings.push({
        check: 'caption-lexicon',
        severity: 'block',
        detail:
          `Caption, on-image text, or alt text carries removal-tier vocabulary: ` +
          `${hits.map(h => h.label).join(', ')}. Meta and TikTok remove accounts for this, they do ` +
          `not age-gate it. Rewrite in mechanism-and-health framing (e.g. "external stimulation", ` +
          `not the explicit term); do not use coded spellings, which the charter forbids and search ` +
          `blocks anyway.`,
      })
    }
  }

  // ── Caption describes its own image ───────────────────────────────────────
  //
  // Severity is `block` (not `hold`), matching every other fixable-by-redraft
  // caption defect in this module (sale-cta, caption-lexicon, repetition):
  // `applyPublishGateVerdict` turns any `block` finding on a PASS into
  // `needs_changes`/REVISE and sends the drafter the findings to act on, which
  // is exactly the outcome wanted here. `hold` is reserved for genuine account
  // risk that needs the owner, which this is not, the fix is a redraft that
  // moves the description into altText, a thing this module's caller cannot do
  // safely on its own. `warn` would record it and publish anyway, defeating
  // the point. This module has only these three severities (see the header);
  // there is no fourth "revise" severity to reach for.
  if (CAPTION_DESCRIBES_IMAGE_PATTERNS.some(re => re.test(caption))) {
    findings.push({
      check: 'caption-describes-image',
      severity: 'block',
      detail:
        'Caption describes its own image; the accessibility description belongs in altText ' +
        '(charter social addendum, 2026-08-22)',
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
