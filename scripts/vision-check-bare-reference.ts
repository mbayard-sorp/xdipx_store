/**
 * scripts/vision-check-bare-reference.ts
 *
 * Ticket #12912 (owner-approved 2026-10-01, all-hands on social product
 * variety, sibling of #12875/#12876/#12877). The catalog-wide
 * `xdipx.bare_product_reference` backfill
 * (`scripts/resolve-bare-product-references.ts --apply`, run 2026-10-01,
 * 5,331 writes, 0 errors) resolved 1,617 products to `url: null`; 1,615 of
 * those share one reason: "the only media entry has no altText and no
 * sibling to confirm it against; not trusted as bare"
 * (`resolveBareProductReference`, `app/lib/shopify.server.ts`) — a
 * filename/altText/sibling heuristic can never confirm a single-photo
 * product bare on text signals alone. That is roughly 30% of the catalog
 * permanently locked out of social imagery (`api.team.social-image.tsx`
 * refuses any handle with no confirmed bare reference), and ticket #12875's
 * resolve-on-miss fix reuses the same heuristic, so it does not help them.
 *
 * This script is the one-off remedy: for each ACTIVE product whose
 * `bare_product_reference` is null for exactly that reason, send its one
 * image to a vision model (Haiku, via the Anthropic Batch API — half price,
 * and enrichment's own batch-only rule) and classify it into one of five
 * classes (see `app/lib/bare-reference-vision-check.ts`, the pure decision
 * core this script is a thin wrapper around). Only `bare-text-free` writes
 * the url onto `xdipx.bare_product_reference`, with `method: 'vision'` so
 * the metafield records it was a vision verdict, not the heuristic — the
 * previous write from the catalog backfill is overwritten (this candidate
 * set is entirely `url: null` rows; there is nothing to clobber). Every
 * other class keeps `url: null` with the specific reason. The carton,
 * wordmark, and AI-generated refusals are never loosened: SKU 96203 is what
 * briefing from a carton costs (the model invented a stalk and club that do
 * not exist).
 *
 * Dry-run by default — runs the real (cheap) classification so the per-class
 * breakdown is real, but never writes a metafield. --apply to write.
 * --limit caps the candidate set for a smoke test.
 *
 * COST NOTE (the cloud sandbox this ticket was authored in has no
 * ANTHROPIC_API_KEY — confirmed via env — so this script could not be
 * executed here, dry-run or otherwise; it needs a session or environment
 * that carries the key, same documented limitation as
 * routine-dev-daily.md step 3h). The projected-cost line below is printed
 * BEFORE any batch is submitted, from the candidate count alone, so a human
 * running this interactively sees it before anything is spent; the batch
 * submission (and so the real charge) happens after that regardless of
 * --apply, because the per-class breakdown requires an actual classification.
 *
 * Usage:
 *   npx tsx scripts/vision-check-bare-reference.ts                 # dry-run
 *   npx tsx scripts/vision-check-bare-reference.ts --apply          # write
 *   npx tsx scripts/vision-check-bare-reference.ts --limit=50       # smoke test
 *   npx tsx scripts/vision-check-bare-reference.ts --apply --limit=50
 *
 * Exit code: 0 on a clean run, 1 if any product errored, 2 on a hard setup failure.
 */
// MUST be the first import — populates process.env (with override) before any
// downstream module reads it at evaluation time.
import './_load-env'
import Anthropic from '@anthropic-ai/sdk'
import { adminGraphQL, updateProductMetafield, ShopifyThrottleError } from '../app/lib/shopify.server'
import { logApiTokens } from '../app/lib/token-log.server'
import { estimateCostUsd } from '../app/lib/model-pricing.server'
import {
  VISION_BARE_REFERENCE_SYSTEM_PROMPT,
  decideBareReferenceFromVisionLabel,
  parseVisionBareReferenceLabel,
  type VisionBareReferenceLabel,
} from '../app/lib/bare-reference-vision-check'

// Verbatim from resolveBareProductReference's single-media-no-altText branch
// (shopify.server.ts). Not imported: that string lives inside the function
// body, not as its own exported constant, and this script only needs to
// match it once at read time — duplicating the literal here is lower risk
// than restructuring that function's body in the same week three sibling
// tickets already touch adjacent lines of the same file.
const SINGLE_IMAGE_UNCONFIRMED_REASON =
  'the only media entry has no altText and no sibling to confirm it against; not trusted as bare'

const MODEL_HAIKU = 'claude-haiku-4-5-20251001'
const FEATURE = 'bare-reference-vision-check'

const THROTTLE_RETRIES = 6
const THROTTLE_BACKOFF_MS = 5000
const THROTTLE_MAX_WAIT_MS = 30_000

function throttleWaitMs(retryAfterMsHint: number, attempt: number): number {
  const escalating = attempt * THROTTLE_BACKOFF_MS
  return Math.min(Math.max(retryAfterMsHint, escalating), THROTTLE_MAX_WAIT_MS)
}

async function withThrottleRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const isThrottle = err instanceof ShopifyThrottleError || /throttl|429|exceeded.*calls per second/i.test(message)
      if (attempt > THROTTLE_RETRIES || !isThrottle) throw err
      const hint = err instanceof ShopifyThrottleError ? err.retryAfterMs : 0
      const waitMs = throttleWaitMs(hint, attempt)
      console.warn(`[throttle] attempt ${attempt}/${THROTTLE_RETRIES}, resting ${waitMs}ms`)
      await new Promise(r => setTimeout(r, waitMs))
    }
  }
}

interface Args {
  apply: boolean
  limit: number
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2)
  const has = (flag: string) => args.includes(flag)
  const valOf = (prefix: string) => {
    const arg = args.find(a => a.startsWith(`${prefix}=`))
    return arg ? arg.slice(prefix.length + 1) : undefined
  }
  const limit = Number(valOf('--limit') ?? Infinity)
  return {
    apply: has('--apply'),
    limit: Number.isFinite(limit) && limit > 0 ? limit : Infinity,
  }
}

interface Candidate {
  gid: string
  handle: string
  title: string
  imageUrl: string
}

async function fetchCandidates(): Promise<Candidate[]> {
  interface AdminImageNode { url: string; altText: string | null }
  interface AdminProductNode {
    id: string
    handle: string
    title: string
    images: { edges: { node: AdminImageNode }[] }
    existingRef: { value: string } | null
  }
  interface PageInfo { hasNextPage: boolean; endCursor: string | null }
  type FetchResult = { products: { pageInfo: PageInfo; nodes: AdminProductNode[] } }

  const out: Candidate[] = []
  let cursor: string | null = null
  let hasNextPage = true
  let page = 0

  while (hasNextPage) {
    page++
    const data: FetchResult = await withThrottleRetry(() => adminGraphQL<FetchResult>(`
      query VisionCheckBareReferenceIndex($first: Int!, $after: String) {
        products(first: $first, after: $after, query: "status:active") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id handle title
            images(first: 5) { edges { node { url altText } } }
            existingRef: metafield(namespace: "xdipx", key: "bare_product_reference") { value }
          }
        }
      }
    `, { first: 50, after: cursor }))

    const conn = data.products
    hasNextPage = conn.pageInfo.hasNextPage
    cursor = conn.pageInfo.endCursor

    for (const node of conn.nodes) {
      if (!node.existingRef) continue
      let parsed: { url: string | null; reason?: string } | null = null
      try {
        parsed = JSON.parse(node.existingRef.value)
      } catch {
        continue
      }
      if (!parsed || parsed.url !== null || parsed.reason !== SINGLE_IMAGE_UNCONFIRMED_REASON) continue
      const imageUrl = node.images.edges[0]?.node.url
      if (!imageUrl) continue
      out.push({ gid: node.id, handle: node.handle, title: node.title, imageUrl })
    }

    console.log(`[index] page ${page}: scanned ${conn.nodes.length}, candidates so far=${out.length}`)
  }

  return out
}

async function fetchImageBase64(url: string): Promise<{ data: string; mediaType: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${url} failed: HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const mediaType = (res.headers.get('content-type') ?? '').split(';')[0] || 'image/jpeg'
  return { data: buffer.toString('base64'), mediaType }
}

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

// Rough per-call token estimate for the PRE-FLIGHT cost line only (printed
// before the batch is submitted, per this script's own header note). A
// single product photo at typical e-commerce resolution plus this short
// system prompt; the real, billed figure comes from the batch's own usage
// once it ends and is logged via logApiTokens below regardless.
const ESTIMATED_INPUT_TOKENS_PER_IMAGE = 1600
const ESTIMATED_OUTPUT_TOKENS_PER_IMAGE = 10

async function main(): Promise<number> {
  const args = parseArgs(process.argv)
  const allCandidates = await fetchCandidates()
  const candidates = allCandidates.slice(0, args.limit)

  console.log(
    `[plan] ${allCandidates.length} candidate(s) with an unconfirmed single-image bare reference` +
    (args.limit !== Infinity ? `, capped at ${args.limit}` : '') +
    `, ${candidates.length} to classify.`,
  )
  if (candidates.length === 0) {
    console.log('[plan] nothing to do.')
    return 0
  }

  const projectedCost = estimateCostUsd({
    model: MODEL_HAIKU,
    source: 'batch',
    inputTokens: ESTIMATED_INPUT_TOKENS_PER_IMAGE * candidates.length,
    outputTokens: ESTIMATED_OUTPUT_TOKENS_PER_IMAGE * candidates.length,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  })
  console.log(
    `[cost] projected (pre-flight estimate, before anything is spent): ~$${projectedCost.toFixed(4)} ` +
    `for ${candidates.length} image(s) at ${MODEL_HAIKU} Batch pricing. Proceeding to classify ` +
    `${args.apply ? '(will WRITE confirmed bare references)' : '(dry-run: will NOT write any metafield)'}.`,
  )

  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })
  const requests: Anthropic.Messages.Batches.BatchCreateParams.Request[] = []
  const skippedFetchErrors: string[] = []

  for (const c of candidates) {
    try {
      const { data, mediaType } = await fetchImageBase64(c.imageUrl)
      const media = (ALLOWED_MEDIA_TYPES as readonly string[]).includes(mediaType)
        ? (mediaType as (typeof ALLOWED_MEDIA_TYPES)[number])
        : 'image/jpeg'
      requests.push({
        custom_id: c.gid.replace('gid://shopify/Product/', ''),
        params: {
          model: MODEL_HAIKU,
          max_tokens: 20,
          system: VISION_BARE_REFERENCE_SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: media, data } },
              { type: 'text', text: 'Reply with the label token now.' },
            ],
          }],
        },
      })
    } catch (err) {
      skippedFetchErrors.push(`${c.handle}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (skippedFetchErrors.length > 0) {
    console.warn(`[fetch] ${skippedFetchErrors.length} image fetch failure(s), skipped:`)
    for (const line of skippedFetchErrors) console.warn(`  ${line}`)
  }
  if (requests.length === 0) {
    console.log('[plan] no images fetched successfully; nothing to classify.')
    return skippedFetchErrors.length > 0 ? 1 : 0
  }

  console.log(`[batch] submitting ${requests.length} request(s)...`)
  const batch = await client.messages.batches.create({ requests })
  console.log(`[batch] submitted ${batch.id}`)

  let current = batch
  while (current.processing_status !== 'ended') {
    await new Promise(r => setTimeout(r, 15_000))
    current = await client.messages.batches.retrieve(batch.id)
    console.log(`[batch] ${current.processing_status}: ${current.request_counts.succeeded}/${requests.length} succeeded`)
  }

  const byProductId = new Map(candidates.map(c => [c.gid.replace('gid://shopify/Product/', ''), c]))
  const breakdown: Record<VisionBareReferenceLabel, number> = {
    'bare-text-free': 0, 'bare-with-label': 0, carton: 0, lifestyle: 0, 'ai-generated-or-other': 0,
  }
  let errors = 0
  let wrote = 0
  const usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }

  const stream = await client.messages.batches.results(batch.id)
  for await (const entry of stream) {
    const candidate = byProductId.get(entry.custom_id)
    if (!candidate) continue
    if (entry.result.type !== 'succeeded') {
      console.error(`ERROR ${candidate.handle}: batch entry ${entry.result.type}`)
      errors++
      continue
    }
    const msg = entry.result.message
    usage.inputTokens += msg.usage.input_tokens
    usage.outputTokens += msg.usage.output_tokens
    usage.cacheCreationTokens += msg.usage.cache_creation_input_tokens ?? 0
    usage.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0

    const block = msg.content[0]
    const raw = block?.type === 'text' ? block.text : ''
    const label = parseVisionBareReferenceLabel(raw)
    breakdown[label]++
    const decision = decideBareReferenceFromVisionLabel(label, candidate.imageUrl)
    console.log(`${candidate.handle}: ${label} -> ${decision.url ?? 'NULL'} (raw reply: "${raw.trim()}")`)

    if (!args.apply) continue
    try {
      const metafieldValue = { ...decision, resolvedAt: new Date().toISOString(), method: 'vision' as const }
      await withThrottleRetry(() =>
        updateProductMetafield(candidate.gid, 'bare_product_reference', JSON.stringify(metafieldValue), 'json'),
      )
      wrote++
      await new Promise(r => setTimeout(r, 550))
    } catch (err) {
      console.error(`ERROR writing ${candidate.handle}:`, err instanceof Error ? err.message : err)
      errors++
    }
  }

  // Best-effort token logging (same shape as collectFullEnrichmentBatch),
  // non-fatal if it fails.
  void logApiTokens({
    feature: FEATURE,
    model: MODEL_HAIKU,
    source: 'batch',
    batchId: batch.id,
    requestCount: requests.length,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens: usage.cacheReadTokens,
    caller: 'vision-check-bare-reference',
  })

  console.log(args.apply
    ? `applied ${wrote} write(s), ${errors} error(s).`
    : 'dry-run (re-run with --apply to write confirmed bare references)')
  console.log(JSON.stringify({
    candidates: allCandidates.length,
    classified: requests.length,
    breakdown,
    wrote,
    errors,
    applied: args.apply,
    usage,
  }, null, 2))

  return errors > 0 ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('ERROR:', err instanceof Error ? err.message : err)
    process.exit(2)
  },
)
