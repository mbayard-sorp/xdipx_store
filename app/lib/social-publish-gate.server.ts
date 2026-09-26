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
 *
 * Media reachability (ticket #11453). `image-provenance` and `vision-verdict`
 * both judge a media url's NAME (does it look generated, does a library row
 * carry a verdict for it); neither one ever asks whether the url actually
 * resolves. Row 306 (2026-09-24) was a composed filename shaped like the
 * library's own naming convention, built from the archetype and product
 * handle rather than read off a real `social_media_assets` row: it 404s, but
 * it happened to read exactly like a legacy prefix-named asset with no
 * recorded verdict, so it was blocked by `vision-verdict` only by accident,
 * on a finding that reads identically for a real-but-uninspected asset. A 404
 * is a distinct, more certain failure and gets its own `media-unreachable`
 * finding so the two are never confused in a run summary; see
 * `defaultCheckMediaReachable` and the check inside
 * `runDeterministicPublishChecks` below.
 */

import { allMediaAreGeneratedSocialAssets, isGeneratedSocialAsset } from './social-media.server'
import { X_CAPTION_MAX, T_CO_LENGTH, weightedTweetLength } from './social-publish/x-limits'
import { VISION_CHECK_NAMES, type VisionCheckName, type VisionVerdict } from './social-vision-gate.server'

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
  /**
   * `social_posts.cast_slugs` — the cast members drafted into this frame.
   * Consulted by the cast/product casting gate (ADR-015, ticket #10730)
   * alongside `productHandle`'s resolved `xdipx.cast_target`. Absent or empty
   * means no cast recorded; the casting check below treats that as a finding
   * only when the product's cast_target is non-universal (fail closed).
   */
  castSlugs?: readonly string[] | null
  /**
   * Explicit reason the drafter recorded for why no lube pairing applies to a
   * toy-featuring draft, per the pairing-presence self-check
   * (docs/store-team/routine-social-daily.md, "Pairing-presence self-check
   * (every toy-featuring draft, at draft time)"). `social_posts` has no
   * column for this yet, so like `onImageText`/`altText` below it is
   * caller-supplied; absent means "no reason recorded", never "cleared".
   */
  pairingNoneReason?: string | null
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
  /**
   * `social_posts.created_at` for the draft under review. Used only by the
   * vision-verdict legacy carve-out below, as the fallback age signal for a
   * prefix-named asset that has no `social_media_assets` row at all.
   *
   * REQUIRED, not optional, since ticket #10476, and that is the whole point
   * of the field's shape. While it was optional, five of the seven call sites
   * never passed it and typecheck said nothing, so every one of them landed in
   * the "age unknown" branch, which used to skip silently. A row about to
   * publish always has a created_at, so "unknown" never meant "old", it meant
   * "the caller did not tell me". `null` is still accepted, for a caller that
   * genuinely has no row (a hand-built input, a test), but it now has to be
   * written down on purpose and it fails closed below.
   */
  postCreatedAt: string | Date | null
  /**
   * `social_posts.poster_url`, the video poster frame, when the row carries
   * one (ticket #10476). This is a SECOND blob, written alongside the final
   * mp4 by the video fan-out (`video-pipeline.server.ts`), and it is the image
   * that renders in the Instagram grid before playback. It is not in
   * `mediaUrls`, so until this field existed nothing looked at it at all.
   *
   * Optional, unlike `postCreatedAt`, because absent is a true and ordinary
   * statement here: a still post has no poster. The conflation that made
   * `postCreatedAt` unsafe does not exist for this one.
   *
   * It is walked by the vision-verdict check only, not by the image-provenance
   * check: a poster's blob path (`video/<jobId>/poster.jpg`) is not a
   * generated-asset filename, and the library ingest re-hosts it under a
   * different url, so running provenance over it would refuse every video post
   * on a naming rule rather than on anything about the pixels.
   */
  posterUrl?: string | null
}

/**
 * Which of the gate's checks a stored verdict does not actually answer.
 *
 * `getVisionVerdictByUrl` returns the stored jsonb blob with no shape
 * validation, and this gate used to read only `verdict.pass`. So a verdict
 * written when the gate asked seven questions kept reading as a full pass
 * after the gate grew an eighth (`anusNotVisible`, ticket #10477): `pass:
 * true` meant "all of the checks I was asked", not "all of the checks that
 * exist now". Every asset carrying a pre-#10477 verdict would have published
 * on a seven-check read forever.
 *
 * Deriving the required keys from `VISION_CHECK_NAMES` rather than listing
 * them here is the point: this is self-healing for every check anyone adds
 * later, which a one-shot backfill is not. A key present with a value that is
 * neither `pass` nor `fail` counts as unanswered too, the same standard
 * `isValidVerdictShape` applies to a live response.
 */
export function missingVisionChecks(verdict: VisionVerdict): VisionCheckName[] {
  const checks = (verdict.checks ?? {}) as Partial<Record<VisionCheckName, unknown>>
  return VISION_CHECK_NAMES.filter(name => checks[name] !== 'pass' && checks[name] !== 'fail')
}

/**
 * Cutoff for the vision-verdict legacy carve-out (ticket #10337). Anything
 * created after this date was generated by a pipeline that writes its verdict
 * synchronously, so a missing verdict there is a write failure, not legacy art.
 */
export const VISION_VERDICT_LEGACY_CUTOFF = new Date('2026-09-01T00:00:00.000Z')

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Legible-text policy (tickets #10279 report field, #10338 policy).
 *
 * `social-vision-gate.server.ts` transcribes any text it reads in the frame
 * and deliberately leaves pass/fail to the caller. This is that caller. The
 * rule is docs/design-doctrine.md section 4 item 4, three cases:
 *
 *   - a manufacturer's brand mark or product name on a product we genuinely
 *     stock and are featuring: allowed, it is truthful product depiction;
 *   - packaging junk (barcode, UPC, shipping label, carton text, ingredient
 *     panel, batch code): blocked;
 *   - a baked-in caption, headline or watermark: blocked, copy lives in the
 *     markup.
 *
 * The verdict carries no classification field of its own (see `VisionVerdict`),
 * so the classification is keyword-based and deliberately conservative:
 * anything transcribed that does not read as a short brand mark blocks. A
 * false block costs one regeneration; a false pass ships baked-in text.
 */
export type LegibleTextClass = 'none' | 'brand-mark' | 'packaging' | 'caption-or-watermark' | 'unclassified'

const PACKAGING_TEXT_PATTERNS: readonly RegExp[] = [
  /\bbar\s?code\b/i,
  /\bupc\b/i,
  /\bean[-\s]?\d/i,
  /\bsku\b/i,
  /\b(lot|batch)\s*(no\.?|number|code)?\b/i,
  /\bshipping label\b/i,
  /\bcarton\b/i,
  /\bingredients?\b/i,
  /\bnet\s*(wt\.?|weight)\b/i,
  /\bfl\.?\s?oz\b/i,
  /\b\d+\s?ml\b/i,
  /\bdistributed by\b/i,
  /\bmanufactured (by|for)\b/i,
  /\bmade in\b/i,
  /\bdirections for use\b/i,
  /\bwarning\b/i,
  /\b(exp|expiry|expires|best before)\b/i,
  /\|{2,}|‖/,
]

const CAPTION_TEXT_PATTERNS: readonly RegExp[] = [
  /\bwatermark\b/i,
  /\bcaption\b/i,
  /©|\(c\)\s?\d{4}/i,
  /\bfollow (us|me)\b/i,
  /\bshop now\b/i,
  /\bswipe\b/i,
  /\b\d{1,3}\s?%\s*off\b/i,
  /\bsale\b/i,
  /(^|\s)[@#]\w/,
  /\bwww\.|\.com\b/i,
]

/** Longest transcription still readable as a wordmark rather than a sentence. */
const BRAND_MARK_MAX_WORDS = 5
const BRAND_MARK_MAX_CHARS = 40

export function classifyLegibleText(text: string | null | undefined): LegibleTextClass {
  const t = (text ?? '').trim()
  if (!t) return 'none'
  if (PACKAGING_TEXT_PATTERNS.some(re => re.test(t))) return 'packaging'
  if (CAPTION_TEXT_PATTERNS.some(re => re.test(t))) return 'caption-or-watermark'
  const words = t.split(/\s+/).filter(Boolean)
  // A wordmark is short and carries no sentence punctuation. Anything longer
  // is a sentence baked into the pixels, which the doctrine bans outright.
  if (words.length <= BRAND_MARK_MAX_WORDS && t.length <= BRAND_MARK_MAX_CHARS && !/[.!?;:]/.test(t)) {
    return 'brand-mark'
  }
  return 'unclassified'
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
    // Instagram only (ticket #9405), mirroring sale-pdp-link: ads-policy.md's
    // Organic-social table bans a discount from the Instagram caption outright,
    // but carries no such limit for X, where a code/depth/link is the
    // platform-permitted promo shape (routine-social-daily.md Step 2 item 5).
    appliesTo: ['instagram'],
  },
  {
    check: 'sale-promo-code',
    re: /\b(promo|coupon|discount)\s*code\b|\bcode\s*[:=]?\s*[A-Z0-9]{4,}\b/,
    detail: 'Caption carries a promo code.',
    // Instagram only (ticket #9405); see sale-discount above.
    appliesTo: ['instagram'],
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

/**
 * `xdipx.product_type_dial` values that are physical, body-contact toys where
 * the pairing rule (crossplatform strategy §3) applies. Deliberately excludes
 * `lube` (it IS the pairing, not something that needs one), `wear` (apparel),
 * `condom` (a barrier product, not a toy), `bondage`/`harness`
 * (restraint/apparel-adjacent, not body-contact in the sense the rule means),
 * and `wellness`/`novelty`/`book-media` (not consistently toys). This is a
 * judgment call, not a formula; a future reader adjusting it is a one-line
 * change of which values this set holds, never the check logic below.
 */
const PAIRING_REQUIRED_TYPE_DIALS = new Set([
  'vibrator', 'dildo', 'anal', 'cock-ring', 'stroker', 'couples',
  'extender', 'pump', 'massage', 'enhancer', 'sex-machine',
])

/**
 * Loose "the caption names a lubricant" match (crossplatform strategy §3):
 * the generic word, or a base-type descriptor a pairing sentence would use.
 * This is a scripted PRESENCE check, not a material-compatibility judgment —
 * confirming the named lube genuinely suits the featured toy stays the
 * independent voice reviewer's job, same split as every other check in this
 * module (see the file header).
 */
const LUBE_MENTION_RE = /\blubes?\b|\blubricants?\b|\bglide\b|\bwater-based\b|\bsilicone-based\b|\bhybrid lube\b/i

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
 * Default implementation of `checkMediaReachable` (ticket #11453): a cheap
 * HEAD request, falling back to a 1-byte ranged GET only when the origin
 * rejects HEAD outright (405/501), which some CDNs and object stores do.
 * Never throws: a transport failure is exactly as "unreachable" as a real
 * non-2xx status, matching every other fail-closed lookup in this module.
 */
export async function defaultCheckMediaReachable(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: 'HEAD' })
    if (head.ok) return true
    if (head.status === 405 || head.status === 501) {
      const ranged = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } })
      return ranged.ok
    }
    return false
  } catch (err) {
    console.error(`[social-publish-gate] media reachability check failed, treating as unreachable: ${url}`, err)
    return false
  }
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
    /** Recorded vision-gate verdict for a library asset (#6763). Defaults to the real lookup. */
    getVisionVerdict?: (url: string) => Promise<VisionVerdict | null>
    /**
     * Does this media url actually resolve (ticket #11453)? Defaults to
     * `defaultCheckMediaReachable` (a HEAD, falling back to a ranged GET).
     * Injected so this is testable without a real network call; a caller
     * that never overrides it gets the real check.
     */
    checkMediaReachable?: (url: string) => Promise<boolean>
    /**
     * `social_media_assets.created_at` for a url, or null when no row exists
     * (#10337). Only consulted for the legacy carve-out below. A throw is
     * treated as "unknown age".
     */
    getAssetCreatedAt?: (url: string) => Promise<Date | null>
    /**
     * `xdipx.product_type_dial` for the featured product (#6745, the pairing
     * check below). Defaults to the real lookup via `getDealByHandle`. Unlike
     * `getAvailability`, a failure here is NOT fail-closed: it means "cannot
     * tell whether the pairing rule even applies", and blocking every draft
     * whose type cannot be resolved would be a far wider blast radius than
     * the stock check's narrow "this one product is unverifiable".
     */
    getProductTypeDial?: (handle: string) => Promise<string | null>
    /**
     * `xdipx.cast_target` for the featured product (ADR-015, ticket #10730,
     * the casting check below). Defaults to the real lookup via
     * `getDealByHandle`. A failure here IS fail-closed (unlike
     * `getProductTypeDial` above): a null/unresolved cast_target is treated
     * as "no classification on file", which the casting check itself blocks
     * on per ADR-015 §5, not as "the rule does not apply".
     */
    getCastTarget?: (handle: string) => Promise<string | null>
    /**
     * `castMember.bodyPresentation` for the roster, keyed by slug. Defaults
     * to the real lookup via `getApprovedCastMembers`. A slug absent from the
     * returned map is treated as "no bodyPresentation on file", which the
     * casting check fails closed on (ADR-015 §5).
     */
    getCastPresentations?: (slugs: readonly string[]) => Promise<ReadonlyMap<string, 'masculine' | 'feminine' | null>>
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

  // ── Vision-gate verdict (#6763) ───────────────────────────────────────────
  //
  // This module is text-only by design (see the file header): it reviews
  // strings, never opens the images. The vision gate is what actually looks
  // at the pixels, and it runs at generation time
  // (app/lib/social-vision-gate.server.ts), recording its verdict on the
  // asset's `social_media_assets` row before the url is ever handed back as
  // publishable. A recorded FAILING verdict is a block. A MISSING verdict is
  // also a block, never a silent skip, per the doctrine's own hard-check
  // mandate (docs/design-doctrine.md:224) — the incident this closes
  // (social_posts #145, a three-armed cast member) shipped BECAUSE nothing
  // checked.
  //
  // One carve-out, mirroring the image-provenance burn-in above, and DATE
  // SCOPED since ticket #10337: a prefix-named url (`isGeneratedSocialAsset`)
  // with no recorded verdict is treated as predating this check (legacy art
  // from before ticket #6763, or before the Social Studio v2 library existed
  // at all) only when it is demonstrably old. "Old" means its
  // `social_media_assets` row was created on or before
  // VISION_VERDICT_LEGACY_CUTOFF, or, when no row exists at all, the post's
  // own created_at is on or before that date. Anything newer BLOCKS.
  //
  // Why the scoping: the original carve-out leaned on "every NEW asset gets
  // its verdict written synchronously at generation time", which is true of
  // the happy path only. `recordVisionVerdict` is non-fatal and swallows its
  // database errors, and `tryIngestSocialAsset` can return null, so a
  // library-write failure on a prefix-named filename produced a current,
  // never-inspected image that the gate waved through. With clothing gone on
  // on-skin frames that is a nudity-shipping path, not a cosmetic one.
  //
  // Age unknown (no row, no post date, or the lookup threw) BLOCKS, since
  // ticket #10476. It used to keep the legacy skip, on the reasoning that the
  // carve-out should not narrow retroactively onto art that already shipped.
  // That reasoning conflated two different things. These checks only ever run
  // on a row that is about to publish, and a `social_posts` row always has a
  // created_at, so "I cannot date this" never means "this is old". It means
  // the caller did not say, or the lookup failed, and neither is evidence that
  // anything ever looked at the image. Unchecked, not legacy. A non-prefix url
  // with no verdict (an owner upload with no library row, or a library asset
  // the generator somehow failed to check) is not covered by the carve-out at
  // all and blocks regardless of date.
  const getVerdict = deps?.getVisionVerdict ?? (async (url: string) => {
    const { getVisionVerdictByUrl } = await import('./social-vision-gate.server')
    return getVisionVerdictByUrl(url)
  })
  const getAssetAge = deps?.getAssetCreatedAt ?? (async (url: string) => {
    const { getAssetCreatedAtByUrl } = await import('./social-asset-library.server')
    return getAssetCreatedAtByUrl(url)
  })
  const postCreatedAt = toDate(input.postCreatedAt)
  // The poster frame rides along here and nowhere else (#10476). It is a
  // publishable image the audience sees in the grid, so it is subject to the
  // verdict, but it is not `mediaUrls` and must not be judged by the
  // provenance naming rule above.
  const poster = input.posterUrl?.trim()
  const inspectable = poster ? [...media, poster] : media

  // ── Media reachability (ticket #11453) ──────────────────────────────────
  //
  // Independent of the two checks above: this asks only "does this url
  // resolve", not whether it looks generated or carries a recorded verdict.
  // A composed url that happens to collide with a library row's naming
  // convention can otherwise clear both of those on a name match alone while
  // pointing at nothing. Checked BEFORE the vision-verdict walk below, and a
  // url found unreachable here is excluded from that walk entirely: asking
  // whether a 404 "has a recorded vision-gate verdict" is a question about
  // whatever asset a stale or colliding filename happens to name, not about
  // the actual defect, and reporting both findings for the same url would
  // bury the honest signal (404) under an incidental one.
  const checkReachable = deps?.checkMediaReachable ?? defaultCheckMediaReachable
  const unreachable = new Set<string>()
  for (const u of inspectable) {
    let reachable = true
    try {
      reachable = await checkReachable(u)
    } catch (err) {
      console.error(`[social-publish-gate] media reachability check threw, treating as unreachable: ${u}`, err)
      reachable = false
    }
    if (!reachable) unreachable.add(u)
  }
  if (unreachable.size > 0) {
    findings.push({
      check: 'media-unreachable',
      severity: 'block',
      detail:
        `Media URL(s) did not resolve (non-2xx on a HEAD/ranged-GET check): ${[...unreachable].join(', ')}. ` +
        'A composed or stale filename that does not exist in the CDN must never reach the publisher.',
    })
  }

  for (const u of inspectable) {
    if (unreachable.has(u)) continue
    let verdict: VisionVerdict | null = null
    try {
      verdict = await getVerdict(u)
    } catch (err) {
      console.error(`[social-publish-gate] vision verdict lookup failed, treating as missing: ${u}`, err)
    }
    if (verdict === null) {
      if (isGeneratedSocialAsset(u)) {
        let assetCreatedAt: Date | null = null
        try {
          assetCreatedAt = await getAssetAge(u)
        } catch (err) {
          console.error(`[social-publish-gate] asset age lookup failed, treating as unknown: ${u}`, err)
        }
        // The row's own date when there is a row, otherwise the post's date.
        const age = assetCreatedAt ?? postCreatedAt
        if (age === null) {
          findings.push({
            check: 'vision-verdict',
            severity: 'block',
            detail: `Generated asset ${u} has no recorded vision-gate verdict and no date to age it by (no social_media_assets row and no post created_at). Unchecked, not legacy.`,
          })
          continue
        }
        if (age.getTime() <= VISION_VERDICT_LEGACY_CUTOFF.getTime()) continue
        findings.push({
          check: 'vision-verdict',
          severity: 'block',
          detail: `Generated asset ${u} has no recorded vision-gate verdict and was created ${age.toISOString().slice(0, 10)}, after the ${VISION_VERDICT_LEGACY_CUTOFF.toISOString().slice(0, 10)} legacy cutoff. The verdict is missing, which means the image was never inspected (a swallowed library or verdict write), not that it predates the check.`,
        })
        continue
      }
      findings.push({
        check: 'vision-verdict',
        severity: 'block',
        detail: `Media has no recorded vision-gate verdict: ${u}. A generated asset must pass all eight vision-gate checks (limb count, hand anatomy, face/body integrity, extra or merged limbs, nipples occluded, genitalia absent, no anus visible, subject unambiguously adult) before it can publish.`,
      })
      continue
    }
    // A verdict that does not answer every current check is not a pass, it is
    // a partial read, and it is rejected here the same way a missing one is
    // (ticket #10477 follow-up). NOT routed through the legacy carve-out
    // above, deliberately: that carve-out's premise is "no verdict exists
    // because the check did not exist yet", and a verdict that exists
    // disproves its own premise. An old date cannot excuse an unanswered
    // question about pixels nobody re-read. The cost is that every asset
    // holding a pre-#10477 verdict blocks once and re-gates on its next
    // publish, which is the intended trade: no database operation, nothing to
    // go stale, and it covers every check added after this one for free.
    const unanswered = missingVisionChecks(verdict)
    if (unanswered.length > 0) {
      findings.push({
        check: 'vision-verdict',
        severity: 'block',
        detail: `Media carries a vision-gate verdict that does not answer every check: ${unanswered.join(', ')} ${unanswered.length === 1 ? 'is' : 'are'} missing from the recorded verdict (${u}). The verdict predates ${unanswered.length === 1 ? 'that check' : 'those checks'}, so its "pass" is a pass on the questions it was asked, not on the ones the gate asks now. Re-run the vision gate on this asset.`,
      })
      continue
    }
    if (!verdict.pass) {
      findings.push({
        check: 'vision-verdict',
        severity: 'block',
        detail: `Media failed the vision-gate checks: ${verdict.notes || 'no notes recorded'} (${u}).`,
      })
    }
    // Legible text is a report field on the verdict; the policy call is here.
    const textClass = classifyLegibleText(verdict.legibleText)
    if (textClass === 'packaging' || textClass === 'caption-or-watermark' || textClass === 'unclassified') {
      const why = textClass === 'packaging'
        ? 'reads as packaging junk (barcode, label, carton or ingredient text)'
        : textClass === 'caption-or-watermark'
          ? 'reads as a baked-in caption or watermark'
          : 'could not be read as a brand mark on the product'
      findings.push({
        check: 'vision-legible-text',
        severity: 'block',
        detail: `Text baked into the image ${why}: "${verdict.legibleText}" (${u}). Copy lives in the markup (docs/design-doctrine.md section 4 item 4).`,
      })
    }
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

  // ── Pairing rule: a toy never travels alone ───────────────────────────────
  //
  // crossplatform strategy §3 / the pairing-presence self-check
  // (docs/store-team/routine-social-daily.md): every draft featuring a
  // physical, body-contact toy either names a compatible lubricant in the
  // caption or records an explicit reason none applies. Instruction-only
  // reminders (#3881) were tried for three weeks and never moved the miss
  // rate — 3 of 5 genuine toy posts shipped with no pairing the week #6745
  // was filed — because nothing checked it before a draft could reach the
  // unattended hourly publish tick. Supersedes the self-check-only framing
  // of #3881, which stays open as the drafting instruction this backs up.
  if (input.productHandle) {
    const getTypeDial = deps?.getProductTypeDial ?? (async (handle: string) => {
      const { getDealByHandle } = await import('./shopify.server')
      const deal = await getDealByHandle(handle)
      return deal?.productTypeDial ?? null
    })
    let typeDial: string | null
    try {
      typeDial = await getTypeDial(input.productHandle)
    } catch {
      typeDial = null
    }
    if (typeDial && PAIRING_REQUIRED_TYPE_DIALS.has(typeDial)) {
      const named = LUBE_MENTION_RE.test(caption)
      const reasoned = !!(input.pairingNoneReason && input.pairingNoneReason.trim())
      if (!named && !reasoned) {
        findings.push({
          check: 'pairing-missing',
          severity: 'block',
          detail:
            `"${input.productHandle}" is a ${typeDial} toy; the caption names no compatible ` +
            `lubricant and the draft records no reason none applies (routine-social-daily.md ` +
            `pairing-presence self-check). Name a compatible lube or log why none applies.`,
        })
      }
    }
  }

  // ── Cast/product casting gate (ADR-015, ticket #10730) ────────────────────
  //
  // Owner, verbatim, 2026-09-22: "When we have a man holding a vibrator; we
  // look like idiots." A product's xdipx.cast_target ('male' | 'female' |
  // 'universal') says which cast presentation may be shown ALONE with it;
  // `checkCastTargetMatch` is the pure data check (social-cast-target-gate.
  // server.ts). This is defense in depth for the admin CastPicker/rework
  // path — social-art-director's own brief-time pre-check (ADR-015 §4 call
  // site 1) is a judgment step in an interactive subagent session the
  // unattended publish path never spawns, so this deterministic check is the
  // only place the rule is actually enforced on that path.
  if (input.productHandle) {
    const getCastTarget = deps?.getCastTarget ?? (async (handle: string) => {
      const { getDealByHandle } = await import('./shopify.server')
      const deal = await getDealByHandle(handle)
      return deal?.castTarget ?? null
    })
    let castTargetRaw: string | null
    try {
      castTargetRaw = await getCastTarget(input.productHandle)
    } catch {
      castTargetRaw = null
    }
    const castTarget = castTargetRaw === 'male' || castTargetRaw === 'female' || castTargetRaw === 'universal'
      ? castTargetRaw
      : null

    const castSlugs = (input.castSlugs ?? []).filter((s): s is string => !!s && s.trim().length > 0)

    const getPresentations = deps?.getCastPresentations ?? (async (slugs: readonly string[]) => {
      const { getApprovedCastMembers } = await import('./sanity.server')
      const roster = await getApprovedCastMembers()
      const bySlug = new Map(roster.map(m => [m.slug, m.bodyPresentation] as const))
      return new Map(slugs.map(s => [s, bySlug.get(s) ?? null] as const))
    })
    let presentationBySlug: ReadonlyMap<string, 'masculine' | 'feminine' | null>
    try {
      presentationBySlug = await getPresentations(castSlugs)
    } catch {
      presentationBySlug = new Map()
    }

    const { checkCastTargetMatch } = await import('./social-cast-target-gate.server')
    const castVerdict = checkCastTargetMatch(castTarget, castSlugs, presentationBySlug)
    if (!castVerdict.pass) {
      findings.push({
        check: 'cast-target-mismatch',
        severity: 'block',
        detail: `"${input.productHandle}": ${castVerdict.reason ?? 'cast/product casting check failed.'}`,
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
