/**
 * app/lib/sms-v2/intent-classifier.server.ts
 *
 * Stage-aware intent classifier for the v2 SMS pipeline.
 *
 * Classification order:
 *   1. High-precision regex bank — confidence 0.95 on hit.
 *   2. RESEARCH heuristic — question shapes, confidence 0.85.
 *   3. Haiku 4.5 structured output for ambiguous DISCOVERY/OBJECTION/SUPPORT.
 *   4. Final fallback — OFF_TOPIC, confidence 0.0, source 'fallback'.
 *
 * NOTE: STOP/HELP/START are handled upstream in sms-processor.server.ts and
 * never reach this classifier. This classifier is v2 stage-routing only.
 */
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { Intent, IntentResult, Stage } from './types.server'
import type { EmmaContext } from './types.server'
import { logApiTokens } from '../token-log.server'

const client = new Anthropic({ apiKey: (process.env['ANTHROPIC_API_KEY'] ?? '').trim() })
const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

// ---------------------------------------------------------------------------
// 0. Category hint resolver
// ---------------------------------------------------------------------------

/**
 * Maps a matched product keyword to a productTypeDial value so downstream
 * search filters can narrow to the right catalog segment.
 *
 * Returns undefined when the word doesn't map cleanly (e.g. "toy", "toys")
 * because those are too broad to assert a specific dial value.
 */
function resolveCategoryHint(word: string): string | undefined {
  // Returns the canonical top-level ProductTypeDial value (see app/types/index.ts).
  // 'plug', 'wand', 'beads' are SUBTYPES, not top-level dials — map to their
  // parent category here. The slot extractor handles subtype assignment separately.
  const w = word.trim().toLowerCase()
  if (['vibrator', 'wand', 'rabbit', 'bullet', 'clitoral', 'suction', 'air pulsation'].includes(w)) {
    return 'vibrator'
  }
  if (w === 'dildo') return 'dildo'
  if (['plug', 'butt plug', 'anal plug', 'anal beads', 'prostate massager', 'prostate'].includes(w)) {
    return 'anal'
  }
  if (['lube', 'lubricant'].includes(w)) return 'lube'
  if (['harness'].includes(w)) return 'harness'
  if (['strap-on', 'strap on'].includes(w)) return 'extender'
  if (w === 'cock ring') return 'cock-ring'
  if (['sleeve', 'masturbator', 'stroker'].includes(w)) return 'stroker'
  if (['lingerie', 'outfit', 'outfits', 'teddy', 'bodysuit', 'bodystocking', 'stockings', 'pasties'].includes(w)) {
    return 'wear'
  }
  if (['blindfold', 'restraints', 'paddle', 'flogger', 'gag', 'cuffs', 'bondage'].includes(w)) {
    return 'bondage'
  }
  if (['condom', 'condoms'].includes(w)) return 'condom'
  return undefined
}

// ---------------------------------------------------------------------------
// 1. High-precision regex bank
// ---------------------------------------------------------------------------

// Each entry: [regex, intent, optional stage filter, optional slots extractor].
// `stages` — if set, the entry only matches when conversation.stage is in this
// list. If unset, matches in all stages. This is what makes "yes" mean
// AGE_CONFIRM in GREETING but UPSELL_ACCEPT in UPSELL.
type RegexEntry = {
  re: RegExp
  intent: Intent
  stages?: ReadonlyArray<Stage>
  extractSlots?: (match: RegExpMatchArray) => Record<string, string>
}

const REGEX_BANK: RegexEntry[] = [
  // STOP_HELP_START — belt-and-suspenders; processor catches these first
  { re: /^\s*(stop|stopall|unsubscribe|cancel|end|quit|revoke)\s*$/i, intent: 'STOP_HELP_START' },
  { re: /^\s*(start|unstop|subscribe|help|info)\s*$/i,               intent: 'STOP_HELP_START' },

  // ─── Stage-gated bare-affirmation patterns (highest priority within each stage) ───
  // "yes"/"sure"/"ok" in GREETING/CONSENT_GATE → AGE_CONFIRM (consent flow)
  {
    re: /^\s*(y|ya|yes|yep|yup|sure|ok|okay|confirm|im\s*18|i\s*am\s*18|18\+?|18plus)\s*[!.]*\s*$/i,
    intent: 'AGE_CONFIRM',
    stages: ['GREETING', 'CONSENT_GATE'],
  },

  // "yes"/"sure"/"ok"/👍/✅ in UPSELL → UPSELL_ACCEPT (customer wants the accessory too)
  {
    re: /^\s*(y|ya|yes|yep|yup|sure|ok|okay|add|add\s+it|please|sounds\s+good|👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿|✅|💯)\s*[!.]*\s*$/iu,
    intent: 'UPSELL_ACCEPT',
    stages: ['UPSELL'],
  },

  // "yes"/"sure"/"ok" in PRESENTATION/OBJECTION → COMMIT_PICK (customer accepts the pitched product)
  {
    re: /^\s*(y|ya|yes|yep|yup|sure|ok|okay|sold|please|sounds\s+good|👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿|✅|💯)\s*[!.]*\s*$/iu,
    intent: 'COMMIT_PICK',
    stages: ['PRESENTATION', 'OBJECTION'],
  },

  // ─── Phrase-based COMMIT_PICK (works in all stages, customer signals buy intent) ───
  {
    // ADR-003 Sub-decision D: negative lookahead on `i want it` so "I want it to
    // help me relax" (use-case disclosure) does NOT fire COMMIT_PICK.
    // "I want it to..." → NAME_ITEM/DISCOVERY via Haiku fallback.
    // "I want it now", "I want it ♥", "I want it shipped" → still match (no \s+to\b after).
    re: /\b(i'?ll\s+take\s+it|let'?s\s+do\s+it|add\s+to\s+cart|buy\s+it|buy\s+now|place\s+order|order\s+now|check\s+out|get\s+it|send\s+it|i\s+want\s+it(?!\s+to\b)|i\s+want\s+that|i'?ll\s+get\s+it|i'?m\s+in)\b/i,
    intent: 'COMMIT_PICK',
  },
  // Short buy signals (any stage)
  {
    re: /^\s*(buy|order|checkout|sold|yes\s+please|yes\s+buy|i\s+want)\s*[!.]*\s*$/i,
    intent: 'COMMIT_PICK',
  },

  // ─── UPSELL_ACCEPT — phrase form (works in any stage but typically UPSELL) ───
  {
    re: /\b(yes\s+add|sure\s+add|add\s+the|yeah\s+add|add\s+it\s+too|get\s+it\s+too|and\s+the|throw\s+in|include\s+the)\b/i,
    intent: 'UPSELL_ACCEPT',
  },

  // ─── UPSELL_DECLINE — phrase form ───
  {
    re: /\b(no\s+thanks|nah|nope|skip|just\s+the\s+one|just\s+this\s+one|no\s+add[- ]?on|don'?t\s+need|not\s+now|maybe\s+later|pass)\b/i,
    intent: 'UPSELL_DECLINE',
  },
  // Bare "no" in UPSELL → decline. In other stages it's ambiguous, leave for Haiku.
  {
    re: /^\s*(no|nope|nah|skip|pass|👎|👎🏻|👎🏼|👎🏽|👎🏾|👎🏿|❌|🚫)\s*[!.]*\s*$/iu,
    intent: 'UPSELL_DECLINE',
    stages: ['UPSELL'],
  },

  // NAME_ITEM — "show me [X]", "tell me about [X]", "what about [X]", "I want to see [X]"
  {
    re: /\b(show\s+me|tell\s+me\s+about|what\s+about|more\s+about|info\s+on|details\s+on|i\s+want\s+to\s+see|can\s+you\s+show|find\s+me|look\s+up)\b/i,
    intent: 'NAME_ITEM',
    extractSlots: (m) => {
      // Capture everything after the matched phrase as 'item'
      const after = m.input?.slice((m.index ?? 0) + m[0].length).trim() ?? ''
      return after ? { item: after.slice(0, 120) } : {}
    },
  },
  // Direct product category mentions
  {
    re: /\b(vibrator|wand|rabbit|dildo|plug|lube|lubricant|toy|toys|bullet|clitoral|suction|air\s+pulsation|couples\s+toy|strap[- ]?on|harness|cock\s+ring|sleeve|masturbator|stroker|prostate\s+massager|prostate|lingerie|outfit|outfits|teddy|bodysuit|bodystocking|stockings|pasties|anal\s+beads|blindfold|restraints|paddle|flogger|gag|cuffs|bondage|condom|condoms)\b/i,
    intent: 'NAME_ITEM',
    extractSlots: (m) => {
      const item = m[0].toLowerCase()
      const categoryHint = resolveCategoryHint(item)
      return categoryHint ? { item, categoryHint } : { item }
    },
  },
]

// ---------------------------------------------------------------------------
// 2. RESEARCH heuristic — question shapes without a buy signal
// ---------------------------------------------------------------------------

const RESEARCH_RE =
  /\b(is\s+it|does\s+it|do\s+you\s+have|what'?s\s+the\s+difference|can\s+i\s+use|is\s+[a-z][\w\s]* compatible|compatible\s+with|works\s+with|how\s+does|is\s+this|is\s+that|will\s+it|how\s+long|how\s+big|what\s+size|waterproof|rechargeable|quiet|loud|returns?|shipping|warranty|ingredients?|material|safe\s+for|body\s+safe)\b/i

const BUY_SIGNAL_RE =
  /\b(buy|order|checkout|add\s+to\s+cart|i'?ll\s+take|get\s+it|send\s+it|place\s+order|commit|purchase)\b/i

function isResearch(text: string): boolean {
  // Must look like a question or information request AND not contain a buy signal
  const hasQuestionShape = RESEARCH_RE.test(text) || text.trim().endsWith('?')
  const hasBuySignal = BUY_SIGNAL_RE.test(text)
  return hasQuestionShape && !hasBuySignal
}

// ---------------------------------------------------------------------------
// 3. Haiku structured classifier
// ---------------------------------------------------------------------------

const HaikuIntentSchema = z.object({
  intent: z.enum([
    'STOP_HELP_START',
    'AGE_CONFIRM',
    'COMMIT_PICK',
    'UPSELL_ACCEPT',
    'UPSELL_DECLINE',
    'NAME_ITEM',
    'SUPPORT',
    'OBJECTION',
    'RESEARCH',
    'OFF_TOPIC',
  ]),
  confidence: z.number().min(0).max(1),
  slots: z.record(z.string(), z.string()).optional(),
})

const HAIKU_SYSTEM = `You classify the intent of an inbound SMS message sent to an 18+ sexual-wellness brand called xdipx. The customer is chatting with Emma, the brand's editorial voice.

Return ONLY a JSON object with these fields:
  intent: one of STOP_HELP_START | AGE_CONFIRM | COMMIT_PICK | UPSELL_ACCEPT | UPSELL_DECLINE | NAME_ITEM | SUPPORT | OBJECTION | RESEARCH | OFF_TOPIC
  confidence: float 0.0–1.0 (your certainty)
  slots: optional object of extracted entities (e.g. {"item": "vibrator"})

Intent definitions:
- STOP_HELP_START: opt-out, resubscribe, or help request
- AGE_CONFIRM: confirming they are 18+ (yes, ok, etc.)
- COMMIT_PICK: ready to buy / add to cart
- UPSELL_ACCEPT: accepting an add-on product offer
- UPSELL_DECLINE: declining an add-on product offer
- NAME_ITEM: asking about a specific product or category
- SUPPORT: order status, returns, account, shipping question
- OBJECTION: concern about price, shipping time, compatibility, safety
- RESEARCH: product question without buy intent (compatibility, specs, ingredients)
- OFF_TOPIC: unrelated to the brand or products

Respond with ONLY the JSON object, no explanation.`

async function classifyWithHaiku(
  text: string,
  stage: string,
): Promise<IntentResult> {
  try {
    const res = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 256,
      system: HAIKU_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Current conversation stage: ${stage}\nCustomer message: ${text}`,
        },
      ],
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
      caller: 'classifyWithHaiku',
    })

    const textBlock = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!textBlock) throw new Error('no text block from Haiku')

    // Strip markdown fences if Haiku wraps in ```json
    const raw = textBlock.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = HaikuIntentSchema.parse(JSON.parse(raw))

    const result: IntentResult = {
      intent: parsed.intent as Intent,
      confidence: parsed.confidence,
      source: 'haiku',
    }
    if (parsed.slots) result.slots = parsed.slots
    return result
  } catch (err) {
    console.warn('[intent-classifier] Haiku classification failed, falling back', err)
    return { intent: 'OFF_TOPIC', confidence: 0.0, source: 'fallback' }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify the intent of an inbound SMS message in the context of the current
 * conversation. Classification order:
 *   1. Regex bank (confidence 0.95)
 *   2. RESEARCH heuristic (confidence 0.85)
 *   3. Low-confidence regex (<0.5) → escalate to Haiku
 *   4. Final fallback: OFF_TOPIC, confidence 0.0
 */
export async function classifyIntent(
  conversation: Pick<EmmaContext['conversation'], 'stage'>,
  inboundText: string,
): Promise<IntentResult> {
  const text = inboundText.trim()
  if (!text) return { intent: 'OFF_TOPIC', confidence: 0.0, source: 'fallback' }

  // --- Step 1: Regex bank ---
  // Stage-aware: skip entries whose `stages` filter excludes the current stage.
  // Without this, AGE_CONFIRM's bare-"yes" pattern would always win over
  // UPSELL_ACCEPT and COMMIT_PICK because it appears earlier in the list.
  const currentStage = conversation.stage as Stage
  for (const entry of REGEX_BANK) {
    if (entry.stages && !entry.stages.includes(currentStage)) continue
    const match = text.match(entry.re)
    if (match) {
      const result: IntentResult = {
        intent: entry.intent,
        confidence: 0.95,
        source: 'regex',
      }
      if (entry.extractSlots) {
        const slots = entry.extractSlots(match)
        if (Object.keys(slots).length > 0) result.slots = slots
      }
      return result
    }
  }

  // --- Step 2: RESEARCH heuristic ---
  if (isResearch(text)) {
    return { intent: 'RESEARCH', confidence: 0.85, source: 'regex' }
  }

  // --- Step 3: Haiku for ambiguous cases ---
  // At this point we don't have a regex match (confidence effectively 0) so
  // escalate to Haiku to distinguish DISCOVERY/OBJECTION/SUPPORT/OFF_TOPIC.
  return classifyWithHaiku(text, conversation.stage)
}
