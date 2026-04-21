import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import type { Deal, EmmaHeroCopy, EmmaHeroVariant, GenerateCopyRequest, GenerateCopyResult, ProductScore } from '~/types'
import { getPipelineSetting } from './feed-processor.server'

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })

// Tiered models: HAIKU for short/templated copy (~20× cheaper), SONNET for
// long-form narrative and structured tasks (full_story, specs, schedule, blog).
const MODEL      = 'claude-sonnet-4-20250514'
const MODEL_FAST = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `You are the voice of xdipx.com — a daily flash-sale site for sexual wellness products.
Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy.
Write as a trusted, funny friend who isn't embarrassed about the topic. Your goal is to welcome first-time buyers and delight experienced ones.
Keep all copy tasteful — suggestive is fine, explicit is not.
Always signal discretion, value, and trust.
Never use "sex" as an adjective — use "intimate", "pleasure", or "wellness".
Never assume the reader's experience level.
Always end descriptions with a curiosity hook that makes the reader want to try it.`

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

/** Strip markdown code fences that Claude sometimes wraps JSON in. */
function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
}

export async function generateCopy(req: GenerateCopyRequest): Promise<GenerateCopyResult> {
  const { type, product } = req
  const productContext = `Product: ${product.title}\nBrand: ${product.brand}\nDescription: ${product.description}\nCategories: ${product.categories.join(', ')}${product.dealPrice ? `\nDeal price: $${product.dealPrice} (was $${product.msrp})` : ''}`

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

      // Fallback: extract lines from description
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

    case 'specifications': {
      const primaryPrompt = `Extract and format the technical specifications from this product description into clean, readable HTML. Use a <table> with two columns (spec name + value) if there are 4+ specs, otherwise use a <ul> list. Include: dimensions, materials, power source, charge time, run time, waterproofing, colors, and any other objective specs. If a spec is not mentioned, omit it. No fluff or marketing copy — just the facts. Return only the HTML, no markdown, no wrapper tags.\n\n${productContext}`
      const retryPrompt   = `Return ONLY HTML starting with <table> or <ul> containing the technical specs from this product description. No markdown, no explanation, no preamble.\n\n${productContext}`

      const text = await generate(primaryPrompt, 2048)
      if (text.includes('<')) return { type, content: text }

      const retried = await generate(retryPrompt, 2048)
      if (retried.includes('<')) return { type, content: retried }

      return { type, content: `<ul><li>${product.description.slice(0, 500)}</li></ul>` }
    }

    default:
      throw new Error(`Unknown copy type: ${type as string}`)
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

export async function generateSEOTitle(rawTitle: string, brand: string): Promise<string> {
  const text = await generate(
    `Rewrite this product title for SEO. Max 60 chars. Format: {Brand} {Product Type} {Key Feature}. Remove filler words and explicit language. Replace explicit terms with tasteful equivalents.\n\nRaw title: "${rawTitle}"\nBrand: "${brand}"\n\nReturn only the rewritten title, no quotes.`,
    256,
    MODEL_FAST,
  )
  return text.trim().slice(0, 60)
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
  featureBullets?: string[]
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
  const bullets     = product.featureBullets
    ? product.featureBullets.map(b => stripHtml(b).slice(0, 80)).filter(Boolean).join(', ')
    : ''

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
    bullets           ? `Features: ${bullets}`                                     : '',
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

Use the product details above to make the narrator script and reaction text feel specific to THIS product — not generic wellness copy. Mine the full story, feature bullets, and specs for details that are funny, surprising, or unusually specific. A narrator referencing an actual feature ("7 settings" or "whisper quiet" or "USB rechargeable") is always funnier and more trustworthy than one speaking in generalities. Specificity = credibility = conversion.

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
