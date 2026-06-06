import type { ActionFunctionArgs } from 'react-router'
import { getDealByHandle } from '~/lib/shopify.server'
import { requireAdmin } from '~/lib/session.server'
import { enqueueFieldRegenJob } from '~/lib/field-regen-runner.server'
import type { GenerateCopyRequest } from '~/types'

/**
 * POST /api/regenerate-with-keywords
 *
 * Regenerates SEO-targeted copy for a single product. Enqueues an async
 * field-regen batch job and returns immediately with { jobId, status: 'queued' }.
 * The cron poller at /cron/enrichment-batch-poller drives the job to completion.
 * Track progress at /admin/async-jobs?jobId=<jobId>.
 *
 * Body (JSON or formData):
 *   - handle:  string (required)        — Shopify product handle
 *   - types:   string[] (optional)      — copy types to regenerate; defaults
 *                                          to the standard PDP set
 *   - authorSlug: string (optional)     — editorialAuthor slug for voice
 *   - seoMode: 'aggressive' | 'natural' | 'off' (optional)
 *
 * Response: { ok, jobId, status: 'queued', handle, fields }
 *
 * NOTE: keyword targeting (buildKeywordBlock / Sanity round-trip) is skipped
 * in the batch path. The batch runner uses the same prompt templates but
 * without the <keyword_targets> block. For full SEO-targeted copy, re-run
 * after the job completes with a fresh sync call if needed.
 */

const DEFAULT_TYPES: GenerateCopyRequest['type'][] = [
  'tagline',
  'full_story',
  'both_ways',
  'seo_meta',
  'bullets',
]

const VALID_TYPES = new Set<GenerateCopyRequest['type']>([
  'tagline', 'full_story', 'both_ways', 'box_contents', 'bullets',
  'email_subjects', 'seo_meta', 'specifications', 'quiet_endorsement',
  'pair_bundle', 'blog_article',
])

// Only these types have apply handlers in the field-regen runner.
const BATCHABLE_TYPES = new Set<GenerateCopyRequest['type']>([
  'tagline', 'full_story', 'both_ways', 'seo_meta', 'specifications', 'box_contents', 'bullets',
])

interface RegenInput {
  handle:      string
  types:       GenerateCopyRequest['type'][]
  authorSlug?: string
  seoMode?:    'aggressive' | 'natural' | 'off'
}

async function parseInput(request: Request): Promise<RegenInput | { error: string }> {
  const ct = request.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body.handle !== 'string') return { error: 'Missing handle' }
    const out: RegenInput = {
      handle: body.handle,
      types:  Array.isArray(body.types)
        ? body.types.filter((t): t is GenerateCopyRequest['type'] => typeof t === 'string' && VALID_TYPES.has(t as GenerateCopyRequest['type']))
        : [...DEFAULT_TYPES],
    }
    if (typeof body.authorSlug === 'string') out.authorSlug = body.authorSlug
    if (body.seoMode === 'aggressive' || body.seoMode === 'natural' || body.seoMode === 'off') {
      out.seoMode = body.seoMode
    }
    if (out.types.length === 0) out.types = [...DEFAULT_TYPES]
    return out
  }
  const form = await request.formData()
  const handle = form.get('handle')
  if (typeof handle !== 'string' || !handle) return { error: 'Missing handle' }
  const typesRaw = form.get('types')
  const types = typeof typesRaw === 'string' && typesRaw.length
    ? typesRaw.split(',').filter((t): t is GenerateCopyRequest['type'] => VALID_TYPES.has(t as GenerateCopyRequest['type']))
    : [...DEFAULT_TYPES]
  const out: RegenInput = { handle, types: types.length ? types : [...DEFAULT_TYPES] }
  const authorSlug = form.get('authorSlug')
  if (typeof authorSlug === 'string' && authorSlug) out.authorSlug = authorSlug
  const seoMode = form.get('seoMode')
  if (seoMode === 'aggressive' || seoMode === 'natural' || seoMode === 'off') out.seoMode = seoMode
  return out
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const parsed = await parseInput(request)
  if ('error' in parsed) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 })
  }
  const { handle, types, authorSlug, seoMode } = parsed

  const deal = await getDealByHandle(handle)
  if (!deal) {
    return Response.json({ ok: false, error: `No deal/product found for handle "${handle}"` }, { status: 404 })
  }

  // Filter to only types that have batch apply handlers.
  const batchableFields = types.filter(t => BATCHABLE_TYPES.has(t))
  if (batchableFields.length === 0) {
    return Response.json({ ok: false, error: 'None of the requested types support async batch regeneration.' }, { status: 400 })
  }

  const productCtx: GenerateCopyRequest['product'] = {
    title:       deal.seoTitle || `${deal.brand} ${deal.handle}`.trim(),
    brand:       deal.brand,
    description: deal.rawDescription ?? deal.fullStory ?? '',
    categories:  deal.tags ?? [],
    dealPrice:   deal.dealPrice,
    msrp:        deal.msrp,
  }
  if (deal.mapRestricted) productCtx.mapRestricted = true
  if (deal.productTypeDial) productCtx.productTypeDial = deal.productTypeDial
  if (deal.moodTags?.length)     productCtx.moodTags     = deal.moodTags
  if (deal.audienceTags?.length) productCtx.audienceTags = deal.audienceTags
  if (deal.mattersTags?.length)  productCtx.mattersTags  = deal.mattersTags

  const sku = deal.sku ?? deal.handle
  const { jobId } = await enqueueFieldRegenJob({
    kind:      'copy-fields',
    productId: deal.shopifyProductId,
    sku,
    product:   productCtx,
    fields:    batchableFields,
    ...(authorSlug ? { authorSlug } : {}),
    ...(seoMode    ? { seoMode    } : {}),
  })

  return Response.json({
    ok:     true,
    jobId,
    status: 'queued',
    handle,
    fields: batchableFields,
    message: `Regeneration queued as job ${jobId}. Track at /admin/async-jobs?jobId=${jobId}`,
  })
}
