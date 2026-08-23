/**
 * POST /api/admin/social-gate  { postId, productHandle? }
 *
 * The owner's "Run gate" button in the Social Studio Composer (Phase 3,
 * ticket #4938, ADR-013 decision 6). `requireAdmin`.
 *
 * WHICH KIND OF VERDICT THIS PRODUCES. `applyPublishGateVerdict` takes an
 * agent-supplied verdict (PASS / REVISE / BLOCK / HOLD with reviewer and
 * notes) as INPUT and only verifies a PASS against the deterministic checks;
 * it cannot manufacture a verdict on its own, and a UI that invented a PASS to
 * feed it would be the self-stamp ADR-013 forbids. So this route runs ONLY the
 * deterministic checks (`runDeterministicPublishChecks`, the same function the
 * publish path and `applyPublishGateVerdict` use, with the same recent-caption
 * scope), persists the findings on the row, and derives `gate_status`:
 *
 *   any block  -> 'block'
 *   any hold   -> 'hold'
 *   anything   -> 'revise'
 *   clean      -> gate_status left NULL, `needsAgentVerdict: true`
 *
 * The PASS is issued by the social-publish-gate agent on its next run, which
 * calls `applyPublishGateVerdict` through the team API exactly as it does for
 * agent drafts. `review_status` is never touched here.
 */
import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { socialPosts, socialPostSlides } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { runDeterministicPublishChecks } from '~/lib/social-publish-gate.server'
import { dbApproveRepo, isGatePlatform, parseGateStamp, GATE_PLATFORMS } from '~/lib/social-publish-approve.server'
import { deriveGateStatus, findingToStored, type StoredGateFinding } from '~/lib/social-gate-status'
import { apiError } from '~/lib/api-error.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const postId = typeof b['postId'] === 'number' ? b['postId'] : Number(b['postId'])
  if (!Number.isInteger(postId) || postId <= 0) return Response.json({ error: 'postId required' }, { status: 400 })

  try {
    const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1)
    if (!post) return Response.json({ error: `No social post ${postId}` }, { status: 404 })
    if (!isGatePlatform(post.platform)) {
      return Response.json({
        error: `The publish gate verdicts ${GATE_PLATFORMS.join(' and ')} only; ${post.platform} posts are shipped by hand from the queue.`,
      }, { status: 409 })
    }
    if (post.status !== 'draft') {
      return Response.json({ error: `Post ${postId} is ${post.status}; only a draft is gated.` }, { status: 409 })
    }

    const productHandle =
      (typeof b['productHandle'] === 'string' && b['productHandle'].trim()) ||
      parseGateStamp(post.feedback)?.productHandle ||
      null

    const slides = await db
      .select({ altText: socialPostSlides.altText })
      .from(socialPostSlides)
      .where(eq(socialPostSlides.postId, postId))
    const altText = slides.map(s => s.altText).filter(Boolean).join('\n') || null

    const caption = post.editedText?.trim() || post.tweetText
    const result = await runDeterministicPublishChecks({
      caption,
      mediaUrls: post.mediaUrls ?? [],
      platform: post.platform,
      productHandle,
      altText,
      recentCaptions: await dbApproveRepo.recentCaptions(14, post.platform),
    })

    const findings: StoredGateFinding[] = result.findings.map(findingToStored)
    const gateStatus = deriveGateStatus(findings)
    const gateCheckedAt = new Date()
    await db
      .update(socialPosts)
      .set({ gateStatus, gateCheckedAt, gateFindings: findings, updatedAt: gateCheckedAt })
      .where(eq(socialPosts.id, postId))

    return Response.json({
      ok: true,
      postId,
      gateStatus,
      gateCheckedAt: gateCheckedAt.toISOString(),
      findings,
      needsAgentVerdict: gateStatus === null,
    })
  } catch (err) {
    return apiError('admin-social-gate', err, 'gate run failed')
  }
}
