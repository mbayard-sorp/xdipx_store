/**
 * POST /api/admin/social-rework
 *   { intent: 'rework-caption',    postId, feedback }
 *   { intent: 'regenerate-image',  postId, feedback, archetype? }
 *   { intent: 'create-rework-row', fromPostId, caption, altText?, mediaUrls, imageBrief?, subject?, scheduledFor? }
 *   { intent: 'owner-approve',     postId }
 *
 * The admin door onto `social-admin-rework.server.ts` (ticket #5414, owner
 * direction 2026-08-22). Before this route, those four functions were fully
 * built and tested but reachable by nothing: owner feedback only ever got
 * acted on by the twice-daily drafting routine's Step 2.5, so a note sat
 * unactioned for up to a day. `requireAdmin`.
 *
 * Each intent is a thin, individually testable wrapper around one exported
 * function, so a caller (today: the "Apply my feedback now" click on
 * PostPreviewCard / Composer, chaining rework-caption and/or regenerate-image
 * then create-rework-row) gets a result back per step rather than one opaque
 * combined call. Nothing here stamps a review decision: `create-rework-row`
 * always lands the new row at reviewStatus 'pending_review' with no gate
 * verdict, same as an agent rework, and `owner-approve` runs the real
 * deterministic checks before writing 'approved' (see that function's header
 * in social-admin-rework.server.ts). Neither bypasses the publish gate.
 *
 * `create-rework-row` does retire the source draft it reworked from, and
 * reports that back as `retiredSource`. That is a queue-hygiene write, not a
 * review decision on the new row: see `shouldRetireReworkSource`.
 *
 * Money. Image generation bills the social team's daily budget the same way
 * the owner's other Social Studio regenerate path
 * (api.admin.social-image.tsx) does: `gate('social')` is checked here before
 * calling `regenerateSocialImage`, and a closed gate is returned as an
 * explicit `gated` reason, not a silent no-op. `reworkCaption` is a text-only
 * Claude call and is not gated by the image budget.
 */
import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { gate } from '~/lib/team.server'
import { SOCIAL_ARCHETYPES } from '~/lib/social-media.server'
import {
  regenerateSocialImage,
  reworkCaption,
  createOwnerReworkRow,
  ownerApprovePost,
  type ReworkArchetype,
} from '~/lib/social-admin-rework.server'
import { apiError } from '~/lib/api-error.server'

async function actorLabel(request: Request): Promise<string> {
  const user = await getAdminUser(request)
  return user?.name || user?.email || 'owner-studio'
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}
function positiveInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}
function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const intent = str(b['intent'])

  try {
    const actor = await actorLabel(request)

    if (intent === 'rework-caption') {
      const postId = positiveInt(b['postId'])
      const feedback = str(b['feedback'])
      if (!postId) return Response.json({ ok: false, error: 'postId required' }, { status: 400 })
      if (!feedback) return Response.json({ ok: false, error: 'feedback required' }, { status: 400 })

      const result = await reworkCaption({ postId, feedback, actor })
      return Response.json(result, { status: result.ok ? 200 : 422 })
    }

    if (intent === 'regenerate-image') {
      const postId = positiveInt(b['postId'])
      const feedback = str(b['feedback'])
      if (!postId) return Response.json({ ok: false, error: 'postId required' }, { status: 400 })
      if (!feedback) return Response.json({ ok: false, error: 'feedback required' }, { status: 400 })
      const archetypeRaw = str(b['archetype'])
      const archetype = (SOCIAL_ARCHETYPES as readonly string[]).includes(archetypeRaw ?? '')
        ? (archetypeRaw as ReworkArchetype)
        : undefined

      // Money gate, same call and same failure shape as api.admin.social-image.tsx:
      // never silently skip generation when the social team is off, over budget,
      // or over its daily image cap.
      const gateResult = await gate('social')
      if (!gateResult.ok) {
        return Response.json({
          ok: false,
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
      if ((gateResult.maxImagesPerDay ?? 0) > 0 && gateResult.imagesToday >= (gateResult.maxImagesPerDay ?? 0)) {
        return Response.json({
          ok: false,
          error: 'gated',
          reason: 'over_image_cap',
          message: `The social team hit its image cap for today (${gateResult.imagesToday}/${gateResult.maxImagesPerDay}).`,
          gate: gateResult,
        }, { status: 403 })
      }

      const result = await regenerateSocialImage({ postId, feedback, actor, ...(archetype ? { archetype } : {}) })
      return Response.json(result, { status: result.ok ? 200 : 502 })
    }

    if (intent === 'create-rework-row') {
      const fromPostId = positiveInt(b['fromPostId'])
      const caption = str(b['caption'])
      if (!fromPostId) return Response.json({ ok: false, error: 'fromPostId required' }, { status: 400 })
      if (!caption) return Response.json({ ok: false, error: 'caption required' }, { status: 400 })

      try {
        const row = await createOwnerReworkRow({
          fromPostId,
          caption,
          altText: str(b['altText']) ?? null,
          mediaUrls: stringArray(b['mediaUrls']),
          imageBrief: str(b['imageBrief']) ?? null,
          subject: str(b['subject']) ?? null,
          scheduledFor: str(b['scheduledFor']) ?? null,
          actor,
        })
        return Response.json({ ok: true, id: row.id, retiredSource: row.retiredSource })
      } catch (err) {
        // createOwnerReworkRow throws (rather than returning ok:false) when the
        // source row is gone; that message is deterministic and safe to show.
        return Response.json({
          ok: false,
          error: err instanceof Error ? err.message : 'Could not file the reworked draft.',
        }, { status: 404 })
      }
    }

    if (intent === 'owner-approve') {
      const postId = positiveInt(b['postId'])
      if (!postId) return Response.json({ ok: false, error: 'postId required' }, { status: 400 })
      const result = await ownerApprovePost({ postId, actor })
      return Response.json(result, { status: result.ok ? 200 : 409 })
    }

    return Response.json({ ok: false, error: `Unknown intent "${intent ?? ''}"` }, { status: 400 })
  } catch (err) {
    return apiError('admin-social-rework', err, 'social rework failed')
  }
}
