/**
 * Field-regen batch runner.
 *
 * Handles jobType='field-regen' jobs within the batch-orchestrator state
 * machine. Unlike the multi-turn full-enrichment runner, field-regen is
 * SINGLE-SHOT: one Anthropic Batch request per field, no tool-use loop.
 *
 * State machine (fits existing batchJobs statuses):
 *   queued     -> submitFieldRegenBatch() -> submitted
 *   submitted  -> retrieve batch -> processing (not ended) | applying (ended)
 *   processing -> retrieve batch -> applying (ended) | stay processing
 *   applying   -> applyFieldRegenResults() -> done | failed
 *
 * runnerState is used as a flat key-value store for this job type:
 *   runnerState['__meta'] = { jobKind: 'field-regen', productId, sku, context, fields }
 *   runnerState[fieldKey] = { prompt, result?, error?, applied? }
 *
 * custom_id scheme: `${jobId}::${fieldKey}` (double-colon; field keys never
 * contain "::" and jobIds (UUIDs) never contain "::").
 */

import Anthropic from '@anthropic-ai/sdk'
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { batchJobs } from '../../db/schema'
import type { ProductRunnerState } from '../../db/schema'
import { logApiTokens } from '~/lib/token-log.server'
import {
  updateProductMetafield,
  updateProductDescriptionHtml,
} from '~/lib/shopify.server'
import { buildEmmaSystemBlocks, BRAND_VOICE_SYSTEM_PROMPT } from '~/lib/claude.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { SONNET } from './models.server'
import type { GenerateCopyRequest } from '~/types'
import type { EmmaHeroVariant } from '~/types'
import type { Deal } from '~/types'

const MODEL      = SONNET
const MODEL_FAST = 'claude-haiku-4-5-20251001'

// ---------------------------------------------------------------------------
// Public context types (serialized into runnerState['__meta'].context)
// ---------------------------------------------------------------------------

export type FieldRegenKind =
  | 'copy-fields'   // generateCopy-style fields (tagline, full_story, etc.)
  | 'emma-hero'     // generateEmmaHero
  | 'emma-take'     // generateEmmaTake

export interface CopyFieldsContext {
  kind: 'copy-fields'
  productId: string   // full GID or numeric; updateProductMetafield handles both
  sku: string
  product: GenerateCopyRequest['product']
  fields: Array<GenerateCopyRequest['type']>
  authorSlug?: string
  seoMode?: 'aggressive' | 'natural' | 'off'
}

export interface EmmaHeroContext {
  kind: 'emma-hero'
  productId: string
  sku: string
  deal: Pick<Deal, 'seoTitle' | 'tagline' | 'fullStory' | 'brand' | 'category' | 'dealPrice' | 'msrp' | 'mapRestricted'>
  variant: EmmaHeroVariant
}

export interface EmmaTakeContext {
  kind: 'emma-take'
  productId: string
  sku: string
  deal: Pick<Deal, 'seoTitle' | 'tagline' | 'fullStory' | 'brand' | 'category' | 'productTypeDial'>
  dryRun?: boolean
}

export type FieldRegenContext = CopyFieldsContext | EmmaHeroContext | EmmaTakeContext

// ---------------------------------------------------------------------------
// Stored per-field runner state shape
// ---------------------------------------------------------------------------

interface FieldState {
  prompt:    string
  model:     string
  maxTokens: number
  result?:   unknown
  rawText?:  string
  error?:    string
  applied?:  boolean
}

interface MetaState {
  jobKind:   'field-regen'
  context:   FieldRegenContext
  systemBlocks: Array<{ text: string; cache?: boolean }>
  fields:    string[]   // ordered list of fieldKeys to submit
}

type FieldRegenRunnerState = Record<string, MetaState | FieldState>

/**
 * Cast FieldRegenRunnerState to the Drizzle column type (Record<string,
 * ProductRunnerState>). The column type is declared for the orchestrator but
 * field-regen repurposes the same JSON column with a different shape. The cast
 * is safe — the runner reads it back as FieldRegenRunnerState at runtime.
 */
function toDbRunnerState(rs: FieldRegenRunnerState): Record<string, ProductRunnerState> {
  return rs as unknown as Record<string, ProductRunnerState>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })
}

function buildCustomId(jobId: string, fieldKey: string): string {
  return `${jobId}::${fieldKey}`
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
}

// ---------------------------------------------------------------------------
// Prompt builders (factored out from claude.server.ts generators)
// These build ONLY the user prompt; system is handled separately.
// ---------------------------------------------------------------------------

function buildCopyFieldUserPrompt(
  type: GenerateCopyRequest['type'],
  product: GenerateCopyRequest['product'],
  keywordBlock: string,
): { prompt: string; model: string; maxTokens: number } {
  const productContextBase = `Product: ${product.title}\nBrand: ${product.brand}\nDescription: ${product.description}\nCategories: ${product.categories.join(', ')}`
  const productContext = keywordBlock ? `${productContextBase}\n\n${keywordBlock}` : productContextBase

  switch (type) {
    case 'tagline':
      return {
        model: MODEL_FAST, maxTokens: 512,
        prompt: `Write 3 one-sentence taglines for the following product. Emma voice — observational, casual, lightly witty. Think: a trusted friend who's recommending it, not a stand-up comedian. Avoid punchline-shaped puns and ad-copy zingers. Fragments are welcome ("the one I keep recommending", "earns its spot daily", "quietly indispensable"). First person OK. Max 12 words each. NO em-dashes. NO ♥ glyph (reserve it for CTAs and asides). If any keyword targets in the prompt do not fit this product, IGNORE them silently — write from product details only. Never narrate a mismatch, never preface, never explain. Return as a JSON array of strings (no markdown).\n\n${productContext}`,
      }
    case 'full_story':
      return {
        model: MODEL, maxTokens: 1024,
        prompt: `Write a short, punchy product description in xdipx brand voice. Return valid HTML only — use <p> tags for paragraphs, <strong> for emphasis, <em> for playful asides, <ul>/<li> for bullets. No <html>, <head>, <body> tags. No headings.\n\nFormat: EXACTLY 2 short paragraphs (3–4 sentences each) followed by a <ul> with 6–10 benefit bullets.\n\nTone: funny, cheeky, a little raunchy — innuendo is welcome, tasteful dirty jokes are great, but nothing gross or clinical. Think: your funniest friend who sells pleasure products and has zero shame. Make the reader smile AND want to buy.\n\nDo NOT include: price, shipping, dimensions, materials, or any technical specs (those live in a separate Specs tab).\nDo NOT start with the product name.\n\n${productContext}`,
      }
    case 'both_ways':
      return {
        model: MODEL, maxTokens: 1024,
        prompt: `Write two sections for the xdipx "Both Ways ♥" tab (60–90 words each). Return valid HTML — use <p> tags, <strong> for emphasis, <em> for playful asides. No headings. Return as JSON with keys "forHim" and "forHer", each containing an HTML string.\n\nSTRATEGY — read the product categories carefully:\n\nIf the product is primarily FOR HER (vibrators, rabbits, clit stimulators, air pulse, etc.):\n- "forHer": Genuine, warm, compelling sell written directly TO women. Speak to her pleasure, her curiosity, her experience. Make her feel seen and excited. This is the hero section.\n- "forHim": Humorous angle — he can't use it directly but here's why he should buy it anyway.\n\nIf the product is primarily FOR HIM (strokers, masturbators, prostate toys, etc.):\n- "forHim": Genuine, warm, compelling sell written directly TO men.\n- "forHer": Humorous angle — she can't use it directly but here's why she should be excited about it.\n\nIf the product works for both or is a couples toy: write genuine, enthusiastic content for each.\n\n${productContext}`,
      }
    case 'seo_meta':
      return {
        model: MODEL_FAST, maxTokens: 512,
        prompt: `Write a 140–155 character SEO meta description for this product. This shows in Google SERP and link previews — drives click-through.\n\nTwo anchors to include (Emma voice within these constraints):\n  (a) Trust beat: "Ships discreetly" — keeps the discretion signal in SERP\n  (b) Benefit beat in light Emma voice — fragment OK, first-person OK, no marketing fluff\n\nNEVER mention price, discount, or any dollar amount. Prices change; this copy is durable.\n\nIf any keyword targets in this prompt don't actually fit the product, IGNORE them silently and write the description from the product details only — never narrate the mismatch, never preface, never explain. Output exactly the description and nothing else.\n\nVoice: light Emma — observational, warm, specific. Not a generic SEO template. Brand mentions written as "XDIPX" (uppercase). NO em-dashes ("—" or "–"). Return ONLY the meta description text — no quotes, no labels.\n\n${productContext}`,
      }
    case 'specifications':
      return {
        model: MODEL_FAST, maxTokens: 1024,
        prompt: `Extract the technical specifications from this product description as a JSON array of "Label: Value" bullet pairs. Each entry is a single short string with the label, a colon, and the value (e.g. "Color: Black", "Material: Body-safe silicone", "Battery life: 90 minutes per charge").\n\nInclude only objective facts surfaced in the description: dimensions, materials, power source, charge time, run time, waterproofing, colors, weight, controls, country of origin. Skip categories the source doesn't mention — better fewer accurate specs than padded ones. NEVER include price, discount, or dollar amounts.\n\nVoice: factual and concise. No fluff, no marketing copy, no Emma asides. Each value 4–80 chars.\n\nReturn ONLY a JSON array of strings, max 12 entries. No markdown, no prose, no wrapper.\n\nExample: ["Color: Black", "Material: Nylon straps with padded cuffs", "Includes: 4 cuffs and restraint straps", "Fit: Universal mattress sizes"]\n\n${productContext}`,
      }
    case 'box_contents':
      return {
        model: MODEL_FAST, maxTokens: 512,
        prompt: `Extract what is physically included in the box for this product from the description below. Return a JSON array of short strings (one item per element), e.g. ["1x vibrator", "1x USB charging cable", "1x storage pouch"]. If the description doesn't mention box contents, infer the most likely inclusions based on the product type. Return only the JSON array, no markdown.\n\n${productContext}`,
      }
    case 'bullets':
      return {
        model: MODEL_FAST, maxTokens: 512,
        prompt: `Write 4–6 feature bullet points for this product. Short, specific, benefit-first. No fluff. Return as a JSON array of strings.\n\n${productContext}`,
      }
    default:
      return {
        model: MODEL_FAST, maxTokens: 512,
        prompt: `Write copy for copy type "${type}" for this product in xdipx brand voice. Return JSON.\n\n${productContext}`,
      }
  }
}

function buildEmmaHeroUserPrompt(ctx: EmmaHeroContext): { prompt: string; model: string; maxTokens: number } {
  const { deal, variant } = ctx
  const discountPct = deal.msrp > 0 && deal.dealPrice > 0
    ? Math.round(((deal.msrp - deal.dealPrice) / deal.msrp) * 100)
    : 0
  const mapLine = deal.mapRestricted
    ? 'MAP-restricted — no discount claims, no percent-off language, no struck prices.'
    : discountPct > 0 ? `Currently ${discountPct}% off MSRP — you may allude to value, but never in "buy now" or countdown language.` : ''

  const prompt = `Write the Emma hero block for the homepage of xdipx.com. Variant: "${variant}".

Product context (do NOT echo — rewrite in Emma's voice):
- Title: ${deal.seoTitle}
- Brand: ${deal.brand}
- Category: ${deal.category.join(', ')}
${deal.tagline ? `- Existing tagline (for context only): ${deal.tagline}` : ''}
${deal.fullStory ? `- Full story (context only, strip HTML): ${deal.fullStory.replace(/<[^>]+>/g, ' ').slice(0, 400)}` : ''}
${mapLine}

Return ONLY this JSON (no markdown):
{
  "eyebrow":   "A DYNAMIC FEELING in Emma's own voice — 2–4 words, first-person, informal. Examples: 'Kinda obsessed', 'Low-key amazed', 'Still thinking about this', 'Quietly sold', 'Actually impressed'. No period. Do NOT use 'Currently loving' or generic editorial phrases like 'This week's pick'. Must feel like a quick reaction, not a label.",
  "headline":  "ONE sentence (8–14 words) that explains WHY Emma is featuring this pick right now — the reason it earned the slot. First-person, specific, warm. Never starts with the product name. Never 'buy now'. Example shape: 'Something about how quiet this one is just broke my brain.'",
  "body":      "1–2 short sentences (25–45 words total) — the highlights a shopper should know. What it feels like, what stands out, what surprised her. Tight and specific. No marketing bloat. No clinical language.",
  "aside":     "'— Emma · <3–6 word aside>', e.g. '— Emma · still on my desk'"${variant === 'quote' ? `,
  "pullQuote": "one short pull-quote (6–12 words) — in quotes — a friend-to-friend endorsement. No price or discount language."` : ''}
}`

  return { prompt, model: MODEL, maxTokens: 800 }
}

function buildEmmaTakeUserPrompt(ctx: EmmaTakeContext): { prompt: string; model: string; maxTokens: number } {
  const { deal } = ctx
  const prompt = `Write Emma's "take" on this product. It appears at the top of the PDP — a friend-to-friend honest read. This is THE customer-facing voice surface; treat it accordingly.

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
- "sex" and "sexy" are allowed where contextually relevant to the product and customer discovery (e.g. "sex toy", "safer sex", "sexy gift"). Default to "intimate"/"pleasure"/"wellness" for general voice.
- NO em-dashes ("—" or "–"). Use periods, commas, or parentheses.

Return ONLY the HTML — no markdown, no fences, no preamble.`

  return { prompt, model: MODEL, maxTokens: 800 }
}

// ---------------------------------------------------------------------------
// advanceFieldRegenJob (called by batch-orchestrator's advanceJob)
// ---------------------------------------------------------------------------

export interface FieldRegenAdvanceOutcome {
  submitted?: boolean
  applied?:   number
  done?:      boolean
  failed?:    boolean
}

type BatchJobRow = {
  jobId:          string
  status:         string
  products:       unknown[]
  runnerState:    Record<string, unknown>
  currentBatchId: string | null
  batchIds:       unknown
  appliedSkus:    unknown
  results:        unknown
  turn:           number
  maxTurns:       number
  submittedAt:    Date | null
  gatesDealId:    number | null
}

export async function advanceFieldRegenJob(job: BatchJobRow): Promise<FieldRegenAdvanceOutcome> {
  const outcome: FieldRegenAdvanceOutcome = {}
  const rs = job.runnerState as FieldRegenRunnerState
  const meta = rs['__meta'] as MetaState | undefined

  switch (job.status) {
    case 'queued': {
      // Build system blocks + per-field prompts, then submit one batch.
      const context = meta?.context ?? (job.products[0] as { input: FieldRegenContext } | undefined)?.input
      if (!context) {
        throw new Error(`[field-regen] job ${job.jobId}: no context in runnerState['__meta'] or products[0].input`)
      }

      // Build system blocks (Emma voice for hero/take, legacy SYSTEM_PROMPT for copy-fields)
      let systemBlocks: Array<{ text: string; cache?: boolean }>
      if (context.kind === 'copy-fields') {
        systemBlocks = [{ text: BRAND_VOICE_SYSTEM_PROMPT, cache: true }]
      } else {
        const brandVoice = (await getPipelineSetting('brandVoice')) ?? undefined
        // buildEmmaSystemBlocks returns ReadonlyArray — spread to mutable.
        systemBlocks = [...(await buildEmmaSystemBlocks(brandVoice))]
      }

      // Build per-field prompt entries
      const fieldPrompts: Array<{ fieldKey: string; prompt: string; model: string; maxTokens: number }> = []

      if (context.kind === 'copy-fields') {
        for (const type of context.fields) {
          // Note: keyword targeting via buildKeywordBlock is skipped in batch path
          // (it requires a live Sanity round-trip). The admin can re-run
          // regenerate-with-keywords for SEO-targeted copy after approving results.
          const { prompt, model, maxTokens } = buildCopyFieldUserPrompt(type, context.product, '')
          fieldPrompts.push({ fieldKey: type, prompt, model, maxTokens })
        }
      } else if (context.kind === 'emma-hero') {
        const { prompt, model, maxTokens } = buildEmmaHeroUserPrompt(context)
        fieldPrompts.push({ fieldKey: 'emma-hero', prompt, model, maxTokens })
      } else {
        const { prompt, model, maxTokens } = buildEmmaTakeUserPrompt(context)
        fieldPrompts.push({ fieldKey: 'emma-take', prompt, model, maxTokens })
      }

      // Build the runnerState with meta + per-field entries
      const newRunnerState: FieldRegenRunnerState = {
        '__meta': {
          jobKind:      'field-regen',
          context,
          systemBlocks,
          fields:       fieldPrompts.map(f => f.fieldKey),
        } as MetaState,
      }
      for (const f of fieldPrompts) {
        newRunnerState[f.fieldKey] = {
          prompt:    f.prompt,
          model:     f.model,
          maxTokens: f.maxTokens,
        } as FieldState
      }

      // Persist runner state before submit (crash safety)
      await db
        .update(batchJobs)
        .set({ runnerState: toDbRunnerState(newRunnerState), updatedAt: new Date() })
        .where(eq(batchJobs.jobId, job.jobId))

      // Submit the batch
      const client = getClient()
      const requests: Array<{ custom_id: string; params: Anthropic.Messages.MessageCreateParamsNonStreaming }> = []
      const systemParam: Anthropic.TextBlockParam[] = systemBlocks.map(b => ({
        type: 'text' as const,
        text: b.text,
        ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }))

      for (const f of fieldPrompts) {
        requests.push({
          custom_id: buildCustomId(job.jobId, f.fieldKey),
          params: {
            model:      f.model,
            max_tokens: f.maxTokens,
            system:     systemParam,
            messages:   [{ role: 'user', content: f.prompt }],
          },
        })
      }

      const batch = await client.messages.batches.create({ requests })
      const batchIds: string[] = [batch.id]

      await db
        .update(batchJobs)
        .set({
          status:         'submitted',
          currentBatchId: batch.id,
          batchIds:       batchIds as unknown as string[],
          runnerState:    toDbRunnerState(newRunnerState),
          submittedAt:    new Date(),
          updatedAt:      new Date(),
        })
        .where(eq(batchJobs.jobId, job.jobId))

      outcome.submitted = true
      console.log(`[field-regen] job ${job.jobId} submitted batch ${batch.id} (${requests.length} requests)`)
      break
    }

    case 'submitted':
    case 'processing': {
      if (!job.currentBatchId) {
        console.error(`[field-regen] job ${job.jobId} in ${job.status} with no currentBatchId`)
        break
      }

      const client = getClient()
      const batch = await client.messages.batches.retrieve(job.currentBatchId)

      if (batch.processing_status !== 'ended') {
        await db
          .update(batchJobs)
          .set({ status: 'processing', updatedAt: new Date() })
          .where(eq(batchJobs.jobId, job.jobId))
        break
      }

      // Stream results into a map
      const responses = new Map<string, Anthropic.Messages.Batches.MessageBatchIndividualResponse>()
      const stream = await client.messages.batches.results(job.currentBatchId)
      for await (const entry of stream) {
        responses.set(entry.custom_id, entry)
      }

      // Update per-field runner state with results
      const updatedRs: FieldRegenRunnerState = { ...rs }
      const metaState = updatedRs['__meta'] as MetaState
      let inputTokens = 0, outputTokens = 0, cacheCreation = 0, cacheRead = 0

      for (const fieldKey of metaState.fields) {
        const customId = buildCustomId(job.jobId, fieldKey)
        const entry = responses.get(customId)
        const fs = updatedRs[fieldKey] as FieldState | undefined
        if (!fs) continue

        if (!entry || entry.result.type !== 'succeeded') {
          const errMsg = entry
            ? `batch result type: ${entry.result.type}`
            : 'no result for custom_id'
          updatedRs[fieldKey] = { ...fs, error: errMsg }
          continue
        }

        const msg = entry.result.message
        const block = msg.content[0]
        const rawText = block?.type === 'text' ? block.text : ''

        const u = msg.usage as {
          input_tokens: number; output_tokens: number
          cache_creation_input_tokens?: number; cache_read_input_tokens?: number
        }
        inputTokens  += u.input_tokens
        outputTokens += u.output_tokens
        cacheCreation += u.cache_creation_input_tokens ?? 0
        cacheRead     += u.cache_read_input_tokens     ?? 0

        // Parse the raw text into a typed result
        const result = parseFieldResult(fieldKey, rawText, metaState.context)
        updatedRs[fieldKey] = { ...fs, rawText, result }
      }

      // Best-effort token log
      if (inputTokens > 0) {
        void logApiTokens({
          feature:             'copy-gen',
          model:               MODEL,
          source:              'batch',
          batchId:             job.currentBatchId,
          requestCount:        metaState.fields.length,
          inputTokens,
          outputTokens,
          cacheCreationTokens: cacheCreation,
          cacheReadTokens:     cacheRead,
          caller:              'field-regen',
        })
      }

      await db
        .update(batchJobs)
        .set({
          status:         'applying',
          currentBatchId: null,
          runnerState:    toDbRunnerState(updatedRs),
          updatedAt:      new Date(),
        })
        .where(eq(batchJobs.jobId, job.jobId))

      break
    }

    case 'applying': {
      const metaState = (rs['__meta'] as MetaState | undefined)
      if (!metaState) {
        throw new Error(`[field-regen] job ${job.jobId}: missing __meta in runnerState during applying`)
      }

      const ctx = metaState.context
      const updatedRs: FieldRegenRunnerState = { ...rs }
      let appliedCount = 0
      let anyError = false

      for (const fieldKey of metaState.fields) {
        const fs = updatedRs[fieldKey] as FieldState | undefined
        if (!fs || fs.applied) continue
        if (fs.error) { anyError = true; continue }

        try {
          await applyFieldResult(fieldKey, fs.result, ctx)
          updatedRs[fieldKey] = { ...fs, applied: true }
          appliedCount++
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          updatedRs[fieldKey] = { ...fs, error: `apply failed: ${errMsg}` }
          anyError = true
        }
      }

      outcome.applied = appliedCount

      const allDone = metaState.fields.every(k => {
        const fs = updatedRs[k] as FieldState | undefined
        return fs?.applied || fs?.error
      })

      if (allDone) {
        const finalStatus = anyError ? 'failed' : 'done'
        await db
          .update(batchJobs)
          .set({
            status:      finalStatus,
            runnerState: toDbRunnerState(updatedRs),
            completedAt: new Date(),
            updatedAt:   new Date(),
          })
          .where(eq(batchJobs.jobId, job.jobId))

        if (finalStatus === 'done') outcome.done    = true
        else                        outcome.failed  = true
      } else {
        // Partial apply (some still have no result yet — shouldn't happen but be safe)
        await db
          .update(batchJobs)
          .set({ runnerState: toDbRunnerState(updatedRs), updatedAt: new Date() })
          .where(eq(batchJobs.jobId, job.jobId))
      }

      break
    }

    case 'done':
    case 'failed':
      break
  }

  return outcome
}

// ---------------------------------------------------------------------------
// Result parsing
// ---------------------------------------------------------------------------

function parseFieldResult(fieldKey: string, rawText: string, ctx: FieldRegenContext): unknown {
  const stripped = stripFences(rawText)

  if (ctx.kind === 'emma-hero' && fieldKey === 'emma-hero') {
    try {
      return JSON.parse(stripped)
    } catch {
      return { rawText }
    }
  }

  if (ctx.kind === 'emma-take' && fieldKey === 'emma-take') {
    return stripped // HTML string
  }

  // copy-fields
  switch (fieldKey as GenerateCopyRequest['type']) {
    case 'tagline':
    case 'bullets':
    case 'box_contents':
    case 'specifications': {
      try {
        const parsed = JSON.parse(stripped)
        if (Array.isArray(parsed)) return parsed
      } catch { /* fall through */ }
      return [stripped]
    }
    case 'both_ways': {
      try {
        const parsed = JSON.parse(stripped) as { forHim?: string; forHer?: string }
        if (parsed.forHim && parsed.forHer) return parsed
      } catch { /* fall through */ }
      return { forHim: '<p>Content unavailable.</p>', forHer: '<p>Content unavailable.</p>' }
    }
    case 'seo_meta':
    case 'full_story':
    default:
      return stripped
  }
}

// ---------------------------------------------------------------------------
// Result application (writes to Shopify)
// All Shopify calls stay in shopify.server.ts; we call the exported helpers.
// ---------------------------------------------------------------------------

async function applyFieldResult(fieldKey: string, result: unknown, ctx: FieldRegenContext): Promise<void> {
  const productId = ctx.productId

  if (ctx.kind === 'emma-hero' && fieldKey === 'emma-hero') {
    const copy = result as { eyebrow?: string; headline?: string; body?: string; aside?: string; pullQuote?: string }
    if (!copy.eyebrow || !copy.headline || !copy.body || !copy.aside) {
      throw new Error('emma-hero: incomplete parsed fields')
    }
    await updateProductMetafield(productId, 'emma_hero', JSON.stringify({ ...copy, generatedAt: new Date().toISOString() }), 'json')
    if (copy.aside) {
      await updateProductMetafield(productId, 'tagline', copy.aside, 'single_line_text_field')
    }
    return
  }

  if (ctx.kind === 'emma-take' && fieldKey === 'emma-take') {
    if (ctx.dryRun) return
    await updateProductDescriptionHtml(productId, result as string)
    return
  }

  // copy-fields
  const type = fieldKey as GenerateCopyRequest['type']
  switch (type) {
    case 'tagline': {
      const arr = Array.isArray(result) ? result as string[] : [result as string]
      const val = arr[0]?.trim() ?? ''
      if (val) await updateProductMetafield(productId, 'tagline', val, 'single_line_text_field')
      break
    }
    case 'full_story': {
      const html = result as string
      if (html) await updateProductMetafield(productId, 'full_story', html, 'multi_line_text_field')
      break
    }
    case 'both_ways': {
      const bw = result as { forHim: string; forHer: string }
      if (bw.forHim) await updateProductMetafield(productId, 'works_for_him', bw.forHim, 'multi_line_text_field')
      if (bw.forHer) await updateProductMetafield(productId, 'works_for_her', bw.forHer, 'multi_line_text_field')
      break
    }
    case 'seo_meta': {
      const meta = result as string
      if (meta) await updateProductMetafield(productId, 'seo_meta_description', meta, 'multi_line_text_field')
      break
    }
    case 'specifications': {
      const specs = Array.isArray(result) ? result as string[] : []
      await updateProductMetafield(productId, 'specifications', JSON.stringify(specs), 'json')
      break
    }
    case 'box_contents': {
      const items = Array.isArray(result) ? result as string[] : []
      await updateProductMetafield(productId, 'box_contents', JSON.stringify(items), 'json')
      break
    }
    case 'bullets': {
      // Bullets are not a standard metafield — skip silently (no metafield to write)
      break
    }
    default:
      console.warn(`[field-regen] no apply handler for field type "${type}" — skipping`)
  }
}

// ---------------------------------------------------------------------------
// Enqueue helper (called by the 4 converted routes)
// ---------------------------------------------------------------------------

/**
 * Enqueue a field-regen job. Returns the jobId immediately; the cron poller
 * drives the state machine. No Anthropic calls happen in the enqueue path.
 */
export async function enqueueFieldRegenJob(
  context: FieldRegenContext,
): Promise<{ jobId: string }> {
  const { enqueueBatchJob } = await import('~/lib/batch-orchestrator.server')

  // We store the context in products[0].input so the existing batchJobs schema
  // carries it through; __meta is also set in runnerState by the runner on first advance.
  const sku = context.sku
  const productId = context.productId

  // Source label maps kind -> source literal (must match EnqueueBatchJobArgs.source union)
  const sourceMap = {
    'copy-fields': 'regen-fields',
    'emma-hero':   'regen-emma-hero',
    'emma-take':   'regen-emma-take',
  } as const satisfies Record<FieldRegenKind, 'regen-fields' | 'regen-emma-hero' | 'regen-emma-take'>

  const result = await enqueueBatchJob({
    jobType:  'field-regen',
    source:   sourceMap[context.kind],
    products: [{ productId, sku, input: context as unknown as import('~/lib/emma-orchestrator.server').OrchestratorInput }],
    maxTurns: 1,  // field-regen is always a single-shot; maxTurns=1 satisfies the schema, not used by runner
  })

  // Seed __meta into runnerState immediately so the runner can read it without
  // having to parse products[0].input (keeps the runner code clean).
  const brandVoice = context.kind !== 'copy-fields'
    ? ((await getPipelineSetting('brandVoice')) ?? undefined)
    : undefined
  // buildEmmaSystemBlocks returns ReadonlyArray — spread to mutable.
  const systemBlocks: Array<{ text: string; cache?: boolean }> = context.kind === 'copy-fields'
    ? [{ text: BRAND_VOICE_SYSTEM_PROMPT, cache: true }]
    : [...(await buildEmmaSystemBlocks(brandVoice))]

  const fields: string[] = context.kind === 'copy-fields'
    ? context.fields.map(f => f as string)
    : context.kind === 'emma-hero' ? ['emma-hero'] : ['emma-take']

  const meta: MetaState = { jobKind: 'field-regen', context, systemBlocks, fields }
  const runnerState: FieldRegenRunnerState = { '__meta': meta }

  await db
    .update(batchJobs)
    .set({ runnerState: toDbRunnerState(runnerState), updatedAt: new Date() })
    .where(eq(batchJobs.jobId, result.jobId))

  return result
}
