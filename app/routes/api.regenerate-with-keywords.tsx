import type { ActionFunctionArgs } from 'react-router'
import { generateCopy } from '~/lib/claude.server'
import { getDealByHandle } from '~/lib/shopify.server'
import { requireAdmin } from '~/lib/session.server'
import type { GenerateCopyRequest, GenerateCopyResult } from '~/types'

/**
 * POST /api/regenerate-with-keywords
 *
 * Regenerates SEO-targeted copy for a single product. Pulls productTypeDial +
 * mood/audience/matters tags from Shopify metafields so generateCopy can match
 * the keyword bank by tag overlap (the broader keyword pool, not just the
 * "general / no-tag" subset).
 *
 * Body (JSON or formData):
 *   - handle:  string (required)        — Shopify product handle
 *   - types:   string[] (optional)      — copy types to regenerate; defaults
 *                                          to the standard PDP set
 *   - authorSlug: string (optional)     — editorialAuthor slug for voice
 *   - seoMode: 'aggressive' | 'natural' | 'off' (optional)
 *
 * Response: { ok, handle, types: { [type]: { ok, content?, error? } } }
 *
 * Does NOT write anything. Admin reviews the regenerated copy in the response
 * and saves with existing per-field save endpoints (or a future "apply" UI).
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

  // Build the GenerateCopyRequest's product context once. Keyword targeting
  // pulls from productTypeDial + mood/audience/matters tags so the gen-time
  // helper can match the keyword bank by tag overlap (not just the no-tag
  // general pool).
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

  // Sequential generation — each call hits Anthropic, KV cache reuses the
  // keyword block across types so only the first call pays the Sanity round-trip.
  const out: Record<string, { ok: true; content: GenerateCopyResult['content'] } | { ok: false; error: string }> = {}
  for (const type of types) {
    try {
      const req: GenerateCopyRequest = { type, product: productCtx }
      if (authorSlug) req.authorSlug = authorSlug
      if (seoMode)    req.seoMode    = seoMode
      const result = await generateCopy(req)
      out[type] = { ok: true, content: result.content }
    } catch (err) {
      console.error(`[regen-with-keywords] ${handle}/${type} failed:`, err)
      out[type] = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  const allOk = Object.values(out).every(r => r.ok)
  return Response.json({ ok: allOk, handle, types: out })
}
