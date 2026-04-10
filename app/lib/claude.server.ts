import Anthropic from '@anthropic-ai/sdk'
import type { GenerateCopyRequest, GenerateCopyResult, ProductScore } from '~/types'

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })

const MODEL = 'claude-sonnet-4-20250514'

const SYSTEM_PROMPT = `You are the voice of xdipx.com — a daily flash-sale site for sexual wellness products.
Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy.
Write as a trusted, funny friend who isn't embarrassed about the topic. Your goal is to welcome first-time buyers and delight experienced ones.
Keep all copy tasteful — suggestive is fine, explicit is not.
Always signal discretion, value, and trust.
Never use "sex" as an adjective — use "intimate", "pleasure", or "wellness".
Never assume the reader's experience level.
Always end descriptions with a curiosity hook that makes the reader want to try it.`

async function generate(prompt: string, maxTokens = 1024): Promise<string> {
  const msg = await client.messages.create({
    model: MODEL,
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

      const raw = await generate(primaryPrompt)
      try {
        const parsed = JSON.parse(stripFences(raw)) as string[]
        const first = Array.isArray(parsed) ? parsed.find(s => typeof s === 'string' && s.trim()) : null
        if (first) return { type, content: parsed }
      } catch { /* fall through to retry */ }

      const retried = await generate(retryPrompt)
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

      const raw = await generate(primaryPrompt)
      try {
        const parsed = JSON.parse(stripFences(raw)) as string[]
        if (Array.isArray(parsed) && parsed.length >= 3) return { type, content: parsed }
      } catch { /* fall through */ }

      const retried = await generate(retryPrompt)
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

      const text = await generate(primaryPrompt)
      const cleaned = text.replace(/^["']|["']$/g, '').trim()
      if (cleaned.length >= 50) return { type, content: cleaned.slice(0, 155) }

      const retried = await generate(retryPrompt)
      const cleanedRetry = retried.replace(/^["']|["']$/g, '').trim()
      if (cleanedRetry.length >= 50) return { type, content: cleanedRetry.slice(0, 155) }

      const fallback = `${discount} on ${product.brand} ${product.title}. Ships discreetly. ${product.dealPrice ? `$${product.dealPrice} ` : ''}at xdipx.com.`
      return { type, content: fallback.slice(0, 155) }
    }

    case 'box_contents': {
      const primaryPrompt = `Extract what is physically included in the box for this product from the description below. Return a JSON array of short strings (one item per element), e.g. ["1x vibrator", "1x USB charging cable", "1x storage pouch"]. If the description doesn't mention box contents, infer the most likely inclusions based on the product type. Return only the JSON array, no markdown.\n\n${productContext}`
      const retryPrompt   = `Return ONLY a JSON array of what's in the box. Example: ["1x vibrator", "1x USB cable"]. Nothing else — no markdown, no prose, no explanation.\n\n${productContext}`

      const raw = await generate(primaryPrompt)
      try {
        const parsed = JSON.parse(stripFences(raw)) as string[]
        if (Array.isArray(parsed) && parsed.length >= 1) return { type, content: parsed }
      } catch { /* fall through */ }

      const retried = await generate(retryPrompt)
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

  const first = await generate(primaryPrompt, 512)
  const firstParsed = tryParse(first)
  if (firstParsed) return firstParsed

  const retried = await generate(retryPrompt, 512)
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
