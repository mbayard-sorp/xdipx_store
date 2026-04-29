import Anthropic from '@anthropic-ai/sdk'
import { buildEmmaSystemBlocks } from '~/lib/claude.server'
import type { Deal } from '~/types'

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })

const MODEL_SONNET = 'claude-sonnet-4-20250514'
const MODEL_HAIKU  = 'claude-haiku-4-5-20251001'

const POLL_INTERVAL_DEFAULT_MS = 30_000
const POLL_TIMEOUT_DEFAULT_MS  = 24 * 60 * 60 * 1000

/**
 * Anthropic Batch API path for nightly enrichment. Each batch submission gets
 * 50% off both input and output tokens — the trade is async (results within
 * 24h, often minutes for small batches) and no multi-turn tool dispatch.
 *
 * MVP scope: this module exposes the core primitives (submit / poll / stream)
 * plus one end-to-end "build many Emma's Take payloads at once" surface,
 * because that generator is Sonnet-priced and a dominant cost contributor. As
 * the cron-driven Nalpac automation lands, additional generators (FAQs,
 * sensation dial, IVR, copy bundle) can extend this same module by following
 * the `runBatchEmmaTake` pattern: build per-product `BatchRequest`s, submit,
 * poll, parse, return a map keyed by productId.
 *
 * Design notes:
 *  - Each batch entry's `custom_id` is `${productId}::${tool}` so multiple
 *    tools per product can share one batch and be demuxed at parse time.
 *  - System prompts use the same `buildEmmaSystemBlocks` helper as the sync
 *    path, so cache_control behaves identically (cache write on the first
 *    request, cache reads on the rest within the 5-minute TTL — works inside
 *    a single batch because Anthropic processes them in parallel windows).
 *  - Errors per request are isolated: a single failed Emma's Take does not
 *    abort the batch. Callers receive a `failures[]` array alongside the
 *    successful map.
 */

export interface BatchEmmaTakeInput {
  productId:  string
  deal:       Pick<Deal, 'seoTitle' | 'tagline' | 'fullStory' | 'brand' | 'category' | 'productTypeDial'>
}

export interface BatchEmmaTakeResult {
  /** productId → generated descriptionHtml. Order not guaranteed. */
  results:  Map<string, string>
  failures: Array<{ productId: string; error: string }>
  meta: {
    batchId:        string
    submittedCount: number
    succeededCount: number
    erroredCount:   number
    durationMs:     number
  }
}

interface BatchRequest {
  custom_id: string
  params:    Anthropic.Messages.MessageCreateParamsNonStreaming
}

/**
 * Submit a list of pre-built Anthropic batch requests, poll until processing
 * ends, and return the raw individual responses keyed by `custom_id`. Use
 * this when you've assembled the requests yourself (e.g. multi-tool batch).
 * Higher-level helpers like `runBatchEmmaTake` wrap this for a single tool.
 */
export async function submitAndPollBatch(
  requests: BatchRequest[],
  opts: { pollIntervalMs?: number; timeoutMs?: number; onProgress?: (status: string, succeeded: number, total: number) => void } = {},
): Promise<{ batchId: string; responses: Map<string, Anthropic.Messages.Batches.MessageBatchIndividualResponse> }> {
  if (requests.length === 0) {
    throw new Error('submitAndPollBatch: no requests')
  }

  const batch = await client.messages.batches.create({ requests })
  console.log(`[batch] submitted batch ${batch.id} with ${requests.length} requests`)

  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_DEFAULT_MS
  const timeoutMs      = opts.timeoutMs      ?? POLL_TIMEOUT_DEFAULT_MS
  const deadline       = Date.now() + timeoutMs

  let current = batch
  while (current.processing_status !== 'ended') {
    if (Date.now() > deadline) {
      throw new Error(`submitAndPollBatch: timed out after ${timeoutMs}ms (batch ${batch.id} still ${current.processing_status})`)
    }
    opts.onProgress?.(
      current.processing_status,
      current.request_counts.succeeded,
      requests.length,
    )
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    current = await client.messages.batches.retrieve(batch.id)
  }

  console.log(`[batch] batch ${batch.id} ended: succeeded=${current.request_counts.succeeded} errored=${current.request_counts.errored} canceled=${current.request_counts.canceled} expired=${current.request_counts.expired}`)

  const responses = new Map<string, Anthropic.Messages.Batches.MessageBatchIndividualResponse>()
  const stream = await client.messages.batches.results(batch.id)
  for await (const entry of stream) {
    responses.set(entry.custom_id, entry)
  }

  return { batchId: batch.id, responses }
}

/**
 * Build + submit a batch of Emma's Take generations. Returns a map of
 * productId → descriptionHtml plus a list of per-product failures.
 *
 * Voice / output rules mirror the sync `generateEmmaTake` in claude.server.ts.
 * Keep them in sync — when one prompt evolves, mirror the change here. (A
 * future refactor can hoist these prompt builders into a shared module.)
 */
export async function runBatchEmmaTake(
  inputs: BatchEmmaTakeInput[],
  opts: { brandVoice?: string; pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<BatchEmmaTakeResult> {
  const t0 = Date.now()
  const systemBlocks = await buildEmmaSystemBlocks(opts.brandVoice)
  const systemParam: Anthropic.TextBlockParam[] = systemBlocks.map(b => ({
    type: 'text' as const,
    text: b.text,
    ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))

  const requests: BatchRequest[] = inputs.map(({ productId, deal }) => ({
    custom_id: `${productId}::emmaTake`,
    params: {
      model:      MODEL_SONNET,
      max_tokens: 800,
      system:     systemParam,
      messages: [
        {
          role: 'user',
          content: buildEmmaTakeUserPrompt(deal),
        },
      ],
    },
  }))

  const { batchId, responses } = await submitAndPollBatch(requests, {
    ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
    ...(opts.timeoutMs      !== undefined ? { timeoutMs:      opts.timeoutMs      } : {}),
  })

  const results = new Map<string, string>()
  const failures: Array<{ productId: string; error: string }> = []

  for (const input of inputs) {
    const customId = `${input.productId}::emmaTake`
    const entry = responses.get(customId)
    if (!entry) {
      failures.push({ productId: input.productId, error: 'no result returned for custom_id' })
      continue
    }
    if (entry.result.type !== 'succeeded') {
      const reason = entry.result.type === 'errored'
        ? entry.result.error.error.message
        : entry.result.type
      failures.push({ productId: input.productId, error: `batch ${entry.result.type}: ${reason}` })
      continue
    }
    const block = entry.result.message.content[0]
    if (block?.type !== 'text') {
      failures.push({ productId: input.productId, error: 'unexpected non-text response' })
      continue
    }
    const html = stripFences(block.text).trim()
    if (!html) {
      failures.push({ productId: input.productId, error: 'empty response' })
      continue
    }
    results.set(input.productId, html)
  }

  return {
    results,
    failures,
    meta: {
      batchId,
      submittedCount: inputs.length,
      succeededCount: results.size,
      erroredCount:   failures.length,
      durationMs:     Date.now() - t0,
    },
  }
}

function buildEmmaTakeUserPrompt(deal: BatchEmmaTakeInput['deal']): string {
  return `Write Emma's "take" on this product. It appears at the top of the PDP — a friend-to-friend honest read. This is THE customer-facing voice surface; treat it accordingly.

Product:
- Title: ${deal.seoTitle}
- Brand: ${deal.brand}
- Category: ${deal.category.join(', ')}
${deal.productTypeDial ? `- Type: ${deal.productTypeDial}` : ''}
${deal.tagline ? `- Tagline (context only — DO NOT echo in first sentence): ${deal.tagline}` : ''}
${deal.fullStory ? `- Existing story (context, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 600)}` : ''}

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
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:html|json)?\n?/i, '').replace(/\n?```$/i, '').trim()
}

// Re-export model constants so callers can build their own request bodies for
// other generators without importing from claude.server.ts (and without
// re-discovering the model strings).
export const BATCH_MODEL_SONNET = MODEL_SONNET
export const BATCH_MODEL_HAIKU  = MODEL_HAIKU
