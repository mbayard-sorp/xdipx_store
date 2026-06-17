/**
 * reviews-ai.server.ts — AI analysis for reviews using Claude.
 * Pattern mirrors claude.server.ts.
 */
import Anthropic from '@anthropic-ai/sdk'
import { SONNET } from './models.server'
import type { Review, ReviewAIAnalysis } from '~/types/reviews'

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })
const MODEL  = SONNET

const SYSTEM_PROMPT = `You are the voice of xdipx.com, an editorially curated sexual wellness storefront.
Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy.
Write as a trusted, funny friend who isn't embarrassed about the topic.
Keep all copy tasteful — suggestive is fine, explicit is not.
Never use "sex" as an adjective — use "intimate", "pleasure", or "wellness".`

/** Strip markdown code fences that Claude sometimes wraps JSON in. */
function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
}

async function generate(prompt: string, systemPrompt?: string, maxTokens = 512): Promise<string> {
  const msg = await client.messages.create({
    model:      MODEL,
    max_tokens: maxTokens,
    system:     systemPrompt ?? SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: prompt }],
  })
  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error('Unexpected Claude response type')
  // B3.6 — best-effort token log
  const u = msg.usage as typeof msg.usage & {
    cache_creation_input_tokens?: number
    cache_read_input_tokens?:     number
  }
  void import('./token-log.server').then(({ logApiTokens }) =>
    logApiTokens({
      feature: 'reviews', model: MODEL, source: 'sync', caller: 'reviews-ai/generate',
      inputTokens: u.input_tokens, outputTokens: u.output_tokens,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadTokens:     u.cache_read_input_tokens     ?? 0,
    })
  ).catch((err) => console.error('[reviews-ai] token-log failed (ignored):', err))
  return block.text
}

/**
 * Analyze a review for sentiment, spam score, and suggested moderation status.
 * Returns a structured analysis object.
 */
export async function analyzeReview(review: {
  title?: string | undefined
  body?: string | undefined
  rating: number
}): Promise<ReviewAIAnalysis> {
  const content = [
    review.title ? `Title: ${review.title}` : '',
    review.body  ? `Body: ${review.body}`   : '',
    `Rating: ${review.rating}/5`,
  ].filter(Boolean).join('\n')

  const prompt = `Analyze this product review for a sexual wellness e-commerce site.

Review content:
${content}

Return a JSON object with these exact fields:
{
  "sentiment": "positive" | "neutral" | "negative",
  "summary": "1-2 sentence summary of what the reviewer liked/disliked",
  "spamScore": 0.0 to 1.0 (0 = definitely not spam, 1 = definitely spam),
  "spamReason": "brief explanation if spamScore > 0.5, else null",
  "suggestedStatus": "approved" | "pending" | "spam",
  "flags": ["array", "of", "concern", "flags"] (e.g. "offensive_language", "irrelevant", "fake_positive", "competitor_mention", "empty_review")
}

Spam indicators: generic filler text, excessive punctuation, competitor links, no relation to product, obvious fake positives.
Return only the JSON object, no markdown.`

  const raw = await generate(prompt, undefined, 512)

  try {
    const parsed = JSON.parse(stripFences(raw)) as ReviewAIAnalysis
    // Validate required fields
    if (
      typeof parsed.sentiment === 'string' &&
      typeof parsed.spamScore === 'number' &&
      typeof parsed.suggestedStatus === 'string'
    ) {
      return {
        sentiment:       parsed.sentiment       as ReviewAIAnalysis['sentiment'],
        summary:         parsed.summary         ?? '',
        spamScore:       Math.min(1, Math.max(0, parsed.spamScore)),
        spamReason:      parsed.spamReason      ?? null,
        suggestedStatus: parsed.suggestedStatus as ReviewAIAnalysis['suggestedStatus'],
        flags:           Array.isArray(parsed.flags) ? parsed.flags : [],
      }
    }
  } catch {
    /* fall through to fallback */
  }

  // Fallback: derive from rating
  const sentiment: ReviewAIAnalysis['sentiment'] =
    review.rating >= 4 ? 'positive' :
    review.rating === 3 ? 'neutral' : 'negative'

  return {
    sentiment,
    summary:         review.body?.slice(0, 100) ?? 'Review submitted.',
    spamScore:       0.1,
    spamReason:      null,
    suggestedStatus: 'pending',
    flags:           [],
  }
}

/**
 * Generate a suggested seller reply to a review in xdipx brand voice.
 * Warm, cheeky, grateful — 2-3 sentences, not corporate.
 */
export async function generateReviewResponseSuggestion(review: Review): Promise<string> {
  const sentiment =
    review.rating >= 4 ? 'positive' :
    review.rating === 3 ? 'mixed'   : 'negative'

  const context = [
    review.title ? `Review title: "${review.title}"` : '',
    review.body  ? `Review: "${review.body.slice(0, 300)}"` : '',
    `Star rating: ${review.rating}/5`,
    `Sentiment: ${sentiment}`,
    review.isVerifiedPurchase ? 'Verified purchaser.' : '',
  ].filter(Boolean).join('\n')

  const prompt = `Write a short, warm seller reply to this customer review on behalf of xdipx.com.

${context}

Guidelines:
- 2-3 sentences max
- Brand voice: playful, warm, grateful — like a real person wrote it, not a corporate template
- For positive reviews: express genuine gratitude + reinforce their experience
- For negative reviews: acknowledge their experience, apologize sincerely, invite them to contact support
- End with ♥ or a warm sign-off
- Do NOT start with "Dear Customer" or "Thank you for your review"
- Do NOT use the word "sex" — use "intimate", "pleasure", or "wellness"

Return only the reply text, no quotes.`

  const raw = await generate(prompt, undefined, 256)
  return raw.trim()
}
