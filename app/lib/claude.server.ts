import Anthropic from '@anthropic-ai/sdk'
import type { GenerateCopyRequest, GenerateCopyResult } from '~/types'

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

async function generate(prompt: string): Promise<string> {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })
  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error('Unexpected Claude response type')
  return block.text
}

export async function generateCopy(req: GenerateCopyRequest): Promise<GenerateCopyResult> {
  const { type, product } = req
  const productContext = `Product: ${product.title}\nBrand: ${product.brand}\nDescription: ${product.description}\nCategories: ${product.categories.join(', ')}${product.dealPrice ? `\nDeal price: $${product.dealPrice} (was $${product.msrp})` : ''}`

  switch (type) {
    case 'tagline': {
      const raw = await generate(
        `Write 3 one-sentence taglines for the following product. Playful, curious, tasteful. Light wordplay welcome. Max 12 words each. Return as a JSON array of strings (no markdown).\n\n${productContext}`,
      )
      try {
        return { type, content: JSON.parse(raw) as string[] }
      } catch {
        return { type, content: raw.split('\n').filter(Boolean).slice(0, 3) }
      }
    }

    case 'full_story': {
      const text = await generate(
        `Write a 300–350 word product description in xdipx brand voice.\nStructure: Opening hook → what it is → key features in human terms → who will love it → curiosity closing hook.\nDo NOT include price or shipping info. Do NOT start with the product name.\n\n${productContext}`,
      )
      return { type, content: text }
    }

    case 'both_ways': {
      const text = await generate(
        `Write two paragraphs (60–80 words each) for the xdipx 'Both Ways' section.\nParagraph 1: "For Him ♥" — warm, curious, not vulgar.\nParagraph 2: "For Her ♥" — same energy.\nIf clearly single-gender, write one primary paragraph and one creative alternative-use paragraph.\nFormat: return as JSON with keys "forHim" and "forHer".\n\n${productContext}`,
      )
      try {
        return { type, content: JSON.parse(text) as { forHim: string; forHer: string } }
      } catch {
        return { type, content: text }
      }
    }

    case 'bullets': {
      const raw = await generate(
        `Write 4–6 feature bullet points for this product. Short, specific, benefit-first. No fluff. Return as a JSON array of strings.\n\n${productContext}`,
      )
      try {
        return { type, content: JSON.parse(raw) as string[] }
      } catch {
        return { type, content: raw.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('•')).map(l => l.replace(/^[-•]\s*/, '')) }
      }
    }

    case 'email_subjects': {
      const raw = await generate(
        `Write 5 email subject lines for today's daily deal email. Max 50 chars each. Playful, urgent, curiosity-driven. Return as a JSON array of strings.\n\n${productContext}`,
      )
      try {
        return { type, content: JSON.parse(raw) as string[] }
      } catch {
        return { type, content: raw.split('\n').filter(Boolean).slice(0, 5) }
      }
    }

    case 'seo_meta': {
      const text = await generate(
        `Write a 140–155 character SEO meta description for this product. Format: "[Discount or 'Best price']. [1-sentence benefit]. Ships discreet. $[price] at xdipx." Return only the meta description, no quotes.\n\n${productContext}`,
      )
      return { type, content: text.replace(/^["']|["']$/g, '').trim() }
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
    return JSON.parse(raw) as { date: string; sku: string; rationale: string }[]
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
