import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import type {
  Deal, EmmaHeroCopy, EmmaHeroVariant, GenerateCopyRequest, GenerateCopyResult, ProductScore,
  SensationDialV2, SensationDialItem, DialValue, ProductTypeDial, CareInstructions,
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

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })

// Tiered models: HAIKU for short/templated copy (~20× cheaper), SONNET for
// long-form narrative and structured tasks (full_story, specs, schedule, blog).
const MODEL      = 'claude-sonnet-4-20250514'
const MODEL_FAST = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `You are the voice of xdipx.com, a daily flash-sale site for sexual wellness products.
Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy.
Write as a trusted, funny friend who isn't embarrassed about the topic. Your goal is to welcome first-time buyers and delight experienced ones.
Keep all copy tasteful. Suggestive is fine, explicit is not.
Always signal discretion, value, and trust.
Never use "sex" as an adjective. Use "intimate", "pleasure", or "wellness".
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
): Promise<string> {
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })
  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error('Unexpected Claude response type')
  return block.text
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

/** Map copy type → keyword bank content-type so the right keywords surface. */
function resolveSeoContentType(type: GenerateCopyRequest['type']): SeoContentType {
  if (type === 'blog_article') return 'blog'
  return 'pdp'
}

export async function generateCopy(req: GenerateCopyRequest): Promise<GenerateCopyResult> {
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

  const productContextBase = `Product: ${product.title}\nBrand: ${product.brand}\nDescription: ${product.description}\nCategories: ${product.categories.join(', ')}${product.dealPrice ? `\nDeal price: $${product.dealPrice} (was $${product.msrp})` : ''}`
  const productContext = keywordBlock
    ? `${productContextBase}\n\n${keywordBlock}`
    : productContextBase

  switch (type) {
    case 'tagline': {
      const primaryPrompt = `Write 3 one-sentence taglines for the following product. Be genuinely funny — irreverent, witty, puns welcome. Think: a comedian friend who loves these products and has zero shame. Tasteful but not boring. Max 12 words each. Return as a JSON array of strings (no markdown).\n\n${productContext}`
      const retryPrompt   = `Return exactly one short funny sentence as a product tagline. No JSON, no newlines, no lists, no quotes. Just the sentence.\n\n${productContext}`

      const raw = await generate(primaryPrompt, 1024, MODEL_FAST)
      try {
        const parsed = JSON.parse(stripFences(raw)) as string[]
        const first = Array.isArray(parsed) ? parsed.find(s => typeof s === 'string' && s.trim()) : null
        if (first) return { type, content: parsed }
      } catch { /* fall through to retry */ }

      const retried = await generate(retryPrompt, 1024, MODEL_FAST)
      const line = retried.trim().split('\n')[0]?.trim()
      if (line) return { type, content: [line] }

      return { type, content: [`${product.brand} ${product.title} — today only at xdipx.`] }
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

      const raw = await generate(primaryPrompt, 1024, MODEL_FAST)
      try {
        const parsed = JSON.parse(stripFences(raw)) as string[]
        if (Array.isArray(parsed) && parsed.length >= 3) return { type, content: parsed }
      } catch { /* fall through */ }

      const retried = await generate(retryPrompt, 1024, MODEL_FAST)
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
      const discount = product.dealPrice && product.msrp && product.msrp > 0
        ? `${Math.round(100 - (product.dealPrice / product.msrp) * 100)}% off`
        : 'Best price'
      const primaryPrompt = `Write a 140–155 character SEO meta description for this product. Format: "[Discount or 'Best price']. [1-sentence benefit]. Ships discreet. $[price] at xdipx." Return only the meta description, no quotes.\n\n${productContext}`
      const retryPrompt   = `Write a single SEO meta description between 140 and 155 characters. Return only the description — no quotes, no labels, no explanation.\n\n${productContext}`

      const text = await generate(primaryPrompt, 1024, MODEL_FAST)
      const cleaned = text.replace(/^["']|["']$/g, '').trim()
      if (cleaned.length >= 50) return { type, content: cleaned.slice(0, 155) }

      const retried = await generate(retryPrompt, 1024, MODEL_FAST)
      const cleanedRetry = retried.replace(/^["']|["']$/g, '').trim()
      if (cleanedRetry.length >= 50) return { type, content: cleanedRetry.slice(0, 155) }

      const fallback = `${discount} on ${product.brand} ${product.title}. Ships discreetly. ${product.dealPrice ? `$${product.dealPrice} ` : ''}at xdipx.com.`
      return { type, content: fallback.slice(0, 155) }
    }

    case 'box_contents': {
      const primaryPrompt = `Extract what is physically included in the box for this product from the description below. Return a JSON array of short strings (one item per element), e.g. ["1x vibrator", "1x USB charging cable", "1x storage pouch"]. If the description doesn't mention box contents, infer the most likely inclusions based on the product type. Return only the JSON array, no markdown.\n\n${productContext}`
      const retryPrompt   = `Return ONLY a JSON array of what's in the box. Example: ["1x vibrator", "1x USB cable"]. Nothing else — no markdown, no prose, no explanation.\n\n${productContext}`

      const raw = await generate(primaryPrompt, 1024, MODEL_FAST)
      try {
        const parsed = JSON.parse(stripFences(raw)) as string[]
        if (Array.isArray(parsed) && parsed.length >= 1) return { type, content: parsed }
      } catch { /* fall through */ }

      const retried = await generate(retryPrompt, 1024, MODEL_FAST)
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

      const raw = await generate(primaryPrompt, 512, MODEL_FAST)
      try {
        const parsed = JSON.parse(stripFences(raw))
        if (isValid(parsed)) return { type, content: parsed }
      } catch { /* fall through */ }

      const retried = await generate(retryPrompt, 512, MODEL_FAST)
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

      const retryPrompt = `Return ONLY raw JSON matching this exact shape: {"eyebrow","subhead","headline","body","bannerLine","primaryTag","partnerTag","knotCaption","whyCards":[{"head","body"},{"head","body"},{"head","body"}],"emmaQuote","momentTitle","moments":[{"lead","body"},{"lead","body"}]}.\n\n${voiceRules}\n\n${pairContext}`

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

      const raw = await generate(primaryPrompt, 1800, MODEL_FAST)
      try {
        const parsed = JSON.parse(stripFences(raw))
        if (isValid(parsed)) return { type, content: wrap(parsed) }
      } catch { /* fall through */ }

      const retried = await generate(retryPrompt, 1800, MODEL_FAST)
      try {
        const parsed = JSON.parse(stripFences(retried))
        if (isValid(parsed)) return { type, content: wrap(parsed) }
      } catch { /* fall through */ }

      return { type, content: staticFallback() }
    }

    case 'specifications': {
      const primaryPrompt = `Extract and format the technical specifications from this product description into clean, readable HTML. Use a <table> with two columns (spec name + value) if there are 4+ specs, otherwise use a <ul> list. Include: dimensions, materials, power source, charge time, run time, waterproofing, colors, and any other objective specs. If a spec is not mentioned, omit it. No fluff or marketing copy — just the facts. Return only the HTML, no markdown, no wrapper tags.\n\n${productContext}`
      const retryPrompt   = `Return ONLY HTML starting with <table> or <ul> containing the technical specs from this product description. No markdown, no explanation, no preamble.\n\n${productContext}`

      const text = await generate(primaryPrompt, 2048)
      if (text.includes('<')) return { type, content: text }

      const retried = await generate(retryPrompt, 2048)
      if (retried.includes('<')) return { type, content: retried }

      return { type, content: `<ul><li>${product.description.slice(0, 500)}</li></ul>` }
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
}

export interface GenerateProductTitleResult {
  title:         string   // Final title (raw OR augmented)
  augmented:     boolean  // True when a descriptor was appended
  originalTitle: string   // The raw manufacturer title verbatim
  reason:        string   // One-line explanation: why augmented or why not
}

const PRODUCT_TYPE_DESCRIPTOR_FALLBACK: Record<ProductTypeDial, string> = {
  'air-pulsation': 'Air-Pulse Stimulator',
  'vibrator':      'Vibrator',
  'wand':          'Wand Vibrator',
  'lube':          'Lubricant',
  'wear':          'Wearable',
}

/**
 * Decide whether to augment a manufacturer's product title with an SEO
 * descriptor. Preserves branded names verbatim ("Sona 2 Cruise") and only
 * appends ONE category descriptor to abstract titles ("Eclipse 7" → "Eclipse 7
 * Wand Vibrator"). Never invents claims.
 *
 * Runs Sonnet (the decision is nuanced — Haiku gets fooled by "Couples Kit").
 * Hard-cap final title at 70 chars.
 */
export async function generateProductTitle(
  input: GenerateProductTitleInput,
): Promise<GenerateProductTitleResult> {
  const original = input.rawTitle.trim()
  const fallbackDescriptor = PRODUCT_TYPE_DESCRIPTOR_FALLBACK[input.productTypeDial] ?? 'Vibrator'

  // Cheap heuristic short-circuit: titles that already contain a category word
  // get returned as-is without burning a Claude call. Saves ~half the catalog
  // from the API hit while still letting Sonnet make the close calls.
  const PRODUCT_TYPE_WORDS = /\b(vibrator|wand|massager|stimulator|stroker|lube|lubricant|gel|harness|plug|ring|sleeve|kit|set|bullet|toy|cleaner|warming|cooling|edible|wearable|panty|dildo)\b/i
  if (PRODUCT_TYPE_WORDS.test(original) && original.length >= 12) {
    return {
      title:         original.slice(0, 70),
      augmented:     false,
      originalTitle: original,
      reason:        'title already descriptive',
    }
  }

  const keywordBlock = input.keywordBlock ?? ''
  const userPrompt = `Decide whether this manufacturer product title needs an SEO descriptor appended.

Raw manufacturer title: "${input.rawTitle}"
Brand / vendor: ${input.brand || input.vendor || '(unknown)'}
Product type (dial): ${input.productTypeDial}
${input.rawDescription ? `Description (first 400 chars): ${input.rawDescription.slice(0, 400)}` : ''}
${keywordBlock || ''}

Rules (in priority order):
1. PRESERVE branded names verbatim — never rewrite "Sona 2 Cruise", "Magic Wand Original", numbered model names. Treat the manufacturer's chosen name as a proper noun.
2. LEAVE FULLY-DESCRIPTIVE titles alone — if the title already contains a product-type word ("wand", "vibrator", "lube", "harness", "plug", "ring", "stimulator", "massager", "kit", "set", etc.) OR a clear functional descriptor, return augmented=false with the original title.
3. AUGMENT abstract titles — when no descriptor is present, APPEND ONE concise descriptor after the branded name with a single space (no em-dash, no colon). Example: "Eclipse 7" → "Eclipse 7 Wand Vibrator".
4. Pull the descriptor from the dial classification + (if a <keyword_targets> block is provided) primary keyword terms that match this dial. If nothing matches, fall back to: ${fallbackDescriptor}.
5. NEVER invent claims — descriptors describe form factor / category only, not benefits ("quiet", "rechargeable", etc.).
6. Cap final title at 70 chars total.
7. NEVER use em-dashes ("—") or en-dashes ("–"). Hyphens in compound words ("soft-touch") are fine.

Return ONLY raw JSON (no markdown):
{"title":"<final title>","augmented":<true|false>,"reason":"<one short sentence>"}`

  let raw: string
  try {
    raw = await generate(userPrompt, 256, MODEL)
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
    raw = await generate(userPrompt, 800, MODEL)
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
}): Promise<{ mainTweet: string; threadReply?: string }> {
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

  const first = await generate(primaryPrompt, 512, MODEL_FAST)
  const firstParsed = tryParse(first)
  if (firstParsed) return firstParsed

  const retried = await generate(retryPrompt, 512, MODEL_FAST)
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

const DEFAULT_BRAND_VOICE = `Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy. Write as a trusted, funny friend who isn't embarrassed about the topic. Keep copy tasteful — suggestive is fine, explicit is not. Never use "sex" as an adjective — use "intimate", "pleasure", or "wellness". Never "Buy now" — use "Take a peek →" or "I'll take it ♥". Never surface a countdown or "until midnight." Always include a short first-person aside ("been living on my desk," "telling everyone about this combo"). Never assume the reader's experience level.`

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

  const system = `${EMMA_SYSTEM_PROMPT}\n\n${brandVoice}`

  const user = `Write the Emma hero block for the homepage of xdipx.com. Variant: "${variant}".

Product context (do NOT echo — rewrite in Emma's voice):
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category}
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
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: 800,
          system,
          messages: [{ role: 'user', content: user }],
        })
        const block = msg.content[0]
        if (block?.type !== 'text') throw new Error('non-text response')
        const parsed = JSON.parse(stripFences(block.text)) as Partial<EmmaHeroCopy>
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
}): Promise<string> {
  const brandVoice = opts.brandVoice ?? (await getPipelineSetting('brandVoice')) ?? DEFAULT_BRAND_VOICE
  const system = `${EMMA_SYSTEM_PROMPT}\n\n${brandVoice}`

  const user = `Write Emma's "take" on this product. It will appear in the Emma's take tab on the product page — a friend-to-friend honest read.

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category}
${opts.deal.productTypeDial ? `- Type: ${opts.deal.productTypeDial}` : ''}
${opts.deal.tagline ? `- Tagline (context): ${opts.deal.tagline}` : ''}
${opts.deal.fullStory ? `- Existing story (context, strip HTML): ${opts.deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 600)}` : ''}

Cover, in this order, in your own voice (no headings, just flowing paragraphs):
1. Who this clicks for — what they're after, what they'll like.
2. Who might want to skip — be specific. Honest. No marketing fudge.
3. How to get the most out of it — a tip Emma would whisper to a friend.

Constraints:
- 120–200 words total. Two short paragraphs maximum.
- Return clean HTML — only <p>, <em>, <strong> tags. No headings, no <ul>, no inline styles, no class attrs.
- First-person Emma voice throughout. No "Buy now". No countdowns. No clinical language.
- Do NOT mention price, MAP, or discounts.
- Do NOT echo the product title in the first sentence.

Return ONLY the HTML — no markdown, no fences, no preamble.`

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system,
      messages: [{ role: 'user', content: user }],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') throw new Error('non-text response')
    return stripFences(block.text).trim()
  } catch (err) {
    console.error('[generateEmmaTake] failed:', err)
    throw err
  }
}

/**
 * Generate 3–5 short imperative care bullets for a product. Haiku-fast.
 */
export async function generateCareInstructions(opts: {
  deal: Pick<Deal, 'seoTitle' | 'brand' | 'category' | 'productTypeDial' | 'specifications'>
}): Promise<CareInstructions> {
  const user = `Write 3 to 5 short care instructions for this product. Each is one short imperative sentence — under 14 words.

Product:
- Title: ${opts.deal.seoTitle}
- Brand: ${opts.deal.brand}
- Category: ${opts.deal.category}
${opts.deal.productTypeDial ? `- Type: ${opts.deal.productTypeDial}` : ''}
${opts.deal.specifications ? `- Specs (HTML, context): ${opts.deal.specifications.replace(/<[^>]+>/g, ' ').slice(0, 500)}` : ''}

Cover what actually matters for this object — cleaning, charging/storage, lube compatibility (where relevant), what to avoid. Practical, not clinical.

Return ONLY a JSON array of strings. Example: ["Wipe with mild soap and warm water after each use.", "Air-dry before storing in the included pouch."]
No markdown, no fences, no commentary.`

  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 400,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') throw new Error('non-text response')
    const parsed = JSON.parse(stripFences(block.text)) as unknown
    if (!Array.isArray(parsed)) throw new Error('expected array')
    const bullets = parsed
      .filter((x): x is string => typeof x === 'string')
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.length <= 140)
      .slice(0, 5)
    if (bullets.length < 3) throw new Error(`only ${bullets.length} valid bullets returned`)
    return bullets
  } catch (err) {
    console.error('[generateCareInstructions] failed:', err)
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
- Category: ${opts.deal.category}
- Type: ${type}
${opts.deal.tagline ? `- Tagline: ${opts.deal.tagline}` : ''}
${opts.deal.fullStory ? `- Story (context, strip HTML): ${opts.deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 500)}` : ''}
${opts.deal.specifications ? `- Specs (HTML, context): ${opts.deal.specifications.replace(/<[^>]+>/g, ' ').slice(0, 400)}` : ''}

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

  const msg = await client.messages.create({
    model: MODEL_FAST,
    max_tokens: 600,
    system: EMMA_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: user }],
  })
  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error('non-text response')

  const parsed = JSON.parse(stripFences(block.text)) as { items?: Array<{ label?: unknown; value?: unknown; proposed?: unknown }> }
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

const PRODUCT_TYPE_DIALS: ProductTypeDial[] = ['air-pulsation', 'vibrator', 'wand', 'lube', 'wear']

/**
 * Classify a product into one of the five `product_type_dial` buckets so the
 * sensation-dial generator can pull the right preferred labels. Defaults to
 * 'vibrator' if Haiku is unsure — never returns null.
 */
export async function inferProductTypeDial(input: {
  title: string
  brand: string
  description: string
  categories: string[]
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
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 60,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') throw new Error('non-text response')
    const parsed = JSON.parse(stripFences(block.text)) as { type?: unknown }
    const t = typeof parsed.type === 'string' ? parsed.type.trim().toLowerCase() : ''
    if (PRODUCT_TYPE_DIALS.includes(t as ProductTypeDial)) return t as ProductTypeDial
  } catch (err) {
    console.error('[inferProductTypeDial] failed, defaulting to vibrator:', err)
  }
  return 'vibrator'
}

export type AskEmmaAxis = 'mood' | 'audience' | 'matters'

const ASK_EMMA_AXIS_GUIDANCE: Record<AskEmmaAxis, string> = {
  mood:     'How using this feels — the energy a shopper would gravitate to. Pick 1–3 that genuinely fit.',
  audience: 'Who this is for — solo, couples, or gifting. Pick 1–2.',
  matters:  'Practical features a shopper might filter on — quietness, travel-friendliness, beginner-friendliness, waterproof, rechargeable, hands-free, soft-touch material. Pick 2–4 that are TRUE for this product.',
}

/**
 * Generate slugified Ask Emma tags for a single axis. Strongly prefers the
 * supplied vocabulary so URL params like `?matters=soft-touch` round-trip
 * cleanly through the Collection filter rail. Model may propose new slugs
 * when none of the preferred labels fit; appended in admin triage (separate UI).
 */
export async function generateAskEmmaTags(opts: {
  deal: Pick<Deal, 'seoTitle' | 'brand' | 'category' | 'productTypeDial' | 'tagline' | 'fullStory' | 'specifications'>
  axis: AskEmmaAxis
  /** Current vocabulary for this axis (from Sanity askEmmaVocabulary). */
  preferredLabels: string[]
}): Promise<string[]> {
  const { deal, axis, preferredLabels } = opts

  const labelList = preferredLabels.length > 0
    ? preferredLabels.map(l => `- ${l}`).join('\n')
    : '(none — invent appropriate slugs)'

  const user = `Pick the Ask Emma tags for the "${axis}" axis on this product. ${ASK_EMMA_AXIS_GUIDANCE[axis]}

Product:
- Title: ${deal.seoTitle}
- Brand: ${deal.brand}
- Category: ${deal.category}
${deal.productTypeDial ? `- Type: ${deal.productTypeDial}` : ''}
${deal.tagline ? `- Tagline: ${deal.tagline}` : ''}
${deal.fullStory ? `- Story (context, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 400)}` : ''}
${deal.specifications ? `- Specs (HTML, context): ${deal.specifications.replace(/<[^>]+>/g, ' ').slice(0, 300)}` : ''}

Preferred slugs for "${axis}" (use these whenever they fit):
${labelList}

Rules:
- Return slugs in lowercase kebab-case (e.g. "soft-touch", not "Soft touch").
- Reuse a preferred slug exactly when it fits.
- Only invent a new slug if none of the preferred ones fit. Keep new slugs short (≤ 24 chars), generic enough to apply to other products.
- Do NOT invent synonyms of preferred slugs.
- Honest tagging — don't tag every option. If unsure, leave it out.

Return ONLY this JSON (no markdown): { "tags": ["slug-one", "slug-two"] }`

  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 200,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') throw new Error('non-text response')
    const parsed = JSON.parse(stripFences(block.text)) as { tags?: unknown }
    if (!Array.isArray(parsed.tags)) return []

    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of parsed.tags) {
      if (typeof raw !== 'string') continue
      const slug = raw.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      if (!slug || slug.length > 32 || seen.has(slug)) continue
      seen.add(slug)
      out.push(slug)
      if (out.length >= 5) break
    }
    return out
  } catch (err) {
    console.error(`[generateAskEmmaTags:${axis}] failed:`, err)
    return []
  }
}

// ─── IVR / voice-surface generators ──────────────────────────────────────────
// Purpose-built fields for chat / IVR / SMS where descriptionHtml can't render.
// Vocabularies are intentionally tight so Emma can speak them naturally aloud
// and downstream surfaces can match user intent without fuzzy NLP.

export const IVR_EXPERIENCE_LEVELS = ['first-time', 'curious', 'experienced', 'advanced', 'any'] as const
export type IvrExperience = typeof IVR_EXPERIENCE_LEVELS[number]

export const IVR_USE_CASES = ['date-night', 'travel', 'everyday', 'discovery', 'gift', 'celebration'] as const
export const IVR_FEATURES  = ['app-controlled', 'waterproof', 'rechargeable', 'quiet', 'travel-size', 'hands-free', 'soft-touch', 'pinpoint', 'full-coverage'] as const

type IvrDealCtx = Pick<
  Deal,
  'seoTitle' | 'brand' | 'category' | 'productTypeDial' | 'tagline' | 'fullStory' | 'specifications'
>

function ivrProductBlock(deal: IvrDealCtx): string {
  return [
    `- Title: ${deal.seoTitle}`,
    `- Brand: ${deal.brand}`,
    `- Category: ${deal.category}`,
    deal.productTypeDial ? `- Type: ${deal.productTypeDial}` : '',
    deal.tagline ? `- Tagline: ${deal.tagline}` : '',
    deal.fullStory ? `- Story (context, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 400)}` : '',
    deal.specifications ? `- Specs (context): ${deal.specifications.replace(/<[^>]+>/g, ' ').slice(0, 250)}` : '',
  ].filter(Boolean).join('\n')
}

/** Single experience-level enum: who this product fits best. */
export async function generateIvrExperience(opts: { deal: IvrDealCtx }): Promise<IvrExperience> {
  const user = `Pick the experience level this product fits best. One of: ${IVR_EXPERIENCE_LEVELS.join(' | ')}.

Use "first-time" for beginner-friendly products (gentle, simple controls, low intensity).
Use "curious" for someone exploring beyond the basics — slightly more ambitious but still approachable.
Use "experienced" for people comfortable with the category looking for variety or upgrades.
Use "advanced" for high-intensity, niche, or technique-heavy products.
Use "any" only when the product genuinely fits across all levels.

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "level": "first-time" }`

  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 60,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') throw new Error('non-text response')
    const parsed = JSON.parse(stripFences(block.text)) as { level?: unknown }
    const lvl = typeof parsed.level === 'string' ? parsed.level.trim().toLowerCase() : ''
    if ((IVR_EXPERIENCE_LEVELS as readonly string[]).includes(lvl)) return lvl as IvrExperience
  } catch (err) {
    console.error('[generateIvrExperience] failed:', err)
  }
  return 'any'
}

/** 1–3 use-case slugs from a fixed vocabulary, voice-friendly. */
export async function generateIvrUseCase(opts: { deal: IvrDealCtx }): Promise<string[]> {
  const user = `Pick 1–3 use cases this product fits, from this exact vocabulary:
${IVR_USE_CASES.map(s => `- ${s}`).join('\n')}

Honest tagging — only pick what genuinely fits. Skip rather than stretch.

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "useCases": ["slug-one", "slug-two"] }`

  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 100,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') throw new Error('non-text response')
    const parsed = JSON.parse(stripFences(block.text)) as { useCases?: unknown }
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
      if (out.length >= 3) break
    }
    return out
  } catch (err) {
    console.error('[generateIvrUseCase] failed:', err)
    return []
  }
}

/** 2–4 feature slugs from a fixed voice-surface vocabulary. */
export async function generateIvrFeatures(opts: { deal: IvrDealCtx }): Promise<string[]> {
  const user = `Pick 2–4 features that are TRUE for this product, from this exact vocabulary:
${IVR_FEATURES.map(s => `- ${s}`).join('\n')}

Honest tagging — these will be spoken aloud by Emma when filtering ("looking for something quiet and waterproof"). Don't tag something the product doesn't actually have.

${ivrProductBlock(opts.deal)}

Return ONLY this JSON (no markdown): { "features": ["slug-one", "slug-two"] }`

  try {
    const msg = await client.messages.create({
      model: MODEL_FAST,
      max_tokens: 120,
      system: EMMA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') throw new Error('non-text response')
    const parsed = JSON.parse(stripFences(block.text)) as { features?: unknown }
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
      if (out.length >= 4) break
    }
    return out
  } catch (err) {
    console.error('[generateIvrFeatures] failed:', err)
    return []
  }
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
    `Category: ${deal.category}`,
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
