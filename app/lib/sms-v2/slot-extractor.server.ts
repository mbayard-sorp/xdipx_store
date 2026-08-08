/**
 * app/lib/sms-v2/slot-extractor.server.ts
 *
 * Two-pass slot extractor for the Emma discovery gate.
 *
 * PASS 1 — Regex (synchronous, zero LLM cost)
 *   Runs a battery of named regex rules over lowercased, normalized text.
 *   Extracts: audience, experience, category (+ subtype), matters[], priceMax,
 *   isAdviceRequest, vulnerabilitySignaled, giftWithNoRecipientHint.
 *
 * PASS 2 — Haiku (async, conditional)
 *   Only fires when:
 *     a. regex extracted a category that isHighStakesCategory() returns true for
 *        (anal, dildo, harness, wear)
 *     b. no audience was found by regex
 *     c. inbound text is > 5 characters
 *   A single Haiku call (~100 tokens) classifies audience with a confidence
 *   threshold of 0.7. On any error the result is discarded — regex result stands.
 *
 * The return value is consumed by:
 *   - discovery-gate.server.ts (advanceGate)
 *   - slot-aware search filters (productTypeDial / productSubtypeDial)
 */

import Anthropic from '@anthropic-ai/sdk'
import { getTurnSignal } from './turn-deadline.server'
import type { ProductTypeDial, ProductSubtypeDial } from '../../types/index'
import {
  type DiscoverySlots,
  isHighStakesCategory,
  SKIP_SENTINEL,
} from './discovery-gate.server'
import { logApiTokens } from '../token-log.server'

export type { ProductTypeDial, ProductSubtypeDial, DiscoverySlots }

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ExtractInput {
  text: string
  /** Prior conversation slots — slots already confirmed are not re-extracted. */
  priorSlots?: Partial<DiscoverySlots>
}

export interface ExtractResult {
  slots: Partial<DiscoverySlots>
  source: 'regex' | 'haiku' | 'mixed'
  haikuCalled: boolean
}

// ---------------------------------------------------------------------------
// Anthropic client (test-injectable via _setAnthropicClient)
// ---------------------------------------------------------------------------

let _anthropic = new Anthropic({
  apiKey: (process.env['ANTHROPIC_API_KEY'] ?? '').trim(),
})

/** Swap out the client in tests to prevent real API calls. */
export function _setAnthropicClient(client: Anthropic): void {
  _anthropic = client
}

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

// ---------------------------------------------------------------------------
// Helper: normalize text for regex matching
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text.toLowerCase().trim()
}

// ---------------------------------------------------------------------------
// PASS 1 — Regex extraction rules
// ---------------------------------------------------------------------------

// ── 1. Audience ──────────────────────────────────────────────────────────────

/**
 * Relationship nouns that resolve audience unambiguously.
 * Returns the audience or undefined if no match.
 */
function extractAudienceByRelationshipNoun(
  norm: string,
): DiscoverySlots['audience'] | undefined {
  // Couples / both
  if (
    /\b(?:for\s+couples|for\s+us|for\s+both\s+of\s+us|us|both\s+of\s+us|me\s+and\s+(?:my\s+)?(?:partner|boyfriend|girlfriend|husband|wife|hubby))\b/.test(
      norm,
    )
  ) {
    return 'couples'
  }

  // Gift — catch before gendered nouns since gift phrasing can co-occur.
  // Bare `gift` is included so the WHO quick-choice pill "A gift" resolves; it
  // also subsumes "as a gift" / "wedding gift". `\bgift\b` does not match
  // "gifted", and the gendered override below still wins when a recipient noun
  // is present ("a gift for my husband" → for-him).
  if (
    /\b(?:gift|as\s+a\s+present|present\s+for|for\s+someone\s+special|bachelorette)\b/.test(
      norm,
    )
  ) {
    // Overruled by gendered relationship noun below if present
    const gendered = extractGendered(norm)
    if (gendered) return gendered
    return 'gift'
  }

  // For-him via "for my boyfriend/husband/guy/him"
  const forHimPhrase =
    /\bfor\s+my\s+(?:boyfriend|husband|guy|partner\s+who'?s?\s+a\s+guy|him)\b/.test(norm)
  const forHerPhrase =
    /\bfor\s+my\s+(?:girlfriend|wife|partner\s+who'?s?\s+a\s+woman|her)\b/.test(norm)

  if (forHimPhrase) return 'for-him'
  if (forHerPhrase) return 'for-her'

  // Bare body-type answers — when a caller is replying to a body-type
  // question they often say "for him" / "for her" / "a for him body"
  // / "for her body" without "my". Caught during voice Stage D testing
  // where these answers were being missed and the gate looped on the
  // same question.
  if (/\b(?:a\s+)?for\s+her(?:\s+body)?\b/.test(norm)) return 'for-her'
  if (/\b(?:a\s+)?for\s+him(?:\s+body)?\b/.test(norm)) return 'for-him'
  if (/\b(?:female|her)\s+body\b/.test(norm)) return 'for-her'
  if (/\b(?:male|his)\s+body\b/.test(norm))   return 'for-him'

  // Gendered relationship nouns anywhere in text (overrule fallbacks)
  return extractGendered(norm)
}

/** Scans for gendered relationship nouns anywhere — husband/boyfriend → for-him, etc. */
function extractGendered(norm: string): DiscoverySlots['audience'] | undefined {
  // Partner relationship nouns (existing).
  if (/\bmy\s+(?:husband|boyfriend)\b/.test(norm)) return 'for-him'
  if (/\bmy\s+(?:wife|girlfriend)\b/.test(norm)) return 'for-her'

  // Self-gender disclosure — "I'm a woman" / "I'm female" → for-her, etc.
  // These take precedence over the bare "for me" pattern below because the
  // gender info is unambiguous. Discovered during voice Stage D testing
  // where callers said "I'm a woman" / "I'm a man" alone and the gate
  // never advanced for lack of audience.
  if (/\bi'?m\s+(?:a\s+)?(?:woman|female|gal|lady)\b/.test(norm)) return 'for-her'
  if (/\bi'?m\s+(?:a\s+)?(?:man|male|guy|dude)\b/.test(norm))     return 'for-him'

  // Self-side phrasing without explicit gender — "her side", "his side".
  if (/\b(?:her\s+side|for\s+her\s+side|woman'?s\s+side)\b/.test(norm)) return 'for-her'
  if (/\b(?:his\s+side|for\s+his\s+side|man'?s\s+side)\b/.test(norm))   return 'for-him'

  return undefined
}

// ── 2. Experience ─────────────────────────────────────────────────────────────

function extractExperience(norm: string): DiscoverySlots['experience'] | undefined {
  if (
    /\b(?:first\s+time|never\s+tried|new\s+to\s+this|new\s+to\s+(?:toys?|sex\s+toys?|this\s+stuff)|haven'?t\s+done\s+this|complete\s+beginner|total\s+newbie)\b/.test(
      norm,
    )
  ) {
    return 'first-time'
  }
  if (
    /\b(?:advanced|connoisseur|enthusiast)\b/.test(norm)
  ) {
    return 'advanced'
  }
  if (
    /\b(?:experienced|been\s+around|have\s+a\s+few|got\s+opinions|know\s+what\s+i\s+like)\b/.test(
      norm,
    )
  ) {
    return 'experienced'
  }
  if (/\b(?:curious|exploring|just\s+looking|just\s+browsing)\b/.test(norm)) {
    return 'curious'
  }
  return undefined
}

// ── 3. Category ────────────────────────────────────────────────────────────────

type CategoryResult = {
  category: ProductTypeDial
  subtype?: ProductSubtypeDial
}

/**
 * Category matching rules in priority order. More-specific rules must appear
 * before their generic siblings so the first match wins correctly.
 *
 * Priority order (high to low):
 *   lube subtypes > bare lube
 *   anal-beads / prostate / plug > bare "anal" keyword
 *   bullet / rabbit / magic wand > bare vibrator
 *   strap-on (extender) > harness
 *   bodystocking / bodysuit / teddy / lingerie / pasties / hosiery > bare outfit
 *   bondage subtypes > bare bondage
 *   dildo > cock-ring > stroker > condom
 */
const CATEGORY_RULES: Array<{
  re: RegExp
  category: ProductTypeDial
  subtype?: ProductSubtypeDial
}> = [
  // lube — specific subtypes first, bare lube catches the rest
  {
    re: /\bwater[- ]?based\b/,
    category: 'lube',
    subtype: 'water-based',
  },
  {
    re: /\bsilicone\s+(?:lube|based)\b/,
    category: 'lube',
    subtype: 'silicone-based',
  },
  {
    re: /\bhybrid\s+lube\b/,
    category: 'lube',
    subtype: 'hybrid',
  },
  {
    re: /\b(?:warming|sensation)\s+lube\b/,
    category: 'lube',
    subtype: 'warming-cooling',
  },
  {
    re: /\b(?:lube|lubricant|lubricants)\b/,
    category: 'lube',
  },
  // anal — specific subtypes before the plug/beads/prostate that sit under 'anal'
  {
    re: /\banal\s+beads\b/,
    category: 'anal',
    subtype: 'beads',
  },
  {
    re: /\bprostate(?:\s+massager)?\b/,
    category: 'anal',
    subtype: 'prostate',
  },
  {
    re: /\b(?:plug|plugs|butt\s+plug|anal\s+plug)\b/,
    category: 'anal',
    subtype: 'plug',
  },
  // dildo
  {
    re: /\b(?:dildo|dildos)\b/,
    category: 'dildo',
  },
  // vibrator subtypes before bare vibrator
  {
    re: /\bbullet\b/,
    category: 'vibrator',
    subtype: 'bullet-egg',
  },
  {
    re: /\brabbit\b/,
    category: 'vibrator',
    subtype: 'rabbit',
  },
  {
    re: /\b(?:wand|wands|magic\s+wand)\b/,
    category: 'vibrator',
    subtype: 'wand',
  },
  {
    re: /\b(?:vibrator|vibrators|vibe|vibes)\b/,
    category: 'vibrator',
  },
  // wear — specific subtypes before bare "outfit"
  {
    re: /\b(?:lingerie|teddy|bodysuit)\b/,
    category: 'wear',
    subtype: 'bodysuit-teddy',
  },
  {
    re: /\b(?:bodystocking|body[- ]?stocking)\b/,
    category: 'wear',
    subtype: 'bodystocking',
  },
  {
    re: /\bstockings\b/,
    category: 'wear',
    subtype: 'hosiery',
  },
  {
    re: /\bpasties\b/,
    category: 'wear',
    subtype: 'pasty',
  },
  {
    re: /\b(?:outfit|outfits)\b/,
    category: 'wear',
  },
  // extender — strap-on is a subtype of extender (not harness)
  {
    re: /\bstrap[- ]?on\b/,
    category: 'extender',
    subtype: 'strap-on',
  },
  // harness
  {
    re: /\b(?:harness|harnesses)\b/,
    category: 'harness',
  },
  // cock-ring
  {
    re: /\b(?:cock\s+ring|cockring)\b/,
    category: 'cock-ring',
    subtype: 'classic',
  },
  // stroker
  {
    re: /\b(?:stroker|masturbator|sleeve|fleshlight)\b/,
    category: 'stroker',
  },
  // bondage subtypes before bare bondage
  {
    re: /\bblindfolded?\b/,
    category: 'bondage',
    subtype: 'blindfold',
  },
  {
    re: /\b(?:restraints|cuffs)\b/,
    category: 'bondage',
    subtype: 'restraint',
  },
  {
    re: /\b(?:paddle|flogger)\b/,
    category: 'bondage',
    subtype: 'paddle-whip',
  },
  {
    re: /\bgag\b/,
    category: 'bondage',
    subtype: 'gag',
  },
  {
    re: /\bbondage\b/,
    category: 'bondage',
  },
  // condom
  {
    re: /\b(?:condom|condoms)\b/,
    category: 'condom',
  },
]

function extractCategory(norm: string): CategoryResult | undefined {
  for (const rule of CATEGORY_RULES) {
    if (!rule.re.test(norm)) continue
    const subtype = rule.subtype
    return subtype !== undefined
      ? { category: rule.category, subtype }
      : { category: rule.category }
  }
  return undefined
}

// ── 4. Matters ────────────────────────────────────────────────────────────────

function extractMatters(norm: string): string[] {
  const results: string[] = []

  if (/\b(?:quiet|whisper|silent|discreet\s+motor)\b/.test(norm)) results.push('quiet')
  if (/\b(?:waterproof|in\s+the\s+shower|bath(?:room)?|water[- ]?(?:resistant|safe))\b/.test(norm))
    results.push('waterproof')
  if (/\b(?:rechargeable|usb|no\s+batteries)\b/.test(norm)) results.push('rechargeable')
  if (/\b(?:travel|portable|tsa)\b/.test(norm)) results.push('travel-friendly')
  if (
    /\b(?:app|app[- ]?controlled|long[- ]?distance|over\s+a\s+call)\b/.test(norm)
  )
    results.push('app-controlled')
  if (/\b(?:discreet\s+(?:packaging|shipping|delivery))\b/.test(norm))
    results.push('discreet-packaging')
  // Bare "discreet" — the literal MATTERS pill label. Excludes "discreet motor",
  // which the quiet rule above already claims. Reads discretion as a
  // packaging/delivery concern, the storefront's common interpretation.
  if (/\bdiscreet\b(?!\s+motor)/.test(norm)) results.push('discreet-packaging')
  // Hands-free — the literal MATTERS pill label. No product-tag mapping today,
  // but producing the slot lets the gate advance instead of looping on the pill.
  if (/\bhands[- ]?free\b/.test(norm)) results.push('hands-free')
  if (/\b(?:beginner[- ]?friendly|easy\s+to\s+use|simple)\b/.test(norm) ||
      // "beginner" alone (without "friendly" suffix) also qualifies
      /\bbeginner\b/.test(norm))
    results.push('beginner-friendly')
  if (/\b(?:soft|gentle|romantic|slow)\b/.test(norm)) results.push('soft')
  if (/\b(?:powerful|strong|intense|deep\s+rumble|rumbly)\b/.test(norm)) results.push('powerful')
  if (/\b(?:warming|warm|warming\s+sensation)\b/.test(norm)) results.push('warming')

  // De-dup while preserving insertion order
  return [...new Set(results)]
}

// ── 4b. Mood ────────────────────────────────────────────────────────────────
//
// The MOOD gate was silently un-fillable: nothing ever assigned regexSlots.mood,
// so hasMood stayed false forever and the documented SKIP_SENTINEL ("just show
// me") was never produced. This closes both gaps.
//
// The mood vocabulary mirrors the searchProducts tool's mood enum
// (playful | romantic | luxurious | adventurous | relaxing) so an extracted mood
// slot maps straight onto a search filter. "Just show me" and close variants
// return the skip-ahead sentinel, which advanceGate reads as searchNow=true.

function extractMood(norm: string): string[] {
  // Skip-ahead: the MATTERS pill "Just show me" and free-text equivalents.
  // Returned alone — a shopper who wants to skip is not also picking a vibe.
  if (
    /\b(?:just\s+show\s+me|show\s+me\s+(?:what\s+you\s+(?:'?ve\s+)?got|something|anything|options|the\s+goods)|surprise\s+me|just\s+pick|pick\s+for\s+me|you\s+(?:choose|decide|pick)|whatever\s+you\s+(?:think|recommend|suggest)|no\s+preference)\b/.test(
      norm,
    )
  ) {
    return [SKIP_SENTINEL]
  }

  const results: string[] = []
  if (/\b(?:playful|flirty|flirtatious|fun|teasing|tease|cheeky)\b/.test(norm))
    results.push('playful')
  if (/\b(?:romantic|intimate|sensual|loving|tender|passionate|connected)\b/.test(norm))
    results.push('romantic')
  if (/\b(?:luxurious|luxury|indulgent|fancy|premium|treat\s+myself|splurge)\b/.test(norm))
    results.push('luxurious')
  if (/\b(?:adventurous|adventure|kinky|wild|spicy|experimental|daring|naughty|frisky)\b/.test(norm))
    results.push('adventurous')
  if (/\b(?:relaxing|relaxed|unwind|chill|calm|cozy|mellow)\b/.test(norm))
    results.push('relaxing')

  // De-dup while preserving insertion order
  return [...new Set(results)]
}

// ── 5. Price ──────────────────────────────────────────────────────────────────

// Budget cues that must appear immediately before a number for it to count as
// a price ceiling. "$50" and "50 dollars" also qualify via the patterns below.
const BUDGET_CUE = String.raw`(?:under|below|less\s+than|no\s+more\s+than|at\s+most|up\s+to|max(?:imum)?(?:\s+of)?|budget\s+(?:of|is|around)?|keep\s+it\s+(?:under|below)|spend(?:ing)?\s+(?:about|around|up\s+to)?|around|about)`

// Units that follow a number in ordinary speech and prove it is NOT money.
// Phone ASR produces plenty of these ("the 10 inch one", "10 speed", "we've
// been together 10 years"), and every one of them used to become a budget.
const NON_PRICE_UNIT =
  /^\s*(?:inch|inches|in|cm|mm|millimet|centimet|foot|feet|ft|minute|min|hour|hr|day|week|month|year|yr|second|sec|speed|mode|pattern|function|setting|percent|%|o'?clock|am|pm|star|out\s+of|piece|pack|count|ct|oz|ounce|ml|gram|g\b|inch(?:es)?|degree)/i

function extractPriceMax(norm: string): number | undefined {
  // Pattern: "under $50", "less than $50", "$50", "under fifty"
  // Explicit word amounts
  const wordMap: Record<string, number> = {
    fifty: 50,
    hundred: 100,
    'one hundred': 100,
    'one fifty': 150,
    'two hundred': 200,
  }
  for (const [word, val] of Object.entries(wordMap)) {
    if (
      new RegExp(`\\b(?:under|less\\s+than)\\s+${word}\\b`).test(norm) &&
      val >= 10 &&
      val <= 500
    ) {
      return val
    }
  }

  // Numeric. A bare number is NOT a budget — it needs one of:
  //   1. a leading budget cue      ("under 50", "up to 200", "my budget is 80")
  //   2. a currency symbol         ("$50")
  //   3. a trailing money noun     ("50 dollars", "80 bucks")
  //
  // The old pattern made the cue and the "$" both optional, so ANY 2-3 digit
  // number in the utterance became a price ceiling. That is how a caller who
  // never mentioned money ended up with priceMax=10 pinned to their phone
  // number, and — because the slot persisted across sessions — kept it for
  // weeks. See the accompanying fix in conversation.server.ts.
  const re = new RegExp(
    String.raw`(?:\b${BUDGET_CUE}\s+\$?(\d{2,3})\b)` +      // cue-led
      String.raw`|(?:\$(\d{2,3})\b)` +                       // $-led
      String.raw`|(?:\b(\d{2,3})\s*(?:dollars?|bucks?|usd)\b)`, // money-noun-trailed
    'gi',
  )

  let match: RegExpExecArray | null
  while ((match = re.exec(norm)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3]
    if (raw === undefined) continue

    // Reject when a non-price unit follows the digits ("under 10 minutes").
    const tail = norm.slice(match.index + match[0].length)
    if (NON_PRICE_UNIT.test(tail)) continue

    const val = parseInt(raw, 10)
    // Prefer the first valid match.
    if (val >= 10 && val <= 500) return val
  }
  return undefined
}

// ── 6. Advice shape ───────────────────────────────────────────────────────────

function extractIsAdviceRequest(norm: string): boolean {
  return /\b(?:tell\s+me\s+about|what'?s?\s+the\s+difference|what\s+is\s+the\s+difference|how\s+do\s+i\s+pick|which\s+(?:kind|type)\s+(?:is|of)|explain\s+(?:the\s+)?lube|explain\s+(?:the\s+)?(?:differences?|options?))\b/.test(
    norm,
  )
}

// ── 7. Vulnerability markers ──────────────────────────────────────────────────

function extractVulnerabilitySignaled(norm: string): boolean {
  // Emotional / life-event markers
  const lifeEvent =
    /\b(?:embarrassing|embarrassed|scared\s+to\s+ask|don'?t\s+know\s+what\s+i'?m\s+doing|never\s+bought|never\s+done\s+this|just\s+got\s+divorced|newly\s+single|getting\s+back\s+out\s+there|after\s+(?:a\s+|the\s+)?(?:divorce|breakup|separation)|after\s+(?:my\s+)?surgery|post[- ]?partum|post[- ]?surgery|having\s+a\s+baby|haven'?t\s+been\s+with\s+anyone\s+in|haven'?t\s+had\s+sex\s+in|long[- ]?distance|chronic\s+pain|mobility|disability|after\s+losing)\b/.test(
      norm,
    )

  // Self-deprecating questioning
  const selfDep =
    /\b(?:stupid\s+question|silly\s+question|dumb\s+question|weird\s+(?:question|to\s+ask)|sorry\s+if\s+this\s+is\s+weird)\b/.test(
      norm,
    )

  return lifeEvent || selfDep
}

// ── 8. Gift with no recipient hint ───────────────────────────────────────────

const RELATIONSHIP_NOUNS_RE =
  /\b(?:husband|wife|boyfriend|girlfriend|partner)\b/

function extractGiftWithNoRecipientHint(
  norm: string,
  audience: DiscoverySlots['audience'] | undefined,
): boolean {
  if (audience && audience !== 'gift') return false // already has a real audience
  const isGiftPhrase =
    /\b(?:buying\s+a\s+gift|need\s+a\s+gift|looking\s+for\s+a\s+gift|gift\s+for\s+(?:a\s+)?(?:someone|a\s+friend|friend))\b/.test(
      norm,
    )
  if (!isGiftPhrase) return false
  return !RELATIONSHIP_NOUNS_RE.test(norm)
}

// ---------------------------------------------------------------------------
// PASS 2 — Haiku audience classifier
// ---------------------------------------------------------------------------

const HAIKU_AUDIENCE_SYSTEM = `You classify the audience of a sexual-wellness shopping query for the high-stakes
categories where audience materially changes the product fit. Return ONLY a JSON
object: { "audience": "for-her" | "for-him" | "couples" | "gift" | null,
"confidence": 0..1 }. If you cannot tell, return null for audience.`

interface HaikuAudienceResult {
  audience: DiscoverySlots['audience'] | null
  confidence: number
}

async function classifyAudienceWithHaiku(
  text: string,
): Promise<HaikuAudienceResult | null> {
  try {
    const res = await _anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 100,
      system: HAIKU_AUDIENCE_SYSTEM,
      messages: [{ role: 'user', content: text }],
    }, { signal: getTurnSignal() })

    // Usage may be absent on injected test clients; logging is best-effort
    // and must never unwind the call (see token-log.server.ts contract).
    const _u = (res.usage ?? {}) as {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
    void logApiTokens({
      feature: 'sms',
      model: HAIKU_MODEL,
      source: 'sync',
      inputTokens: _u.input_tokens ?? 0,
      outputTokens: _u.output_tokens ?? 0,
      cacheCreationTokens: _u.cache_creation_input_tokens ?? 0,
      cacheReadTokens: _u.cache_read_input_tokens ?? 0,
      caller: 'classifyAudienceWithHaiku',
    })

    const textBlock = res.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    )
    if (!textBlock) return null

    const raw = textBlock.text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
    const parsed = JSON.parse(raw) as { audience: unknown; confidence: unknown }

    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
    if (confidence < 0.7) return null

    const VALID_AUDIENCES = new Set(['for-her', 'for-him', 'couples', 'gift'])
    if (
      parsed.audience !== null &&
      typeof parsed.audience === 'string' &&
      VALID_AUDIENCES.has(parsed.audience)
    ) {
      return {
        audience: parsed.audience as DiscoverySlots['audience'],
        confidence,
      }
    }

    return { audience: null, confidence }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function extractSlots(input: ExtractInput): Promise<ExtractResult> {
  const { text, priorSlots = {} } = input
  const norm = normalize(text)

  if (!norm) {
    return { slots: {}, source: 'regex', haikuCalled: false }
  }

  // ── Regex pass ─────────────────────────────────────────────────────────────

  const categoryResult = extractCategory(norm)
  const audienceByRegex = extractAudienceByRelationshipNoun(norm)
  const experience = extractExperience(norm)
  const rawMatters = extractMatters(norm)
  const rawMood = extractMood(norm)

  // "beginner" also implies first-time if experience not already set
  const resolvedExperience: DiscoverySlots['experience'] | undefined =
    experience ??
    (rawMatters.includes('beginner-friendly') ? 'first-time' : undefined)

  const priceMax = extractPriceMax(norm)
  const isAdviceRequest = extractIsAdviceRequest(norm) || undefined
  const vulnerabilitySignaled = extractVulnerabilitySignaled(norm) || undefined
  const giftNoHint =
    extractGiftWithNoRecipientHint(norm, audienceByRegex) || undefined

  // Determine audience — gift audience from extractAudienceByRelationshipNoun
  // already handles the "buying a gift for my husband" case by returning for-him.
  // So audience from regex is final unless we skip to Haiku.
  let resolvedAudience = audienceByRegex

  // Also check bare gift-buying phrases that didn't already get an audience
  if (!resolvedAudience && giftNoHint) {
    resolvedAudience = 'gift'
  }

  // Build initial regex-sourced slots
  const regexSlots: Partial<DiscoverySlots> = {}

  if (categoryResult) {
    regexSlots.category = categoryResult.category
    if ('subtype' in categoryResult && categoryResult.subtype !== undefined) {
      regexSlots.subtype = categoryResult.subtype
    }
  }
  if (resolvedAudience !== undefined) regexSlots.audience = resolvedAudience
  if (resolvedExperience !== undefined) regexSlots.experience = resolvedExperience
  if (rawMatters.length > 0) regexSlots.matters = rawMatters
  if (rawMood.length > 0) regexSlots.mood = rawMood
  if (priceMax !== undefined) regexSlots.priceMax = priceMax
  if (isAdviceRequest) regexSlots.isAdviceRequest = true
  if (vulnerabilitySignaled) regexSlots.vulnerabilitySignaled = true
  if (giftNoHint) regexSlots.giftWithNoRecipientHint = true

  // ── Haiku pass ─────────────────────────────────────────────────────────────

  const needsHaiku =
    isHighStakesCategory(categoryResult?.category) &&
    resolvedAudience === undefined &&
    !priorSlots.audience &&
    norm.length > 5

  if (!needsHaiku) {
    return { slots: regexSlots, source: 'regex', haikuCalled: false }
  }

  const haikuResult = await classifyAudienceWithHaiku(text)

  if (haikuResult && haikuResult.audience !== null && haikuResult.audience !== undefined) {
    regexSlots.audience = haikuResult.audience
    return { slots: regexSlots, source: 'mixed', haikuCalled: true }
  }

  return { slots: regexSlots, source: haikuResult !== null ? 'mixed' : 'regex', haikuCalled: true }
}
