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
import type { ProductTypeDial, ProductSubtypeDial } from '../../types/index'
import { type DiscoverySlots, isHighStakesCategory } from './discovery-gate.server'
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

  // Gift — catch before gendered nouns since gift phrasing can co-occur
  if (
    /\b(?:as\s+a\s+(?:gift|present)|for\s+someone\s+special|wedding\s+gift|bachelorette)\b/.test(
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

// ── 5. Price ──────────────────────────────────────────────────────────────────

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

  // Numeric: look for "under $NNN", "less than $NNN", or bare "$NNN"
  const re = /(?:under|less\s+than\s*)?\$?(\d{2,3})\b/g
  let match: RegExpExecArray | null
  let found: number | undefined
  while ((match = re.exec(norm)) !== null) {
    const raw = match[1]
    if (raw === undefined) continue
    const val = parseInt(raw, 10)
    if (val >= 10 && val <= 500) {
      // Prefer the first valid match
      if (found === undefined) found = val
    }
  }
  return found
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
    })

    const _u = res.usage as {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
    void logApiTokens({
      feature: 'sms',
      model: HAIKU_MODEL,
      source: 'sync',
      inputTokens: _u.input_tokens,
      outputTokens: _u.output_tokens,
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
