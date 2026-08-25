/**
 * POST /api/admin/social-image
 *   { mode: 'single', prompt, postId?, assetId?, productHandle?, refImageUrl?,
 *     aspect?: '4:5'|'16:9'|'9:16'|'1:1', archetype? }
 *   { mode: 'cast', prompt, castSlug, refImageUrl (product photo), postId?,
 *     assetId?, productHandle?, aspect?: '4:5'|'16:9', scale?, count? }
 *   -> { ok, urls: string[], assetIds?: number[], provider?, model? }
 *
 * Owner-initiated regeneration from the Social Studio (Library drawer "Edit
 * prompt, regenerate" and the Composer). Phase 3, ticket #4938, ADR-013
 * decision 7. `requireAdmin`.
 *
 * Spend. Owner generation bills the SOCIAL team: the same `gate('social')`
 * call api.team.social-image makes runs first, and generation runs with
 * `logCost: true` and caller 'owner-studio', so the social budget gate sees
 * it. Never the `admin-images` feature the product-image imagen routes bill.
 *
 * Library rows. Phase 2 makes `generateAndUploadSocialImage` and
 * `generateCastComposite` dual-write every candidate to Sanity plus a
 * `social_media_assets` row. When the result carries `assetIds` they are
 * passed through; when it does not (Phase 2 not merged yet), the caller gets
 * URLs only and the Library fills in on the next ingest.
 */
import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { gate } from '~/lib/team.server'
import { SOCIAL_ARCHETYPES, isProductScale, type SocialArchetype } from '~/lib/social-media.server'
import { getApprovedCastMembers } from '~/lib/sanity.server'
import { apiError } from '~/lib/api-error.server'

const ASPECTS = ['4:5', '16:9', '9:16', '1:1'] as const
type Aspect = (typeof ASPECTS)[number]
const PIXELS: Record<Aspect, { width: number; height: number }> = {
  '4:5': { width: 1080, height: 1350 },
  '16:9': { width: 1600, height: 900 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}
function slugish(raw: string | undefined, fallback: string): string {
  const s = (raw ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return s || fallback
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  try {
    const mode = b['mode'] === 'cast' ? 'cast' : b['mode'] === 'single' ? 'single' : null
    if (!mode) return Response.json({ error: "mode must be 'single' or 'cast'" }, { status: 400 })
    const prompt = str(b['prompt'])
    if (!prompt) return Response.json({ error: 'prompt required' }, { status: 400 })
    if (prompt.length > 4000) return Response.json({ error: 'prompt is over 4000 characters' }, { status: 400 })
    const productHandle = str(b['productHandle'])
    const refImageUrl = str(b['refImageUrl'])
    const aspectRaw = str(b['aspect'])
    const aspect: Aspect = (ASPECTS as readonly string[]).includes(aspectRaw ?? '') ? (aspectRaw as Aspect) : '4:5'
    const handle = slugish(productHandle, 'studio')
    const date = new Date().toISOString().slice(0, 10)
    const caller = 'owner-studio'

    // Money gate, same call and same shape as api.team.social-image.
    const gateResult = await gate('social')
    if (!gateResult.ok) {
      return Response.json({
        error: 'gated',
        reason: gateResult.reason,
        message:
          gateResult.reason === 'over_budget'
            ? `The social team is over its daily budget ($${(gateResult.spentCents / 100).toFixed(2)} of $${(gateResult.dailyCents / 100).toFixed(2)}). Raise it on Agent Teams or try tomorrow.`
            : gateResult.reason === 'over_image_cap'
              ? `The social team hit its image cap for today (${gateResult.imagesToday}/${gateResult.maxImagesPerDay}).`
              : gateResult.reason === 'disabled'
                ? 'The social team is switched off on Agent Teams; generation bills that team, so it is off too.'
                : `Refused by the social budget gate (${gateResult.reason ?? 'unknown'}).`,
        gate: gateResult,
      }, { status: 403 })
    }
    // Ticket #5429 fix 4: gate('social') no longer flips `ok` to false for a
    // positive-and-exceeded image cap (so a scheduled run can still finish
    // its rework/gate/triage steps); this owner-triggered generation route
    // relied on `ok` alone for the cap, so it needs its own explicit check
    // now or an owner click past the cap would generate and bill unblocked.
    if (gateResult.maxImagesPerDay > 0 && gateResult.imagesToday >= gateResult.maxImagesPerDay) {
      return Response.json({
        error: 'gated',
        reason: 'over_image_cap',
        message: `The social team hit its image cap for today (${gateResult.imagesToday}/${gateResult.maxImagesPerDay}).`,
        gate: gateResult,
      }, { status: 403 })
    }

    if (mode === 'cast') {
      const castSlug = str(b['castSlug'])
      if (!castSlug) return Response.json({ error: 'castSlug required for cast mode' }, { status: 400 })
      if (!refImageUrl) return Response.json({ error: 'refImageUrl (the product photo) is required for cast mode' }, { status: 400 })
      const roster = await getApprovedCastMembers()
      const member = roster.find(m => m.slug === castSlug)
      if (!member) return Response.json({ error: `No approved cast member "${castSlug}"` }, { status: 404 })
      const scaleRaw = str(b['scale'])
      const scale = scaleRaw && isProductScale(scaleRaw) ? scaleRaw : 'handheld'
      const countRaw = Number(b['count'])
      const count = Number.isInteger(countRaw) && countRaw >= 1 && countRaw <= 4 ? countRaw : 2
      const { generateCastComposite } = await import('~/lib/social-media.server')
      const result = await generateCastComposite({
        prompt,
        handle,
        mood: 'owner',
        date,
        presenterImageUrl: member.photoUrl,
        productImageUrl: refImageUrl,
        extraImageUrls: [refImageUrl],
        scale,
        count,
        aspectRatio: aspect === '16:9' ? '16:9' : '4:5',
        caller,
      })
      const assetIds = (result as { assetIds?: number[] }).assetIds
      return Response.json({
        ok: true,
        urls: result.urls,
        ...(assetIds ? { assetIds } : {}),
        costs: result.costs,
      })
    }

    const archetypeRaw = str(b['archetype'])
    const archetype: SocialArchetype = (SOCIAL_ARCHETYPES as readonly string[]).includes(archetypeRaw ?? '')
      ? (archetypeRaw as SocialArchetype)
      : 'scene'
    const { generateAndUploadSocialImage } = await import('~/lib/social-media.server')
    const result = await generateAndUploadSocialImage({
      prompt,
      handle,
      archetype,
      mood: 'owner',
      date,
      aspect,
      imageSize: PIXELS[aspect],
      caller,
      logCost: true,
      ...(refImageUrl ? { refImageUrl } : {}),
    })
    const assetIds = (result as { assetIds?: number[] }).assetIds
    if (!result.url) {
      return Response.json({
        ok: false,
        error: result.provider === 'none'
          ? 'The provider returned nothing (often a stochastic safety block). Nothing was billed; try the same prompt once more or soften it.'
          : `Generated on ${result.provider} but the rehost failed, so there is no asset. The generation was billed; retry in a minute.`,
        provider: result.provider,
        model: result.model,
      }, { status: 502 })
    }
    return Response.json({
      ok: true,
      urls: [result.url],
      ...(assetIds ? { assetIds } : {}),
      provider: result.provider,
      model: result.model,
    })
  } catch (err) {
    return apiError('admin-social-image', err, 'social image generation failed')
  }
}
