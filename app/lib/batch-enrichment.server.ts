import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { buildEmmaSystemBlocks } from '~/lib/claude.server'
import { logApiTokens } from '~/lib/token-log.server'
import type { ProductWrites } from '~/lib/emma-orchestrator.server'
import type { Deal } from '~/types'
import { SONNET } from './models.server'

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })

const MODEL_SONNET = SONNET
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
    custom_id: `${productId}_emmaTake`,
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
    const customId = `${input.productId}_emmaTake`
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
- Emma is an AI guide with NO lived experience. She has never used, tested, worn, owned, or kept any product, and she has no nightstand, desk, drawer, shelf, or travel bag. NEVER say "I tried", "I tested", "I've been testing/using/wearing", "I keep mine", "I own", "been living on my nightstand", "I reach for this", "when I use it", or any similar first-person use claim. Speak from catalog knowledge instead: "known for", "designed for", "the spec says", "reviewers describe".
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

// ─── Full-enrichment batch path (single-call ProductWrites per product) ──────
//
// One Sonnet request per product produces the entire ProductWrites JSON. This
// mirrors what the `emma-product-enricher` Claude Code subagent does, but runs
// through the Anthropic Batch API for 50% off and async parallelism.
//
// System blocks (cached): EMMA_SYSTEM_PROMPT + brand voice + the agent prompt
// loaded from .claude/agents/emma-product-enricher.md + per-batch shared
// context (vocab + dial registry + dial taxonomy). All four blocks are tagged
// cache_control: ephemeral so writes happen on the first request and reads on
// the rest within the 5-min TTL — the dominant cost for 1K products is the
// 999 cache reads at 10% input price.
//
// User block (per-product, uncached): the brief produced by gather-enricher-
// brief.ts (snapshot + raw description + pairing candidates + existing
// metafields).

export interface SharedEnrichmentContext {
  moodVocab:          string[]
  audienceVocab:      string[]
  mattersVocab:       string[]
  dialRegistryByType: Record<string, readonly string[]>
  dialTaxonomy:       Record<string, ReadonlyArray<{
    label:      string
    definition?: string
    scaleLow?:   string
    scaleMid?:   string
    scaleHigh?:  string
  }>>
}

export interface ProductBrief {
  shopifyProductId:   string
  sku?:               string
  rawTitle:           string
  brand:              string
  vendor:             string
  rawDescription:     string
  categories:         string[]
  dealPrice:          number
  msrp:               number
  existingMetafields: Record<string, string>
  pairingCandidates:  Array<{
    productId:        string
    title:            string
    brand?:           string
    productTypeDial?: string
    price?:           number
  }>
}

export interface BatchFullEnrichmentInput {
  /** Shopify product gid — used as the custom_id prefix and result key. */
  productId: string
  brief:     ProductBrief
}

export interface BatchFullEnrichmentResult {
  /** productId → parsed ProductWrites. Ordering not guaranteed. */
  results:  Map<string, ProductWrites>
  failures: Array<{ productId: string; error: string }>
  meta: {
    batchId:        string
    submittedCount: number
    succeededCount: number
    erroredCount:   number
    durationMs:     number
    usage: {
      inputTokens:           number
      outputTokens:          number
      cacheCreationTokens:   number
      cacheReadTokens:       number
    }
  }
}

let _cachedAgentPrompt: string | null = null

/**
 * Load .claude/agents/emma-product-enricher.md, strip the YAML frontmatter,
 * and return the body as a single string. Cached for the process lifetime —
 * the prompt only changes when an editor commits a new agent definition.
 */
async function loadEnricherAgentPrompt(): Promise<string> {
  if (_cachedAgentPrompt !== null) return _cachedAgentPrompt
  // app/lib/batch-enrichment.server.ts → repo root is two levels up.
  const here = dirname(fileURLToPath(import.meta.url))
  const path = resolve(here, '..', '..', '.claude', 'agents', 'emma-product-enricher.md')
  const raw  = await readFile(path, 'utf8')
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
  if (!body) throw new Error(`empty agent prompt at ${path}`)
  _cachedAgentPrompt = body
  return body
}

function buildSharedContextBlock(ctx: SharedEnrichmentContext): string {
  const dialReg = Object.entries(ctx.dialRegistryByType)
    .map(([t, labels]) => `  ${t}: ${labels.join(', ')}`)
    .join('\n')

  const dialTax = Object.entries(ctx.dialTaxonomy).map(([t, items]) => {
    const lines = items.map(i => {
      const scaleParts: string[] = []
      if (i.scaleLow)  scaleParts.push(`1=${i.scaleLow}`)
      if (i.scaleMid)  scaleParts.push(`3=${i.scaleMid}`)
      if (i.scaleHigh) scaleParts.push(`5=${i.scaleHigh}`)
      const scaleSuffix = scaleParts.length > 0 ? `  (${scaleParts.join(' | ')})` : ''
      const def = i.definition ? `: ${i.definition}` : ''
      return `    - ${i.label}${def}${scaleSuffix}`
    }).join('\n')
    return `  ${t}:\n${lines}`
  }).join('\n')

  return `Shared editorial context for this batch (vocabularies, dial registry, dial taxonomy). Apply per the <inputs> section of your agent prompt.

moodVocab: ${ctx.moodVocab.join(', ')}
audienceVocab: ${ctx.audienceVocab.join(', ')}
mattersVocab: ${ctx.mattersVocab.join(', ')}

dialRegistryByType:
${dialReg}

dialTaxonomy:
${dialTax}`
}

function buildPerProductUserPrompt(brief: ProductBrief): string {
  return `Product brief:
\`\`\`json
${JSON.stringify(brief, null, 2)}
\`\`\`

Return ONLY the ProductWrites JSON object per your <output_schema>. No markdown fences. No commentary. No preamble.`
}

/**
 * Submit a batch of single-call full-enrichment requests, poll until done,
 * parse each result as ProductWrites. Per-product parse failures are isolated
 * into `failures[]`; the rest are returned in `results`.
 *
 * Cost note: with N products, the system blocks are written once and read
 * (N-1) times within the cache TTL. For 1K products at ~3K cached system
 * tokens + ~1K per-product user tokens + ~2K output tokens (Sonnet-priced,
 * 50% batch discount), expect roughly $20–30 total spend.
 */
const FULL_ENRICHMENT_SUFFIX = '_fullEnrichment'

interface UsageDelta {
  inputTokens:         number
  outputTokens:        number
  cacheCreationTokens: number
  cacheReadTokens:     number
}

function addUsage(acc: UsageDelta, delta: UsageDelta): void {
  acc.inputTokens         += delta.inputTokens
  acc.outputTokens        += delta.outputTokens
  acc.cacheCreationTokens += delta.cacheCreationTokens
  acc.cacheReadTokens     += delta.cacheReadTokens
}

/**
 * Build the per-product batch requests for a full-enrichment run. Shared by the
 * sync poll path (`runBatchFullEnrichment`) and the submit/collect split
 * (`submitFullEnrichmentBatch`) so the prompt assembly stays identical.
 */
async function buildFullEnrichmentRequests(
  inputs:  BatchFullEnrichmentInput[],
  context: SharedEnrichmentContext,
  opts:    { brandVoice?: string; maxTokens?: number } = {},
): Promise<BatchRequest[]> {
  const emmaBlocks   = await buildEmmaSystemBlocks(opts.brandVoice)
  const agentPrompt  = await loadEnricherAgentPrompt()
  const contextBlock = buildSharedContextBlock(context)

  const systemParam: Anthropic.TextBlockParam[] = [
    ...emmaBlocks.map(b => ({
      type: 'text' as const,
      text: b.text,
      ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
    })),
    { type: 'text', text: agentPrompt,  cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contextBlock, cache_control: { type: 'ephemeral' } },
  ]

  return inputs.map(({ productId, brief }) => ({
    custom_id: `${productId}${FULL_ENRICHMENT_SUFFIX}`,
    params: {
      model:      MODEL_SONNET,
      max_tokens: opts.maxTokens ?? 4096,
      system:     systemParam,
      messages: [{ role: 'user', content: buildPerProductUserPrompt(brief) }],
    },
  }))
}

/**
 * Parse a single batch result entry into either parsed ProductWrites or an
 * error string. Usage is returned whenever the model produced a message (even
 * if its body failed to parse), so token accounting stays accurate.
 */
function parseFullEnrichmentEntry(
  entry: Anthropic.Messages.Batches.MessageBatchIndividualResponse | undefined,
): { writes: ProductWrites; usage: UsageDelta } | { writes?: undefined; error: string; usage?: UsageDelta } {
  if (!entry) return { error: 'no result for custom_id' }
  if (entry.result.type !== 'succeeded') {
    const reason = entry.result.type === 'errored'
      ? entry.result.error.error.message
      : entry.result.type
    return { error: `batch ${entry.result.type}: ${reason}` }
  }

  const msg = entry.result.message
  // Token accounting — Anthropic returns separate cache fields when prompt
  // caching is in use. Defensive: read with optional chaining and treat as
  // 0 if a field is absent (older SDK versions).
  const u = msg.usage as {
    input_tokens?:                 number
    output_tokens?:                number
    cache_creation_input_tokens?:  number
    cache_read_input_tokens?:      number
  }
  const usage: UsageDelta = {
    inputTokens:         u?.input_tokens                ?? 0,
    outputTokens:        u?.output_tokens               ?? 0,
    cacheCreationTokens: u?.cache_creation_input_tokens ?? 0,
    cacheReadTokens:     u?.cache_read_input_tokens     ?? 0,
  }

  const block = msg.content[0]
  if (block?.type !== 'text') return { error: 'unexpected non-text response block', usage }
  const cleaned = stripFences(block.text).trim()
  if (!cleaned) return { error: 'empty response', usage }
  try {
    return { writes: JSON.parse(cleaned) as ProductWrites, usage }
  } catch (err) {
    const preview = cleaned.slice(0, 200).replace(/\n/g, ' ')
    return { error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)} | preview: ${preview}`, usage }
  }
}

/**
 * Submit a full-enrichment batch and return immediately — does NOT poll.
 *
 * For request/cron contexts (Vercel functions cap at 60s) where blocking on the
 * batch is impossible. The caller persists the returned batchId and collects on
 * a later tick via `collectFullEnrichmentBatch`.
 */
export async function submitFullEnrichmentBatch(
  inputs:  BatchFullEnrichmentInput[],
  context: SharedEnrichmentContext,
  opts:    { brandVoice?: string; maxTokens?: number } = {},
): Promise<{ batchId: string; productIds: string[]; submittedCount: number }> {
  if (inputs.length === 0) throw new Error('submitFullEnrichmentBatch: no inputs')
  const requests = await buildFullEnrichmentRequests(inputs, context, opts)
  const batch = await client.messages.batches.create({ requests })
  console.log(`[batch] submitted full-enrichment batch ${batch.id} with ${requests.length} requests (no poll)`)
  return { batchId: batch.id, productIds: inputs.map(i => i.productId), submittedCount: requests.length }
}

/**
 * Collect a previously-submitted full-enrichment batch. Returns `ended:false`
 * (with progress) when the batch is still processing — the caller should leave
 * it pending and retry on the next tick. When ended, returns parsed
 * ProductWrites keyed by productId (derived from each entry's custom_id) plus
 * per-product failures and aggregate usage.
 */
export async function collectFullEnrichmentBatch(batchId: string): Promise<
  | { ended: false; status: string; succeeded: number }
  | { ended: true; results: Map<string, ProductWrites>; failures: Array<{ productId: string; error: string }>; usage: UsageDelta }
> {
  const current = await client.messages.batches.retrieve(batchId)
  if (current.processing_status !== 'ended') {
    return { ended: false, status: current.processing_status, succeeded: current.request_counts.succeeded }
  }

  const results = new Map<string, ProductWrites>()
  const failures: Array<{ productId: string; error: string }> = []
  const usage: UsageDelta = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }

  const stream = await client.messages.batches.results(batchId)
  for await (const entry of stream) {
    if (!entry.custom_id.endsWith(FULL_ENRICHMENT_SUFFIX)) continue
    const productId = entry.custom_id.slice(0, -FULL_ENRICHMENT_SUFFIX.length)
    const parsed = parseFullEnrichmentEntry(entry)
    if (parsed.usage) addUsage(usage, parsed.usage)
    if (parsed.writes) results.set(productId, parsed.writes)
    else failures.push({ productId, error: parsed.error })
  }

  // Best-effort token logging (spec B3 -- no silent bypasses on live batch paths).
  void logApiTokens({
    feature:             'enrichment',
    model:               MODEL_SONNET,
    source:              'batch',
    batchId,
    requestCount:        results.size + failures.length,
    inputTokens:         usage.inputTokens,
    outputTokens:        usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens:     usage.cacheReadTokens,
    caller:              'collectFullEnrichmentBatch',
  })

  return { ended: true, results, failures, usage }
}

export async function runBatchFullEnrichment(
  inputs:  BatchFullEnrichmentInput[],
  context: SharedEnrichmentContext,
  opts:    { brandVoice?: string; pollIntervalMs?: number; timeoutMs?: number; maxTokens?: number } = {},
): Promise<BatchFullEnrichmentResult> {
  if (inputs.length === 0) throw new Error('runBatchFullEnrichment: no inputs')

  const t0 = Date.now()
  const requests = await buildFullEnrichmentRequests(inputs, context, opts)

  const { batchId, responses } = await submitAndPollBatch(requests, {
    ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
    ...(opts.timeoutMs      !== undefined ? { timeoutMs:      opts.timeoutMs      } : {}),
  })

  const results = new Map<string, ProductWrites>()
  const failures: Array<{ productId: string; error: string }> = []
  const usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }

  for (const input of inputs) {
    const entry = responses.get(`${input.productId}${FULL_ENRICHMENT_SUFFIX}`)
    const parsed = parseFullEnrichmentEntry(entry)
    if (parsed.usage) addUsage(usage, parsed.usage)
    if (parsed.writes) results.set(input.productId, parsed.writes)
    else failures.push({ productId: input.productId, error: parsed.error })
  }

  // Best-effort token logging (spec B3 -- no silent bypasses on live batch paths).
  void logApiTokens({
    feature:             'enrichment',
    model:               MODEL_SONNET,
    source:              'batch',
    batchId,
    requestCount:        inputs.length,
    inputTokens:         usage.inputTokens,
    outputTokens:        usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens:     usage.cacheReadTokens,
    caller:              'runBatchFullEnrichment',
  })

  return {
    results,
    failures,
    meta: {
      batchId,
      submittedCount: inputs.length,
      succeededCount: results.size,
      erroredCount:   failures.length,
      durationMs:     Date.now() - t0,
      usage,
    },
  }
}

// ─── Dial spread repair (second-batch retry) ────────────────────────────────

export interface DialItem {
  label:     string
  value:     number
  proposed?: boolean
}

export interface DialSpreadCheck {
  ok:        boolean
  distinct:  number
  fives:     number
  ones:      number
  values:    number[]
}

/**
 * Check whether a dial passes the spread invariants enforced in the agent
 * prompt:
 *   - values span ≥ 3 distinct integers
 *   - at most one 5
 *   - at most one 1
 * Empty / malformed dials return ok:false so callers can decide whether to
 * skip or repair.
 */
export function checkDialSpread(items: ReadonlyArray<DialItem> | undefined | null): DialSpreadCheck {
  const values = (items ?? [])
    .map(i => i.value)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const distinct = new Set(values).size
  const fives    = values.filter(v => v === 5).length
  const ones     = values.filter(v => v === 1).length
  const ok = values.length >= 5 && distinct >= 3 && fives <= 1 && ones <= 1
  return { ok, distinct, fives, ones, values }
}

export interface BatchDialRepairInput {
  productId:       string
  /** Original brief — gives the model the same context the main batch had. */
  brief:           ProductBrief
  /** The bad dial that needs repair. */
  badDial:         ReadonlyArray<DialItem>
  /** Optional product type from the main batch — anchors the repair to the
   *  same dial registry the main call used. */
  productTypeDial?: string
}

export interface BatchDialRepairResult {
  /** productId → repaired dial items. Missing entries failed and should be
   *  treated as warn-only (caller keeps the original bad dial and logs). */
  repairs:  Map<string, DialItem[]>
  failures: Array<{ productId: string; error: string }>
  meta: {
    batchId:        string
    submittedCount: number
    succeededCount: number
    erroredCount:   number
    durationMs:     number
    usage: {
      inputTokens:         number
      outputTokens:        number
      cacheCreationTokens: number
      cacheReadTokens:     number
    }
  }
}

function buildDialRepairUserPrompt(input: BatchDialRepairInput): string {
  const badJson = JSON.stringify(input.badDial.map(i => ({ label: i.label, value: i.value, ...(i.proposed ? { proposed: true } : {}) })), null, 2)
  return `Your previous response generated a sensationDialV2 that violates the spread rules. Regenerate ONLY the dial items array.

Product type: ${input.productTypeDial ?? '(unknown — infer from brief)'}
Product brief:
\`\`\`json
${JSON.stringify({
  rawTitle:       input.brief.rawTitle,
  brand:          input.brief.brand,
  vendor:         input.brief.vendor,
  rawDescription: input.brief.rawDescription.slice(0, 1500),
  categories:     input.brief.categories,
}, null, 2)}
\`\`\`

Your previous bad dial:
\`\`\`json
${badJson}
\`\`\`

ABSOLUTE rules — the response will be rejected if any is violated:
1. 5 or 6 items, no duplicate labels.
2. Each "value" is an integer from {1, 2, 3, 4, 5}. No half-steps.
3. Values MUST include at least 3 distinct integers.
4. AT MOST ONE item may have value 5. AT MOST ONE may have value 1.
5. The single defining strength of the product gets the 5; everything else is scored honestly relative to category peers.

Mental model: most products are MEDIUM at most things. A "medium" wand is a 3 on intensity, not 4. Reserve 4 for genuinely above-average and 5 for the one thing this product does best.

Self-check before returning: count your 5s. If more than one, drop the weakest 5 to a 3 or below. Count distinct values. If fewer than 3, redistribute.

Keep the SAME labels from the bad dial when they're appropriate; you may swap a label only if the original was wrong for the product.

Return ONLY this JSON shape — no markdown fences, no commentary:
{ "items": [ { "label": "...", "value": 1-5 }, ... ] }`
}

const DIAL_REPAIR_SYSTEM = `You are a careful editor. You generate sensationDialV2 items for product pages and you take the spread rules seriously: at most one 5, at most one 1, values span at least 3 distinct integers, integers only.`

/**
 * Submit a batch of dial-repair requests for products whose main-batch dial
 * violated spread invariants. Each request is a fresh single-turn Sonnet call
 * with a focused prompt; total output per request is small (~150 tokens), so
 * this batch is much cheaper than the main full-enrichment batch.
 *
 * On success, returns repaired dials keyed by productId. The caller should
 * splice these into the original ProductWrites before pushing to Shopify.
 */
export async function runBatchDialRepair(
  inputs: BatchDialRepairInput[],
  opts:   { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<BatchDialRepairResult> {
  if (inputs.length === 0) throw new Error('runBatchDialRepair: no inputs')

  const t0 = Date.now()

  // No prompt cache here — the system prompt is short and per-product user
  // prompts dominate token count. Skipping cache simplifies the logic and
  // costs little since dial repair is small (~150 output tokens / request).
  const systemParam: Anthropic.TextBlockParam[] = [
    { type: 'text', text: DIAL_REPAIR_SYSTEM },
  ]

  const requests: BatchRequest[] = inputs.map(input => ({
    custom_id: `${input.productId}_dialRepair`,
    params: {
      model:      MODEL_SONNET,
      max_tokens: 400,
      system:     systemParam,
      messages: [{ role: 'user', content: buildDialRepairUserPrompt(input) }],
    },
  }))

  const { batchId, responses } = await submitAndPollBatch(requests, {
    ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
    ...(opts.timeoutMs      !== undefined ? { timeoutMs:      opts.timeoutMs      } : {}),
  })

  const repairs = new Map<string, DialItem[]>()
  const failures: Array<{ productId: string; error: string }> = []
  const usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }

  for (const input of inputs) {
    const customId = `${input.productId}_dialRepair`
    const entry    = responses.get(customId)
    if (!entry) {
      failures.push({ productId: input.productId, error: 'no result for custom_id' })
      continue
    }
    if (entry.result.type !== 'succeeded') {
      const reason = entry.result.type === 'errored'
        ? entry.result.error.error.message
        : entry.result.type
      failures.push({ productId: input.productId, error: `dial repair ${entry.result.type}: ${reason}` })
      continue
    }

    const msg = entry.result.message
    const u = msg.usage as {
      input_tokens?:                 number
      output_tokens?:                number
      cache_creation_input_tokens?:  number
      cache_read_input_tokens?:      number
    }
    usage.inputTokens         += u?.input_tokens                 ?? 0
    usage.outputTokens        += u?.output_tokens                ?? 0
    usage.cacheCreationTokens += u?.cache_creation_input_tokens  ?? 0
    usage.cacheReadTokens     += u?.cache_read_input_tokens      ?? 0

    const block = msg.content[0]
    if (block?.type !== 'text') {
      failures.push({ productId: input.productId, error: 'unexpected non-text response block' })
      continue
    }
    const cleaned = stripFences(block.text).trim()
    let parsed: { items?: unknown }
    try {
      parsed = JSON.parse(cleaned) as { items?: unknown }
    } catch (err) {
      failures.push({ productId: input.productId, error: `dial repair JSON parse: ${err instanceof Error ? err.message : String(err)}` })
      continue
    }
    if (!Array.isArray(parsed.items)) {
      failures.push({ productId: input.productId, error: 'dial repair missing items array' })
      continue
    }

    const seen = new Set<string>()
    const items: DialItem[] = []
    for (const raw of parsed.items as Array<{ label?: unknown; value?: unknown; proposed?: unknown }>) {
      const label = typeof raw.label === 'string' ? raw.label.trim() : ''
      const value = typeof raw.value === 'number' ? Math.round(raw.value) : NaN
      if (!label || label.length > 30) continue
      if (!Number.isFinite(value) || value < 1 || value > 5) continue
      const key = label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const item: DialItem = { label, value }
      if (raw.proposed === true) item.proposed = true
      items.push(item)
      if (items.length >= 6) break
    }

    if (items.length < 5) {
      failures.push({ productId: input.productId, error: `dial repair returned only ${items.length} valid items` })
      continue
    }

    // Re-check the repaired dial. If it ALSO violates, accept warn-only —
    // the caller logs and keeps the bad dial. We don't recurse into a third
    // attempt; editors will fix the rare double-failures via admin UI.
    const recheck = checkDialSpread(items)
    if (!recheck.ok) {
      failures.push({
        productId: input.productId,
        error: `dial repair STILL violates spread (distinct=${recheck.distinct} fives=${recheck.fives} ones=${recheck.ones} values=[${recheck.values.join(',')}])`,
      })
      continue
    }
    repairs.set(input.productId, items)
  }

  return {
    repairs,
    failures,
    meta: {
      batchId,
      submittedCount: inputs.length,
      succeededCount: repairs.size,
      erroredCount:   failures.length,
      durationMs:     Date.now() - t0,
      usage,
    },
  }
}
