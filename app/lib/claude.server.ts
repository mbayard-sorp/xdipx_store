import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import type {
  Deal, EmmaHeroCopy, EmmaHeroVariant, GenerateCopyRequest, GenerateCopyResult, ProductScore,
  SensationDialV2, SensationDialItem, DialValue, ProductTypeDial, ProductSubtypeDial, CareInstructions,
} from '~/types'
import { getPipelineSetting } from './feed-processor.server'
import { buildKeywordBlock, type SeoContentType } from './seo-keywords.server'
import { getEditorialAuthor } from './editorial-author.server'
import {
  RAIL_TOOLS,
  buildCandidatePool,
  createRailGenState,
  executeRailTool,
  type RailProposal,
  type PairingWhyProposal,
} from '~/lib/emma-rail-tools.server'
// `runSingleClaudeCallViaSdk` is still exported from llm-client.server.ts and ready
// to be re-imported here when the SDK's single-turn surface starts working for
// our JSON-only prompts. See header comment on `callClaude` below.
import { type LLMClient } from '~/lib/llm-client.server'

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })

/**
 * Single point of routing for per-tool generators. Currently HYBRID by design:
 *
 *   - Outer orchestrator turn loop routes through the Agent SDK / Max
 *     subscription via `runOrchestrationViaSdk` in emma-orchestrator.server.ts.
 *   - Per-tool generators (this function's callers) route through the
 *     Anthropic SDK / API key. We keep the `llmClient` parameter threaded
 *     through every generator (and surface it here) so that when the SDK's
 *     single-turn surface starts working for our use case, we can flip the
 *     branch back on without re-touching every generator.
 *
 * Why per-tool can't currently route through Max: the Agent SDK is
 * tool-using-agent shaped. `runSingleClaudeCallViaSdk` (with `tools: []`,
 * `maxTurns: 1`) returns literal text "Failed to ..." for our JSON-only
 * prompts — Claude Code refuses the bare-prompt shape. Investigation deferred;
 * see `runSingleClaudeCallViaSdk` in llm-client.server.ts and the comment block
 * around the disabled SDK branch below.
 *
 * Returns text + per-call token counts so generators can surface telemetry up
 * to the orchestrator's `state.telemetry.toolCalls` entries via the
 * `drainToolTokens()` helper.
 */
async function callClaude(opts: {
  llmClient?: LLMClient | undefined
  model:      string
  maxTokens:  number
  /** Plain string system prompt (uncached). Mutually exclusive with `systemBlocks`. */
  system?:    string
  /**
   * Structured system prompt with optional `cache_control` per block. Used to
   * cache the stable persona + brand voice prefix across the ~14 per-tool calls
   * within a product enrichment run (and across products processed within the
   * 5-minute ephemeral cache TTL). Mutually exclusive with `system`.
   */
  systemBlocks?: ReadonlyArray<{ text: string; cache?: boolean }>
  userPrompt: string
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  // SDK branch DISABLED — see header comment.
  void opts.llmClient

  const systemParam: string | Anthropic.TextBlockParam[] | undefined = opts.systemBlocks
    ? opts.systemBlocks.map(b => ({
        type: 'text' as const,
        text: b.text,
        ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }))
    : opts.system

  if (systemParam === undefined) {
    throw new Error('callClaude: system or systemBlocks required')
  }

  const msg = await client.messages.create({
    model:      opts.model,
    max_tokens: opts.maxTokens,
    system:     systemParam,
    messages:   [{ role: 'user', content: opts.userPrompt }],
  })
  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error('Unexpected Claude response type')
  const usage = msg.usage as (typeof msg.usage) & {
    cache_creation_input_tokens?: number
    cache_read_input_tokens?:     number
  }
  const result = {
    text:         block.text,
    inputTokens:  usage.input_tokens,
    outputTokens: usage.output_tokens,
  }
  _toolTokenAccumulator.input         += result.inputTokens
  _toolTokenAccumulator.output        += result.outputTokens
  _toolTokenAccumulator.cacheCreation += usage.cache_creation_input_tokens ?? 0
  _toolTokenAccumulator.cacheRead     += usage.cache_read_input_tokens     ?? 0
  return result
}

/**
 * Build a cacheable system block array for Emma's voice surfaces. Pull the
 * brand voice from pipelineSettings once (or use the explicit override) and
 * tag both blocks with `cache_control: ephemeral` so subsequent generators
 * within the 5-minute TTL hit the cache at ~10% input price.
 *
 * Used by every per-tool generator that previously concatenated
 * `${EMMA_SYSTEM_PROMPT}\n\n${brandVoice}` into a string. Switch from
 * `system` to `systemBlocks: await buildEmmaSystemBlocks(brandVoiceOverride)`.
 */
export async function buildEmmaSystemBlocks(brandVoiceOverride?: string): Promise<ReadonlyArray<{ text: string; cache?: boolean }>> {
  const brandVoice = brandVoiceOverride ?? (await getPipelineSetting('brandVoice')) ?? DEFAULT_BRAND_VOICE
  return [
    { text: EMMA_SYSTEM_PROMPT, cache: true },
    { text: brandVoice,         cache: true },
  ]
}

/** Cacheable variant of the legacy SYSTEM_PROMPT used by `generateCopy`. */
function buildLegacySystemBlocks(): ReadonlyArray<{ text: string; cache?: boolean }> {
  return [{ text: SYSTEM_PROMPT, cache: true }]
}

/**
 * Module-level accumulator for per-tool token counts. callClaude adds to it;
 * the orchestrator's executeTool dispatch drains it after each tool call so
 * the totals can be attributed to the right ToolCallTrace entry. Cache fields
 * are tracked separately so the cost summary can show how much of each call's
 * input was cache-read (90% off) vs. fresh-write (1.25× input).
 */
let _toolTokenAccumulator = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }

/** Drain the accumulator and return the delta. Resets on read. */
export function drainToolTokens(): { input: number; output: number; cacheCreation: number; cacheRead: number } {
  const out = _toolTokenAccumulator
  _toolTokenAccumulator = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
  return out
}

// Tiered models: HAIKU for short/templated copy (~20× cheaper), SONNET for
// long-form narrative and structured tasks (full_story, specs, schedule, blog).
const MODEL      = 'claude-sonnet-4-20250514'
const MODEL_FAST = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `You are the voice of xdipx.com, a daily flash-sale site for sexual wellness products.
Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy.
Write as a trusted, funny friend who isn't embarrassed about the topic. Your goal is to welcome first-time buyers and delight experienced ones.
Keep all copy tasteful. Suggestive is fine, explicit is not.
Always signal discretion, value, and trust.
Use "sex" and "sexy" sparingly but allow them in helpful contexts where they fit the product and aid customer discovery (e.g. "sex toy", "safer sex", "sex-positive", "sexy lingerie", "sexy gift"). Default to "intimate", "pleasure", or "wellness" for general voice. Both words are fine in titles, SEO meta, FAQs, and product descriptions when they read naturally and serve the customer; avoid them where they'd feel clinical, crude, or just dropped in for SEO bait.
Never assume the reader's experience level.
Always end descriptions with a curiosity hook that makes the reader want to try it.

Punctuation rules (strict):
- NEVER use em-dashes ("—") or en-dashes ("–"). They read as AI-written.
- Use periods, commas, or parentheses instead. Two short sentences beat one long sentence with an em-dash.
- Hyphens ("-") inside compound words ("soft-touch", "travel-size") are fine.

Hard facts (never invent variants):
- Credit-card statement descriptor is "XDIPX". If you mention billing, the descriptor, or what shows on a statement, write it as XDIPX. Never invent another descriptor (no DIPCOM, no XDIPX.COM, no variants).
- Brand name is "xdipx" (lowercase) and is pronounced "ex-dip-ex" (three syllables). Never "ex-dip" or "x-dipx".
- Orders ship in plain unbranded packaging. Don't claim same-day or next-day shipping unless given as context.

SEO targeting:
- When a <keyword_targets> block appears in the input, weave the primary term into the headline and first 100 words exactly once. Integrate secondary terms naturally across headings and body. Long-tail and question terms surface best in FAQs, asides, and supporting paragraphs.
- Never stuff. Do not repeat the primary term more than three times in body copy.
- If a term feels forced, drop it. Voice always wins over keyword density.
- Avoid any term listed inside <avoid>.`

async function generate(
  prompt: string,
  maxTokens = 1024,
  model: string = MODEL,
  llmClient?: LLMClient,
): Promise<string> {
  const { text } = await callClaude({
    llmClient,
    model,
    maxTokens,
    systemBlocks: buildLegacySystemBlocks(),
    userPrompt: prompt,
  })
  return text
}

/**
 * Reusable low-level call for short, one-shot generations (contextual asides,
 * microcopy, etc.). Lets callers override the system prompt while sharing the
 * same Anthropic client + error handling. Supports a wall-clock timeout so
 * PDP renders don't hang on slow model responses.
 */
export async function generateWithSystem(opts: {
  system:     string
  user:       string
  model?:     string
  maxTokens?: number
  timeoutMs?: number
}): Promise<string> {
  const { system, user, model = MODEL_FAST, maxTokens = 128, timeoutMs } = opts
  const call = client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  })
  const msg = timeoutMs
    ? await Promise.race([
        call,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Claude request timed out')), timeoutMs),
        ),
      ])
    : await call
  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error('Unexpected Claude response type')
  return block.text
}

/** Exported brand-voice system prompt so callers composing their own user prompts can speak in brand voice. */
export const BRAND_VOICE_SYSTEM_PROMPT = SYSTEM_PROMPT

/** Strip markdown code fences that Claude sometimes wraps JSON in. */
function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
}

/**
 * Detect when the model wrote meta-commentary about the prompt instead of the
 * requested output. Triggered when keyword targets are off-topic (e.g. a
 * product type with no keyword-bank coverage falls through the GROQ filter
 * and surfaces unrelated terms — the model "helpfully" calls out the
 * mismatch in plain text instead of generating copy). Caller falls through
 * to retry / deterministic fallback.
 *
 * Patterns are intentionally conservative — false positives here truncate
 * legit copy to the fallback, which is worse than the current behaviour for
 * normal output. Only the obvious commentary openings are flagged.
 */
/**
 * Detect price mentions in generated copy. Prices change frequently and storing
 * them in body/SEO/tagline copy creates stale text — the PDP renders Shopify's
 * live price separately. Caller falls through to retry / deterministic fallback
 * when this returns true.
 *
 * Matches: "$73.99", "$74", "73.99 dollars", "73 dollars", "for $5".
 * Does NOT match: dimension specs like "16 oz" or "5/5" dial values.
 */
function containsPrice(text: string): boolean {
  return /\$\s?\d/.test(text) || /\b\d+(?:\.\d{1,2})?\s*(?:dollars|usd)\b/i.test(text)
}

function looksLikeMetaCommentary(text: string): boolean {
  const head = text.slice(0, 80).toLowerCase()
  return (
    head.startsWith('i notice') ||
    head.startsWith("i'm flagging") ||
    head.startsWith('i am flagging') ||
    head.startsWith("i'd flag") ||
    head.startsWith('the keyword') ||
    head.startsWith("these keywords don't") ||
    head.startsWith('these keyword targets') ||
    head.startsWith('the provided keyword')
  )
}

/** Map copy type → keyword bank content-type so the right keywords surface. */
function resolveSeoContentType(type: GenerateCopyRequest['type']): SeoContentType {
  if (type === 'blog_article') return 'blog'
  return 'pdp'
}

export async function generateCopy(req: GenerateCopyRequest, llmClient?: LLMClient): Promise<GenerateCopyResult> {
  const { type, product } = req

  // Resolve optional editorial author. Emma is implied by the default brand voice;
  // when an explicit author is set, voiceRules layer on top in the blog_article case.
  const author = req.authorSlug ? await getEditorialAuthor(req.authorSlug).catch(() => null) : null
  const seoMode = req.seoMode ?? author?.seoMode ?? 'natural'

  // Pull the keyword targeting block in parallel with prompt assembly.
  // No-op (returns '') when seoMode === 'off' or the bank has nothing matching —
  // copy generation falls back to the pre-keyword behaviour.
  const keywordBlock = await buildKeywordBlock({
    productType: product.productTypeDial,
    moods:       product.moodTags,
    audiences:   product.audienceTags,
    matters:     product.mattersTags,
    contentType: resolveSeoContentType(type),
    topic:       req.topic,
    seoMode,
  }).catch((err) => {
    console.error('[claude] buildKeywordBlock failed (continuing without):', err)
    return ''
  })

  // Editorial direction: price MUST NOT appear in any AI-generated copy. Prices
  // change frequently and storing them in body/SEO/tagline copy creates stale
  // text. The PDP renders Shopify's live price separately from this content.
  const productContextBase = `Product: ${product.title}\nBrand: ${product.brand}\nDescription: ${product.description}\nCategories: ${product.categories.join(', ')}`
  const productContext = keywordBlock
    ? `${productContextBase}\n\n${keywordBlock}`
    : productContextBase

  switch (type) {
    case 'tagline': {
      const primaryPrompt = `Write 3 one-sentence taglines for the following product. Emma voice — observational, casual, lightly witty. Think: a trusted friend who's recommending it, not a stand-up comedian. Avoid punchline-shaped puns and ad-copy zingers. Fragments are welcome ("the one I keep recommending", "earns its spot daily", "quietly indispensable"). First person OK. Max 12 words each. NO em-dashes. NO ♥ glyph (reserve it for CTAs and asides). If any keyword targets in the prompt do not fit this product, IGNORE them silently — write from product details only. Never narrate a mismatch, never preface, never explain. Return as a JSON array of strings (no markdown).\n\n${productContext}`
      const retryPrompt   = `Return exactly one short Emma-voice product tagline. Observational, casual, ≤ 12 words. No em-dashes, no ♥ glyph, no quotes, no preamble, no commentary. Just the sentence.\n\n${productContext}`

      const raw = await generate(primaryPrompt, 1024, MODEL_FAST, llmClient)
      try {
        const parsed = JSON.parse(stripFences(raw)) as string[]
        if (Array.isArray(parsed)) {
          const clean = parsed.filter(s => typeof s === 'string' && s.trim() && !looksLikeMetaCommentary(s))
          if (clean.length > 0) return { type, content: clean }
        }
      } catch { /* fall through to retry */ }

      const retried = await generate(retryPrompt, 1024, MODEL_FAST, llmClient)
      const line = retried.trim().split('\n')[0]?.trim()
      if (line && !looksLikeMetaCommentary(line)) return { type, content: [line] }

      return { type, content: [`${product.brand} ${product.title}, today on xdipx.`] }
    }

    case 'full_story': {
      const primaryPrompt = `Write a short, punchy product description in xdipx brand voice. Return valid HTML only — use <p> tags for paragraphs, <strong> for emphasis, <em> for playful asides, <ul>/<li> for bullets. No <html>, <head>, <body> tags. No headings.\n\nFormat: EXACTLY 2 short paragraphs (3–4 sentences each) followed by a <ul> with 6–10 benefit bullets.\n\nTone: funny, cheeky, a little raunchy — innuendo is welcome, tasteful dirty jokes are great, but nothing gross or clinical. Think: your funniest friend who sells pleasure products and has zero shame. Make the reader smile AND want to buy.\n\nDo NOT include: price, shipping, dimensions, materials, or any technical specs (those live in a separate Specs tab).\nDo NOT start with the product name.\n\n${productContext}`
      const retryPrompt   = `Return ONLY valid HTML starting with <p>. No preamble, no markdown, no explanation. Write 2 short paragraphs and a <ul> bullet list about this product in a funny, cheeky brand voice.\n\n${productContext}`

      const text = await generate(primaryPrompt)
      if (text.includes('<p')) return { type, content: text }

      const retried = await generate(retryPrompt)
      if (retried.includes('<p')) return { type, content: retried }

      return { type, content: `<p>${product.description.slice(0, 400)}</p>` }
    }

    case 'both_ways': {
      const primaryPrompt = `Write two sections for the xdipx "Both Ways ♥" tab (60–90 words each). Return valid HTML — use <p> tags, <strong> for emphasis, <em> for playful asides. No headings. Return as JSON with keys "forHim" and "forHer", each containing an HTML string.

STRATEGY — read the product categories carefully:

If the product is primarily FOR HER (vibrators, rabbits, clit stimulators, air pulse, etc.):
- "forHer": Genuine, warm, compelling sell written directly TO women. Speak to her pleasure, her curiosity, her experience. Make her feel seen and excited. This is the hero section.
- "forHim": Humorous angle — he can't use it directly but here's why he should buy it anyway. Options: the joy of being the one who gives this gift, using it together as a couple, or a playfully absurd "creative solo use" that's funny but not weird. Keep it light and self-aware.

If the product is primarily FOR HIM (strokers, masturbators, prostate toys, etc.):
- "forHim": Genuine, warm, compelling sell written directly TO men. Speak to his pleasure, curiosity, experience. Make him feel this was made for him.
- "forHer": Humorous angle — she can't use it directly but here's why she should be excited about it. Options: the magic of a satisfied partner, using it together, or a playfully absurd angle. Keep it warm and funny.

If the product works for both or is a couples toy: write genuine, enthusiastic content for each.

${productContext}`
      const retryPrompt = `Return ONLY raw JSON with no markdown, no prose before or after:\n{"forHim": "<p>...</p>", "forHer": "<p>...</p>"}\n\nWrite 60-90 words each in a playful brand voice about this product.\n\n${productContext}`

      const tryParse = (raw: string): { forHim: string; forHer: string } | null => {
        try {
          const parsed = JSON.parse(stripFences(raw)) as { forHim: string; forHer: string }
          if (parsed?.forHim && parsed?.forHer) return parsed
        } catch { /* fall through */ }
        // Try extracting JSON object from within markdown or prose
        const match = raw.match(/\{[\s\S]*?"forHim"[\s\S]*?"forHer"[\s\S]*?\}/)
        if (match) {
          try {
            const parsed = JSON.parse(match[0]) as { forHim: string; forHer: string }
            if (parsed?.forHim && parsed?.forHer) return parsed
          } catch { /* fall through */ }
        }
        return null
      }

      const first = await generate(primaryPrompt)
      const firstParsed = tryParse(first)
      if (firstParsed) return { type, content: firstParsed }

      const retried = await generate(retryPrompt)
      const secondParsed = tryParse(retried)
      if (secondParsed) return { type, content: secondParsed }

      return {
        type,
        content: {
          forHim: `<p><strong>${product.title}</strong> — worth exploring together. Trust us, being the person who brings this home is its own reward. ♥</p>`,
          forHer: `<p><strong>${product.title}</strong> — made with you in mind. Your curiosity is valid, your comfort matters, and this is exactly the kind of upgrade you deserve. ♥</p>`,
        },
      }
    }

    case 'bullets': {
      const primaryPrompt = `Write 4–6 feature bullet points for this product. Short, specific, benefit-first. No fluff. Return as a JSON array of strings.\n\n${productContext}`
      const retryPrompt   = `Return ONLY a JSON array of 4 to 5 short benefit strings. Example: ["Dual motors for blended stimulation", "Whisper-quiet for total privacy"]. Nothing else — no markdown, no prose.\n\n${productContext}`

      const raw = await generate(primaryPrompt, 1024, MODEL_FAST, llmClient)
      try {
        const parsed = JSON.parse(stripFences(raw)) as string[]
        if (Array.isArray(parsed) && parsed.length >= 3) return { type, content: parsed }
      } catch { /* fall through */ }

      const retried = await generate(retryPrompt, 1024, MODEL_FAST, llmClient)
      try {
        const parsed = JSON.parse(stripFences(retried)) as string[]
        if (Array.isArray(parsed) && parsed.length >= 3) return { type, content: parsed }
      } catch { /* fall through */ }

      const lines = product.description
        .split(/[.!?\n]/)
        .map(s => s.trim())
        .filter(s => s.length > 20 && s.length < 120)
        .slice(0, 4)
      return { type, content: lines.length >= 3 ? lines : [`${product.title} by ${product.brand}`, 'Rechargeable and body-safe', 'Ships discreetly'] }
    }

    case 'email_subjects': {
      const raw = await generate(
        `Write 5 email subject lines for today's daily deal email. Max 50 chars each. Playful, urgent, curiosity-driven. Return as a JSON array of strings.\n\n${productContext}`,
        1024,
        MODEL_FAST,
      )
      try {
        return { type, content: JSON.parse(stripFences(raw)) as string[] }
      } catch {
        return { type, content: raw.split('\n').filter(Boolean).slice(0, 5) }
      }
    }

    case 'seo_meta': {
      const primaryPrompt = `Write a 140–155 character SEO meta description for this product. This shows in Google SERP and link previews — drives click-through.

Two anchors to include (Emma voice within these constraints):
  (a) Trust beat: "Ships discreetly" — keeps the discretion signal in SERP
  (b) Benefit beat in light Emma voice — fragment OK, first-person OK, no marketing fluff

NEVER mention price, discount, or any dollar amount. Prices change; this copy is durable. Keep the focus on the product and how it feels to use.

If any keyword targets in this prompt don't actually fit the product, IGNORE them silently and write the description from the product details only — never narrate the mismatch, never preface, never explain. Output exactly the description and nothing else.

Voice: light Emma — observational, warm, specific. Not a generic SEO template, not a stand-up zinger. Brand mentions written as "XDIPX" (uppercase). NO em-dashes ("—" or "–"). Return ONLY the meta description text — no quotes, no labels.\n\n${productContext}`
      const retryPrompt   = `Write a single SEO meta description, 140 to 155 characters. Light Emma voice. Include "Ships discreetly". NEVER mention price or dollar amounts. No em-dashes. Output ONLY the description text — no preamble, no commentary, no quotes.\n\n${productContext}`

      const text = await generate(primaryPrompt, 1024, MODEL_FAST, llmClient)
      const cleaned = text.replace(/^["']|["']$/g, '').trim()
      if (cleaned.length >= 50 && !looksLikeMetaCommentary(cleaned) && !containsPrice(cleaned)) return { type, content: cleaned.slice(0, 155) }

      const retried = await generate(retryPrompt, 1024, MODEL_FAST, llmClient)
      const cleanedRetry = retried.replace(/^["']|["']$/g, '').trim()
      if (cleanedRetry.length >= 50 && !looksLikeMetaCommentary(cleanedRetry) && !containsPrice(cleanedRetry)) return { type, content: cleanedRetry.slice(0, 155) }

      // Fallback: deterministic, no em-dashes, no price.
      const fallback = `${product.brand} ${product.title}. Ships discreetly from XDIPX.`
      return { type, content: fallback.slice(0, 155) }
    }

    case 'box_contents': {
      const primaryPrompt = `Extract what is physically included in the box for this product from the description below. Return a JSON array of short strings (one item per element), e.g. ["1x vibrator", "1x USB charging cable", "1x storage pouch"]. If the description doesn't mention box contents, infer the most likely inclusions based on the product type. Return only the JSON array, no markdown.\n\n${productContext}`
      const retryPrompt   = `Return ONLY a JSON array of what's in the box. Example: ["1x vibrator", "1x USB cable"]. Nothing else — no markdown, no prose, no explanation.\n\n${productContext}`

      const raw = await generate(primaryPrompt, 1024, MODEL_FAST, llmClient)
      try {
        const parsed = JSON.parse(stripFences(raw)) as string[]
        if (Array.isArray(parsed) && parsed.length >= 1) return { type, content: parsed }
      } catch { /* fall through */ }

      const retried = await generate(retryPrompt, 1024, MODEL_FAST, llmClient)
      try {
        const parsed = JSON.parse(stripFences(retried)) as string[]
        if (Array.isArray(parsed) && parsed.length >= 1) return { type, content: parsed }
      } catch { /* fall through */ }

      return { type, content: [`1x ${product.title}`, '1x User manual'] }
    }

    case 'quiet_endorsement': {
      const mapNote = product.mapRestricted
        ? 'This product is MAP-restricted — do NOT reference a discount or a strike price. The hook must be Emma\'s endorsement, not the price.'
        : 'You may reference a pleasant price or value if it flows naturally, but the hook should still be Emma\'s endorsement, not the discount.'
      const primaryPrompt = `Write the four short strings for Emma's "quiet endorsement" homepage template. Emma voice: a trusted, funny friend who has actually tried this and quietly can't stop thinking about it. Never "Buy now" — never countdowns — never "sex" as an adjective. Use "intimate", "pleasure", "wellness", "slow-burn", "satisfaction".
${mapNote}

Return ONLY a raw JSON object (no markdown) with these exact keys:
- eyebrow: a tag line ≤ 60 chars, two short phrases joined by " · " (middle dot, U+00B7). Example shape: "quiet endorsement · works for MAP-restricted".
- subhead: one short line, lowercase, casual — something like "updated whenever I change my mind".
- body: 1–2 sentences (≤ 200 chars total). First person, Emma voice. Wrap one 1–4 word phrase in underscores like _slow-burn energy_ so the UI can highlight it in coral. End with a soft curiosity nudge ("Come see.", "Worth a peek.", etc).
- bannerHeadline: ≤ 30 chars, italic-editorial feel, product name in Emma's words. Use " · " as separator if you have two parts. Example: "Slowburn · the Hush".

${productContext}`
      const retryPrompt = `Return ONLY raw JSON. No markdown, no prose before or after. Shape: {"eyebrow": "...", "subhead": "...", "body": "...", "bannerHeadline": "..."}. Follow Emma voice rules. ${productContext}`

      const isValid = (v: unknown): v is import('~/types').QuietEndorsementCopy => {
        if (!v || typeof v !== 'object') return false
        const obj = v as Record<string, unknown>
        return typeof obj.eyebrow === 'string' && obj.eyebrow.trim().length > 0
          && typeof obj.subhead === 'string' && obj.subhead.trim().length > 0
          && typeof obj.body === 'string' && obj.body.trim().length > 0
          && typeof obj.bannerHeadline === 'string' && obj.bannerHeadline.trim().length > 0
      }

      const raw = await generate(primaryPrompt, 512, MODEL_FAST, llmClient)
      try {
        const parsed = JSON.parse(stripFences(raw))
        if (isValid(parsed)) return { type, content: parsed }
      } catch { /* fall through */ }

      const retried = await generate(retryPrompt, 512, MODEL_FAST, llmClient)
      try {
        const parsed = JSON.parse(stripFences(retried))
        if (isValid(parsed)) return { type, content: parsed }
      } catch { /* fall through */ }

      return {
        type,
        content: {
          eyebrow:        product.mapRestricted ? 'quiet endorsement · works for MAP-restricted' : 'quiet endorsement · editor\u2019s pick',
          subhead:        'updated whenever I change my mind',
          body:           `I\u2019ve been a little obsessed with this one \u2014 it\u2019s got a kind of _slow-burn energy_ I wasn\u2019t expecting. Come see.`,
          bannerHeadline: `${product.brand || 'Emma\u2019s pick'} \u00B7 ${product.title}`.slice(0, 30),
        },
      }
    }

    case 'pair_bundle': {
      const partner = product.partner
      const nowISO  = () => new Date().toISOString()

      const staticFallback = (): import('~/types').PairBundleCopy => ({
        eyebrow:      'emma recommends · a pair',
        subhead:      'better together · save when you grab both',
        headline:     'These two were made for each other.',
        body:         `One sets the mood, the other carries it. It\u2019s the kind of _slow-burn pairing_ that just clicks. Come see.`,
        bannerLine:   '\u2014 Emma \u00B7 picked this pair because they click \u00B7 swaps it when something better lands',
        pairedHandle: '',
        generatedAt:  nowISO(),
        primaryTag:   'this one',
        partnerTag:   'and this',
        knotCaption:  'tied together on purpose',
        conciergeSalutation: 'great to have you',
        whyCards: [
          { head: 'One handles the fun part.', body: 'The rumble, the tease, the main event. Dialed in and ready to go.' },
          { head: 'The other handles the smart part.', body: 'Keeps everything gliding, safe on toys, easy on skin. No drama, no cleanup headache.' },
          { head: 'Together they buy you time.', body: 'Less stop-and-start, more flow. You\u2019ll feel the difference in the first few minutes.' },
        ],
        emmaQuote:    `This is the pair I\u2019d hand a friend who asked \u201Cjust pick something for me.\u201D One does the work, one does the _finish_, and together they feel intentional. That\u2019s the whole point of a good pair.`,
        momentTitle:  'how to make this pair click',
        moments: [
          { lead: 'Start with the lube.', body: 'A little goes a long way \u2014 warm it in your hands first so it lands smooth instead of startling.' },
          { lead: 'Then bring in the other.', body: 'Let the rhythm build before you ramp up. The pair wants you unhurried.' },
        ],
      })

      if (!partner) {
        return {
          type,
          content: {
            ...staticFallback(),
            body:       `Set a pair in the toolbar first \u2014 I\u2019ll write this once I can see both.`,
            bannerLine: '\u2014 Emma \u00B7 waiting on a pairing',
          },
        }
      }

      const pairContext = `Primary product:\n- Title: ${product.title}\n- Brand: ${product.brand}\n- Description: ${product.description}\n- Categories: ${product.categories.join(', ')}${product.dealPrice ? `\n- Deal price: $${product.dealPrice}` : ''}\n\nPartner product:\n- Title: ${partner.title}\n- Brand: ${partner.brand}\n- Description: ${partner.description}\n- Categories: ${partner.categories.join(', ')}${partner.dealPrice ? `\n- Deal price: $${partner.dealPrice}` : ''}`

      const voiceRules = `VOICE RULES (strict):
- Emma is a persona \u2014 she does NOT claim to have personally used or tested any product.
- NEVER say: "I tried", "I tested", "I've been using", "been living with", "spent X weeks", "I reached for this", "since April", "a month of use", or any similar first-person use claim.
- NEVER invent usage stats ("238 pairs grabbed", "top 5%", "my #1").
- Emma curates, pairs, and recommends \u2014 she speaks about why things WOULD click, not what she felt.
- OK to say: "picks this pair", "I\u2019d hand this to a friend", "why they click", "made for each other", "the slow one", "the fix-it one", "a pairing that works".
- Do NOT name the brands. Do NOT restate the product titles. Do NOT surface countdowns or "until midnight".
- Use "intimate", "pleasure", "wellness", "slow-burn", "satisfaction" \u2014 never "sex" as an adjective.`

      const shapeSpec = `Return ONLY a raw JSON object (no markdown fences, no prose around it) with EXACTLY these keys:

{
  "eyebrow":     string  // \u2264 60 chars, two short phrases joined by " \u00B7 " (middle dot U+00B7). e.g. "emma recommends \u00B7 a powerful pair"
  "subhead":     string  // \u2264 70 chars, lowercase, casual. e.g. "better together \u00B7 save when you grab both"
  "headline":    string  // 6\u201310 words, editorial italic feel, the hook. e.g. "These two were made for each other."
  "body":        string  // 25\u201345 words, 2 sentences. Wrap ONE 1\u20134 word phrase in underscores like _slow-burn energy_. Describe both products' ROLES (one does X, the other does Y). End with a soft curiosity nudge.
  "bannerLine":  string  // one short italic Emma sign-off, no testimony. e.g. "\u2014 Emma \u00B7 picks this pair for slow-burn nights \u00B7 swaps it when something better lands"
  "primaryTag":  string  // 2\u20133 lowercase words, curator voice, describes the primary's ROLE. e.g. "the buzz one" or "the slow one"
  "partnerTag":  string  // 2\u20133 lowercase words, curator voice, describes the partner's ROLE. e.g. "the glide one" or "the fix-it one"
  "knotCaption": string  // 3\u20136 words, short label for why they're tied together. e.g. "tied together on purpose" or "one better idea"
  "conciergeSalutation": string  // 2\u20135 lowercase words, warm Emma-voice greeting shown next to her avatar after "Hello, I'm Emma your shop concierge." e.g. "great to meet you" or "happy you stopped by". No exclamation marks, no first-person product claims.
  "whyCards": [          // EXACTLY 3 entries explaining why the pairing works
    { "head": string,    // 5\u20139 words ending in a period. Short editorial hook. e.g. "One handles the fun part."
      "body": string }   // 15\u201325 words, no testimony, factual + evocative
  ],
  "emmaQuote":   string  // 35\u201360 words, 2\u20133 sentences, first-person curator voice ("this is the pair I'd hand a friend"). Supports 1\u20132 _emphasis_ spans. NEVER "tried/tested/used".
  "momentTitle": string  // 5\u20138 words, italic feel. e.g. "how to make this pair click"
  "moments": [           // 2 or 3 entries \u2014 a quick how-to for the pair
    { "lead": string,    // 4\u20137 words, will render bold. e.g. "Start with the lube."
      "body": string }   // 15\u201322 words continuing the step in Emma voice
  ]
}

The whyCards array MUST have length 3. The moments array MUST have length 2 or 3. No extra keys. No nulls.`

      const primaryPrompt = `Write Emma's "pair bundle" editorial module copy \u2014 two curated products sold together at a better price.

${voiceRules}

${shapeSpec}

${pairContext}`

      const retryPrompt = `Return ONLY raw JSON matching this exact shape: {"eyebrow","subhead","headline","body","bannerLine","primaryTag","partnerTag","knotCaption","conciergeSalutation","whyCards":[{"head","body"},{"head","body"},{"head","body"}],"emmaQuote","momentTitle","moments":[{"lead","body"},{"lead","body"}]}.\n\n${voiceRules}\n\n${pairContext}`

      type Raw = Omit<import('~/types').PairBundleCopy, 'pairedHandle' | 'generatedAt'>

      const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
      const isCard = (v: unknown): v is { head: string; body: string } =>
        !!v && typeof v === 'object' && isStr((v as Record<string, unknown>).head) && isStr((v as Record<string, unknown>).body)
      const isMoment = (v: unknown): v is { lead: string; body: string } =>
        !!v && typeof v === 'object' && isStr((v as Record<string, unknown>).lead) && isStr((v as Record<string, unknown>).body)

      const isValid = (v: unknown): v is Raw => {
        if (!v || typeof v !== 'object') return false
        const o = v as Record<string, unknown>
        return isStr(o.eyebrow)
          && isStr(o.subhead)
          && isStr(o.headline)
          && isStr(o.body)
          && isStr(o.bannerLine)
          && isStr(o.primaryTag)
          && isStr(o.partnerTag)
          && isStr(o.knotCaption)
          && isStr(o.emmaQuote)
          && isStr(o.momentTitle)
          && Array.isArray(o.whyCards) && o.whyCards.length === 3 && o.whyCards.every(isCard)
          && Array.isArray(o.moments) && (o.moments.length === 2 || o.moments.length === 3) && o.moments.every(isMoment)
      }

      const wrap = (copy: Raw): import('~/types').PairBundleCopy => ({
        ...copy,
        pairedHandle: '',
        generatedAt:  nowISO(),
      })

      const raw = await generate(primaryPrompt, 1800, MODEL_FAST, llmClient)
      try {
        const parsed = JSON.parse(stripFences(raw))
        if (isValid(parsed)) return { type, content: wrap(parsed) }
      } catch { /* fall through */ }

      const retried = await generate(retryPrompt, 1800, MODEL_FAST, llmClient)
      try {
        const parsed = JSON.parse(stripFences(retried))
        if (isValid(parsed)) return { type, content: wrap(parsed) }
      } catch { /* fall through */ }

      return { type, content: staticFallback() }
    }

    case 'specifications': {
      // Phase 2 — emit a JSON array of "Label: Value" bullet pairs (mirrors
      // care_instructions / box_contents shape). Renders as <ul> on the PDP
      // Specs grid card. NEVER include price.
      const primaryPrompt = `Extract the technical specifications from this product description as a JSON array of "Label: Value" bullet pairs. Each entry is a single short string with the label, a colon, and the value (e.g. "Color: Black", "Material: Body-safe silicone", "Battery life: 90 minutes per charge").

Include only objective facts surfaced in the description: dimensions, materials, power source, charge time, run time, waterproofing, colors, weight, controls, country of origin. Skip categories the source doesn't mention — better fewer accurate specs than padded ones. NEVER include price, discount, or dollar amounts.

Voice: factual and concise. No fluff, no marketing copy, no Emma asides. Each value 4–80 chars.

Return ONLY a JSON array of strings, max 12 entries. No markdown, no prose, no wrapper.

Example: ["Color: Black", "Material: Nylon straps with padded cuffs", "Includes: 4 cuffs and restraint straps", "Fit: Universal mattress sizes"]

${productContext}`
      const retryPrompt   = `Return ONLY a JSON array of "Label: Value" spec strings extracted from this product. No markdown, no explanation, no preamble. Example: ["Color: Black", "Material: Silicone"]\n\n${productContext}`

      const tryParse = (raw: string): string[] | null => {
        try {
          const parsed = JSON.parse(stripFences(raw))
          if (!Array.isArray(parsed)) return null
          const out = parsed
            .filter((s): s is string => typeof s === 'string' && s.trim().length >= 4 && s.trim().length <= 100)
            .map(s => s.trim())
          return out.length > 0 ? out.slice(0, 12) : null
        } catch { return null }
      }

      const text = await generate(primaryPrompt, 1500, MODEL_FAST, llmClient)
      const parsed = tryParse(text)
      if (parsed) return { type, content: parsed }

      const retried = await generate(retryPrompt, 1500, MODEL_FAST, llmClient)
      const parsedRetry = tryParse(retried)
      if (parsedRetry) return { type, content: parsedRetry }

      // Deterministic fallback — returns nothing. The PDP shows the
      // specifications fallback message rather than mangled HTML when the
      // model can't produce a clean array.
      return { type, content: [] }
    }

    case 'blog_article': {
      // Blog articles route through generateBlogArticle which has its own
      // input shape (topic-driven, not product-driven). The product object
      // here is treated as topical context — title may carry the article topic
      // when the caller has no separate `topic` field.
      const article = await generateBlogArticle({
        topic:    req.topic ?? product.title,
        context:  product.description ?? '',
        tags:     product.categories ?? [],
        keywordBlock,
        author,
      })
      return { type, content: article }
    }

    default:
      throw new Error(`Unknown copy type: ${type as string}`)
  }
}

/**
 * Consolidated copy generator — produces tagline, SEO meta, and specifications
 * in a SINGLE Haiku round trip. Replaces three legacy `generateCopy` calls
 * (`tagline` + `seo_meta` + `specifications`) which all fed the same product
 * context and same keyword block. Cuts per-call system-prompt overhead and
 * the productContext/keywordBlock prefix by 3× before caching savings layer.
 *
 * Per-field validators run on the parsed JSON; if any field is invalid we
 * fall back to the single-field generator from `generateCopy` for just that
 * field, which is still 2× cheaper than the legacy 3-call path on the happy
 * path and never worse than legacy on the unhappy path.
 */
export async function generateProductCopyBundle(req: {
  product:    GenerateCopyRequest['product']
  authorSlug?: string
  seoMode?:    GenerateCopyRequest['seoMode']
  llmClient?:  LLMClient
}): Promise<{ tagline: string; seoMeta: string; specifications: string[] }> {
  const { product } = req

  const author = req.authorSlug ? await getEditorialAuthor(req.authorSlug).catch(() => null) : null
  const seoMode = req.seoMode ?? author?.seoMode ?? 'natural'

  const keywordBlock = await buildKeywordBlock({
    productType: product.productTypeDial,
    moods:       product.moodTags,
    audiences:   product.audienceTags,
    matters:     product.mattersTags,
    contentType: 'pdp',
    seoMode,
  }).catch((err) => {
    console.error('[generateProductCopyBundle] buildKeywordBlock failed (continuing without):', err)
    return ''
  })

  const productContextBase = `Product: ${product.title}\nBrand: ${product.brand}\nDescription: ${product.description}\nCategories: ${product.categories.join(', ')}`
  const productContext = keywordBlock ? `${productContextBase}\n\n${keywordBlock}` : productContextBase

  const prompt = `Produce three independent copy fields for this product in a SINGLE JSON response. Each field has its own constraints — apply them strictly. NEVER mention price, discount, or dollar amounts in any field; the PDP renders Shopify's live price separately. NO em-dashes ("—" or "–") anywhere.

If any keyword targets in the prompt do not fit this product, IGNORE them silently and write from the product details only. Never narrate a mismatch, never preface, never explain.

FIELD 1 — "tagline" (string):
- One short Emma-voice tagline. Observational, casual, lightly witty. Not a stand-up zinger.
- Fragments are welcome ("the one I keep recommending", "earns its spot daily", "quietly indispensable").
- Max 12 words. First person OK. NO em-dashes. NO ♥ glyph (reserve it for CTAs and asides).

FIELD 2 — "seoMeta" (string):
- 140–155 characters. Shows in Google SERP and link previews.
- Include both: (a) the trust beat "Ships discreetly", (b) one short Emma-voice benefit beat (fragment OK, first-person OK).
- Brand mentions written as "XDIPX" (uppercase). NO em-dashes. NO price/discount language.

FIELD 3 — "specifications" (string[]):
- JSON array of "Label: Value" bullet pairs (e.g. "Color: Black", "Material: Body-safe silicone").
- Include only objective facts surfaced in the description: dimensions, materials, power source, charge time, run time, waterproofing, colors, weight, controls, country of origin.
- Skip categories the source doesn't mention. Better fewer accurate specs than padded ones.
- Factual and concise — no fluff, no Emma asides. Each value 4–80 chars. Max 12 entries. NEVER include price.

Return ONLY this JSON shape (no markdown, no preamble):
{ "tagline": "string", "seoMeta": "string", "specifications": ["Label: Value", ...] }

${productContext}`

  type Parsed = { tagline?: unknown; seoMeta?: unknown; specifications?: unknown }
  let parsed: Parsed | null = null
  try {
    const { text } = await callClaude({
      llmClient: req.llmClient,
      model:     MODEL_FAST,
      maxTokens: 1500,
      systemBlocks: buildLegacySystemBlocks(),
      userPrompt: prompt,
    })
    parsed = JSON.parse(stripFences(text)) as Parsed
  } catch (err) {
    console.error('[generateProductCopyBundle] consolidated call failed, falling back to per-field:', err)
  }

  // Per-field validation. Anything that fails validation falls back to the
  // legacy per-field generator so a single bad field doesn't blank the others.
  const taglineOk = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0 && s.trim().split(/\s+/).length <= 12 && !looksLikeMetaCommentary(s) && !s.includes('—') && !s.includes('–')
  const seoMetaOk = (s: unknown): s is string => typeof s === 'string' && s.trim().length >= 50 && !looksLikeMetaCommentary(s) && !containsPrice(s)
  const specsOk   = (a: unknown): a is string[] => Array.isArray(a) && a.length > 0 && a.every(v => typeof v === 'string' && v.trim().length >= 4 && v.trim().length <= 100)

  let tagline = ''
  let seoMeta = ''
  let specifications: string[] = []

  if (parsed && taglineOk(parsed.tagline)) {
    tagline = parsed.tagline.trim()
  } else {
    const r = await generateCopy({ type: 'tagline', product, ...(req.authorSlug ? { authorSlug: req.authorSlug } : {}), ...(req.seoMode ? { seoMode: req.seoMode } : {}) }, req.llmClient)
    const arr = r.content as string[]
    tagline = (Array.isArray(arr) ? arr[0] : (arr as unknown as string))?.trim() ?? ''
  }

  if (parsed && seoMetaOk(parsed.seoMeta)) {
    seoMeta = parsed.seoMeta.trim().slice(0, 155)
  } else {
    const r = await generateCopy({ type: 'seo_meta', product, ...(req.authorSlug ? { authorSlug: req.authorSlug } : {}), ...(req.seoMode ? { seoMode: req.seoMode } : {}) }, req.llmClient)
    seoMeta = (r.content as string) ?? ''
  }

  if (parsed && specsOk(parsed.specifications)) {
    specifications = parsed.specifications.map(s => s.trim()).slice(0, 12)
  } else {
    const r = await generateCopy({ type: 'specifications', product, ...(req.authorSlug ? { authorSlug: req.authorSlug } : {}), ...(req.seoMode ? { seoMode: req.seoMode } : {}) }, req.llmClient)
    specifications = Array.isArray(r.content) ? (r.content as string[]) : []
  }

  return { tagline, seoMeta, specifications }
}

// ─── Blog article generation ────────────────────────────────────────────────
// Topic-driven (not product-driven). Composes the base brand voice with optional
// editorial author rules and the keyword bank's <keyword_targets> block. Output
// is Sanity-Portable-Text-compatible so the result can be saved straight into
// blogPost.body[] as a draft for admin review.

import type { BlogArticleCopy } from '~/types'
import type { EditorialAuthor } from './editorial-author.server'

interface GenerateBlogArticleInput {
  topic:        string
  context?:     string
  tags?:        string[]
  /** Pre-rendered <keyword_targets> XML — saves a Sanity round-trip when the
   *  caller already built it. Pass '' to skip targeting. */
  keywordBlock: string
  author?:      EditorialAuthor | null
}

function rid(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`
}

/** Convert markdown-ish text into a minimal Portable Text array.
 *  Accepts:
 *    - "## Heading"  → block with style:"h2"
 *    - "### Heading" → block with style:"h3"
 *    - blank line    → paragraph break
 *    - everything else → block with style:"normal"
 *  Bold/italic/links are emitted as plain text — keeps the helper trivial and
 *  predictable. Editors can add formatting in Studio.
 */
function markdownToPortableText(md: string): unknown[] {
  const blocks: unknown[] = []
  const paragraphs = md.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  for (const p of paragraphs) {
    let style: 'h2' | 'h3' | 'normal' = 'normal'
    let text = p
    if (text.startsWith('### ')) { style = 'h3'; text = text.slice(4).trim() }
    else if (text.startsWith('## ')) { style = 'h2'; text = text.slice(3).trim() }
    else if (text.startsWith('# ')) { style = 'h2'; text = text.slice(2).trim() }
    blocks.push({
      _type: 'block',
      _key:  rid('b'),
      style,
      markDefs: [],
      children: [{
        _type: 'span',
        _key:  rid('s'),
        text,
        marks: [],
      }],
    })
  }
  return blocks
}

function slugifyForBlog(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
}

/**
 * Generate a blog article. Topic-driven; composes voice + keyword targeting
 * + author rules into one Claude call. Returns Portable Text + metadata.
 *
 * Side-effect-free — caller decides where to write (typically a Sanity
 * blogPost draft via the admin UI or a separate persistence helper).
 */
export async function generateBlogArticle(input: GenerateBlogArticleInput): Promise<BlogArticleCopy> {
  const { topic, context = '', tags = [], keywordBlock, author } = input

  const composedSystem = author?.voiceRules?.length
    ? `${SYSTEM_PROMPT}\n\nAuthor voice (${author.name}):\n${author.voiceRules.map(r => `- ${r}`).join('\n')}${author.personaSummary ? `\n\nPersona: ${author.personaSummary}` : ''}`
    : SYSTEM_PROMPT

  const ctxBlock = [
    `Topic: ${topic}`,
    context ? `Background context:\n${context}` : '',
    tags.length ? `Related tags: ${tags.join(', ')}` : '',
    keywordBlock,
  ].filter(Boolean).join('\n\n')

  // Single structured-output call. Asks for JSON with title, slug, excerpt,
  // SEO meta, and a markdown body — body is parsed into Portable Text below.
  const userPrompt = `Write a blog article for xdipx.com targeting the topic and keyword set above. Length: ~700–1100 words. Structure: a hook intro (no heading), then 3–5 H2 sections with at least one H3 subsection in the longest section. Conversational, useful, never preachy. Cite specific scenarios over generalities.

Return a single JSON object with this exact shape (JSON only, no markdown fences):
{
  "title":          "string — 50–70 chars, weave the primary keyword",
  "slug":           "string — kebab-case, ≤ 60 chars, derived from title",
  "excerpt":        "string — 110–160 chars, hook the reader",
  "seoTitle":       "string — 50–60 chars, optimized for SERP",
  "seoDescription": "string — 140–155 chars, includes primary keyword",
  "body":           "string — markdown body (## for H2, ### for H3, blank lines between paragraphs). Do NOT include the H1 title (that's the title field)."
}

${ctxBlock}`

  const fallback = (): BlogArticleCopy => ({
    title:          topic,
    slug:           slugifyForBlog(topic),
    excerpt:        `A look at ${topic} from xdipx.`,
    seoTitle:       topic.slice(0, 60),
    seoDescription: `Practical, tasteful guidance on ${topic} — written for curious adults.`.slice(0, 155),
    body:           markdownToPortableText(`A short note on ${topic}. We'll come back with more soon.`),
  })

  let raw: string
  try {
    raw = await generateWithSystem({
      system:    composedSystem,
      user:      userPrompt,
      model:     MODEL,
      maxTokens: 4096,
    })
  } catch (err) {
    console.error('[claude] generateBlogArticle Claude call failed:', err)
    return fallback()
  }

  try {
    const parsed = JSON.parse(stripFences(raw)) as Partial<{
      title:          unknown
      slug:           unknown
      excerpt:        unknown
      seoTitle:       unknown
      seoDescription: unknown
      body:           unknown
    }>
    const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : topic
    const slug  = typeof parsed.slug  === 'string' && parsed.slug.trim()  ? slugifyForBlog(parsed.slug)  : slugifyForBlog(title)
    const excerpt = typeof parsed.excerpt === 'string' ? parsed.excerpt.trim() : ''
    const seoTitle = typeof parsed.seoTitle === 'string' && parsed.seoTitle.trim()
      ? parsed.seoTitle.trim()
      : title.slice(0, 60)
    const seoDescription = typeof parsed.seoDescription === 'string' && parsed.seoDescription.trim()
      ? parsed.seoDescription.trim()
      : (excerpt || `A practical guide to ${topic}.`).slice(0, 155)
    const bodyMd = typeof parsed.body === 'string' ? parsed.body : ''
    return {
      title,
      slug,
      excerpt: excerpt || `A look at ${topic}.`,
      seoTitle,
      seoDescription,
      body: bodyMd ? markdownToPortableText(bodyMd) : markdownToPortableText(`A short note on ${topic}.`),
    }
  } catch (err) {
    console.error('[claude] generateBlogArticle JSON parse failed:', err)
    return fallback()
  }
}

export async function generateSchedule(
  products: { sku: string; title: string; brand: string; score: number; categories: string[] }[],
  days = 30,
): Promise<{ date: string; sku: string; rationale: string }[]> {
  const productList = products.map((p, i) =>
    `${i + 1}. SKU: ${p.sku} | Brand: ${p.brand} | Title: ${p.title} | Score: ${p.score.toFixed(3)} | Categories: ${p.categories.join(', ')}`,
  ).join('\n')

  const startDate = new Date()
  startDate.setDate(startDate.getDate() + 1)

  const raw = await generate(
    `Given these ${products.length} products and their scores, suggest a ${days}-day deal calendar starting ${startDate.toISOString().split('T')[0]}.\n\nRules:\n- No same brand within 3 days\n- Alternate price tiers (budget/mid/premium)\n- Highest-value deals on Friday/Saturday\n- Lubricants as accessories not daily deals when possible\n- Use highest-scoring products first\n\nProducts:\n${productList}\n\nReturn a JSON array: [{"date": "YYYY-MM-DD", "sku": "...", "rationale": "..."}]\nReturn only the JSON array, no markdown.`,
  )

  try {
    return JSON.parse(stripFences(raw)) as { date: string; sku: string; rationale: string }[]
  } catch {
    return []
  }
}

/**
 * @deprecated Use `generateProductTitle` — it preserves manufacturer-branded
 * names verbatim, only augmenting abstract titles with a category descriptor.
 * Kept for back-compat with admin tooling that still calls it directly.
 */
export async function generateSEOTitle(rawTitle: string, brand: string): Promise<string> {
  const text = await generate(
    `Rewrite this product title for SEO. Max 60 chars. Format: {Brand} {Product Type} {Key Feature}. Remove filler words and explicit language. Replace explicit terms with tasteful equivalents.\n\nRaw title: "${rawTitle}"\nBrand: "${brand}"\n\nReturn only the rewritten title, no quotes.`,
    256,
    MODEL_FAST,
  )
  return text.trim().slice(0, 60)
}

// ─── Brand-aware, SEO-aware product title generation ─────────────────────────

export interface GenerateProductTitleInput {
  rawTitle:        string
  brand:           string
  vendor?:         string
  rawDescription?: string
  productTypeDial: ProductTypeDial
  /** Pre-rendered <keyword_targets> XML block from buildKeywordBlock — saves
   *  a Sanity round-trip when the caller already built it. Pass '' to skip. */
  keywordBlock?:   string
  llmClient?:      LLMClient
}

export interface GenerateProductTitleResult {
  title:         string   // Final title (raw OR augmented)
  augmented:     boolean  // True when a descriptor was appended
  originalTitle: string   // The raw manufacturer title verbatim
  reason:        string   // One-line explanation: why augmented or why not
}

// Phase 1 rebuild — descriptor fallbacks for the expanded D1 enum.
// Used by generateProductTitle when no descriptor can be extracted from the
// manufacturer's description. Keep these short, factual, and SEO-friendly.
const PRODUCT_TYPE_DESCRIPTOR_FALLBACK: Record<ProductTypeDial, string> = {
  'vibrator':    'Vibrator',
  'dildo':       'Dildo',
  'anal':        'Anal Toy',
  'bondage':     'Bondage Gear',
  'cock-ring':   'Cock Ring',
  'stroker':     'Stroker',
  'couples':     'Couples Toy',
  'harness':     'Harness',
  'extender':    'Extender',
  'pump':        'Pump',
  'lube':        'Lubricant',
  'massage':     'Massage',
  'enhancer':    'Enhancer',
  'wear':        'Wearable',
  'condom':      'Condoms',
  'wellness':    'Wellness',
  'novelty':     'Novelty',
  'book-media':  'Book',
  'sex-machine': 'Sex Machine',
}

/**
 * Compose a factual, SEO-friendly product title from the manufacturer's raw
 * title + description. Pulls descriptors (material, format, category, size /
 * variant) from the source description and assembles them in a standardized
 * order so titles read consistently across the catalog.
 *
 * Examples:
 *   "Edible G-String"        → "Edible Candy G-String Underwear One-Size"
 *   "JO H2O Original 16oz"   → "H2O Original Water-Based Personal Lubricant 16oz"
 *   "Sona 2 Cruise" (branded model — preserve) → "Sona 2 Cruise Sonic Clitoral Massager"
 *   "Eclipse 7"   (numbered abstract — augment)→ "Eclipse 7 Rechargeable Wand Vibrator"
 *
 * Brand is NOT prepended (the PDP shows the brand above the title).
 * Plain factual tone — not Emma voice. Hard cap 70 chars.
 *
 * Runs Sonnet — the descriptor extraction + branded-model-preservation balance
 * is nuanced enough to fool Haiku on "Couples Kit"-shaped inputs.
 */
export async function generateProductTitle(
  input: GenerateProductTitleInput,
): Promise<GenerateProductTitleResult> {
  const original = input.rawTitle.trim()
  const fallbackDescriptor = PRODUCT_TYPE_DESCRIPTOR_FALLBACK[input.productTypeDial] ?? 'Vibrator'

  const keywordBlock = input.keywordBlock ?? ''
  const userPrompt = `Compose an SEO-friendly product title for this product. Pull descriptors (material, format, category, size / variant) from the manufacturer's description and assemble them in this standardized order:

  [Material / Feature] [Original Manufacturer Name] [Category Noun] [Size / Variant]

Raw manufacturer title: "${input.rawTitle}"
Product type (dial): ${input.productTypeDial}
${input.rawDescription ? `Manufacturer description (first 600 chars):\n${input.rawDescription.slice(0, 600)}` : '(no description provided)'}
${keywordBlock || ''}

Rules (in priority order):
1. PRESERVE branded model names verbatim — "Sona 2 Cruise", "Magic Wand Original", numbered model names. Treat the manufacturer's chosen name as a proper noun. You may APPEND descriptors after the branded name; never rewrite the name itself.
2. NO BRAND PREFIX — the PDP shows the brand above the title, so don't include "Hott Products" / "System JO" / "Lelo" etc. Start with the material / feature descriptor or the product name.
3. PULL descriptors from the description, not from imagination. If the description doesn't say "silicone" or "rechargeable", don't add those words.
4. CATEGORY NOUN — every title ends with (or contains) a clear category word: "Underwear", "Vibrator", "Wand", "Lube", "Lubricant", "Plug", "Massager", "Sleeve", "Kit", etc. If you can't determine one from the description, fall back to: ${fallbackDescriptor}.
5. SIZE / VARIANT — append size or volume when stated ("16oz", "One-Size", "Medium", "12-Pack"). Skip if not in the source.
6. PLAIN FACTUAL TONE — no Emma personality, no marketing puffery, no benefit claims ("luxurious", "intense"). Just descriptors.
7. NEVER use em-dashes ("—") or en-dashes ("–"). Hyphens in compound words ("water-based", "soft-touch") are fine.
8. Cap final title at 70 characters total. Trim least-informative descriptor first if over.
9. \`augmented\` should be \`true\` when the new title differs from the raw manufacturer title (which is almost always); \`false\` only when no useful descriptors could be extracted and you preserved the original as-is.

Return ONLY raw JSON (no markdown):
{"title":"<final title>","augmented":<true|false>,"reason":"<one short sentence>"}`

  let raw: string
  try {
    raw = await generate(userPrompt, 256, MODEL, input.llmClient)
  } catch (err) {
    console.warn('[generateProductTitle] Claude call failed, falling back to raw title:', err instanceof Error ? err.message : err)
    return {
      title:         original.slice(0, 70),
      augmented:     false,
      originalTitle: original,
      reason:        'claude error; preserved original',
    }
  }

  let parsed: { title?: string; augmented?: boolean; reason?: string } = {}
  try {
    parsed = JSON.parse(stripFences(raw)) as typeof parsed
  } catch {
    // Sonnet sometimes wraps in prose; try to extract a JSON object
    const m = raw.match(/\{[\s\S]*?"title"[\s\S]*?\}/)
    if (m) {
      try { parsed = JSON.parse(m[0]) as typeof parsed } catch { /* keep empty */ }
    }
  }

  const finalTitle = (parsed.title ?? original).trim().slice(0, 70)
  const augmented  = Boolean(parsed.augmented) && finalTitle !== original
  const reason     = (parsed.reason ?? '').trim() || (augmented ? 'augmented with descriptor' : 'preserved as-is')

  return {
    title:         finalTitle,
    augmented,
    originalTitle: original,
    reason,
  }
}

// ─── Pairing-why generation ──────────────────────────────────────────────────

export interface PairingCandidateInput {
  productId:       string  // GID — keys the result object
  title:           string
  brand?:          string
  productTypeDial?: string
  price?:          number
}

export interface GeneratePairingWhyInput {
  primary: {
    title:           string
    brand:           string
    productTypeDial: ProductTypeDial
    tagline?:        string
    description?:    string
  }
  candidates: PairingCandidateInput[]
  llmClient?:        LLMClient
}

/**
 * Pick the best 1–3 pairing accessories from the candidate list and write a
 * short Emma-voice "why this pairs" blurb for each. Returns an object keyed
 * by accessoryProductId for direct write to `xdipx.pairing_why`.
 *
 * Returns empty arrays when no candidates are good enough to recommend
 * (the orchestrator should treat that as "skip" rather than fail).
 */
export async function generatePairingWhy(
  input: GeneratePairingWhyInput,
): Promise<{ accessoryProductIds: string[]; pairingWhy: Record<string, string> }> {
  if (input.candidates.length === 0) {
    return { accessoryProductIds: [], pairingWhy: {} }
  }

  const candidatesBlock = input.candidates
    .map((c, i) => `${i + 1}. id=${c.productId}\n   title="${c.title}"${c.brand ? `, brand="${c.brand}"` : ''}${c.productTypeDial ? `, type=${c.productTypeDial}` : ''}${c.price !== undefined ? `, price=$${c.price}` : ''}`)
    .join('\n')

  const userPrompt = `You're picking 1–3 accessory products that genuinely pair with the primary product, then writing one short Emma-voice "why this pairs" blurb per pick.

Primary product:
Title: ${input.primary.title}
Brand: ${input.primary.brand}
Type: ${input.primary.productTypeDial}
${input.primary.tagline ? `Tagline: ${input.primary.tagline}` : ''}
${input.primary.description ? `Description (200 chars): ${input.primary.description.slice(0, 200)}` : ''}

Accessory candidates:
${candidatesBlock}

Rules:
- Pick 1, 2, or 3 — only the ones that genuinely complement the primary. Quality over quota.
- Skip any candidate that doesn't fit. Better to return 1 strong pick than 3 weak ones.
- Each blurb: ONE short sentence (≤120 chars), Emma voice, first-person friend who's tested it. Explains WHY they pair (not what each product does on its own).
- Voice: warm, curious, witty. Not clinical, not sleazy.
- NEVER use em-dashes ("—"). Hyphens in compound words are fine.
- Don't restate the product titles. Don't name brands.
- If NO candidates are strong fits, return picks: [].

Return ONLY raw JSON (no markdown):
{"picks":[{"id":"<accessoryProductId>","blurb":"<≤120 chars Emma voice>"}]}`

  let raw: string
  try {
    raw = await generate(userPrompt, 800, MODEL, input.llmClient)
  } catch (err) {
    console.warn('[generatePairingWhy] Claude call failed:', err instanceof Error ? err.message : err)
    return { accessoryProductIds: [], pairingWhy: {} }
  }

  let parsed: { picks?: Array<{ id?: string; blurb?: string }> } = {}
  try {
    parsed = JSON.parse(stripFences(raw)) as typeof parsed
  } catch {
    const m = raw.match(/\{[\s\S]*?"picks"[\s\S]*?\}/)
    if (m) {
      try { parsed = JSON.parse(m[0]) as typeof parsed } catch { /* keep empty */ }
    }
  }

  const validIds = new Set(input.candidates.map(c => c.productId))
  const accessoryProductIds: string[] = []
  const pairingWhy: Record<string, string> = {}

  for (const pick of parsed.picks ?? []) {
    if (!pick?.id || !pick?.blurb) continue
    if (!validIds.has(pick.id)) continue
    if (accessoryProductIds.includes(pick.id)) continue
    const blurb = pick.blurb.trim().slice(0, 140)
    if (!blurb) continue
    accessoryProductIds.push(pick.id)
    pairingWhy[pick.id] = blurb
    if (accessoryProductIds.length >= 3) break
  }

  return { accessoryProductIds, pairingWhy }
}

// ─── Tweet Copy Generation ───────────────────────────────────────────────────

export async function generateTweetCopy(deal: {
  title: string
  brand: string
  tagline?: string
  dealPrice: number
  msrp: number
  category: string
  handle: string
}, llmClient?: LLMClient): Promise<{ mainTweet: string; threadReply?: string }> {
  const discountPct = deal.msrp > 0
    ? Math.round(100 - (deal.dealPrice / deal.msrp) * 100)
    : 0
  const productUrl = `https://xdipx.com/products/${deal.handle}`

  const primaryPrompt = `Write a tweet for today's daily deal on xdipx.com.

Product: ${deal.title}
Brand: ${deal.brand}${deal.tagline ? `\nTagline: ${deal.tagline}` : ''}
Price: $${deal.dealPrice} (was $${deal.msrp}) — ${discountPct}% off
Category: ${deal.category}
Link: ${productUrl}

Rules:
- The main tweet MUST be under 240 characters (leave room for the link)
- Include the product URL at the end: ${productUrl}
- Include 1-2 relevant hashtags from: #DailyDeal #FlashSale #SelfCare #PleasurePositive #IntimateWellness #TreatYourself
- Brand voice: playful, cheeky, warm. Never clinical, never sleazy.
- Include the discount percentage or price if compelling
- Use the ♥ motif naturally
- NEVER use explicit language or the word "sex" as an adjective

Also write a thread reply (optional second tweet) with 1-2 extra detail sentences if the product warrants it. Max 240 chars. If no thread reply is needed, set threadReply to null.

Return ONLY this JSON (no markdown):
{"mainTweet": "...", "threadReply": "..." or null}`

  const retryPrompt = `Return ONLY raw JSON, no markdown. Write a tweet under 240 chars for this product. Include the URL ${productUrl} and one hashtag.
{"mainTweet": "...", "threadReply": null}

Product: ${deal.brand} ${deal.title} — $${deal.dealPrice} (was $${deal.msrp})`

  const tryParse = (raw: string): { mainTweet: string; threadReply?: string } | null => {
    try {
      const parsed = JSON.parse(stripFences(raw)) as { mainTweet: string; threadReply?: string | null }
      if (parsed?.mainTweet) {
        const result: { mainTweet: string; threadReply?: string } = { mainTweet: parsed.mainTweet }
        if (parsed.threadReply) result.threadReply = parsed.threadReply
        return result
      }
    } catch { /* fall through */ }
    return null
  }

  const first = await generate(primaryPrompt, 512, MODEL_FAST, llmClient)
  const firstParsed = tryParse(first)
  if (firstParsed) return firstParsed

  const retried = await generate(retryPrompt, 512, MODEL_FAST, llmClient)
  const secondParsed = tryParse(retried)
  if (secondParsed) return secondParsed

  // Hardcoded fallback — always works
  return {
    mainTweet: `${deal.brand} ${deal.title} — ${discountPct}% off today only. $${deal.dealPrice} (was $${deal.msrp}) ♥\n\n${productUrl}\n\n#DailyDeal #SelfCare`,
  }
}

// ─── Video Content Generation ─────────────────────────────────────────────────

export type VOFormat =
  | 'sitcom_sketch'
  | 'fake_testimonial'
  | 'educational'
  | 'breaking_news'
  | 'absurdist_narrator'
  | 'custom'

export interface VideoContentResult {
  format: VOFormat
  formatRationale: string
  /** Narrator voiceover script — 2–3 sentences, max 35 words. Used directly as ElevenLabs input. */
  narratorScript: string
  /** Two short reaction strings styled like TikTok comments / phone notifications */
  reactionText: string[]
  /** Funny closing tagline shown on the end card under the logo */
  endTagline: string
  ctaWord: string
}

const CTA_WORDS = ['Today.', 'Yours.', 'Obviously.', 'Go on.', 'Finally.']

function pickFormat(category: string): VOFormat {
  const lowerCat = category.toLowerCase()
  if (lowerCat.includes('couples')) return 'sitcom_sketch'
  if (lowerCat.includes('him') || lowerCat.includes('strok')) return 'breaking_news'
  if (lowerCat.includes('her') || lowerCat.includes('vibrat')) return 'fake_testimonial'
  if (lowerCat.includes('lube') || lowerCat.includes('lubricant')) return 'educational'
  const formats: VOFormat[] = ['sitcom_sketch', 'fake_testimonial', 'educational', 'breaking_news', 'absurdist_narrator']
  return formats[Math.floor(Math.random() * formats.length)]!
}

/** Strip HTML tags from a string */
function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

export async function generateVideoContent(product: {
  title: string
  brand: string
  tagline?: string
  category: string
  dealPrice?: number
  msrp?: number
  fullStory?: string
  worksForHim?: string
  worksForHer?: string
  specifications?: string
  whatsInTheBox?: string
  /** Optional freeform instruction appended to the Claude prompt — for admin overrides */
  customPrompt?: string
  /** Pin to a specific format instead of auto-selecting */
  forceFormat?: VOFormat
  /** Free-form narrator persona description (used when format is 'custom') */
  customFormatDescription?: string
}): Promise<VideoContentResult> {
  const format = product.customFormatDescription ? 'custom' as VOFormat : (product.forceFormat ?? pickFormat(product.category))

  // Pre-process rich-text fields — strip HTML, truncate to keep token count lean
  const fullStory   = product.fullStory   ? stripHtml(product.fullStory).slice(0, 300)   : ''
  const worksForHim = product.worksForHim ? stripHtml(product.worksForHim).slice(0, 200) : ''
  const worksForHer = product.worksForHer ? stripHtml(product.worksForHer).slice(0, 200) : ''
  const specs       = product.specifications ? stripHtml(product.specifications).slice(0, 200) : ''
  const inTheBox    = product.whatsInTheBox  ? stripHtml(product.whatsInTheBox).slice(0, 150)  : ''

  const productContext = [
    `Product: ${product.title}`,
    `Brand: ${product.brand}`,
    `Category: ${product.category}`,
    product.tagline   ? `Tagline: ${product.tagline}`                              : '',
    product.dealPrice ? `Deal price: $${product.dealPrice} (was $${product.msrp})` : '',
    fullStory         ? `Full story: ${fullStory}`                                 : '',
    worksForHim       ? `Works for him: ${worksForHim}`                            : '',
    worksForHer       ? `Works for her: ${worksForHer}`                            : '',
    specs             ? `Specifications: ${specs}`                                 : '',
    inTheBox          ? `What's in the box: ${inTheBox}`                           : '',
  ].filter(Boolean).join('\n')

  const formatDescriptions: Partial<Record<VOFormat, string>> = {
    sitcom_sketch:      'narrator is a well-meaning friend who keeps accidentally describing couples activities in extremely innocent terms',
    fake_testimonial:   'narrator is an EXTREMELY enthusiastic stranger who found this product and their life is now unrecognizable, in the best way',
    educational:        "narrator is a hilariously underqualified 'expert' delivering 'facts' that are not facts",
    breaking_news:      'narrator is reporting BREAKING NEWS with escalating urgency about a very personal problem that this product solves',
    absurdist_narrator: 'narrator keeps accidentally describing the product perfectly while appearing to talk about something else entirely',
  }

  const customInstruction = product.customPrompt
    ? `\n\nADDITIONAL DIRECTION FROM CREATOR:\n${product.customPrompt}\n`
    : ''

  const persona = product.customFormatDescription || formatDescriptions[format] || 'narrator delivers a funny, engaging product pitch'

  const prompt = `Write a funny 10-second product ad narration.

Narrator persona: ${persona}${customInstruction}

This is for xdipx.com — a daily flash-sale site for sexual wellness products.
Brand voice: playful, cheeky, warm. PG-13 strictly — suggest, never show. Innuendo welcome, explicit never.

Product:
${productContext}

Use the product details above to make the narrator script and reaction text feel specific to THIS product — not generic wellness copy. Mine the full story and specs for details that are funny, surprising, or unusually specific. A narrator referencing an actual feature ("7 settings" or "whisper quiet" or "USB rechargeable") is always funnier and more trustworthy than one speaking in generalities. Specificity = credibility = conversion.

If works-for-him and works-for-her are both present, the narrator should feel warm and inclusive toward both without assuming who is watching. If only one is present, subtly orient the tone toward that audience without being exclusionary.

Mine specifications and what's-in-the-box for unexpected details that land as humor (e.g. "comes with a satin pouch, because you deserve nice things").

Write the narrator script: 2–3 sentences, max 35 words total. Punchy, warm, slightly conspiratorial. Written to be performed aloud, not read. This is the exact voiceover script for a female voice.

Write exactly 2 reaction strings: max 8 words each. Style them like a phone notification or TikTok comment — a stranger reacting to what the narrator just said. Keep them dry, funny, relatable.
Examples of good reactions: "sir this is a wellness site" / "...adding to cart" / "my therapist said treat yourself so" / "wait this is actually genius"

Also write:
- endTagline: a funny 4–8 word closing line for the end card (e.g. "Your body called. We answered." or "Treat yourself. You've earned it, probably.")

Return ONLY this JSON (no markdown):
{
  "formatRationale": "one sentence why this format fits this product",
  "narratorScript": "...",
  "reactionText": ["...", "..."],
  "endTagline": "..."
}`

  const raw = await generate(prompt, 1024)

  let parsed: { formatRationale: string; narratorScript: string; reactionText: string[]; endTagline: string }
  try {
    parsed = JSON.parse(stripFences(raw)) as typeof parsed
  } catch {
    const match = raw.match(/\{[\s\S]*?"narratorScript"[\s\S]*?\}/)
    if (match) {
      parsed = JSON.parse(match[0]) as typeof parsed
    } else {
      // Fallback
      parsed = {
        formatRationale: 'Fallback content',
        narratorScript: `${product.tagline ?? `${product.brand} ${product.title}. Today only at xdipx.`}`,
        reactionText: ['...adding to cart', 'my therapist said treat yourself so'],
        endTagline: 'One deal. One day. No regrets.',
      }
    }
  }

  const titleSum = product.title.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const ctaWord = CTA_WORDS[titleSum % CTA_WORDS.length]!

  return {
    format,
    formatRationale: parsed.formatRationale,
    narratorScript: parsed.narratorScript,
    reactionText: parsed.reactionText ?? ['...adding to cart', 'my therapist said treat yourself so'],
    endTagline: parsed.endTagline,
    ctaWord,
  }
}

// ─── Veo Prompt Enhancement ─────────────────────────────────────────────────

const VEO_SYSTEM_PROMPT = `You are a video prompt engineer for Google Veo. You enhance simple video ideas into detailed, production-ready Veo prompts. Your job is to FAITHFULLY EXPAND the user's idea — not replace it. The user's concept is the creative foundation. You add cinematic detail (camera, lighting, composition, audio) while keeping their vision intact.

Brand context: xdipx.com is a daily flash-sale site for sexual wellness products.
Visual style: premium, warm, tasteful. Suggestive never explicit.`

export async function enhanceVeoPrompt(opts: {
  userIdea: string
  productTitle: string
  productBrand: string
  productCategory?: string
  hasStartingImage: boolean
  imageMode: 'start_frame' | 'reference'
  aspectRatio: '16:9' | '9:16'
  durationSeconds: number
}): Promise<string> {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: VEO_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Enhance this video idea into a detailed Google Veo prompt. IMPORTANT: The user's idea IS the creative direction — keep it as the core of your prompt and build around it with cinematic detail.

THE VIDEO IDEA: "${opts.userIdea}"

Product: ${opts.productTitle} by ${opts.productBrand}${opts.productCategory ? ` (${opts.productCategory})` : ''}
${opts.hasStartingImage
  ? opts.imageMode === 'reference'
    ? 'Mode: TEXT-TO-VIDEO with REFERENCE IMAGE — a product photo is included as visual context (NOT the first frame). The video should feature the product as it appears in the reference image.'
    : 'Mode: IMAGE-TO-VIDEO — the starting frame is a product photo. Describe how the scene evolves FROM that image.'
  : 'Mode: TEXT-TO-VIDEO — describe the full scene from scratch.'}
Aspect: ${opts.aspectRatio} (${opts.aspectRatio === '16:9' ? 'landscape' : 'vertical'}) | Duration: ${opts.durationSeconds}s

Take the user's idea above and enrich it with:
- Camera work (angle, movement: pan, dolly, tracking, etc.)
- Lighting (golden hour, soft diffusion, neon, etc.)
- Depth of field / focus effects
- Audio: dialogue in quotes, sound effects, ambient noise

Stay true to what the user described. Don't replace their concept with something different. Add production detail, don't reimagine.

Return ONLY the enhanced prompt as one flowing paragraph. No labels, no markdown.`,
    }],
  })
  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error('Unexpected Claude response type for Veo prompt')
  return block.text.trim()
}

// ─── LTX Prompt Enhancement ───────────────────────────────────────────────────

const LTX_SYSTEM_PROMPT = `You are a video prompt engineer for LTX Video, an image-to-video model. You enhance simple video ideas into detailed, production-ready prompts.

CRITICAL RULE — NEVER RE-DESCRIBE THE FIRST FRAME.
The model already sees the product image as its starting frame. Your prompt must describe what happens NEXT — motion, change, evolution. If you restate what is already visible, the model wastes capacity on redundancy.

Structure every prompt using three temporal layers, in order:

1. SUBJECT ACTION — What moves and how. This is the hero moment. Name the subject first ("The vibrator begins to glow…"), then describe the physical change. No adjective labels like "epic" or "stunning" — describe what physically happens.

2. CAMERA MOVEMENT — Use specific cinematographic terms: slow dolly in, gentle jib up, smooth tracking left, rack focus from foreground to background. Never use vague words like "dynamic" or "cinematic" without specifying the actual motion.

3. ENVIRONMENT / ATMOSPHERE — What shifts in the background: lighting changes (warm golden light intensifies, soft shadow creeps across the surface), particles (dust motes drift through a shaft of light), reflections, color temperature shifts. Describe change, not static state.

Think of the prompt as a mini screenplay beat:
- Sense of place/time (implied by the atmosphere layer)
- Blocking (choreography between subject motion and camera)
- Atmospheric detail (what the viewer feels through visual cues)

Prompt length rules:
- 6-8 second videos: 3-5 rich sentences
- 10-15 second videos: 5-8 sentences with more temporal progression
- 16-20 second videos: 8-12 sentences — describe phases of motion, mid-video shifts, ending beat

Template skeleton: [product action] + [camera instruction] + [lighting/atmosphere shift] + [optional ambient audio cue]

Brand context: xdipx.com — daily flash-sale site for sexual wellness products.
Visual style: premium, warm, a little edgy — push boundaries while staying tasteful. Suggestive and playful, never outright explicit. Think high-end fragrance ad that makes you look twice.`

export async function enhanceLtxPrompt(opts: {
  userIdea: string
  productTitle: string
  productBrand: string
  productCategory?: string
  hasStartingImage: boolean
  resolution: string
  durationSeconds: number
  cameraMotion?: string
}): Promise<string> {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: LTX_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Enhance this video idea into a detailed LTX Video prompt using the three-layer structure. IMPORTANT: The user's idea IS the creative direction — keep it as the core and build cinematic detail around it.

THE VIDEO IDEA: "${opts.userIdea}"

Product: ${opts.productTitle} by ${opts.productBrand}${opts.productCategory ? ` (${opts.productCategory})` : ''}

FIRST FRAME: The starting frame is a product photo — the model already sees it. DO NOT re-describe the product's appearance, color, shape, or packaging. Jump straight into what happens next.

Duration: ${opts.durationSeconds}s — scale your detail proportionally. ${opts.durationSeconds <= 8 ? 'Keep it tight: 3-5 sentences.' : opts.durationSeconds <= 15 ? 'Medium detail: 5-8 sentences with temporal progression.' : 'Full detail: 8-12 sentences with phases of motion, mid-video shifts, and an ending beat.'}
Resolution: ${opts.resolution}
${opts.cameraMotion ? `Camera direction: "${opts.cameraMotion.replace(/_/g, ' ')}" — use this as the Camera Movement layer. Integrate it specifically (e.g., if "dolly in", describe pace and target of the dolly).` : 'No camera direction specified — choose an appropriate camera movement for the Subject Action.'}

Build the prompt with these three layers in order:
1. SUBJECT ACTION — what moves, how, the hero moment
2. CAMERA MOVEMENT — specific cinematographic terms
3. ENVIRONMENT/ATMOSPHERE — what shifts in lighting, particles, reflections, color temperature

Return ONLY the enhanced prompt as one flowing paragraph. No labels, no markdown, no layer headings.`,
    }],
  })
  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error('Unexpected Claude response type for LTX prompt')
  return block.text.trim()
}

export async function selectAccessories(
  mainProduct: ProductScore,
  candidates: ProductScore[],
  count = 3,
): Promise<string[]> {
  if (candidates.length === 0) return []
  const productList = candidates.slice(0, 20).map(p =>
    `SKU: ${p.sku} | Title: ${p.title} | Brand: ${p.brand} | Categories: ${p.categories.join(', ')}`,
  ).join('\n')

  const raw = await generate(
    `You are selecting complementary add-on products for a daily deal.

Main product: "${mainProduct.title}" by ${mainProduct.brand}
Categories: ${mainProduct.categories.join(', ')}

From the candidates below, choose exactly ${count} products that would work as accessories or perfect pairings — things that complete the experience or enhance the main product.

Good pairings: lubricants with toys, cleaners/maintenance items, charging accessories, enhancement items that serve a complementary function.
Do NOT pick products in the same primary category as the main product — those are competitors, not accessories.
Prefer variety — don't pick ${count} of the same type.

Return a JSON array of exactly ${count} SKU strings. Example: ["SKU1", "SKU2", "SKU3"]
Return only the JSON array, no markdown.

Candidates:
${productList}`,
  )

  try {
    const parsed = JSON.parse(stripFences(raw)) as string[]
    return Array.isArray(parsed) ? parsed.slice(0, count) : []
  } catch {
    return []
  }
}

// ─── Blog Content Generation ─────────────────────────────────────────────────

export interface BlogOutline {
  title: string
  sections: { heading: string; bullets: string[] }[]
  suggestedTags: string[]
}

export async function generateBlogOutline(
  topic: string,
  keywords: string[] = [],
  category?: string,
): Promise<BlogOutline> {
  const raw = await generate(
    `Create a detailed blog post outline for the xdipx.com blog.

Topic: ${topic}
${keywords.length ? `SEO keywords to target: ${keywords.join(', ')}` : ''}
${category ? `Category: ${category}` : ''}

The blog covers sexual wellness topics — guides, tips, product roundups, relationship advice.
Voice: playful, cheeky, warm, judgment-free. Never clinical or sleazy.

Return a JSON object with:
- "title": an engaging, SEO-friendly headline (max 70 chars)
- "sections": array of { "heading": "H2 section title", "bullets": ["key point 1", "key point 2", ...] }
  Include 4-6 sections with 2-4 bullets each.
- "suggestedTags": array of 3-5 tag strings for categorization

Return only the JSON object, no markdown fences.`,
    2048,
  )

  try {
    return JSON.parse(stripFences(raw)) as BlogOutline
  } catch {
    return {
      title: topic,
      sections: [{ heading: 'Introduction', bullets: ['Overview of the topic'] }],
      suggestedTags: [],
    }
  }
}

export async function generateBlogDraft(
  outline: BlogOutline,
): Promise<string> {
  const sectionsText = outline.sections
    .map(s => `## ${s.heading}\n${s.bullets.map(b => `- ${b}`).join('\n')}`)
    .join('\n\n')

  const raw = await generate(
    `Write a full blog post draft for the xdipx.com blog based on this outline.

Title: ${outline.title}

Outline:
${sectionsText}

Write in xdipx brand voice: playful, cheeky, warm, curious, judgment-free.
Return valid HTML using: <h2>, <h3>, <p>, <strong>, <em>, <ul>/<li>, <blockquote>.
No <html>, <head>, <body>, or <h1> tags.
Each section should be 2-3 paragraphs.
Include a brief intro paragraph before the first section.
End with a wrap-up that includes a subtle CTA to browse xdipx deals.
Make it genuinely entertaining — innuendo and tasteful humor welcome.
Target word count: 800-1200 words.`,
    4096,
  )

  // Return as-is if it looks like HTML, otherwise wrap in <p>
  if (raw.includes('<h2>') || raw.includes('<p>')) return raw.trim()
  return `<p>${raw.trim()}</p>`
}

export interface BlogSEOSuggestion {
  seoTitle: string
  seoDescription: string
  suggestedTags: string[]
}

// ─── Emma Hero (homepage) ─────────────────────────────────────────────────

const DEFAULT_BRAND_VOICE = `Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy. Write as a trusted, funny friend who isn't embarrassed about the topic. Keep copy tasteful — suggestive is fine, explicit is not. Use "sex" and "sexy" sparingly but allow them in helpful contexts where they fit the product and aid customer discovery (e.g. "sex toy", "safer sex", "sex-positive", "sexy lingerie", "sexy gift"). Default to "intimate", "pleasure", or "wellness" for general voice. Both words are fine in titles, SEO meta, FAQs, and product descriptions when they read naturally and serve the customer; avoid them where they'd feel clinical, crude, or just dropped in for SEO bait. Never "Buy now" — use "Take a peek →" or "I'll take it ♥". Never surface a countdown or "until midnight." Always include a short first-person aside ("been living on my desk," "telling everyone about this combo"). Never assume the reader's experience level. If any keyword targets, vocabulary lists, or input fields in the prompt do not fit the actual product, silently ignore them — write from the product details only. Never narrate a mismatch, never preface output with explanation, never write meta-commentary about the prompt. Output only the requested copy.`

const EMMA_SYSTEM_PROMPT = `You are Emma — the editorial voice of xdipx.com, an editorially-curated sexual-wellness storefront. You test everything you recommend. You write in first person, warm and specific, like a note to a friend.`

function emmaHeroFallback(deal: Pick<Deal, 'seoTitle' | 'tagline' | 'brand'>, variant: EmmaHeroVariant, voiceHash: string): EmmaHeroCopy {
  const base: EmmaHeroCopy = {
    variant,
    eyebrow: 'Kinda obsessed',
    headline: deal.tagline || `This ${deal.brand} one quietly made it into my rotation.`,
    body: `Slow-burn build, surprisingly gentle finish. If you want something that feels considered — not gimmicky — this is the one.`,
    aside: `— Emma · still on my desk`,
    generatedAt: new Date().toISOString(),
    voiceHash,
  }
  if (variant === 'quote') base.pullQuote = `"This one earned its spot."`
  return base
}

export async function generateEmmaHero(opts: {
  deal: Pick<Deal, 'seoTitle' | 'tagline' | 'fullStory' | 'brand' | 'category' | 'dealPrice' | 'msrp' | 'mapRestricted'>
  variant?: EmmaHeroVariant
  /** Optional override — otherwise pulled from pipelineSettings.brandVoice. */
  brandVoice?: string
  llmClient?:  LLMClient
}): Promise<EmmaHeroCopy> {
  const variant = opts.variant ?? (opts.deal.mapRestricted ? 'quote' : 'loving')
  const brandVoice = opts.brandVoice ?? (await getPipelineSetting('brandVoice')) ?? DEFAULT_BRAND_VOICE
  const voiceHash = createHash('sha1').update(brandVoice).digest('hex').slice(0, 12)

  const discountPct = opts.deal.msrp > 0 && opts.deal.dealPrice > 0
    ? Math.round(((opts.deal.msrp - opts.deal.dealPrice) / opts.deal.msrp) * 100)
    : 0
  const mapLine = opts.deal.mapRestricted
    ? 'MAP-restricted — no discount claims, no percent-off language, no struck prices.'
    : discountPct > 0 ? `Currently ${discountPct}% off MSRP — you may allude to value, but never in "buy now" or countdown language.` : ''

  const systemBlocksForHero = await buildEmmaSystemBlocks(opts.brandVoice)

  const user = `Write the Emma hero block for the homepage of xdipx.com. Variant: "${variant}".

Product context (do NOT echo — rewrite in Emma's voice):
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category.join(', ')}
${opts.deal.tagline ? `- Existing tagline (for context only): ${opts.deal.tagline}` : ''}
${opts.deal.fullStory ? `- Full story (context only, strip HTML): ${opts.deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 400)}` : ''}
${mapLine}

Return ONLY this JSON (no markdown):
{
  "eyebrow":   "A DYNAMIC FEELING in Emma's own voice — 2–4 words, first-person, informal. Examples: 'Kinda obsessed', 'Low-key amazed', 'Still thinking about this', 'Quietly sold', 'Actually impressed'. No period. Do NOT use 'Currently loving' or generic editorial phrases like 'This week's pick'. Must feel like a quick reaction, not a label.",
  "headline":  "ONE sentence (8–14 words) that explains WHY Emma is featuring this pick right now — the reason it earned the slot. First-person, specific, warm. Never starts with the product name. Never 'buy now'. Example shape: 'Something about how quiet this one is just broke my brain.'",
  "body":      "1–2 short sentences (25–45 words total) — the highlights a shopper should know. What it feels like, what stands out, what surprised her. Tight and specific. No marketing bloat. No clinical language.",
  "aside":     "'— Emma · <3–6 word aside>', e.g. '— Emma · still on my desk'"${variant === 'quote' ? `,
  "pullQuote": "one short pull-quote (6–12 words) — in quotes — a friend-to-friend endorsement. No price or discount language."` : ''}
}`

  async function attempt(tries = 2): Promise<EmmaHeroCopy> {
    for (let i = 0; i < tries; i++) {
      try {
        const { text } = await callClaude({
          llmClient: opts.llmClient,
          model:     MODEL,
          maxTokens: 800,
          systemBlocks: systemBlocksForHero,
          userPrompt: user,
        })
        const parsed = JSON.parse(stripFences(text)) as Partial<EmmaHeroCopy>
        if (parsed.eyebrow && parsed.headline && parsed.body && parsed.aside) {
          const out: EmmaHeroCopy = {
            variant,
            eyebrow:  parsed.eyebrow,
            headline: parsed.headline,
            body:     parsed.body,
            aside:    parsed.aside,
            generatedAt: new Date().toISOString(),
            voiceHash,
          }
          if (variant === 'quote' && parsed.pullQuote) out.pullQuote = parsed.pullQuote
          return out
        }
      } catch (err) {
        if (i === tries - 1) throw err
      }
    }
    throw new Error('unreachable')
  }

  try {
    return await attempt(2)
  } catch (err) {
    console.error('[generateEmmaHero] falling back to hardcoded copy:', err)
    return emmaHeroFallback(opts.deal, variant, voiceHash)
  }
}

const EMMA_TAGLINE_FALLBACKS = [
  'here to help you find what you’re into ♥',
  'your no-judgment guide to pleasure ♥',
  'quietly obsessed with the good stuff ♥',
  'pick my brain — I’ve tested most of it ♥',
  'tell me what you’re curious about ♥',
]

export async function generateEmmaTagline(): Promise<string> {
  const system = `You are Emma — the editorial voice of xdipx.com, an editorially-curated sexual-wellness storefront. You write like a trusted, funny friend. Tasteful, warm, curious. Never clinical. Never sleazy. Never "sex" as an adjective.`
  const user = `Write ONE short tagline for the Emma chat window's status line. It sits right under "Ask Emma · Online".

Rules:
- 5 to 9 words, lowercase (first word may be capitalized).
- First-person Emma voice.
- Ends with the ♥ glyph (exactly one).
- No quotes, no period, no emoji other than ♥.
- No "buy now", no countdown, no pricing, no "sex" as adjective.
- Feel friendly and specific — the kind of thing a friend might say when you open the chat. Examples of the vibe (don't copy): "here to help you find what you're into ♥", "pick my brain, I've tried most of it ♥".

Return ONLY the tagline text, nothing else.`

  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 80,
      system,
      messages: [{ role: 'user', content: user }],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') throw new Error('non-text response')
    const line = block.text
      .trim()
      .replace(/^["'`]|["'`]$/g, '')
      .replace(/\s+/g, ' ')
      .split('\n')[0]
      ?.trim()
    if (line && line.length > 4 && line.length <= 80 && line.includes('♥')) return line
    if (line && line.length > 4 && line.length <= 80) return `${line} ♥`
  } catch (err) {
    console.error('[generateEmmaTagline] falling back:', err)
  }
  return EMMA_TAGLINE_FALLBACKS[Math.floor(Math.random() * EMMA_TAGLINE_FALLBACKS.length)]!
}

export async function generateBlogSEO(
  title: string,
  excerpt: string,
): Promise<BlogSEOSuggestion> {
  const raw = await generate(
    `Generate SEO metadata for this blog post on xdipx.com (sexual wellness daily deals site).

Title: ${title}
Excerpt: ${excerpt}

Return a JSON object with:
- "seoTitle": optimized page title, max 70 chars. Include primary keyword near the start.
- "seoDescription": meta description, exactly 140-160 chars. Include a benefit and CTA. Conversational tone.
- "suggestedTags": array of 3-5 relevant tags for the post.

Return only the JSON object, no markdown.`,
  )

  try {
    return JSON.parse(stripFences(raw)) as BlogSEOSuggestion
  } catch {
    return {
      seoTitle: title.slice(0, 70),
      seoDescription: excerpt.slice(0, 160),
      suggestedTags: [],
    }
  }
}

// ─── PDP redesign — Emma's take, Care, Sensation dial v2 ────────────────────

/**
 * Generate Emma's first-person "take" on a product as one rich HTML paragraph.
 * Output is intended to overwrite Shopify product.descriptionHtml — the editor
 * can hand-tweak in Shopify admin afterward.
 */
export async function generateEmmaTake(opts: {
  deal: Pick<Deal, 'seoTitle' | 'tagline' | 'fullStory' | 'brand' | 'category' | 'productTypeDial'>
  brandVoice?: string
  llmClient?:  LLMClient
}): Promise<string> {
  const systemBlocksForTake = await buildEmmaSystemBlocks(opts.brandVoice)

  const user = `Write Emma's "take" on this product. It appears at the top of the PDP — a friend-to-friend honest read. This is THE customer-facing voice surface; treat it accordingly.

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category.join(', ')}
${opts.deal.productTypeDial ? `- Type: ${opts.deal.productTypeDial}` : ''}
${opts.deal.tagline ? `- Tagline (context only — DO NOT echo in first sentence): ${opts.deal.tagline}` : ''}
${opts.deal.fullStory ? `- Existing story (context, strip HTML): ${opts.deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 600)}` : ''}

Cover, in this order, in your own voice (no headings, just flowing paragraphs):
1. Who this clicks for — what they're after, what they'll like.
2. Why it's worth exploring — what makes it intriguing, approachable, or fun to try. POSITIVE INVITATION. NEVER tell anyone to skip this product. NEVER gatekeep.
3. How to get the most out of it — a tip Emma would whisper to a friend.

Constraints:
- Under 100 words total. One paragraph (or two very short ones, max). The PDP shows this above a "...more" expand fold; staying tight means readers see all three beats without clicking.
- Return clean HTML — only <p>, <em>, <strong> tags. No headings, no <ul>, no inline styles, no class attrs.
- First-person Emma voice throughout. Present tense. No "Buy now". No countdowns. No clinical language.
- Do NOT mention price, MAP, or discounts.
- Do NOT echo the product title OR tagline in the first sentence.
- "sex" and "sexy" are allowed where contextually relevant to the product and customer discovery (e.g. "sex toy", "safer sex", "sexy gift"). Default to "intimate"/"pleasure"/"wellness" for general voice — don't drop "sex" in for SEO bait.
- NO em-dashes ("—" or "–"). Use periods, commas, or parentheses.

Return ONLY the HTML — no markdown, no fences, no preamble.`

  try {
    const { text } = await callClaude({
      llmClient: opts.llmClient,
      model:     MODEL,
      maxTokens: 800,
      systemBlocks: systemBlocksForTake,
      userPrompt: user,
    })
    return stripFences(text).trim()
  } catch (err) {
    console.error('[generateEmmaTake] failed:', err)
    throw err
  }
}

/**
 * Generate care instructions for a product. Branches on `productTypeDial`:
 *
 *   - Hardware (vibrator / wand / air-pulsation / wear non-edible): 3–5 short
 *     imperative bullets covering cleaning, charging, storage, lube
 *     compatibility, what to avoid. Practical, technical.
 *
 *   - Consumables (lube, edible wear): 2–3 fun + SEO-friendly bullets that
 *     read more like "how to enjoy / where to keep it" than maintenance
 *     instructions. The product takes care of you, not the other way around.
 *
 * Lube and edible wear used to be skipped entirely; with the consumable
 * branch they get something tasteful in the empty Care card.
 */
export async function generateCareInstructions(opts: {
  deal: Pick<Deal, 'seoTitle' | 'brand' | 'category' | 'productTypeDial' | 'specifications' | 'fullStory'>
  llmClient?: LLMClient
}): Promise<CareInstructions> {
  // Phase 1 rebuild — consumable family. Today only `lube` is in ProductTypeDial,
  // but the D1 refactor expands the enum to include `massage`, `enhancer`, and
  // `condom`. Using a runtime string Set makes this branch correctly absorb the
  // expanded values once D1 lands without a second edit here.
  const CONSUMABLE_TYPES: ReadonlySet<string> = new Set([
    'lube', 'massage', 'enhancer', 'condom',
  ])
  const isConsumable = opts.deal.productTypeDial !== undefined
    && CONSUMABLE_TYPES.has(opts.deal.productTypeDial)

  const user = isConsumable
    ? `Write 2 or 3 short care/storage bullets for this consumable product. Each is one playful, SEO-friendly sentence — under 16 words. Goal: fill the PDP "Care" card with something genuinely useful and a little fun, NOT a maintenance manual.

Product:
- Title: ${opts.deal.seoTitle}
- Type: ${opts.deal.productTypeDial}
${opts.deal.specifications?.length ? `- Specs (context): ${opts.deal.specifications.join('; ').slice(0, 400)}` : ''}

Tone:
- This stuff takes care of you more than you take care of it.
- Cover what actually matters: where to keep it, when to use it, how it plays with toys / condoms / skin (if relevant), shelf life.
- SPECIFIC OVER GENERIC. "Store wherever you intend to use it most" beats "store in a cool, dry place." "Stays slick from morning shower to midnight nightstand" beats "long-lasting formula."
- The word "sex" or "sexy" is allowed where it fits naturally and helps SEO.
- No em-dashes ("—" or "–"). Use periods, commas, or parentheses.

Return ONLY a JSON array of strings (2–3 items). Example: ["Stays slick from morning shower to midnight nightstand.", "Plays well with silicone toys, latex condoms, and sensitive skin."]
No markdown, no fences, no commentary.`
    : `Write 3 to 5 short care instructions for this product. Each is one short imperative sentence — under 14 words.

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category.join(', ')}
${opts.deal.productTypeDial ? `- Type: ${opts.deal.productTypeDial}` : ''}
${opts.deal.specifications?.length ? `- Specs (context): ${opts.deal.specifications.join('; ').slice(0, 500)}` : ''}

Cover what actually matters for this object — cleaning, charging/storage, lube compatibility (where relevant), what to avoid. Practical, not clinical.

SPECIFIC OVER GENERIC. "Tucks back into the storage pouch; charges off any USB-C" beats "Store in a cool, dry place." "Wipe with mild soap and warm water after use" beats "Clean before storage."

No em-dashes ("—" or "–"). Use periods, commas, or parentheses.

Return ONLY a JSON array of strings. Example: ["Wipe with mild soap and warm water after each use.", "Air-dry before storing in the included pouch."]
No markdown, no fences, no commentary.`

  try {
    const { text } = await callClaude({
      llmClient: opts.llmClient,
      model:     MODEL_FAST,
      maxTokens: 400,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user,
    })
    const parsed = JSON.parse(stripFences(text)) as unknown
    if (!Array.isArray(parsed)) throw new Error('expected array')
    const bullets = parsed
      .filter((x): x is string => typeof x === 'string')
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.length <= 160)
      .slice(0, 5)
    const minRequired = isConsumable ? 2 : 3
    if (bullets.length < minRequired) throw new Error(`only ${bullets.length} valid bullets returned (needed ${minRequired})`)
    return bullets
  } catch (err) {
    console.error('[generateCareInstructions] failed:', err)
    throw err
  }
}

/**
 * Product FAQ — shape matches `studio/schemas/blocks/productFaq.js`. Stored on
 * `productPage.productFaqs[]`, rendered visibly on the PDP and emitted as
 * FAQPage JSON-LD. Visible answer text MUST equal the structured-data answer
 * text (Google flags hidden-content schemas).
 */
export type ProductFaq = {
  question: string
  answer:   string
  category: 'general' | 'care' | 'usage' | 'compatibility' | 'shipping'
}

const PRODUCT_FAQ_CATEGORIES = ['general', 'care', 'usage', 'compatibility', 'shipping'] as const

/**
 * Generate 4–6 product FAQs covering general / usage / care (mandatory) plus
 * compatibility and shipping where they apply. Powers the PDP "FAQs / Q&A"
 * card AND the FAQPage JSON-LD that Google + LLM citers consume.
 *
 * Phase 1 rebuild — must DIFFERENTIATE from descriptionHtml (B1) and
 * careInstructions (C3). The B1 narrative + C3 structured care + H1 Q&A all
 * render on the same PDP; restating concepts across them dilutes the page
 * for shoppers AND for SEO/LLM citers. Caller passes already-generated B1+C3
 * into the prompt context so the model can see what it must NOT echo.
 *
 * Sonnet — answers benefit from rich product context.
 */
export async function generateProductFaqs(opts: {
  deal: Pick<Deal, 'seoTitle' | 'brand' | 'category' | 'productTypeDial' | 'specifications' | 'fullStory' | 'tagline' | 'moodTags' | 'audienceTags' | 'mattersTags' | 'descriptionHtml' | 'careInstructions'>
  llmClient?: LLMClient
}): Promise<ProductFaq[]> {
  const tagsLine = [
    opts.deal.moodTags?.length    ? `mood: ${opts.deal.moodTags.join(', ')}`         : '',
    opts.deal.audienceTags?.length ? `audience: ${opts.deal.audienceTags.join(', ')}` : '',
    opts.deal.mattersTags?.length  ? `matters: ${opts.deal.mattersTags.join(', ')}`   : '',
  ].filter(Boolean).join(' / ')

  // Already-generated B1 (Emma's Take) and C3 (care instructions) get passed
  // as differentiation context. The model sees what's already covered and
  // chooses Q&A that complements rather than restates.
  const descriptionHtmlText = opts.deal.descriptionHtml
    ? opts.deal.descriptionHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600)
    : ''
  const careInstructionsText = Array.isArray(opts.deal.careInstructions) && opts.deal.careInstructions.length > 0
    ? opts.deal.careInstructions.join(' | ').slice(0, 500)
    : ''

  const user = `Generate 6 to 8 FAQs for this product's PDP. They render visibly AND get emitted as FAQPage JSON-LD — visible text must match structured text (no hidden content).

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category.join(', ')}
${opts.deal.productTypeDial ? `- Type: ${opts.deal.productTypeDial}` : ''}
${opts.deal.tagline ? `- Tagline (context): ${opts.deal.tagline}` : ''}
${tagsLine ? `- Tags: ${tagsLine}` : ''}
${opts.deal.specifications?.length ? `- Specs (context): ${opts.deal.specifications.join('; ').slice(0, 500)}` : ''}
${opts.deal.fullStory ? `- Existing story (context, strip HTML): ${opts.deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 600)}` : ''}

DIFFERENTIATION CONTEXT (what's already covered elsewhere on the PDP):
${descriptionHtmlText ? `- Emma's Take (descriptionHtml — narrative beat: who it clicks for / why explore / Emma's tip):\n  ${descriptionHtmlText}\n` : ''}${careInstructionsText ? `- Care card (careInstructions — structured imperatives covering cleaning / charging / storage / lube compat):\n  ${careInstructionsText}\n` : ''}
**Each FAQ must be DISTINCT from the description and care instructions above. If the answer would just restate content from those surfaces, SKIP that FAQ — better fewer distinct entries than overlap.**

Coverage requirements + DIFFERENTIATION RULES per category:

- \`general\` — 1 to 2 entries.
  Focus: practical "what is this" — product type, primary feature, basic spec.
  Good: "What kind of stimulation does this provide?", "Is this rechargeable?", "What's the runtime on a full charge?"
  AVOID: "Who is this for?" / "Who clicks for this?" — already covered in Emma's Take.

- \`usage\` — 1 to 2 entries.
  Focus: practical operation — controls, modes, setup, partner/solo.
  Good: "How do I switch between intensity levels?", "Can I use this in the shower?", "Does it work with a partner or solo?"
  AVOID: "How do I get the most out of it?" — already covered in Emma's Take.

- \`care\` — **2 to 3 entries (REQUIRED for SEO).** Each must hit a DIFFERENT care angle from the list below.
  Focus: customer-question framings that COMPLEMENT (do not restate) the structured care card.
  Distinct angles to choose 2-3 from:
    • Safety / sharing — "Is it safe to share with a partner?", "Do I need a condom or barrier when sharing?"
    • Material safety — "Is the material body-safe?", "Is this phthalate-free?", "Is it hypoallergenic?"
    • Battery / power longevity — "How long does the battery last on a full charge?", "What if it stops charging?", "How long until I need to replace the battery?"
    • Lifespan / replacement — "How long should this last with regular use?", "When should I retire it?"
    • Travel / on-the-go — "Can I take this on a plane?", "Will the charger work internationally?", "Is it discreet for travel?"
    • Lube + material compatibility — "Which lubes are safe with this material?", "Will silicone lube damage the surface?"
  AVOID: "How do I clean it?" / "How do I store it?" / "How do I charge it?" — already in the care card.

- \`compatibility\` — OPTIONAL. Only when relevant: lube↔toy materials (if not already covered in care), sleeve sizing, app/Bluetooth requirements, condom safety.

- \`shipping\` — OPTIONAL. Only for non-standard shipping (oversize, restricted regions). Otherwise SKIP entirely.

Question rules:
- Full natural-language sentences ("How long does it take to charge?") — never keyword fragments.
- Each question 10–160 chars. Each unique.
- Phrase the way a real customer would type into search or ask out loud.

Answer rules:
- 1–3 sentences, 40–800 chars. Emma voice — friendly, factual, specific.
- Plain text only. No markdown, no HTML, no URLs, no emoji.
- NO em-dashes ("—" or "–"). Use periods, commas, or parentheses instead.
- The words "sex" and "sexy" are allowed where contextually relevant to the product and customer discovery — FAQs benefit from these terms for SEO + LLM-citer indexing.
- Don't invent specs not in the source (no fabricated battery life, dimensions, materials).

Return ONLY raw JSON (no markdown). An array of objects: [{ "question": "...", "answer": "...", "category": "general|care|usage|compatibility|shipping" }, ...]`

  const parseFaqs = (raw: string): ProductFaq[] => {
    const parsed = JSON.parse(stripFences(raw)) as unknown
    if (!Array.isArray(parsed)) throw new Error('expected array')
    const faqs: ProductFaq[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as { question?: unknown; answer?: unknown; category?: unknown }
      const question = typeof e.question === 'string' ? e.question.trim() : ''
      const answer   = typeof e.answer   === 'string' ? e.answer.trim()   : ''
      const category = typeof e.category === 'string' ? e.category.trim() : ''
      if (question.length < 10 || question.length > 160) continue
      if (answer.length   < 40 || answer.length   > 800) continue
      if (!(PRODUCT_FAQ_CATEGORIES as readonly string[]).includes(category)) continue
      faqs.push({ question, answer, category: category as ProductFaq['category'] })
    }
    return faqs
  }

  /**
   * Smart trim that preserves category coverage. Walks the desired-distribution
   * caps below in priority order, taking up to N entries from each bucket so a
   * model that over-produced one category can't crowd out coverage of another.
   * Total cap 8 (matches the prompt's upper bound).
   */
  const trimWithCoverage = (faqs: ProductFaq[]): ProductFaq[] => {
    const caps: Record<ProductFaq['category'], number> = {
      care:          3,
      general:       2,
      usage:         2,
      compatibility: 1,
      shipping:      1,
    }
    const taken: ProductFaq[] = []
    const counts: Record<string, number> = {}
    for (const f of faqs) {
      if (taken.length >= 8) break
      const cap = caps[f.category]
      const cur = counts[f.category] ?? 0
      if (cur >= cap) continue
      taken.push(f)
      counts[f.category] = cur + 1
    }
    return taken
  }

  try {
    const { text } = await callClaude({
      llmClient: opts.llmClient,
      model:     MODEL,
      maxTokens: 2500,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user,
    })
    let faqs = parseFaqs(text)

    // Coverage retry: if the primary call came back with fewer than 2 care
    // FAQs, ask Sonnet for additional care-only entries that complement (don't
    // restate) what's already there. We splice them into the existing batch
    // instead of re-running the full generator (cheaper, preserves the
    // diversity of the first pass for general/usage).
    const careCount = (arr: ProductFaq[]) => arr.filter(f => f.category === 'care').length
    if (careCount(faqs) < 2) {
      const existingCareQs = faqs
        .filter(f => f.category === 'care')
        .map(f => `- ${f.question}`)
        .join('\n') || '(none yet)'
      const careTopUp = `The first FAQ pass for this product produced fewer than 2 \`care\` entries. Generate ${2 - careCount(faqs) + 1} additional \`care\` FAQs that COMPLEMENT (do not restate) the structured care card AND are DISTINCT from these existing care entries:

${existingCareQs}

Each new FAQ must hit a DIFFERENT care angle (safety/sharing, material safety, battery/power longevity, lifespan/replacement, travel/on-the-go, or lube↔material compatibility) from the others.

Same product context, same answer rules (40–800 chars, plain text, no em-dashes, Emma voice).
Return ONLY raw JSON array of objects: [{ "question": "...", "answer": "...", "category": "care" }, ...]

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
${opts.deal.productTypeDial ? `- Type: ${opts.deal.productTypeDial}` : ''}
${opts.deal.specifications?.length ? `- Specs (context): ${opts.deal.specifications.join('; ').slice(0, 400)}` : ''}
${careInstructionsText ? `- Care card already covers (do NOT restate): ${careInstructionsText}` : ''}`

      try {
        const { text: retryText } = await callClaude({
          llmClient: opts.llmClient,
          model:     MODEL,
          maxTokens: 1200,
          systemBlocks: await buildEmmaSystemBlocks(),
          userPrompt: careTopUp,
        })
        const extras = parseFaqs(retryText).filter(f => f.category === 'care')
        // Dedupe by question (case-insensitive) before splicing in.
        const seen = new Set(faqs.map(f => f.question.toLowerCase()))
        for (const e of extras) {
          if (seen.has(e.question.toLowerCase())) continue
          faqs.push(e)
          seen.add(e.question.toLowerCase())
        }
      } catch (err) {
        console.warn('[generateProductFaqs] care top-up failed (continuing with primary batch):', err instanceof Error ? err.message : err)
      }
    }

    const trimmed = trimWithCoverage(faqs)
    if (trimmed.length < 3) throw new Error(`only ${trimmed.length} valid FAQs returned`)
    if (careCount(trimmed) < 1) {
      console.warn(`[generateProductFaqs] no care FAQs after retry — Care card will fall back to careInstructions bullets`)
    } else if (careCount(trimmed) < 2) {
      console.warn(`[generateProductFaqs] only 1 care FAQ after retry — below the SEO target of 2-3`)
    }
    return trimmed
  } catch (err) {
    console.error('[generateProductFaqs] failed:', err)
    throw err
  }
}

/**
 * Generate the v2 sensation dial for a product. Reads the current registry of
 * preferred labels for the product type and asks Haiku to prefer them — but
 * propose a new label (with `proposed: true`) if it fits this product better.
 */
export async function generateSensationDialV2(opts: {
  deal: Pick<Deal, 'seoTitle' | 'brand' | 'category' | 'productTypeDial' | 'fullStory' | 'specifications' | 'tagline'>
  /** Current preferred labels for this product type (from Sanity dialRegistry). */
  preferredLabels: string[]
  /** Optional rich taxonomy entries with definitions + 1/3/5 scale docs from
   *  the dialTaxonomy singleton. When present, makes generated values much
   *  more consistent across products of the same type. */
  taxonomy?: Array<{
    label:      string
    definition?: string
    scaleLow?:  string
    scaleMid?:  string
    scaleHigh?: string
  }>
  llmClient?: LLMClient
}): Promise<SensationDialV2> {
  const type: ProductTypeDial = opts.deal.productTypeDial ?? 'vibrator'

  // Prefer the rich taxonomy when populated — it includes scale documentation
  // that anchors values consistently. Fall back to the flat label list when
  // the taxonomy hasn't been seeded yet.
  const taxonomyBlock = (() => {
    if (!opts.taxonomy?.length) return ''
    const lines = opts.taxonomy.map(d => {
      const head = `- ${d.label}${d.definition ? `: ${d.definition}` : ''}`
      const scale: string[] = []
      if (d.scaleLow)  scale.push(`1 = ${d.scaleLow}`)
      if (d.scaleMid)  scale.push(`3 = ${d.scaleMid}`)
      if (d.scaleHigh) scale.push(`5 = ${d.scaleHigh}`)
      return scale.length > 0 ? `${head}\n  scale: ${scale.join(' | ')}` : head
    })
    return `\n\nDimension definitions and value scales (use these to anchor your scoring — same dimension should mean the same thing across products):\n${lines.join('\n')}`
  })()

  const labelList = opts.preferredLabels.length > 0
    ? opts.preferredLabels.map(l => `- ${l}`).join('\n')
    : '(none — invent appropriate labels)'

  const user = `Build the "How it feels" sensation dial for this product. 5 to 6 dimensions, each scored 1 to 5 (5 = most).

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category.join(', ')}
- Type: ${type}
${opts.deal.tagline ? `- Tagline: ${opts.deal.tagline}` : ''}
${opts.deal.fullStory ? `- Story (context, strip HTML): ${opts.deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 500)}` : ''}
${opts.deal.specifications?.length ? `- Specs (context): ${opts.deal.specifications.join('; ').slice(0, 400)}` : ''}

Preferred labels for this product type (use these when they fit):
${labelList}${taxonomyBlock}

If a different label clearly fits this product better than any of the preferred ones, propose the new label and set "proposed": true. Otherwise reuse a preferred label exactly as written and omit "proposed". Do not propose a synonym of a preferred label — propose only when the dimension is genuinely different.

Return ONLY this JSON shape (no markdown, no fences):
{
  "items": [
    { "label": "Intensity", "value": 4 },
    { "label": "Quietness", "value": 5 },
    { "label": "Suction strength", "value": 3, "proposed": true }
  ]
}

Rules:
- 5 or 6 items, no duplicates.
- Each "value" is an integer 1–5.
- Keep labels under 24 chars, sentence case, no trailing punctuation.
- Honest scoring — don't max everything. Use the dimension scale docs above (when present) to anchor "what 3 vs 5 means" — consistency across products matters.`

  const { text } = await callClaude({
    llmClient: opts.llmClient,
    model:     MODEL_FAST,
    maxTokens: 600,
    systemBlocks: await buildEmmaSystemBlocks(),
    userPrompt: user,
  })

  const parsed = JSON.parse(stripFences(text)) as { items?: Array<{ label?: unknown; value?: unknown; proposed?: unknown }> }
  if (!parsed.items || !Array.isArray(parsed.items)) throw new Error('missing items array')

  const seen = new Set<string>()
  const items: SensationDialItem[] = []
  for (const raw of parsed.items) {
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    const value = typeof raw.value === 'number' ? Math.round(raw.value) : NaN
    if (!label || label.length > 30) continue
    if (!Number.isFinite(value) || value < 1 || value > 5) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const item: SensationDialItem = { label, value: value as DialValue }
    if (raw.proposed === true) item.proposed = true
    items.push(item)
    if (items.length >= 6) break
  }
  if (items.length < 5) throw new Error(`only ${items.length} valid dial items returned`)

  return { items }
}

// ─── Bulk-import — product type classifier + Ask Emma tag generator ─────────

// Phase 1 rebuild — `inferProductTypeDial` is the legacy 5-bucket classifier.
// D1 step 7 will replace it with `inferProductTaxonomy` (combined type+subtype
// call returning the full 19-value enum + per-parent subtype). Until then,
// this maps the legacy buckets to the new top-level ProductTypeDial:
//   air-pulsation, wand, vibrator → vibrator   (legacy values are now subtypes)
//   lube → lube, wear → wear
const LEGACY_DIAL_BUCKETS = ['air-pulsation', 'vibrator', 'wand', 'lube', 'wear'] as const

function mapLegacyDialBucket(legacy: string): ProductTypeDial | null {
  if (legacy === 'air-pulsation' || legacy === 'wand' || legacy === 'vibrator') return 'vibrator'
  if (legacy === 'lube') return 'lube'
  if (legacy === 'wear') return 'wear'
  return null
}

/**
 * @deprecated Phase 1 rebuild replaces this with `inferProductTaxonomy` (D1 step 7).
 * Classify a product into one of the legacy five buckets and map to the new
 * top-level ProductTypeDial. Defaults to 'vibrator' if Haiku is unsure — never
 * returns null.
 */
export async function inferProductTypeDial(input: {
  title: string
  brand: string
  description: string
  categories: string[]
  llmClient?: LLMClient
}): Promise<ProductTypeDial> {
  const user = `Classify the product into ONE of these buckets (return exactly one):
- air-pulsation  (clitoral suction / air-pulse / pressure-wave devices)
- vibrator       (internal/external vibrators, rabbits, bullets, couples vibes)
- wand           (large-format wand massagers, corded or rechargeable)
- lube           (lubricants, gels, oils, intimate moisturizers)
- wear           (lingerie, harnesses, panties, apparel, restraints, accessories worn on the body)

Product:
- Title: ${input.title}
- Brand: ${input.brand}
- Categories: ${input.categories.join(', ') || '(none)'}
- Description (truncated): ${input.description.slice(0, 500)}

Return ONLY this JSON: { "type": "vibrator" }
No markdown. No commentary.`

  try {
    const { text } = await callClaude({
      llmClient: input.llmClient,
      model:     MODEL_FAST,
      maxTokens: 60,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user,
    })
    const parsed = JSON.parse(stripFences(text)) as { type?: unknown }
    const t = typeof parsed.type === 'string' ? parsed.type.trim().toLowerCase() : ''
    if ((LEGACY_DIAL_BUCKETS as readonly string[]).includes(t)) {
      const mapped = mapLegacyDialBucket(t)
      if (mapped) return mapped
    }
  } catch (err) {
    console.error('[inferProductTypeDial] failed, defaulting to vibrator:', err)
  }
  return 'vibrator'
}

// ─── Phase 1 D1 — combined type+subtype hierarchical classifier ──────────────

/** Per-parent subtype enum. Closed list per top-level ProductTypeDial. Used by
 *  `inferProductTaxonomy` for runtime validation and for prompt context (the
 *  caller passes the parent's allowed subtypes so Haiku doesn't memorize the
 *  full hierarchy). `sex-machine` has no subtypes — leave the value null. */
export const PRODUCT_SUBTYPES_BY_TYPE: Record<ProductTypeDial, readonly ProductSubtypeDial[]> = {
  vibrator:    ['bullet-egg', 'rabbit', 'g-spot', 'finger-clit', 'wand', 'air-pulsation', 'rotating-thrusting', 'remote', 'wearable'],
  dildo:       ['realistic', 'glass-metal', 'silicone', 'dual-density', 'non-phallic', 'vibrating', 'packer', 'large'],
  anal:        ['plug', 'prostate', 'beads', 'vibrating', 'dilator', 'douche-enema'],
  bondage:     ['paddle-whip', 'restraint', 'blindfold', 'gag', 'collar-leash', 'nipple', 'body-harness', 'sensory', 'electrostim'],
  'cock-ring': ['classic', 'vibrating', 'cock-ball-sling', 'ball-stretcher', 'set'],
  stroker:     ['vagina', 'mouth', 'pocket', 'non-realistic', 'vibrating', 'doll', 'disposable'],
  couples:     ['game-romance', 'bedroom-accessory', 'positioning-aid', 'swing-sling', 'wearable'],
  harness:     ['fabric', 'leather', 'vegan-leather', 'o-ring', 'set-kit'],
  extender:    ['sling', 'sleeve', 'vibrating', 'strap-on'],
  pump:        ['penis'],
  lube:        ['water-based', 'silicone-based', 'hybrid', 'flavored', 'natural', 'anal', 'warming-cooling', 'toy-cleaner'],
  massage:     ['body-care', 'candle', 'perfume-pheromone', 'hygiene', 'cbd'],
  enhancer:    ['desensitizer-relaxer', 'oral', 'arousal-gel', 'male-arousal', 'female-arousal', 'gummy-edible', 'pill'],
  wear:        ['mens-underwear', 'panty', 'bra-panty-set', 'bodysuit-teddy', 'bodystocking', 'hosiery', 'pasty', 'apparel', 'sock', 'accessory', 'plus-queen'],
  condom:      ['glyde', 'trojan', 'lifestyles', 'durex'],
  wellness:    ['kegel', 'dilator', 'douche-enema', 'hygiene', 'aftercare'],
  novelty:     ['candy-edible', 'pin-keychain', 'game', 'plushie-pillow', 'novelty-gift', 'party-supply'],
  'book-media': ['book', 'coloring-book'],
  'sex-machine': [],
}

const TOP_LEVEL_DIAL_GUIDE = `Top-level taxonomy (pick exactly one):
- vibrator     (any vibrating toy: bullet, rabbit, g-spot, wand, air-pulse, rotating, remote, wearable)
- dildo        (non-vibrating insertable, realistic or fantasy, packer, etc.)
- anal         (plug, prostate massager, beads, dilator, douche)
- bondage      (paddle, restraint, blindfold, gag, collar, sensory, electrostim)
- cock-ring    (classic ring, sling, ball stretcher, ring set)
- stroker      (masturbation sleeve, pocket, doll)
- couples      (couples game, positioning aid, swing/sling, shared accessory)
- harness      (strap-on harness body)
- extender     (penis sleeve, extender, strap-on extender)
- pump         (penis pump)
- lube         (lubricant of any base — water/silicone/hybrid/oil — and toy cleaner)
- massage      (body massage product, oil, candle, pheromone, CBD)
- enhancer     (desensitizer, arousal gel, gummy, pill, oral spray)
- wear         (lingerie, underwear, bodysuit, hosiery, pasty, apparel)
- condom       (any condom brand)
- wellness     (kegel, dilator, douche, hygiene, aftercare)
- novelty      (candy, pin, game, plushie, party supply, novelty gift)
- book-media   (book, coloring book)
- sex-machine  (machines — no subtype available; leave subtype empty)`

export interface InferProductTaxonomyResult {
  type:    ProductTypeDial
  /** Null when the top-level is sex-machine (no subtypes) or when classification
   *  is too ambiguous to commit. Validated against PRODUCT_SUBTYPES_BY_TYPE. */
  subtype: ProductSubtypeDial | null
}

/**
 * Phase 1 D1 — combined type+subtype Haiku classifier. Returns the top-level
 * ProductTypeDial AND the per-parent ProductSubtypeDial in one call.
 *
 * The prompt scopes the subtype options to the chosen top-level (caller passes
 * the parent's child list as context) so Haiku doesn't have to memorize the
 * full hierarchy. Defaults to {type: 'vibrator', subtype: null} on failure.
 *
 * Replaces `inferProductTypeDial`. Both write paths go through this for new
 * imports and backfill reclassification.
 */
export async function inferProductTaxonomy(input: {
  title: string
  brand: string
  description: string
  categories: string[]
  llmClient?: LLMClient
}): Promise<InferProductTaxonomyResult> {
  const subtypeBlock = (Object.entries(PRODUCT_SUBTYPES_BY_TYPE) as Array<[ProductTypeDial, readonly ProductSubtypeDial[]]>)
    .map(([t, subs]) => subs.length === 0
      ? `  ${t}: (no subtype — leave subtype null/empty)`
      : `  ${t}: ${subs.join(' | ')}`)
    .join('\n')

  const user = `Classify this product into a hierarchical taxonomy. Two fields:
1. \`type\` — one of the closed top-level values
2. \`subtype\` — one of the closed values scoped to the chosen \`type\`, OR null when the type is \`sex-machine\` or no subtype clearly fits

${TOP_LEVEL_DIAL_GUIDE}

Subtypes by parent:
${subtypeBlock}

HONEST CLASSIFICATION:
- Pick the dominant type when a product spans two (an anal vibrator → \`anal\` parent with subtype \`vibrating\`, NOT \`vibrator\` parent).
- Skip the subtype (return null) rather than force a bad fit.
- Don't invent new types or subtypes — both lists are closed.

Product:
- Title: ${input.title}
- Brand: ${input.brand}
- Categories: ${input.categories.join(', ') || '(none)'}
- Description (truncated): ${input.description.slice(0, 600)}

Return ONLY this JSON (no markdown):
{ "type": "vibrator", "subtype": "rabbit" }
or { "type": "sex-machine", "subtype": null }`

  try {
    const { text } = await callClaude({
      llmClient: input.llmClient,
      model:     MODEL_FAST,
      maxTokens: 100,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user,
    })
    const parsed = JSON.parse(stripFences(text)) as { type?: unknown; subtype?: unknown }
    const rawType = typeof parsed.type === 'string' ? parsed.type.trim().toLowerCase() : ''
    if (!(rawType in PRODUCT_SUBTYPES_BY_TYPE)) {
      console.warn(`[inferProductTaxonomy] unrecognized type "${rawType}", defaulting to vibrator`)
      return { type: 'vibrator', subtype: null }
    }
    const type = rawType as ProductTypeDial
    const allowedSubs = PRODUCT_SUBTYPES_BY_TYPE[type]

    let subtype: ProductSubtypeDial | null = null
    if (allowedSubs.length > 0) {
      const rawSubtype = typeof parsed.subtype === 'string' ? parsed.subtype.trim().toLowerCase() : ''
      if (rawSubtype && (allowedSubs as readonly string[]).includes(rawSubtype)) {
        subtype = rawSubtype as ProductSubtypeDial
      }
      // else leave null — admin can review and fill in manually
    }
    return { type, subtype }
  } catch (err) {
    console.error('[inferProductTaxonomy] failed, defaulting to vibrator:', err)
    return { type: 'vibrator', subtype: null }
  }
}

export type AskEmmaAxis = 'mood' | 'audience' | 'matters'

const ASK_EMMA_AXIS_GUIDANCE: Record<AskEmmaAxis, string> = {
  mood:     'How using this feels — the energy a shopper would gravitate to. Pick 1–3 that genuinely fit.',
  audience: 'Who this is for — solo, couples, or gifting. Pick 1–2.',
  matters:  'Practical features a shopper might filter on — quietness, travel-friendliness, beginner-friendliness, waterproof, rechargeable, hands-free, soft-touch material. Pick 2–4 that are TRUE for this product.',
}

/**
 * Validate raw model-output tags against curated vocabulary. Phase 1 rebuild —
 * Title Case storage. Returns Title Case canonicalized from `preferredLabels`
 * (case-insensitive match), capped at 5 unique entries.
 *
 * Storage form is always Title Case regardless of vocab case. The Sanity
 * `askEmmaVocabulary` doc still serves kebab during the transition (Phase 2
 * Sanity migration), so we Title Case at the boundary. Matches the one-time
 * migration in scripts/migrate-existing-products-d1-d3.ts:84.
 *
 * When `allowProposed` is true and a tag doesn't match any preferred label,
 * the raw value is title-cased and accepted as a proposal. When false (the
 * default for backfill), unmatched tags are dropped.
 */
function validateAskEmmaTagBatch(
  raw: unknown[],
  preferredLabels: string[],
  allowProposed: boolean,
): string[] {
  const canonicalByLower = new Map<string, string>()
  for (const label of preferredLabels) {
    const trimmed = label.trim()
    if (!trimmed) continue
    canonicalByLower.set(trimmed.toLowerCase(), trimmed)
  }

  const seen = new Set<string>()
  const out:  string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || trimmed.length > 32) continue
    const lower = trimmed.toLowerCase()
    const canonical = canonicalByLower.get(lower) ?? (allowProposed ? trimmed : null)
    if (!canonical) continue
    const titleCased = toTitleCase(canonical)
    if (seen.has(titleCased)) continue
    seen.add(titleCased)
    out.push(titleCased)
    if (out.length >= 5) break
  }
  return out
}

/** Title-case a label, preserving hyphenated compounds ("First-Time Friendly"). */
function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map(word => word
      .split('-')
      .map(part => part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part)
      .join('-'))
    .join(' ')
    .trim()
}

/**
 * Generate Ask Emma tags for a single axis. Phase 1 rebuild — Title Case
 * storage (e.g. "Soft Touch" not "soft-touch").
 *
 * **Backfill default: AI does NOT invent new labels.** Output is restricted
 * to `preferredLabels` (case-insensitive match, canonical form from vocab).
 * Forward pipeline can opt in via `allowProposed: true` — those land Title
 * Case for admin review.
 *
 * For the cost-optimized combined-axes call see `generateAskEmmaTagsAll`.
 */
export async function generateAskEmmaTags(opts: {
  deal: Pick<Deal, 'seoTitle' | 'brand' | 'category' | 'productTypeDial' | 'tagline' | 'fullStory' | 'specifications'>
  axis: AskEmmaAxis
  /** Current vocabulary for this axis (from Sanity askEmmaVocabulary). */
  preferredLabels: string[]
  /** Phase 1 default false — backfill must NOT invent new vocab. Forward
   *  pipeline may flip to true. */
  allowProposed?: boolean
  llmClient?: LLMClient
}): Promise<string[]> {
  const { deal, axis, preferredLabels, allowProposed = false } = opts

  const labelList = preferredLabels.length > 0
    ? preferredLabels.map(l => `- ${l}`).join('\n')
    : '(no curated vocabulary yet)'

  const user = `Pick the Ask Emma tags for the "${axis}" axis on this product. ${ASK_EMMA_AXIS_GUIDANCE[axis]}

Product:
- Title: ${deal.seoTitle}
- Brand: ${deal.brand}
- Category: ${deal.category.join(', ')}
${deal.productTypeDial ? `- Type: ${deal.productTypeDial}` : ''}
${deal.tagline ? `- Tagline: ${deal.tagline}` : ''}
${deal.fullStory ? `- Story (context, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 400)}` : ''}
${deal.specifications?.length ? `- Specs (context): ${deal.specifications.join('; ').slice(0, 300)}` : ''}

Curated vocabulary for "${axis}" (Title Case — ${allowProposed ? 'PREFER these; only propose new when none fit' : 'STRICT: pick ONLY from this list'}):
${labelList}

Rules:
- Return labels in **Title Case** (e.g. "Soft Touch", "First-Time Friendly", "Slow Burn") — never lowercase, never kebab-case.
${allowProposed
  ? '- Only invent a new label if NONE of the curated ones fit. Keep new labels <=24 chars, Title Case, generic enough to apply to other products. Do NOT invent synonyms of existing labels.'
  : '- DO NOT invent new labels. If no curated label fits, leave that aspect untagged.'}
- Honest tagging — don't tag every option. If unsure, leave it out.

Return ONLY this JSON (no markdown): { "tags": ["Soft Touch", "First-Time Friendly"] }`

  try {
    const { text } = await callClaude({
      llmClient: opts.llmClient,
      model:     MODEL_FAST,
      maxTokens: 200,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user,
    })
    const parsed = JSON.parse(stripFences(text)) as { tags?: unknown }
    if (!Array.isArray(parsed.tags)) return []
    return validateAskEmmaTagBatch(parsed.tags, preferredLabels, allowProposed)
  } catch (err) {
    console.error(`[generateAskEmmaTags:${axis}] failed:`, err)
    return []
  }
}

/**
 * Phase 1 D3 \u2014 combined-axes Ask Emma tag generator. Single Haiku call returns
 * all three axes (mood / audience / matters) in one round trip. Cost saver \u2014
 * 3 calls become 1, sharing the product context block.
 *
 * Title Case storage. Backfill default disallows AI-proposed new labels.
 */
export async function generateAskEmmaTagsAll(opts: {
  deal: Pick<Deal, 'seoTitle' | 'brand' | 'category' | 'productTypeDial' | 'tagline' | 'fullStory' | 'specifications'>
  /** Curated vocabulary per axis (from Sanity askEmmaVocabulary). */
  vocabularies: Record<AskEmmaAxis, string[]>
  /** Phase 1 default false \u2014 backfill must NOT invent new vocab. */
  allowProposed?: boolean
  llmClient?: LLMClient
}): Promise<{ moodTags: string[]; audienceTags: string[]; mattersTags: string[] }> {
  const { deal, vocabularies, allowProposed = false } = opts

  const renderVocab = (axis: AskEmmaAxis): string => {
    const items = vocabularies[axis]
    return items.length > 0
      ? items.map(l => `  - ${l}`).join('\n')
      : '  (no curated vocabulary yet)'
  }

  const user = `Pick the Ask Emma tags for ALL THREE axes on this product. Title Case storage.

Product:
- Title: ${deal.seoTitle}
- Brand: ${deal.brand}
- Category: ${deal.category.join(', ')}
${deal.productTypeDial ? `- Type: ${deal.productTypeDial}` : ''}
${deal.tagline ? `- Tagline: ${deal.tagline}` : ''}
${deal.fullStory ? `- Story (context, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 400)}` : ''}
${deal.specifications?.length ? `- Specs (context): ${deal.specifications.join('; ').slice(0, 300)}` : ''}

AXIS GUIDE:
- mood: ${ASK_EMMA_AXIS_GUIDANCE.mood}
- audience: ${ASK_EMMA_AXIS_GUIDANCE.audience}
- matters: ${ASK_EMMA_AXIS_GUIDANCE.matters}

CURATED VOCABULARIES (Title Case \u2014 ${allowProposed ? 'PREFER these; only propose new when none fit' : 'STRICT: pick ONLY from these lists'}):
mood:
${renderVocab('mood')}
audience:
${renderVocab('audience')}
matters:
${renderVocab('matters')}

Rules:
- Each tag in **Title Case** (e.g. "Soft Touch", "First-Time Friendly"). Never lowercase, never kebab-case.
${allowProposed
  ? '- Only invent a new label per axis when NONE of that axis\'s curated entries fit. <=24 chars, Title Case, no synonyms of existing labels.'
  : '- DO NOT invent new labels. If no curated entry fits an aspect, leave that aspect untagged in that axis.'}
- Honest tagging \u2014 leave it out if unsure.
- Stay within each axis. Don't put a "mood" label in the "matters" array.

Return ONLY this JSON (no markdown):
{ "mood": ["..."], "audience": ["..."], "matters": ["..."] }`

  try {
    const { text } = await callClaude({
      llmClient: opts.llmClient,
      model:     MODEL_FAST,
      maxTokens: 600,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user,
    })
    const parsed = JSON.parse(stripFences(text)) as { mood?: unknown; audience?: unknown; matters?: unknown }
    return {
      moodTags:     Array.isArray(parsed.mood)     ? validateAskEmmaTagBatch(parsed.mood,     vocabularies.mood,     allowProposed) : [],
      audienceTags: Array.isArray(parsed.audience) ? validateAskEmmaTagBatch(parsed.audience, vocabularies.audience, allowProposed) : [],
      mattersTags:  Array.isArray(parsed.matters)  ? validateAskEmmaTagBatch(parsed.matters,  vocabularies.matters,  allowProposed) : [],
    }
  } catch (err) {
    console.error('[generateAskEmmaTagsAll] failed:', err)
    return { moodTags: [], audienceTags: [], mattersTags: [] }
  }
}

// ─── IVR / voice-surface generators ──────────────────────────────────────────
// Purpose-built fields for chat / IVR / SMS where descriptionHtml can't render.
// Vocabularies are intentionally tight so Emma can speak them naturally aloud
// and downstream surfaces can match user intent without fuzzy NLP.

// Phase 2 — multi-select. The legacy single-value 'any' was redundant and is
// expressed as either an empty array (no constraint) or all four levels. Drop
// 'any' from the canonical vocabulary; the IVR search filter `$exp in array`
// returns no constraint when the field is empty.
export const IVR_EXPERIENCE_LEVELS = ['first-time', 'curious', 'experienced', 'advanced'] as const
export type IvrExperienceValue = typeof IVR_EXPERIENCE_LEVELS[number]
export type IvrExperience      = IvrExperienceValue[]

// Phase 1 rebuild — expanded vocabularies. See plan: Group G locked.
// Cap raised on G2 (1–3 → 2–5) and G3 (2–4 → 3–8) to accommodate richer vocab
// without becoming a tag dump. Honest tagging is the load-bearing rule.
export const IVR_USE_CASES = [
  'date-night', 'travel', 'everyday', 'discovery', 'gift', 'celebration',
  'anniversary', 'honeymoon', 'valentine', 'birthday', 'bachelorette', 'pride',
  'holiday', 'me-time', 'self-care', 'stress-relief', 'bedtime', 'after-work',
  'couples-play', 'long-distance', 'partner-surprise', 'spice-up',
  'newly-dating', 'long-term', 'first-time', 'experimentation',
  'couples-discovery', 'kink-curious', 'role-play', 'fantasy', 'bdsm',
  'power-play', 'bondage-night', 'vacation', 'weekend-getaway', 'shower-bath',
  'discreet-public', 'quickie', 'pelvic-floor', 'kegel-training', 'postpartum',
  'menopause', 'libido-boost', 'prostate-health', 'erectile-support',
  'menstrual-comfort', 'gift-set', 'party-favor', 'self-gift',
  'queer-affirming', 'trans-affirming', 'women-focused', 'men-focused',
  'inclusive',
] as const

export const IVR_FEATURES = [
  'app-controlled', 'waterproof', 'rechargeable', 'quiet', 'travel-size',
  'hands-free', 'soft-touch', 'pinpoint', 'full-coverage', 'battery-powered',
  'disposable-battery', 'usb-c', 'wireless-remote', 'bluetooth', 'long-distance',
  'magnetic-charging', 'rumbly', 'buzzy', 'gentle', 'beginner-friendly',
  'intense', 'powerful', 'vibrating', 'rotating', 'thrusting', 'suction',
  'squirting', 'pulsing', 'warming', 'cooling', 'tingling', 'silicone', 'glass',
  'metal', 'wood', 'body-safe', 'phthalate-free', 'latex-free', 'hypoallergenic',
  'vegan', 'vegan-leather', 'leather', 'faux-leather', 'mini', 'compact',
  'large', 'xl', 'xxl', 'oversized', 'plus-size', 'queen-size', 'curvy',
  'small', 'medium', 'slim', 'girthy', 'flared-base', 'suction-cup', 'strapless',
  'harness-compatible', 'solo', 'partner', 'couples', 'gift', 'gift-set',
  'beginner', 'advanced', 'pro', 'lgbtq', 'pride', 'rainbow', 'clitoral',
  'g-spot', 'p-spot', 'prostate', 'nipple', 'anal', 'oral', 'external',
  'internal', 'dual-stim', 'luxury', 'premium', 'discreet', 'glow-in-the-dark',
  'realistic', 'non-phallic', 'fantasy', 'holiday', 'valentine', 'pride-edition',
  'water-based', 'silicone-based', 'hybrid', 'oil-based', 'flavored',
  'unscented', 'cbd', 'organic', 'natural', 'condom-safe', 'toy-safe',
  'numbing', 'desensitizing',
] as const

type IvrDealCtx = Pick<
  Deal,
  'seoTitle' | 'brand' | 'category' | 'productTypeDial' | 'tagline' | 'fullStory' | 'specifications'
>

function ivrProductBlock(deal: IvrDealCtx): string {
  return [
    `- Title: ${deal.seoTitle}`,
    `- Brand: ${deal.brand}`,
    `- Category: ${deal.category.join(', ')}`,
    deal.productTypeDial ? `- Type: ${deal.productTypeDial}` : '',
    deal.tagline ? `- Tagline: ${deal.tagline}` : '',
    deal.fullStory ? `- Story (context, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 400)}` : '',
    deal.specifications?.length ? `- Specs (context): ${deal.specifications.join('; ').slice(0, 250)}` : '',
  ].filter(Boolean).join('\n')
}

/**
 * Multi-select experience-level: every level this product fits.
 * Phase 2 — was a single enum value (incl. legacy 'any'); now an array. Empty
 * array = no level constraint (matches every level via `$exp in array`).
 */
export async function generateIvrExperience(opts: { deal: IvrDealCtx; llmClient?: LLMClient }): Promise<IvrExperience> {
  const user = `Pick every experience level this product genuinely fits. Multi-select — return 1–4 levels. Choose from: ${IVR_EXPERIENCE_LEVELS.join(' | ')}.

Use "first-time" for beginner-friendly products (gentle, simple controls, low intensity).
Use "curious" for someone exploring beyond the basics — slightly more ambitious but still approachable.
Use "experienced" for people comfortable with the category looking for variety or upgrades.
Use "advanced" for high-intensity, niche, or technique-heavy products.

A versatile product can hit multiple levels (e.g. a starter vibrator that also satisfies an experienced buyer). Be honest — only include a level the product genuinely serves.

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "levels": ["first-time", "curious"] }`

  try {
    const { text } = await callClaude({
      llmClient: opts.llmClient,
      model:     MODEL_FAST,
      maxTokens: 100,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user,
    })
    const parsed = JSON.parse(stripFences(text)) as { levels?: unknown }
    if (Array.isArray(parsed.levels)) {
      const valid = new Set<string>(IVR_EXPERIENCE_LEVELS as readonly string[])
      const out: IvrExperienceValue[] = []
      const seen = new Set<string>()
      for (const item of parsed.levels) {
        if (typeof item !== 'string') continue
        const v = item.trim().toLowerCase()
        if (!valid.has(v) || seen.has(v)) continue
        seen.add(v)
        out.push(v as IvrExperienceValue)
        if (out.length >= 4) break
      }
      return out
    }
  } catch (err) {
    console.error('[generateIvrExperience] failed:', err)
  }
  return []
}

/** 2–5 use-case slugs from a fixed vocabulary (54 slugs post-Phase 1 expansion).
 *  Voice-friendly — Emma reads these aloud when filtering ("good for date-night,
 *  long-distance"). Honest tagging is the load-bearing rule. */
export async function generateIvrUseCase(opts: { deal: IvrDealCtx; llmClient?: LLMClient }): Promise<string[]> {
  const user = `Pick 2–5 use cases this product fits, from this exact vocabulary:
${IVR_USE_CASES.map(s => `- ${s}`).join('\n')}

HONEST TAGGING — STRICT.
- For OBJECTIVE/inferable slugs (travel = product is portable; long-distance = product has remote/app control): tag based on product spec support.
- For SUBJECTIVE slugs (spice-up, partner-surprise, kink-curious, role-play, newly-dating, long-term, experimentation, queer-affirming, trans-affirming, etc.): tag ONLY when the description strongly supports it. Default to OMISSION when ambiguous. Skip rather than stretch.

MUTUAL-EXCLUSIVITY HINTS (soft guidance — usually pick at most one within each facet):
- Occasion: anniversary, honeymoon, valentine, birthday, bachelorette, pride, holiday — usually one or none. \`holiday\` is the umbrella for non-specific holidays; pick a specific occasion when it fits.
- Wellness/health: pelvic-floor, kegel-training, postpartum, menopause, libido-boost, prostate-health, erectile-support, menstrual-comfort — usually one, ONLY on wellness-category products.
- Affirming/inclusive: queer-affirming, trans-affirming, women-focused, men-focused, inclusive — usually one or two.
- Gift sub-category: gift, gift-set, party-favor, self-gift — pick the most specific that applies.

PRODUCT-TYPE SELF-RESTRICTION:
- Wellness slugs (kegel-training, postpartum, prostate-health, erectile-support, menstrual-comfort) only apply to wellness/specific product types. Don't tag a vibrator as \`kegel-training\` unless it's actually a kegel device.
- Affirming slugs (queer-affirming, trans-affirming, women-focused, men-focused) based on actual product positioning, not assumption from category.
${opts.deal.productTypeDial ? `- This product's type is "${opts.deal.productTypeDial}" — keep tags consistent with what fits this category.` : ''}

CROSS-FIELD NOTE: Some slugs (valentine, pride, holiday, gift, gift-set, long-distance, first-time) also appear in the IVR features vocabulary. There, they describe what the product IS (Pride-edition design, has rainbow colors). Here, they describe WHEN/WHY to use it (good for Pride parties, good for Valentine's gift). A product may legitimately tag the same slug in both fields — that's intentional.

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "useCases": ["slug-one", "slug-two"] }`

  try {
    const { text } = await callClaude({
      llmClient: opts.llmClient,
      model:     MODEL_FAST,
      maxTokens: 200,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user,
    })
    const parsed = JSON.parse(stripFences(text)) as { useCases?: unknown }
    if (!Array.isArray(parsed.useCases)) return []
    const allowed = new Set<string>(IVR_USE_CASES as readonly string[])
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of parsed.useCases) {
      if (typeof raw !== 'string') continue
      const slug = raw.trim().toLowerCase()
      if (!allowed.has(slug) || seen.has(slug)) continue
      seen.add(slug)
      out.push(slug)
      if (out.length >= 5) break
    }
    return out
  } catch (err) {
    console.error('[generateIvrUseCase] failed:', err)
    return []
  }
}

/** 3–8 feature slugs from a fixed voice-surface vocabulary (104 slugs post-Phase 1 expansion).
 *  Spoken aloud by Emma when filtering. Honest tagging is critical — false claims break trust
 *  immediately. */
export async function generateIvrFeatures(opts: { deal: IvrDealCtx; llmClient?: LLMClient }): Promise<string[]> {
  const user = `Pick 3–8 features that are TRUE for this product, from this exact vocabulary:
${IVR_FEATURES.map(s => `- ${s}`).join('\n')}

HONEST TAGGING — STRICT.
- For OBJECTIVE slugs (waterproof, rechargeable, usb-c, silicone, body-safe, phthalate-free, latex-free, hypoallergenic, vegan, app-controlled, bluetooth, magnetic-charging, etc.): tag ONLY when the product description supports it. Don't infer from category.
- For SUBJECTIVE slugs (rumbly, buzzy, gentle, intense, powerful, luxury, premium, discreet, beginner-friendly): tag ONLY when the description strongly supports it. Default to OMISSION when ambiguous.
- These get spoken aloud by Emma when filtering ("looking for something quiet and waterproof"). False claims break shopper trust immediately.

MUTUAL-EXCLUSIVITY HINTS (soft guidance — usually pick at most one within each facet):
- Size: mini, compact, small, medium, large, xl, xxl, oversized, plus-size, queen-size, curvy, slim, girthy
- Material primary: silicone, glass, metal, wood, leather, vegan-leather, faux-leather
- Lube base: water-based, silicone-based, hybrid, oil-based (none for non-lubes)
- Identity/edition: pride, rainbow, pride-edition, holiday, valentine

PRODUCT-TYPE SELF-RESTRICTION:
- Only tag features that apply to the product type. Don't tag \`harness-compatible\` on a lube, \`condom-safe\` on a vibrator, \`flared-base\` on a non-anal toy, \`water-based\`/\`silicone-based\`/\`hybrid\`/\`oil-based\` on anything that isn't a lubricant, etc.
${opts.deal.productTypeDial ? `- This product's type is "${opts.deal.productTypeDial}" — only pick features that genuinely fit this category.` : ''}

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "features": ["slug-one", "slug-two"] }`

  try {
    const { text } = await callClaude({
      llmClient: opts.llmClient,
      model:     MODEL_FAST,
      maxTokens: 300,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user,
    })
    const parsed = JSON.parse(stripFences(text)) as { features?: unknown }
    if (!Array.isArray(parsed.features)) return []
    const allowed = new Set<string>(IVR_FEATURES as readonly string[])
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of parsed.features) {
      if (typeof raw !== 'string') continue
      const slug = raw.trim().toLowerCase()
      if (!allowed.has(slug) || seen.has(slug)) continue
      seen.add(slug)
      out.push(slug)
      if (out.length >= 8) break
    }
    return out
  } catch (err) {
    console.error('[generateIvrFeatures] failed:', err)
    return []
  }
}

/**
 * Consolidated IVR generator — picks experience levels, use-case slugs, and
 * feature slugs in a SINGLE Haiku round trip. Replaces three legacy calls
 * (generateIvrExperience + generateIvrUseCase + generateIvrFeatures) with
 * one, cutting per-call system-prompt overhead by 3× and the deal-context
 * block by 3× before caching savings layer on top. Vocabularies and
 * honest-tagging rules are preserved from the legacy prompts. Returns each
 * field independently so a partial parse failure on one axis does not blank
 * the others.
 */
export async function generateIvrAll(opts: {
  deal:       IvrDealCtx
  llmClient?: LLMClient
}): Promise<{ experience: IvrExperience; useCases: string[]; features: string[] }> {
  const user = `Pick three independent things for this product in a single response: experience levels, use cases, and features. Each axis has its own rules — apply them honestly.

EXPERIENCE LEVELS (multi-select, 1–4 from this list):
${IVR_EXPERIENCE_LEVELS.join(' | ')}

- "first-time": gentle, simple controls, low intensity.
- "curious": exploring beyond the basics, slightly ambitious but approachable.
- "experienced": comfortable with the category, looking for variety or upgrades.
- "advanced": high-intensity, niche, or technique-heavy.
- A versatile product can hit multiple levels. Be honest — only include a level the product genuinely serves.

USE CASES (2–5 slugs from this exact vocabulary):
${IVR_USE_CASES.map(s => `- ${s}`).join('\n')}

- Objective slugs (travel = portable; long-distance = remote/app control): tag based on spec support.
- Subjective slugs (spice-up, partner-surprise, kink-curious, role-play, etc.): tag ONLY when the description strongly supports it. Default to OMISSION when ambiguous.
- Mutual-exclusivity hints — usually pick at most one within each facet:
  · Occasion: anniversary, honeymoon, valentine, birthday, bachelorette, pride, holiday.
  · Wellness/health: pelvic-floor, kegel-training, postpartum, menopause, libido-boost, prostate-health, erectile-support, menstrual-comfort — usually one, ONLY on wellness-category products.
  · Affirming/inclusive: queer-affirming, trans-affirming, women-focused, men-focused, inclusive — usually one or two.
  · Gift sub-category: gift, gift-set, party-favor, self-gift — pick the most specific.
- Wellness slugs apply only to wellness/specific product types. Affirming slugs based on actual product positioning.
${opts.deal.productTypeDial ? `- This product's type is "${opts.deal.productTypeDial}" — keep tags consistent with what fits this category.` : ''}

FEATURES (3–8 slugs from this exact vocabulary):
${IVR_FEATURES.map(s => `- ${s}`).join('\n')}

- Objective slugs (waterproof, rechargeable, usb-c, silicone, body-safe, app-controlled, bluetooth, etc.): tag ONLY when the description supports it. Don't infer from category.
- Subjective slugs (rumbly, buzzy, gentle, intense, powerful, luxury, premium, discreet, beginner-friendly): tag ONLY when the description strongly supports it.
- These get spoken aloud by Emma when filtering. False claims break shopper trust immediately.
- Mutual-exclusivity hints:
  · Size: mini, compact, small, medium, large, xl, xxl, oversized, plus-size, queen-size, curvy, slim, girthy.
  · Material primary: silicone, glass, metal, wood, leather, vegan-leather, faux-leather.
  · Lube base: water-based, silicone-based, hybrid, oil-based (none for non-lubes).
  · Identity/edition: pride, rainbow, pride-edition, holiday, valentine.
- Don't tag harness-compatible on a lube, condom-safe on a vibrator, flared-base on a non-anal toy, or any lube-base slug on anything that isn't a lubricant.
${opts.deal.productTypeDial ? `- This product's type is "${opts.deal.productTypeDial}" — only pick features that genuinely fit this category.` : ''}

CROSS-FIELD: a slug like 'pride' can appear in both useCases (good for Pride parties) AND features (Pride-edition design) — that's intentional when both apply.

${ivrProductBlock(opts.deal)}

Return ONLY this JSON shape (no markdown, no preamble):
{ "experience": ["first-time"], "useCases": ["slug-one","slug-two"], "features": ["slug-one","slug-two","slug-three"] }`

  type ParsedIvr = { experience?: unknown; useCases?: unknown; features?: unknown }
  let parsed: ParsedIvr | null = null
  try {
    const { text } = await callClaude({
      llmClient: opts.llmClient,
      model:     MODEL_FAST,
      maxTokens: 500,
      systemBlocks: await buildEmmaSystemBlocks(),
      userPrompt: user,
    })
    const cleaned = stripFences(text)
    try {
      parsed = JSON.parse(cleaned) as ParsedIvr
    } catch {
      // Extract the first top-level `{ ... }` block — handles cases where the
      // model adds prose around the JSON or trails a stray character. Cheaper
      // than running three legacy generators on a single parse hiccup.
      const match = cleaned.match(/\{[\s\S]*?\}\s*$/m) ?? cleaned.match(/\{[\s\S]*\}/)
      if (match) {
        try { parsed = JSON.parse(match[0]) as ParsedIvr } catch { /* fall through */ }
      }
      if (!parsed) {
        console.error('[generateIvrAll] could not extract JSON from response:', cleaned.slice(0, 300))
      }
    }
  } catch (err) {
    console.error('[generateIvrAll] failed:', err)
  }
  if (!parsed) parsed = {}

  const experience: IvrExperience = Array.isArray(parsed.experience)
    ? (() => {
        const valid = new Set<string>(IVR_EXPERIENCE_LEVELS as readonly string[])
        const out: IvrExperienceValue[] = []
        const seen = new Set<string>()
        for (const item of parsed.experience as unknown[]) {
          if (typeof item !== 'string') continue
          const v = item.trim().toLowerCase()
          if (!valid.has(v) || seen.has(v)) continue
          seen.add(v)
          out.push(v as IvrExperienceValue)
          if (out.length >= 4) break
        }
        return out
      })()
    : []

  const useCases: string[] = Array.isArray(parsed.useCases)
    ? (() => {
        const allowed = new Set<string>(IVR_USE_CASES as readonly string[])
        const out: string[] = []
        const seen = new Set<string>()
        for (const raw of parsed.useCases as unknown[]) {
          if (typeof raw !== 'string') continue
          const slug = raw.trim().toLowerCase()
          if (!allowed.has(slug) || seen.has(slug)) continue
          seen.add(slug)
          out.push(slug)
          if (out.length >= 5) break
        }
        return out
      })()
    : []

  const features: string[] = Array.isArray(parsed.features)
    ? (() => {
        const allowed = new Set<string>(IVR_FEATURES as readonly string[])
        const out: string[] = []
        const seen = new Set<string>()
        for (const raw of parsed.features as unknown[]) {
          if (typeof raw !== 'string') continue
          const slug = raw.trim().toLowerCase()
          if (!allowed.has(slug) || seen.has(slug)) continue
          seen.add(slug)
          out.push(slug)
          if (out.length >= 8) break
        }
        return out
      })()
    : []

  return { experience, useCases, features }
}

// ─── Emma Curated Rails (agentic, tool-use loop) ─────────────────────────────
// ─── Emma context-group picker ──────────────────────────────────────────────
// Used by the homepage "Emma picks" rails. Called at midnight deal rotation
// (plus admin/brief-change/lazy fallbacks) — never per page view. Uses prompt
// caching: SYSTEM_PROMPT + hero context block are cache_control-tagged so the
// first group per deal pays full cost and subsequent groups read from cache.

export interface ContextPickCandidate {
  id:          string          // Shopify product GID
  handle:      string
  title:       string
  brand?:      string
  tags?:       string[]
  productType?: string
  price?:      number
  blurb?:      string          // 1-line description
}

export interface ContextPickInput {
  hero: {
    handle:      string
    title:       string
    brand?:      string
    tagline?:    string
    category?:   string
    tags?:       string[]
    dealPrice?:  number
    moodTags?:   string[]
    audienceTags?: string[]
    mattersTags?: string[]
  }
  group: {
    name:        string
    kind:        'pairing' | 'alternative' | 'adjacent'
    emmaContext: string
  }
  candidates:    ContextPickCandidate[]
  maxPicks:      number
}

export interface ContextPickResult {
  picks: Array<{ id: string; pairingWhy: string }>
  tokens: {
    input:  number
    output: number
    cacheCreation: number
    cacheRead:     number
  }
}

function kindBrief(kind: ContextPickInput['group']['kind']): string {
  switch (kind) {
    case 'pairing':     return 'Pick products that go WELL WITH the hero deal — complements, add-ons, or things that make the hero better.'
    case 'alternative': return 'Pick products that someone who skipped the hero deal might love instead — same vibe or satisfaction, different form factor.'
    case 'adjacent':    return 'Pick products that share the hero\u2019s mood or moment — adjacent in category, not direct pairs or alternatives.'
  }
}

export async function pickForContextGroup(input: ContextPickInput): Promise<ContextPickResult> {
  const hero = input.hero
  const heroBlock = [
    `HERO DEAL (what\u2019s in the sale box right now)`,
    `Title: ${hero.title}`,
    hero.brand    ? `Brand: ${hero.brand}` : '',
    hero.tagline  ? `Tagline: ${hero.tagline}` : '',
    hero.category ? `Category: ${hero.category}` : '',
    hero.dealPrice != null ? `Deal price: $${hero.dealPrice.toFixed(2)}` : '',
    hero.tags?.length         ? `Tags: ${hero.tags.join(', ')}` : '',
    hero.moodTags?.length     ? `Mood: ${hero.moodTags.join(', ')}` : '',
    hero.audienceTags?.length ? `Audience: ${hero.audienceTags.join(', ')}` : '',
    hero.mattersTags?.length  ? `Matters: ${hero.mattersTags.join(', ')}` : '',
  ].filter(Boolean).join('\n')

  const candidateLines = input.candidates.map((c, i) => {
    const bits = [
      `${i + 1}. id=${c.id}`,
      `handle=${c.handle}`,
      `title="${c.title}"`,
      c.brand       ? `brand=${c.brand}` : '',
      c.productType ? `type=${c.productType}` : '',
      c.price != null ? `price=$${c.price.toFixed(2)}` : '',
      c.tags?.length ? `tags=[${c.tags.slice(0, 6).join(',')}]` : '',
      c.blurb       ? `blurb=${c.blurb.slice(0, 120)}` : '',
    ].filter(Boolean)
    return bits.join(' | ')
  }).join('\n')

  const userPrompt = `GROUP BRIEF
Name: ${input.group.name}
Kind: ${input.group.kind} \u2014 ${kindBrief(input.group.kind)}
Context from editor: ${input.group.emmaContext}

CANDIDATES (pick from these only; exclude the hero deal):
${candidateLines}

TASK
Pick the best ${input.maxPicks} products from the candidates above. For each pick, write Emma\u2019s 12\u201320 word first-person aside explaining why it fits with the hero deal in *this* group\u2019s context.

Voice rules (must follow):
- First person ("been testing these side by side", "I keep coming back to this one").
- Never "Buy now", "limited time", "until midnight", or any countdown language.
- Never use "sex" as an adjective \u2014 use intimate, pleasure, wellness, slow-burn.
- Never assume the reader\u2019s experience level.
- Tasteful and warm. Suggestive OK, explicit not OK.
- Use \u2665 sparingly (at most one per group).

Return STRICT JSON only, no markdown fences:
{ "picks": [{ "id": "<product GID>", "pairingWhy": "<12\u201320 word aside>" }, ...] }

Return exactly ${input.maxPicks} picks, ordered best\u2192worst. Use only ids from the candidates list.`

  const msg = await client.messages.create({
    model: MODEL_FAST,
    max_tokens: 1500,
    // Cache the brand voice + hero context across groups within the same deal
    // rotation. Ephemeral cache TTL ~5m; a midnight pass finishes in seconds.
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: heroBlock,     cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  })

  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error('pickForContextGroup: unexpected response type')

  let parsed: { picks: Array<{ id: string; pairingWhy: string }> }
  try {
    parsed = JSON.parse(stripFences(block.text)) as typeof parsed
  } catch {
    const match = block.text.match(/\{[\s\S]*"picks"[\s\S]*\}/)
    if (!match) throw new Error('pickForContextGroup: could not parse JSON response')
    parsed = JSON.parse(match[0]) as typeof parsed
  }

  const validIds = new Set(input.candidates.map(c => c.id))
  const picks = (parsed.picks ?? [])
    .filter(p => p && typeof p.id === 'string' && typeof p.pairingWhy === 'string' && validIds.has(p.id))
    .slice(0, input.maxPicks)

  const usage = msg.usage as (typeof msg.usage) & {
    cache_creation_input_tokens?: number
    cache_read_input_tokens?:     number
  }

  return {
    picks,
    tokens: {
      input:         usage?.input_tokens ?? 0,
      output:        usage?.output_tokens ?? 0,
      cacheCreation: usage?.cache_creation_input_tokens ?? 0,
      cacheRead:     usage?.cache_read_input_tokens ?? 0,
    },
  }
}

// ─── Emma Curated Rails (agentic, tool-use loop) ─────────────────────────────

export interface GenerateRailsResult {
  rails: RailProposal[]
  pairingWhy: PairingWhyProposal[]
  candidatePoolSize: number
  turns: number
}

/**
 * Multi-turn agent loop where Emma reasons over the catalog and proposes rails.
 * Stops when the model emits stop_reason "end_turn" or hits MAX_TURNS.
 */
export async function generateRails(opts: {
  deal: Deal
  partner?: Deal
  accessories?: { id: string; title: string; brand?: string }[]
  brandVoice?: string
}): Promise<GenerateRailsResult> {
  const { deal, partner, accessories = [] } = opts
  const brandVoice = opts.brandVoice ?? (await getPipelineSetting('brandVoice')) ?? DEFAULT_BRAND_VOICE

  const pool = await buildCandidatePool(deal, partner)
  const state = createRailGenState([deal.handle, partner?.handle].filter(Boolean) as string[])

  const dealContext = [
    `Title: ${deal.seoTitle}`,
    `Brand: ${deal.brand}`,
    `Category: ${deal.category.join(', ')}`,
    deal.tagline ? `Tagline: ${deal.tagline}` : '',
    deal.audienceTags?.length ? `Audience tags: ${deal.audienceTags.join(', ')}` : '',
    deal.moodTags?.length     ? `Mood tags: ${deal.moodTags.join(', ')}` : '',
    deal.mattersTags?.length  ? `Matters tags: ${deal.mattersTags.join(', ')}` : '',
  ].filter(Boolean).join('\n')

  const partnerContext = partner ? `\n\nPaired with:\n- Title: ${partner.seoTitle}\n- Brand: ${partner.brand}\n- Category: ${partner.category}` : ''

  const accessoryContext = accessories.length
    ? `\n\nAccessories that need pairing_why blurbs (call propose_pairing_why once each):\n${accessories.map(a => `- ${a.id} — ${a.title}${a.brand ? ` (${a.brand})` : ''}`).join('\n')}`
    : ''

  const system = `${EMMA_SYSTEM_PROMPT}\n\n${brandVoice}

You are curating cross-sell rails for an editorial storefront. Your goal: propose 2 rails for the product detail page (target: "pdp") and 1 rail for the homepage (target: "homepage"). Each rail must include 4–8 products, a short Emma-voice aside, and a one-sentence rationale.

Rules:
- Use list_candidate_pool first to see what's available. Only fall back to query_products_by_tag/collection if the pool is thin.
- Never include the primary deal product or its pair partner in any rail.
- Each rail should have a clear theme (a mood, an audience, a use case) — not a random grab bag.
- The "emmaAside" is first-person and short ("been pairing these all month", "the trio I keep recommending").
- The rail "heading" is a confident editorial label, 3–7 words. Never "buy now" / "shop now".
- After all rails and pairing_why blurbs are proposed, simply stop responding (end_turn). Do not summarize.`

  const userPrompt = `Deal context:\n${dealContext}${partnerContext}${accessoryContext}\n\nStart by inspecting list_candidate_pool, then propose 2 PDP rails + 1 homepage rail using propose_rail.${accessories.length ? ' Then propose one pairing_why blurb per accessory.' : ''}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: 'user', content: userPrompt }]
  const MAX_TURNS = 8
  let turn = 0

  console.log(`[generateRails] starting. pool=${pool.length} deal=${deal.handle}${partner ? ` partner=${partner.handle}` : ''}`)

  while (turn < MAX_TURNS) {
    turn++
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: RAIL_TOOLS as any,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textParts = response.content.filter((b: any) => b.type === 'text') as { text: string }[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUses = response.content.filter((b: any) => b.type === 'tool_use') as { name: string; input: unknown }[]
    console.log(
      `[generateRails] turn ${turn}: stop=${response.stop_reason} tools=[${toolUses.map(t => t.name).join(', ') || 'none'}]${textParts[0]?.text ? ` text="${textParts[0].text.slice(0, 120).replace(/\s+/g, ' ')}"` : ''}`,
    )

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') break

    if (toolUses.length === 0) break

    const toolResults = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (toolUses as any[]).map(async tu => {
        try {
          const result = await executeRailTool(tu.name, tu.input, state, pool)
          return {
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          }
        } catch (err) {
          return {
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            is_error: true,
            content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      }),
    )

    messages.push({ role: 'user', content: toolResults })
  }

  console.log(`[generateRails] completed in ${turn} turns. ${state.rails.length} rails, ${state.pairingWhy.length} blurbs.`)

  return {
    rails: state.rails,
    pairingWhy: state.pairingWhy,
    candidatePoolSize: pool.length,
    turns: turn,
  }
}
