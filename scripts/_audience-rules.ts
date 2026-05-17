/**
 * Deterministic audience-tag rules from TAXONOMY_SPEC_v2 (v2.2).
 *
 * Source of truth: docs/taxonomy/TAXONOMY_SPEC_v2_audience_revision.md §5.
 *
 * This file encodes R1–R7 (relationship), L1–L7 (life-event), Q1–Q8 (LGBTQ),
 * and C1–C6 (cleanup) so they can be applied deterministically before any
 * subagent / Claude call. Pure functions, no I/O.
 *
 * Every applied rule attaches a `RuleHit` so the rationale CSV column can
 * cite the rule by ID. Products with no relationship-rule hit get
 * `needsClaude: true` for the subagent pass.
 */

export interface RuleInput {
  /** Shopify standard product type, e.g. "Stroker", "Cock Ring" */
  productType:    string | null
  /** Shopify product tags (the comma-separated tags field) */
  tags:           string[]
  /** Lowercased product title */
  title:          string
  /** Lowercased plain-text descriptionHtml excerpt (first ~800 chars) */
  bodyExcerpt:    string
  /** Vendor name as set in Shopify */
  vendor:         string
  /** Lowercased collection handles the product belongs to */
  collections:    string[]
  /** Max variant price (USD, decimal) */
  maxPrice:       number
  /** Current xdipx.audience_tags values (lowercased, normalized) */
  currentAudience:string[]
  /** Current xdipx.matters_tags values (lowercased) */
  currentMatters: string[]
  /** Editor override: xdipx.queer_friendly_override boolean */
  queerOverride:  boolean
}

export interface RuleHit { id: string; addsTags: string[]; note: string }

export interface RuleResult {
  finalAudience: string[]
  hits:          RuleHit[]
  /** True if no relationship rule fired — needs Claude subagent pass */
  needsClaude:   boolean
  /** Cleanup actions applied (C1–C6) */
  cleanupHits:   RuleHit[]
}

const RELATIONSHIP_TAGS = new Set([
  'solo','couples','long-distance',
  'queer-friendly','gay-couples','sapphic','non-binary',
])
const LIFE_EVENT_TAGS = new Set([
  'gift','date-night','bachelorette','anniversary','birthday','housewarming',
])

/** §5 R-rules — Type sets verbatim. Matched case-insensitively. */
const TYPES_SOLO_MALE = new Set([
  'stroker','cock ring','prostate massager','penis pump','penis sleeve',
])
const TYPES_SOLO_FEMALE = new Set([
  'g-spot vibrator','clitoral vibrator','rabbit vibrator','suction vibrator','bullet vibrator',
])
const TYPES_COUPLES = new Set([
  'couples vibrator','strap-on harness','strap-on dildo',
])
const TYPES_KIT_BOTH = new Set([
  'cock ring','bullet vibrator','plug',
])
/** Vibrator family for R6 (matters:hands-free + Vibrator → couples) */
const TYPES_VIBRATOR_FAMILY = new Set([
  'vibrator','g-spot vibrator','clitoral vibrator','rabbit vibrator','suction vibrator',
  'bullet vibrator','wand massager','couples vibrator',
])
const TYPES_AGNOSTIC = new Set([
  'anal plug','anal beads','anal training kit','lubricant','massage oil','toy cleaner',
])

/** §5 Q-rules brand allow-lists, lowercased for case-insensitive vendor match.
 *  Prowler and Prowler RED are distinct vendor strings in Nalpac data — both
 *  qualify whole-brand per spec v2.3 §3. */
const TIER1_QUEER_BRANDS = new Set([
  'tantus','sportsheets','sliquid','spareparts','pjur','cute little fuckers',
  'prowler','prowler red',
])

/** §5 Q7a exclusion: types where "strapless" appears but the product isn't a strap-on */
const Q7A_EXCLUDED_TYPES = new Set([
  'pasties','lingerie set','hosiery','bodysuit','bra & panty set','babydoll / chemise',
])

/** §5 Q7b allow-list: Types where a "double-ended" descriptor implies a partnered dildo */
const Q7B_ALLOWED_TYPES = new Set([
  'realistic dildo','silicone dildo','vibrating dildo','fantasy dildo',
  'strap-on dildo','g-spot vibrator',
])

/** §5 Q7b exclusion: titles where "double-ended" describes a stroker, not a partnered dildo */
const Q7B_STROKER_KEYWORDS = ['stroker','masturbator','sleeve','cocksheath']

const Q7A_RE = /\bstrapless\s+strap[-\s]?on\b/
const Q7B_RE = /\bdouble[-\s]?(ended|headed)\b/
const TIER2_BRANDS = new Set([
  'doc johnson','we-vibe','lelo','womanizer','pastease',
])
/** §5 Q4 marketing-language phrases (matched on title + body excerpt, lowercase) */
const QUEER_MARKETING_PHRASES = [
  /\ball bodies\b/, /\bany body\b/, /\bungendered\b/, /\bfor everyone\b/,
  /\binclusive\b/, /\bqueer\b/, /\blgbtq\b/, /\brainbow\b/,
]
const PRIDE_NOISE = /\bpride (month|parade|festival)\b/
const GAY_COUPLES_PHRASES = [
  /\bfor him and him\b/, /\bm\/m\b/, /\bgay couples\b/, /\bfor two men\b/,
]
const SAPPHIC_PHRASES = [
  /\bfor her and her\b/, /\bwlw\b/, /\bsapphic\b/, /\blesbian\b/,
]
const NB_PHRASES = [
  /\btrans[- ]affirming\b/, /\bgender[- ]affirming\b/, /\bnon[- ]binary\b/, /\btgnc\b/,
]

/** §5 L4 anniversary premium vendors */
const ANNIVERSARY_VENDORS = new Set(['lelo','we-vibe','womanizer'])

/** Cleanup vocabulary. Values that should be removed from audience_tags. */
const CLEANUP_VALUES = new Set([
  'him','her',                       // C1, C2 — strip gender
  'first-time',                      // C4 — moves to matters
  'lgbtq',                           // C3 — re-classify
  'gift-idea',                       // C5 — rename to gift
  'us',                              // C6 — junk
])

function addRel(out: Set<string>, hits: RuleHit[], rule: string, tags: string[], note: string) {
  for (const t of tags) out.add(t)
  hits.push({ id: rule, addsTags: tags, note })
}

/**
 * Apply all v2.2 deterministic rules. Pure: same input always returns same
 * output. Order of operations matters only for the rule ID logged.
 */
export function applyAudienceRules(input: RuleInput): RuleResult {
  const audience = new Set<string>()
  const hits: RuleHit[] = []
  const cleanupHits: RuleHit[] = []

  const pt = (input.productType ?? '').trim().toLowerCase()
  const titleLc = input.title.toLowerCase()
  const bodyLc  = input.bodyExcerpt.toLowerCase()
  const both    = titleLc + ' ' + bodyLc
  const vendorLc = input.vendor.trim().toLowerCase()
  const tagsLc  = new Set(input.tags.map(t => t.toLowerCase()))

  // ── C1–C6 cleanup detection (decided regardless of new additions) ─────
  // The strip set is applied later in the writer (it diffs against the
  // current state). Here we record which cleanup rules fired for audit.
  for (const v of input.currentAudience) {
    if (v === 'him')        cleanupHits.push({ id: 'C1', addsTags: [],          note: 'strip for:him' })
    if (v === 'her')        cleanupHits.push({ id: 'C2', addsTags: [],          note: 'strip for:her' })
    if (v === 'lgbtq')      cleanupHits.push({ id: 'C3', addsTags: [],          note: 're-classify lgbtq via Q1–Q8' })
    if (v === 'first-time') cleanupHits.push({ id: 'C4', addsTags: [],          note: 'move to matters:beginner-friendly' })
    if (v === 'gift-idea')  cleanupHits.push({ id: 'C5', addsTags: ['gift'],    note: 'rename gift-idea → gift' })
    if (v === 'us')         cleanupHits.push({ id: 'C6', addsTags: [],          note: 'delete junk us' })
  }

  // ── R1–R7 relationship rules ──────────────────────────────────────────
  if (TYPES_SOLO_MALE.has(pt))   addRel(audience, hits, 'R1', ['solo'], `type=${pt} → solo (male solo set)`)
  if (TYPES_SOLO_FEMALE.has(pt)) addRel(audience, hits, 'R2', ['solo'], `type=${pt} → solo (female solo set)`)
  if (TYPES_COUPLES.has(pt))     addRel(audience, hits, 'R3', ['couples'], `type=${pt} → couples`)

  if (titleLc.includes('kit') && TYPES_KIT_BOTH.has(pt)) {
    addRel(audience, hits, 'R4', ['solo','couples'], `kit + type=${pt} → both`)
  }

  if (input.currentMatters.includes('remote') || input.currentMatters.includes('app-controlled')) {
    addRel(audience, hits, 'R5', ['long-distance'], 'matters:remote|app-controlled → long-distance')
  }

  if (input.currentMatters.includes('hands-free') && TYPES_VIBRATOR_FAMILY.has(pt)) {
    addRel(audience, hits, 'R6', ['couples'], `hands-free + vibrator family type=${pt} → couples`)
  }

  if (TYPES_AGNOSTIC.has(pt)) {
    addRel(audience, hits, 'R7', ['solo','couples'], `type=${pt} → agnostic both`)
  }

  // ── L1–L7 life-event rules ────────────────────────────────────────────
  const bachelorette = vendorLc.includes('bachelorette')
    || titleLc.includes('bachelorette')
    || input.collections.some(c => c.includes('bachelorette'))
  if (bachelorette) {
    addRel(audience, hits, 'L1', ['bachelorette','gift'], 'bachelorette signal → bachelorette + gift (below-floor)')
  }

  if (pt === 'adult game') {
    addRel(audience, hits, 'L2', ['date-night','couples'], 'type=adult game → date-night + couples')
  }

  if ((titleLc.includes('kit') || input.collections.some(c => c.includes('kit'))) && input.maxPrice >= 80) {
    addRel(audience, hits, 'L3', ['gift'], `kit + $${input.maxPrice} ≥ $80 → gift`)
  }

  // L4: candidate-only for Claude confirmation; we mark a "candidate" hit but
  // don't add the tag. The merge step / Claude path decides.
  if (ANNIVERSARY_VENDORS.has(vendorLc) && input.maxPrice >= 150) {
    hits.push({ id: 'L4', addsTags: [], note: `candidate for:anniversary (vendor=${vendorLc}, $${input.maxPrice} ≥ $150)` })
  }

  if (pt === 'massage candle') {
    addRel(audience, hits, 'L5', ['date-night'], 'type=massage candle → date-night')
    hits.push({ id: 'L5', addsTags: [], note: 'candidate for:gift + for:housewarming' })
  }

  if (titleLc.includes('birthday') || input.collections.some(c => c.includes('birthday'))) {
    addRel(audience, hits, 'L6', ['birthday'], 'birthday signal → birthday')
  }

  // L7: for:gift requires at least one relationship tag. Enforce at the end.

  // ── Q1–Q8 LGBTQ rules (affirmative-signal only, default-off) ──────────
  if (TIER1_QUEER_BRANDS.has(vendorLc)) {
    addRel(audience, hits, 'Q1', ['queer-friendly'], `vendor=${vendorLc} on Tier-1 allow-list`)
  }

  if (TIER2_BRANDS.has(vendorLc)
      && /\b(pride|tom of finland)\b/.test(titleLc)
      && !PRIDE_NOISE.test(titleLc)) {
    addRel(audience, hits, 'Q2', ['queer-friendly'], `vendor=${vendorLc} + pride/tom-of-finland title`)
  }

  if (/\bpacker\b/.test(titleLc) || titleLc.includes('stp')) {
    addRel(audience, hits, 'Q3', ['queer-friendly','non-binary'], 'packer/STP → queer-friendly + non-binary')
  }

  if (QUEER_MARKETING_PHRASES.some(re => re.test(both)) && !PRIDE_NOISE.test(both)) {
    addRel(audience, hits, 'Q4', ['queer-friendly'], 'queer marketing-language match')
  }

  if (input.queerOverride) {
    addRel(audience, hits, 'Q5', ['queer-friendly'], 'editor override xdipx.queer_friendly_override=true')
  }

  const q6Hit = GAY_COUPLES_PHRASES.some(re => re.test(both))
    || vendorLc === 'prowler'
    || (vendorLc === 'doc johnson' && titleLc.includes('tom of finland'))
  if (q6Hit) {
    addRel(audience, hits, 'Q6', ['gay-couples','queer-friendly'], 'm/m affirmative signal')
  }

  if (SAPPHIC_PHRASES.some(re => re.test(both))) {
    addRel(audience, hits, 'Q7', ['sapphic','queer-friendly'], 'f/f affirmative signal')
  }

  // Q7a (v2.3) — strapless strap-on as de-facto sapphic form factor.
  // Excludes lingerie types that happen to be called "strapless" but aren't strap-ons.
  if (Q7A_RE.test(titleLc) && !Q7A_EXCLUDED_TYPES.has(pt) && !q6Hit) {
    addRel(audience, hits, 'Q7a', ['sapphic','queer-friendly'],
      'strapless strap-on (de-facto sapphic form factor)')
  }

  // Q7b (v2.3) — partnered double-ended dildos as de-facto sapphic form factor.
  // Excludes solo strokers / masturbators that share the "double-ended" descriptor.
  if (Q7B_RE.test(titleLc)
      && Q7B_ALLOWED_TYPES.has(pt)
      && !q6Hit
      && !Q7B_STROKER_KEYWORDS.some(kw => titleLc.includes(kw))) {
    addRel(audience, hits, 'Q7b', ['sapphic','queer-friendly'],
      'partnered double-ended dildo (de-facto sapphic form factor)')
  }

  if (NB_PHRASES.some(re => re.test(both))) {
    addRel(audience, hits, 'Q8', ['non-binary','queer-friendly'], 'trans/NB affirmative signal')
  }

  // ── Enforce L7 ────────────────────────────────────────────────────────
  // If gift is present but no relationship tag, drop gift (relationship
  // rules will be filled by Claude pass on the ambiguous fallback).
  const hasRelationship = ['solo','couples','long-distance'].some(t => audience.has(t))
  if (audience.has('gift') && !hasRelationship) {
    audience.delete('gift')
    hits.push({ id: 'L7', addsTags: [], note: 'dropped gift: no relationship tag yet (re-apply after Claude)' })
  }

  // Identity-only catalog products (e.g., Q1 matched but no R-rule) still
  // need a relationship tag. Mark for Claude when no R-rule fired.
  const needsClaude = !['solo','couples','long-distance'].some(t => audience.has(t))

  return {
    finalAudience: [...audience].sort(),
    hits,
    needsClaude,
    cleanupHits,
  }
}

export const SPEC_RELATIONSHIP_TAGS = RELATIONSHIP_TAGS
export const SPEC_LIFE_EVENT_TAGS   = LIFE_EVENT_TAGS
export const SPEC_CLEANUP_VALUES    = CLEANUP_VALUES
