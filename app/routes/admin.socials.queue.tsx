/**
 * /admin/socials/queue — Review, Approved and History in one list-plus-detail
 * screen (Social Studio v2 Phase 3, ticket #4938).
 *
 * Every review and posting intent from the old single-route Social Studio
 * lives here unchanged: review, review-live, review-batch, reschedule,
 * post-approved-draft, post-media, delete-post, retry-post. New here:
 * `revert-to-draft` (approved back to pending, stamp burned, ADR-013
 * decision 4). `set-frequency` moved to /settings, `generate-tweet` and
 * `post-tweet` (the legacy X quick post) to /compose/new.
 *
 * Publishing. The owner's Post-now click publishes a still on either platform
 * regardless of the autopublish valves (owner direction 2026-08-23); video
 * alone still reads video_autopublish_enabled, which is his frame review.
 * What still refuses is a fact the caption does not show him: the stock
 * guard and the deterministic publish checks (manual-publish-gate.server.ts).
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router'
import { useLoaderData, useFetcher, useSearchParams, Link } from 'react-router'
import { useMemo, useState } from 'react'
import { db } from '~/lib/db.server'
import { socialPosts } from '../../db/schema'
import { eq, desc } from 'drizzle-orm'
import { postApprovedDraft } from '~/lib/twitter.server'
import { retryFailedSocialPost, deleteSocialPost } from '~/lib/social-post-ops.server'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { reviewSocialPost, rescheduleSocialPost, recordLivePostFeedback, getValve } from '~/lib/team.server'
import { laWallClockToUtc } from '~/lib/social-schedule'
import { permalinkFor } from '~/lib/social-permalink.server'
import { isLivePostVerdict, parseLiveFeedback } from '~/lib/live-post-feedback'
import { SOCIAL_REVIEW_STATUSES, isManualPublishPlatform } from '~/lib/team-keys'
import { ReviewQueue } from '~/components/admin/social/ReviewQueue'
import { parseBatchPostIds } from '~/components/admin/social/review-batch'
import { PlatformChip } from '~/components/admin/social/PostPreviewCard'
import { StatusPill, studioStatusOf, GatePill } from '~/components/admin/social/StatusPill'
import { isVideoPost, livePostUrl, type SocialPostRow } from '~/components/admin/social/types'
import { useStudioShortcuts } from '~/components/admin/social/use-shortcuts'
import { ExternalIcon, PenIcon, UndoIcon, PlusIcon } from '~/components/admin/social/icons'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import type { PublishMedia } from '~/lib/social-publish/types'
import { decideManualPublish } from '~/lib/social-publish/manual-publish-gate.server'
import { checkLinkedProductStock } from '~/lib/social-publish/stock-guard.server'
import { effectiveGateStatus, preserveGateStamp, revertSocialPostToDraft } from '~/lib/social-publish-approve.server'
import { cloneRejectedSocialPost } from '~/lib/social-publish-clone.server'
import { resolvePostProductHandle } from '~/lib/social-publish/product-handle.server'
import { formatLaWallClock } from '~/lib/social-schedule-ui'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const posts = await db
    .select()
    .from(socialPosts)
    .orderBy(desc(socialPosts.createdAt))
    .limit(100)
  return { posts }
}

/** How the reviewer stamp names whoever is clicking. */
async function ownerLabel(request: Request): Promise<string> {
  const user = await getAdminUser(request)
  return user?.name || user?.email || 'admin'
}

/**
 * Record an owner Post-now that shipped without a publish-gate PASS.
 *
 * The stamp is no longer required to publish (owner direction 2026-08-23), but
 * whether one existed is still worth knowing afterwards: `feedback` is the
 * channel the social team reads verbatim on its next run, so a post the owner
 * shipped over a REVISE is exactly the signal that should reach the drafters.
 * Appended, never prepended, so the legacy stamp block (burn-in, #4913) stays
 * intact for the readers that still parse it.
 */
async function recordManualPublish(
  postId: number,
  post: { feedback: string | null; gateStatus?: string | null },
  by: string,
): Promise<void> {
  const feedback = post.feedback
  // Column first, stamp fallback (TODO(#4913 burn-in) inside effectiveGateStatus).
  const verdict = effectiveGateStatus(post)
  if (verdict === 'pass') return
  // 'owner' (ticket #5425) is an earlier Studio approve, not a gate verdict to
  // override, so it reads differently from a REVISE/BLOCK/HOLD being shipped
  // over.
  const had =
    verdict === 'owner' ? 'after an earlier owner approval in Social Studio, with no agent verdict on the row'
    : verdict ? `over a gate ${verdict.toUpperCase()}`
    : 'with no gate verdict on the row'
  const note =
    `\n\n[manual-publish by ${by} on ${new Date().toISOString().slice(0, 10)}] ` +
    `Published from Post-now ${had}. The deterministic publish checks passed; ` +
    `the agent verdict was the owner's call.`
  await db.update(socialPosts)
    .set({ feedback: `${feedback ?? ''}${note}`.trim() })
    .where(eq(socialPosts.id, postId))
}

/**
 * The feedback line a hand-posted row carries. Says who, when, and that there
 * is no post id to look up, so a later reader does not read the empty
 * `external_post_id` as a publish that half-failed.
 */
function manualPostNote(platform: string, by: string, now: Date): string {
  return (
    `\n\n[posted-by-hand by ${by} on ${now.toISOString().slice(0, 10)}] ` +
    `Marked as posted on ${platform}, which has no publisher in this codebase. ` +
    `Nothing was published from here, so there is no post id or permalink on this row.`
  )
}

/**
 * Ticket #5412: review states Post-now may publish from. Approved is here
 * unchanged; pending_review and needs_changes are new, because the click now
 * performs the approval instead of requiring it first.
 */
const POST_NOW_ELIGIBLE_REVIEW_STATUSES: readonly string[] = ['pending_review', 'needs_changes', 'approved']

/**
 * The owner's Post-now click performing its own approval (ticket #5412b).
 *
 * Routes through `reviewSocialPost`, the one write path that already refuses
 * to approve a row carrying an unresolved gate BLOCK (`reason:'gate_block'`),
 * so that hard stop is inherited here rather than re-implemented, and
 * "gate BLOCK has no manual override" stays true on this path too. The
 * current feedback/editedText are passed back verbatim so the write is a
 * pure review-status transition: nothing about the row's content changes,
 * so no gate stamp is burned and no edit is recorded.
 */
async function approveForPostNow(
  post: { id: number; feedback: string | null; editedText: string | null },
  by: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await reviewSocialPost(post.id, {
    reviewStatus: 'approved',
    reviewedBy: by,
    feedback: post.feedback ?? undefined,
    editedText: post.editedText ?? undefined,
  })
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = form.get('intent') as string

  // ── Review lifecycle (owner-only; agents have no write path to this) ────
  if (intent === 'review') {
    const postId = parseInt(form.get('postId') as string)
    const decision = form.get('decision') as string
    const feedback = ((form.get('feedback') as string | null) ?? '').trim()
    const editedText = ((form.get('editedText') as string | null) ?? '').trim()

    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    if (!(SOCIAL_REVIEW_STATUSES as readonly string[]).includes(decision) || decision === 'pending_review') {
      return { ok: false, error: 'Bad decision' }
    }
    if (decision === 'needs_changes' && !feedback) {
      return { ok: false, error: 'Feedback is required when requesting changes' }
    }
    const user = await getAdminUser(request)
    const result = await reviewSocialPost(postId, {
      reviewStatus: decision as 'approved' | 'needs_changes' | 'rejected',
      feedback: feedback || undefined,
      editedText: editedText || undefined,
      reviewedBy: user?.name || user?.email || 'admin',
    })
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  }

  // ── Live-post feedback (owner-only). Review is an editorial gate on drafts
  // and not a way to relabel history; this is the other question, asked after
  // the fact ("now that it is live, was it any good"). Writes feedback and the
  // reviewer stamp only, leaving review_status as the record of the decision
  // that let it ship.
  if (intent === 'review-live') {
    const postId = parseInt(form.get('postId') as string)
    const verdict = form.get('verdict')
    const note = ((form.get('note') as string | null) ?? '').trim()

    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    if (!isLivePostVerdict(verdict)) return { ok: false, error: 'Bad verdict' }
    if (verdict !== 'worked' && !note) {
      return { ok: false, error: 'Tell the team what was off, otherwise there is nothing to learn from' }
    }
    const user = await getAdminUser(request)
    const ok = await recordLivePostFeedback(postId, {
      verdict,
      note: note || undefined,
      reviewedBy: user?.name || user?.email || 'admin',
    })
    return ok ? { ok: true } : { ok: false, error: 'Post not found or not published yet' }
  }

  // ── Batch review (owner-only): approve/reject many selected drafts at once.
  // Reuses the same reviewSocialPost writer per id. needs_changes is not
  // batchable because it requires per-draft feedback.
  if (intent === 'review-batch') {
    const decision = form.get('decision') as string
    if (decision !== 'approved' && decision !== 'rejected') {
      return { ok: false, error: 'Batch review supports approve or reject only' }
    }
    const ids = parseBatchPostIds(form.get('postIds') as string | null)
    if (ids.length === 0) return { ok: false, error: 'No drafts selected' }
    const user = await getAdminUser(request)
    const reviewedBy = user?.name || user?.email || 'admin'
    let updated = 0
    let blocked = 0
    for (const id of ids) {
      const result = await reviewSocialPost(id, {
        reviewStatus: decision as 'approved' | 'rejected',
        reviewedBy,
      })
      if (result.ok) updated++
      else if (result.reason === 'gate_block') blocked++
    }
    return { ok: true, intent: 'review-batch', updated, blocked, requested: ids.length }
  }

  if (intent === 'reschedule') {
    const postId = parseInt(form.get('postId') as string)
    const day = (form.get('scheduledFor') as string | null) ?? ''
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: 'Bad date' }
    // Phase 4 (#4939): an optional LA wall-clock time alongside the date sets
    // a precise `scheduled_at`; the date keeps being written for legacy readers.
    const time = (form.get('time') as string | null) ?? ''
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, error: 'Bad time' }
    await rescheduleSocialPost(
      postId,
      day || null,
      day && time ? { scheduledAt: laWallClockToUtc(day, time) } : {},
    )
    return { ok: true }
  }

  // ── Revert to draft (ADR-013 decision 4): approved back to pending, the
  // stamp and gate columns burned unconditionally. The Composer exposes the
  // same control; both go through revertSocialPostToDraft.
  if (intent === 'revert-to-draft') {
    const postId = parseInt(form.get('postId') as string)
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    const result = await revertSocialPostToDraft(postId)
    return result.ok ? { ok: true, intent: 'revert-to-draft' } : { ok: false, error: result.error }
  }

  // ── Save caption without a review decision (ticket #5418a). The review
  // card's textarea used to be reachable only through Approve/Request
  // changes/Reject, so a better caption typed and then navigated away from
  // was gone. This persists `editedText` alone, on any not-yet-posted draft,
  // leaving review_status, feedback, and the gate columns untouched.
  if (intent === 'save-caption') {
    const postId = parseInt(form.get('postId') as string)
    const caption = ((form.get('caption') as string | null) ?? '').trim()
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    if (!caption) return { ok: false, error: 'Caption cannot be empty' }
    const [current] = await db
      .select({ status: socialPosts.status, tweetText: socialPosts.tweetText })
      .from(socialPosts)
      .where(eq(socialPosts.id, postId))
      .limit(1)
    if (!current || current.status === 'posted') {
      return { ok: false, error: 'Post not found or already posted' }
    }
    await db.update(socialPosts)
      .set({
        editedText: caption === current.tweetText.trim() ? null : caption,
        updatedAt: new Date(),
      })
      .where(eq(socialPosts.id, postId))
    return { ok: true, intent: 'save-caption' }
  }

  // ── Clone a rejected/gate-BLOCKed row into a fresh draft (ticket #5416b).
  // The sanctioned escape from a terminal rejection: mints a NEW pending_review
  // row (gate_status null, judged on its own merits) carrying the dead row's
  // content forward with reworkedFrom pointing at it. Never re-verdicts the
  // dead row and never lets the clone inherit an approved state.
  if (intent === 'clone-to-new-draft') {
    const postId = parseInt(form.get('postId') as string)
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    const result = await cloneRejectedSocialPost(postId, { by: await ownerLabel(request) })
    return result.ok
      ? { ok: true, intent: 'clone-to-new-draft', id: result.id }
      : { ok: false, error: result.error }
  }

  // ── Live posting: explicit owner clicks only ─────────────────────────────
  //
  // Ticket #5412: Post-now is reachable from a pending_review or
  // needs_changes draft too, not only an already-approved one. The click
  // PERFORMS the approval (via reviewSocialPost) rather than requiring it
  // first, which inherits the gate-BLOCK hard stop for free: reviewSocialPost
  // refuses a `gate_status='block'` row with `reason:'gate_block'`, and that
  // refusal is returned as-is, before anything is published. An already-
  // approved row round-trips its own feedback/editedText unchanged (no gate
  // burn, since nothing about the content changed).
  if (intent === 'post-approved-draft') {
    const postId = parseInt(form.get('postId') as string)
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    const [draft] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1)
    if (!draft) return { ok: false, error: 'Post not found' }
    if (draft.status !== 'draft' || !POST_NOW_ELIGIBLE_REVIEW_STATUSES.includes(draft.reviewStatus)) {
      return { ok: false, error: 'Post must be a pending, needs-changes, or approved draft' }
    }
    if (draft.reviewStatus !== 'approved') {
      const approve = await approveForPostNow(draft, await ownerLabel(request))
      if (!approve.ok) return { ok: false, error: approve.error }
    }
    // The durable stock guard the media path already ran, now on X too
    // (ticket #2212). It reads shopify_product_id, set at draft time.
    const draftStock = await checkLinkedProductStock(draft.shopifyProductId)
    if (!draftStock.ok) {
      await db.update(socialPosts)
        .set({
          reviewStatus: 'needs_changes',
          // Stamp preserved behind the note for burn-in readers (#4913).
          feedback: preserveGateStamp(
            draft.feedback,
            `[stock-guard] ${draftStock.detail} Swap the product or re-draft before this can publish.`,
          ),
          updatedAt: new Date(),
        })
        .where(eq(socialPosts.id, postId))
      return { ok: false, error: `${draftStock.detail} Moved to Needs Changes.` }
    }
    // Ticket #5412(e): the X path used to hardcode isVideo:false, so a
    // video-bearing X draft (the video pipeline fans out to X too) was judged
    // by still-image rules instead of its own.
    const isVideo = isVideoPost(draft)
    const gate = await decideManualPublish(
      {
        isVideo,
        platform: 'x',
        caption: draft.editedText?.trim() || draft.tweetText,
        mediaUrls: draft.mediaUrls,
        productHandle: await resolvePostProductHandle(draft),
      },
      getValve,
    )
    if (!gate.ok) return { ok: false, error: gate.error }
    const result = await postApprovedDraft(postId)
    if (result.ok) await recordManualPublish(postId, draft, await ownerLabel(request))
    return { ok: result.ok, intent: 'post-approved-draft', tweetId: result.tweetId, error: result.error }
  }

  // ── Media posting via platform publishers. Instagram is live; TikTok and
  // YouTube are still stubs and report the manual path.
  if (intent === 'post-media') {
    const postId = parseInt(form.get('postId') as string)
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1)
    if (!post || post.status !== 'draft' || !POST_NOW_ELIGIBLE_REVIEW_STATUSES.includes(post.reviewStatus)) {
      return { ok: false, error: 'Post must be a pending, needs-changes, or approved draft' }
    }
    if (post.reviewStatus !== 'approved') {
      const approve = await approveForPostNow(post, await ownerLabel(request))
      if (!approve.ok) return { ok: false, error: approve.error }
    }
    const mediaUrls = post.mediaUrls ?? []
    const mediaUrl = mediaUrls[0]
    if (!mediaUrl) return { ok: false, error: 'Draft has no media URL' }
    // Publish-time stock guard (ticket #2212), independent of the gate
    // stamp's own product handle. See stock-guard.server.ts.
    const stock = await checkLinkedProductStock(post.shopifyProductId)
    if (!stock.ok) {
      await db.update(socialPosts)
        .set({
          status: 'draft',
          reviewStatus: 'needs_changes',
          // Stamp preserved behind the note for burn-in readers (#4913).
          feedback: preserveGateStamp(
            post.feedback,
            `[stock-guard] ${stock.detail} Swap the product or re-draft before this can publish.`,
          ),
          updatedAt: new Date(),
        })
        .where(eq(socialPosts.id, postId))
      return { ok: false, error: `${stock.detail} Moved to Needs Changes.` }
    }
    const isVideo = isVideoPost(post)
    // Product linkage first, legacy stamp as burn-in fallback (#4913). Resolved
    // once and shared by the manual checks and the publisher's catalog tag.
    const productHandle = await resolvePostProductHandle(post)
    const gate = await decideManualPublish(
      {
        isVideo,
        caption: post.editedText?.trim() || post.tweetText,
        mediaUrls: post.mediaUrls,
        productHandle,
      },
      getValve,
    )
    if (!gate.ok) {
      return gate.stub ? { ok: false, stub: true, error: gate.error } : { ok: false, error: gate.error }
    }
    const { getPublisher } = await import('~/lib/social-publish/registry.server')
    const publisher = getPublisher(post.platform)
    if (!publisher) return { ok: false, stub: true, error: `No publisher for ${post.platform}` }
    // A still draft carrying more than one media URL publishes as a carousel;
    // a single still or any video keeps the existing single-container path.
    const media: PublishMedia = isVideo
      ? { kind: 'video', videoUrl: mediaUrl, ...(post.posterUrl ? { posterUrl: post.posterUrl } : {}) }
      : mediaUrls.length > 1
        ? { kind: 'carousel', imageUrls: mediaUrls }
        : { kind: 'image', imageUrl: mediaUrl }
    const result = await publisher.publish({
      postId,
      media,
      caption: post.editedText?.trim() || post.tweetText,
      productTagHandle: productHandle,
    })
    if (!result.ok) {
      return {
        ok: false,
        stub: result.reason === 'not_configured',
        error: result.reason === 'not_configured'
          ? `${post.platform} API keys are not configured yet. Copy the caption and download the video to post manually.`
          : result.detail ?? 'Publish failed',
      }
    }
    await db.update(socialPosts)
      .set({
        status: 'posted',
        externalPostId: result.externalPostId,
        postedAt: new Date(),
        permalink: await permalinkFor(post.platform, result.externalPostId),
        updatedAt: new Date(),
      })
      .where(eq(socialPosts.id, postId))
    await recordManualPublish(postId, post, await ownerLabel(request))
    return { ok: true }
  }

  /**
   * Record a post the owner shipped by hand on a platform this codebase
   * cannot publish to.
   *
   * LinkedIn (and tiktok/youtube, whose registry adapters are
   * `not_configured` stubs) had no terminal state. The hourly job only runs
   * instagram and x, and Post-now dead-ends on `No publisher for <platform>`,
   * so an approved LinkedIn draft sat in the Approved tab forever: #37 and
   * #38 were scheduled for 2026-08-13 and were still there two weeks later.
   * The Studio already told the owner to "copy the caption and post manually"
   * and then gave him no way to say that he had.
   *
   * This publishes nothing. It writes down that the owner did, which is what
   * moves the row to History and puts it on the calendar at the hour it
   * actually went out. No externalPostId and no permalink, because there is
   * no API response to take them from, and inventing either would make
   * `livePostUrl` offer a link that goes nowhere.
   *
   * Narrow on purpose. It refuses any platform Post-now can really ship, so
   * it can never become a way to mark an Instagram or X row live without
   * publishing it, and it requires an already-approved row rather than
   * approving on the way through like Post-now does: the owner had to reach
   * Approved to get the caption he pasted, so there is no click to save.
   */
  if (intent === 'mark-posted') {
    const postId = parseInt(form.get('postId') as string)
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1)
    if (!post) return { ok: false, error: 'Post not found' }
    if (!isManualPublishPlatform(post.platform)) {
      return { ok: false, error: `${post.platform} publishes from here; use Post now so the row gets a real post id.` }
    }
    if (post.status !== 'draft' || post.reviewStatus !== 'approved') {
      return { ok: false, error: 'Only an approved draft can be marked as posted' }
    }
    const by = await ownerLabel(request)
    const now = new Date()
    await db.update(socialPosts)
      .set({
        status: 'posted',
        postedAt: now,
        // Appended, never prepended, so the gate stamp block stays intact for
        // the burn-in readers that still parse it (#4913).
        feedback: `${post.feedback ?? ''}${manualPostNote(post.platform, by, now)}`.trim(),
        updatedAt: now,
      })
      .where(eq(socialPosts.id, postId))
    return { ok: true, intent: 'mark-posted' }
  }

  // Delete and retry are platform-aware (ticket #4908 / #4935): a retry re-runs
  // the publish the row earned, with the owner's edited text and every slide;
  // a delete works on drafts, failed rows, X posts (deleted on X first) and
  // Instagram posts (row only, the API cannot delete media).
  if (intent === 'delete-post') {
    const postId = parseInt(form.get('postId') as string)
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    const result = await deleteSocialPost(postId)
    return { ok: result.ok, intent: 'delete-post', note: result.note, error: result.error }
  }

  if (intent === 'retry-post') {
    const postId = parseInt(form.get('postId') as string)
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    const result = await retryFailedSocialPost(postId)
    return { ok: result.ok, intent: 'retry-post', tweetId: result.externalPostId, error: result.error }
  }


  return { ok: false, error: 'Unknown intent' }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const VIEWS = [
  { key: 'review', label: 'Review' },
  { key: 'approved', label: 'Approved' },
  { key: 'history', label: 'History' },
] as const
type View = (typeof VIEWS)[number]['key']

export default function SocialsQueue() {
  const { posts: raw } = useLoaderData<typeof loader>()
  const posts = raw as unknown as SocialPostRow[]
  const [params, setParams] = useSearchParams()
  const view: View = (VIEWS.some(v => v.key === params.get('view')) ? params.get('view') : 'review') as View

  const pending = posts.filter(
    p => p.status === 'draft' && (p.reviewStatus === 'pending_review' || p.reviewStatus === 'needs_changes'),
  )
  const approved = posts.filter(p => p.status === 'draft' && p.reviewStatus === 'approved')
  const history = posts.filter(p => !(p.status === 'draft' && (p.reviewStatus === 'pending_review' || p.reviewStatus === 'needs_changes' || p.reviewStatus === 'approved')))

  const counts: Record<View, number> = { review: pending.length, approved: approved.length, history: history.length }

  // Ticket #5415: the "Rework of #N" chip on a child row was already a
  // one-way pointer; the parent showed nothing. Built once off the full
  // loaded set (not just the visible tab) so a rejected parent in History
  // links forward to whatever reworked it, wherever that landed.
  const childrenByParent = useMemo(() => {
    const map = new Map<number, number[]>()
    for (const p of posts) {
      if (p.reworkedFrom == null) continue
      const arr = map.get(p.reworkedFrom) ?? []
      arr.push(p.id)
      map.set(p.reworkedFrom, arr)
    }
    return map
  }, [posts])

  // j/k move a focus ring over the pending cards; a/r click that card's own
  // Approve / Request-changes button, so the keyboard path and the click path
  // are the same submit.
  const [focusIdx, setFocusIdx] = useState(-1)
  const shortcuts = useMemo(() => ({
    j: () => setFocusIdx(i => Math.min(pending.length - 1, i + 1)),
    k: () => setFocusIdx(i => Math.max(0, i - 1)),
    a: () => clickReview(pending[focusIdx]?.id, 'approved'),
    r: () => clickReview(pending[focusIdx]?.id, 'needs_changes'),
    n: () => { window.location.assign('/admin/socials/compose/new') },
  }), [pending, focusIdx])
  useStudioShortcuts(shortcuts, view === 'review')

  function clickReview(postId: number | undefined, decision: string) {
    if (!postId) return
    const card = document.querySelector<HTMLElement>(`[data-post-id="${postId}"]`)
    card?.querySelector<HTMLButtonElement>(`[data-review="${decision}"]`)?.click()
  }
  const focusedId = pending[focusIdx]?.id ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Queue view" className="inline-flex rounded-full border border-line bg-paper p-0.5">
          {VIEWS.map(v => (
            <button
              key={v.key}
              role="tab"
              type="button"
              aria-selected={view === v.key}
              onClick={() => setParams(prev => { const n = new URLSearchParams(prev); n.set('view', v.key); return n }, { preventScrollReset: true })}
              className={`inline-flex items-center gap-1.5 min-h-10 px-3 rounded-full text-sm font-medium ${view === v.key ? 'bg-ink text-white' : 'text-ink-3 hover:text-ink'}`}
            >
              {v.label}
              <span className={`font-mono text-[11px] tabular-nums ${view === v.key ? 'text-white/70' : 'text-ink-4'}`}>{counts[v.key]}</span>
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Link
          to="/admin/socials/compose/new"
          className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full border border-line bg-paper text-ink text-sm font-semibold hover:border-ink-4"
          title="New post (n). Approve is the primary action on this screen"
        >
          <PlusIcon size={14} /> New post
        </Link>
      </div>

      {view === 'review' && (
        <div data-focused-post={focusedId ?? undefined} className="[&_[data-post-id]]:transition-shadow">
          {focusedId && (
            <style>{`[data-post-id="${focusedId}"]{box-shadow:0 0 0 2px var(--color-coral)}`}</style>
          )}
          <ReviewQueue posts={pending} childrenByParent={childrenByParent} />
          <p className="mt-3 text-[11px] text-ink-4 hidden md:block">
            Keys: <span className="font-mono">j</span>/<span className="font-mono">k</span> move, <span className="font-mono">a</span> approve, <span className="font-mono">r</span> request changes, <span className="font-mono">n</span> new post.
          </p>
        </div>
      )}
      {view === 'approved' && <ApprovedList posts={approved} />}
      {view === 'history' && <HistoryTable posts={history} childrenByParent={childrenByParent} />}
    </div>
  )
}

// ── Approved view ────────────────────────────────────────────────────────────

function ApprovedList({ posts }: { posts: SocialPostRow[] }) {
  if (posts.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-paper p-10 text-center">
        <p className="text-sm text-ink">No approved drafts waiting.</p>
        <p className="text-xs text-ink-3 mt-1">Approve drafts in Review and they queue up here with their slot.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {posts.map(post => <ApprovedRow key={post.id} post={post} />)}
    </div>
  )
}

function ApprovedRow({ post }: { post: SocialPostRow }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string; tweetId?: string; stub?: boolean; intent?: string }>()
  const revert = useFetcher<{ ok: boolean; error?: string }>()
  const [copied, setCopied] = useState(false)
  const text = post.editedText?.trim() || post.tweetText
  const media = post.mediaUrls?.[0] ?? null
  const video = isVideoPost(post)
  const manual = isManualPublishPlatform(post.platform)
  // Late by the same rule the tick uses (OVERDUE_AFTER_MS). A manual-platform
  // row is not late, it is waiting on the owner, and the "posts by hand" chip
  // already says so; stacking a second chip on it would read as a fault.
  const overdue = !manual && approvedSlotIsOverdue(post)
  const isSubmitting = fetcher.state !== 'idle'
  const slot = formatLaWallClock(post.scheduledAt ?? null)
    ?? (post.scheduledFor ? new Date(`${post.scheduledFor}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null)

  async function copyCaption() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (revert.data?.ok) {
    return (
      <div className="rounded-2xl border border-line bg-paper-2 p-4 text-sm text-ink-3">
        Post #{post.id} is back in Review as a draft; the gate will look again.
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-line bg-paper p-4 flex flex-col md:flex-row gap-3 md:items-center">
      {media && (video ? (
        <div className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-ink">
          <img src={post.posterUrl ?? undefined} alt="" className="w-full h-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center text-white font-mono text-[10px]">video</span>
        </div>
      ) : (
        <img src={media} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-paper-3" />
      ))}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <PlatformChip platform={post.platform} />
          <StatusPill status={studioStatusOf(post)} />
          <GatePill status={post.gateStatus ?? (parseGateStampClient(post.feedback))} />
          {slot && <span className="font-mono text-[11px] text-ink-3">{slot}</span>}
          {overdue && (
            <span
              className="font-mono text-[11px] uppercase tracking-wide text-white bg-coral rounded-full px-2 py-0.5"
              title="Approved and days past its slot, so the hourly publisher has been skipping or failing. Check the autopublish valve, the daily cap, and the spend ceiling."
            >
              overdue
            </span>
          )}
          {manual && (
            <span
              className="font-mono text-[11px] uppercase tracking-wide text-ink-3 border border-line rounded-full px-2 py-0.5"
              title={`Nothing publishes to ${post.platform} from here, and the hourly job does not run it. This row waits on you, not on a slot.`}
            >
              posts by hand
            </span>
          )}
          {(post.mediaUrls?.length ?? 0) > 1 && <span className="font-mono text-[11px] text-ink-4">{post.mediaUrls!.length} slides</span>}
        </div>
        <p className="text-sm text-ink break-words">{text.length > 160 ? `${text.slice(0, 160)}...` : text}</p>
        {fetcher.data?.ok === false && <p className="text-xs text-red-700 mt-1">{fetcher.data.error}</p>}
        {fetcher.data?.ok && fetcher.data.tweetId && (
          <p className="text-xs text-[#4F6150] mt-1">Posted, id <span className="font-mono">{fetcher.data.tweetId}</span></p>
        )}
        {revert.data?.ok === false && <p className="text-xs text-red-700 mt-1">{revert.data.error}</p>}
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        {manual ? (
          /* No publisher exists for this platform, so Post-now would only ever
             report the manual path. Offer the action that is actually real:
             copy the caption, post it by hand, then record that here. */
          <>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="mark-posted" />
              <input type="hidden" name="postId" value={post.id} />
              <button
                type="submit"
                disabled={isSubmitting || Boolean(fetcher.data?.ok)}
                className="min-h-11 px-4 bg-coral text-white rounded-full text-sm font-semibold hover:bg-coral-2 transition-colors disabled:opacity-50"
                title={`Nothing publishes to ${post.platform} from here. Post it by hand, then mark it so it leaves the queue and lands on the calendar.`}
              >
                {isSubmitting ? 'Marking' : 'Mark as posted'}
              </button>
            </fetcher.Form>
            <button
              type="button"
              onClick={copyCaption}
              className="min-h-11 px-4 bg-paper-2 text-ink rounded-full text-sm font-medium border border-line hover:border-ink-4 transition-colors"
            >
              {copied ? 'Copied' : 'Copy caption'}
            </button>
            {media && (
              <a
                href={media}
                target="_blank"
                rel="noopener noreferrer"
                download={video || undefined}
                className="inline-flex items-center min-h-11 px-4 bg-paper-2 text-ink-3 rounded-full text-sm font-medium border border-line hover:border-ink-4 transition-colors"
              >
                {video ? 'Download video' : 'Open media'}
              </a>
            )}
          </>
        ) : post.platform === 'x' ? (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="post-approved-draft" />
            <input type="hidden" name="postId" value={post.id} />
            <button
              type="submit"
              disabled={isSubmitting || Boolean(fetcher.data?.ok)}
              className="min-h-11 px-4 bg-coral text-white rounded-full text-sm font-semibold hover:bg-coral-2 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Posting' : 'Post now'}
            </button>
          </fetcher.Form>
        ) : (
          <>
            {/* Ticket #5412(d): this used to render nothing at all for a
                media-less approved draft, which read as "there is no way to
                publish this" rather than "add media first". Always render the
                button; disable it with a reason instead of hiding it. */}
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="post-media" />
              <input type="hidden" name="postId" value={post.id} />
              <button
                type="submit"
                disabled={isSubmitting || !media}
                className="min-h-11 px-4 bg-coral text-white rounded-full text-sm font-semibold hover:bg-coral-2 transition-colors disabled:opacity-50"
                title={!media ? 'This draft has no image or video yet' : 'Publishes via the platform API once keys are set; until then this reports the manual path.'}
              >
                {isSubmitting ? 'Trying' : 'Post now'}
              </button>
            </fetcher.Form>
            <button
              type="button"
              onClick={copyCaption}
              className="min-h-11 px-4 bg-paper-2 text-ink rounded-full text-sm font-medium border border-line hover:border-ink-4 transition-colors"
            >
              {copied ? 'Copied' : 'Copy caption'}
            </button>
            {media && (
              <a
                href={media}
                target="_blank"
                rel="noopener noreferrer"
                download={video || undefined}
                className="inline-flex items-center min-h-11 px-4 bg-paper-2 text-ink-3 rounded-full text-sm font-medium border border-line hover:border-ink-4 transition-colors"
              >
                {video ? 'Download video' : 'Open media'}
              </a>
            )}
          </>
        )}
        <Link
          to={`/admin/socials/compose/${post.id}`}
          className="inline-flex items-center gap-1 min-h-11 px-3 text-ink-3 rounded-full text-sm font-medium border border-line hover:border-ink-4"
          title="Open in the Composer (edits return it to pending)"
        >
          <PenIcon size={14} /> Edit
        </Link>
        <revert.Form method="post">
          <input type="hidden" name="intent" value="revert-to-draft" />
          <input type="hidden" name="postId" value={post.id} />
          <button
            type="submit"
            disabled={revert.state !== 'idle'}
            className="inline-flex items-center gap-1 min-h-11 px-3 text-ink-3 rounded-full text-sm font-medium border border-line hover:border-ink-4 disabled:opacity-50"
            title="Back to pending review; clears the approval and the gate verdict"
          >
            <UndoIcon size={14} /> Revert to draft
          </button>
        </revert.Form>
        {fetcher.data?.stub && (
          <p className="w-full text-xs text-ink-3">
            {fetcher.data.error ?? 'Platform posting is not configured yet. Copy the caption and download the video to post manually.'}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Client-side read of the legacy stamp header, used only when `gate_status`
 * is null (the column wins, see `effectiveGateStatus`).
 * TODO(#4913 burn-in): remove with the stamp; the pill then reads the column alone.
 */
function parseGateStampClient(feedback: string | null): string | null {
  const m = /^\[publish-gate (PASS|REVISE|BLOCK|HOLD) /m.exec(feedback ?? '')
  return m ? (m[1] as string).toLowerCase() : null
}

// ── Live feedback (ticket #2738) ─────────────────────────────────────────────

function LiveFeedbackForm({ postId, hasFeedback }: { postId: number; hasFeedback: boolean }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>()
  const [open, setOpen] = useState(false)
  const busy = fetcher.state !== 'idle'

  if (hasFeedback && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-ink-4 hover:underline mt-1 min-h-9">
        Change feedback
      </button>
    )
  }

  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex items-center gap-3 flex-wrap">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="review-live" />
          <input type="hidden" name="postId" value={postId} />
          <input type="hidden" name="verdict" value="worked" />
          <button type="submit" disabled={busy} className="text-xs text-[#4F6150] hover:underline disabled:opacity-50 min-h-9">
            This worked
          </button>
        </fetcher.Form>
        <button type="button" onClick={() => setOpen(v => !v)} className="text-xs text-ink-4 hover:underline min-h-9">
          {open ? 'Cancel' : 'Something was off'}
        </button>
      </div>
      {open && (
        <fetcher.Form method="post" className="flex flex-col gap-1 md:flex-row md:items-center">
          <input type="hidden" name="intent" value="review-live" />
          <input type="hidden" name="postId" value={postId} />
          <input
            type="text"
            name="note"
            required
            placeholder="What was off? The team reads this verbatim."
            className="text-xs border border-line rounded-lg px-2 min-h-9 flex-1 min-w-0"
          />
          <div className="flex items-center gap-3">
            <button type="submit" name="verdict" value="off" disabled={busy} className="text-xs text-ink-3 hover:underline disabled:opacity-50 min-h-9">
              Note it
            </button>
            <button type="submit" name="verdict" value="pull" disabled={busy} className="text-xs text-red-700 hover:underline disabled:opacity-50 min-h-9">
              Pull this
            </button>
          </div>
        </fetcher.Form>
      )}
      {fetcher.data && !fetcher.data.ok && <p className="text-xs text-red-700">{fetcher.data.error}</p>}
    </div>
  )
}

// ── History view ─────────────────────────────────────────────────────────────

function HistoryTable({ posts, childrenByParent }: { posts: SocialPostRow[]; childrenByParent: Map<number, number[]> }) {
  const deleteFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const retryFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const cloneFetcher = useFetcher<{ ok: boolean; error?: string; id?: number }>()
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  if (posts.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-paper p-10 text-center">
        <p className="text-sm text-ink">Nothing published, failed or rejected yet.</p>
        <p className="text-xs text-ink-3 mt-1">Rows land here once they leave Review or Approved.</p>
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-line bg-paper p-3 md:p-4">
      <ResponsiveTable>
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3 border-b border-line">
              <th className="py-2 pr-3 font-semibold">Post</th>
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 font-semibold">When</th>
              <th className="py-2 pr-3 font-semibold">By</th>
              <th className="py-2 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {posts.map(post => {
              const live = parseLiveFeedback(post.feedback)
              const link = livePostUrl(post)
              return (
                <tr key={post.id} className="align-top">
                  <td className="py-3 pr-3 max-w-[360px]">
                    <div className="flex items-start gap-2">
                      {post.mediaUrls?.[0] && !isVideoPost(post) && (
                        <img src={post.mediaUrls[0]} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 bg-paper-3" loading="lazy" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <PlatformChip platform={post.platform} />
                          <span className="font-mono text-[11px] text-ink-4">#{post.id}</span>
                          {/* Ticket #5415: the rework relationship used to be
                              one-directional (only the child named its
                              parent). Both directions now link. */}
                          {post.reworkedFrom != null && (
                            <Link to={`/admin/socials/compose/${post.reworkedFrom}`} className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-plum-soft text-plum hover:underline">
                              Rework of #{post.reworkedFrom}
                            </Link>
                          )}
                          {(childrenByParent.get(post.id) ?? []).map(childId => (
                            <Link key={childId} to={`/admin/socials/compose/${childId}`} className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-sage/20 text-sage hover:underline">
                              Reworked as #{childId}
                            </Link>
                          ))}
                        </div>
                        <p className="text-ink break-words whitespace-pre-wrap">
                          {post.tweetText.length > 160 ? `${post.tweetText.slice(0, 160)}...` : post.tweetText}
                        </p>
                        {post.feedback && (
                          <p className="text-xs text-ink-3 mt-1 italic" title={post.feedback}>
                            {live ? `Live (${live.verdict})` : 'Feedback'}
                            {(live ? live.note : post.feedback) ? `: ${(live ? live.note : post.feedback)!.slice(0, 120)}` : ''}
                          </p>
                        )}
                        {post.status === 'posted' && (
                          <LiveFeedbackForm postId={post.id} hasFeedback={!!live} />
                        )}
                        {post.status === 'failed' && post.errorMessage && (
                          <p className="text-xs text-red-700 mt-1 break-words">{post.errorMessage}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-col gap-1 items-start">
                      <StatusPill status={studioStatusOf(post)} />
                      <span className="font-mono text-[11px] text-ink-4">{post.reviewStatus.replace('_', ' ')}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-3 font-mono text-[11px] text-ink-3 whitespace-nowrap">
                    {post.postedAt
                      ? formatLaWallClock(post.postedAt)
                      : post.createdAt
                        ? formatLaWallClock(post.createdAt)
                        : ''}
                  </td>
                  <td className="py-3 pr-3 text-xs text-ink-3">
                    <span className="capitalize">{post.createdBy}</span>
                    {post.reviewedBy && <span className="block text-ink-4">reviewed {post.reviewedBy}</span>}
                  </td>
                  <td className="py-3 text-right">
                    <div className="inline-flex items-center gap-2 flex-wrap justify-end">
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#4F6150] hover:underline min-h-9">
                          <ExternalIcon size={12} /> View
                        </a>
                      )}
                      {/* Ticket #5417(b): only ApprovedRow had an Edit link
                          before; fixing a caption or a media pick on any
                          draft (not just an approved one) needed hand-typing
                          the compose URL. The Composer itself opens read-only
                          with a reason on posted/failed/rejected rows. */}
                      <Link
                        to={`/admin/socials/compose/${post.id}`}
                        className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink hover:underline min-h-9"
                        title="Open in the Composer"
                      >
                        <PenIcon size={12} /> Edit
                      </Link>
                      {canDeletePost(post) && (
                        deleteConfirmId === post.id ? (
                          <span className="inline-flex items-center gap-2">
                            <deleteFetcher.Form method="post">
                              <input type="hidden" name="intent" value="delete-post" />
                              <input type="hidden" name="postId" value={post.id} />
                              <button
                                type="submit"
                                className="text-xs text-red-700 hover:underline min-h-9"
                                onClick={() => setDeleteConfirmId(null)}
                                title={post.status === 'posted' && post.platform === 'instagram'
                                  ? 'Removes the row here only. Instagram has no delete API; remove the post in the app.'
                                  : post.status === 'posted' ? 'Deletes the post on X, then removes the row' : 'Removes this draft from the Studio'}
                              >
                                {post.status === 'posted'
                                  ? (post.platform === 'instagram' ? 'Confirm remove (still live on Instagram)' : 'Confirm delete on X')
                                  : 'Confirm delete'}
                              </button>
                            </deleteFetcher.Form>
                            <button type="button" onClick={() => setDeleteConfirmId(null)} className="text-xs text-ink-4 hover:underline min-h-9">
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setDeleteConfirmId(post.id)} className="text-xs text-ink-3 hover:text-red-700 min-h-9">
                            {post.status === 'posted' && post.platform === 'instagram' ? 'Remove' : 'Delete'}
                          </button>
                        )
                      )}
                      {post.status === 'failed' && (
                        <retryFetcher.Form method="post">
                          <input type="hidden" name="intent" value="retry-post" />
                          <input type="hidden" name="postId" value={post.id} />
                          <button type="submit" disabled={retryFetcher.state !== 'idle'} className="text-xs text-[#4F6150] hover:underline disabled:opacity-50 min-h-9">
                            Retry
                          </button>
                        </retryFetcher.Form>
                      )}
                      {/* Ticket #5416(b): rejection (including a gate BLOCK)
                          is terminal by design, no code path re-verdicts a
                          rejected row, but the owner also uses Reject to mean
                          "this needs real changes". Clone is the sanctioned
                          escape: a fresh pending_review row, gate_status
                          null, judged on its own merits, never the dead row
                          itself. */}
                      {post.status === 'draft' && post.reviewStatus === 'rejected' && (
                        cloneFetcher.data?.ok && cloneFetcher.formData?.get('postId') === String(post.id) ? (
                          <span className="text-[11px] text-[#4F6150]">
                            Cloned as #{cloneFetcher.data.id}
                          </span>
                        ) : (
                          <cloneFetcher.Form method="post">
                            <input type="hidden" name="intent" value="clone-to-new-draft" />
                            <input type="hidden" name="postId" value={post.id} />
                            <button
                              type="submit"
                              disabled={cloneFetcher.state !== 'idle'}
                              className="text-xs text-ink-3 hover:text-ink hover:underline disabled:opacity-50 min-h-9"
                              title="No override; this row stays rejected. Mints a new draft carrying its content and lineage forward, gated normally."
                            >
                              {cloneFetcher.state !== 'idle' ? 'Cloning' : 'Clone to new draft'}
                            </button>
                          </cloneFetcher.Form>
                        )
                      )}
                    </div>
                    {deleteFetcher.data?.ok === false && <p className="text-xs text-red-700 mt-1">{deleteFetcher.data.error}</p>}
                    {deleteFetcher.data?.ok === true && (deleteFetcher.data as { note?: string }).note && (
                      <p role="status" className="text-xs text-amber-800 mt-1">{(deleteFetcher.data as { note?: string }).note}</p>
                    )}
                    {retryFetcher.data?.ok === false && <p className="text-xs text-red-700 mt-1">{retryFetcher.data.error}</p>}
                    {cloneFetcher.data?.ok === false && cloneFetcher.formData?.get('postId') === String(post.id) && (
                      <p className="text-xs text-red-700 mt-1">{cloneFetcher.data.error}</p>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </ResponsiveTable>
    </section>
  )
}

/**
 * Is this approved draft late enough that the publisher should have shipped it?
 *
 * Mirrors `OVERDUE_AFTER_MS` and the publisher's `COALESCE(scheduled_at,
 * scheduled_for)` slot, deliberately duplicated rather than imported: the
 * source of both lives in a `.server.ts` that must not reach the client
 * bundle. Being a chip, it is allowed to be approximate; the blocker filed by
 * `reportOverdueApproved` is the authoritative one.
 */
const OVERDUE_DAYS = 3

function approvedSlotIsOverdue(post: Pick<SocialPostRow, 'scheduledAt' | 'scheduledFor'>): boolean {
  const raw = post.scheduledAt ?? (post.scheduledFor ? `${post.scheduledFor}T00:00:00Z` : null)
  if (!raw) return false
  const slot = new Date(raw)
  if (Number.isNaN(slot.getTime())) return false
  return Date.now() - slot.getTime() > OVERDUE_DAYS * 86_400_000
}

/**
 * Which rows the owner can delete from the history list. Drafts and failed
 * rows always; live X posts (deleted on X first); live Instagram posts as a
 * row-only removal. `publishing` belongs to a tick and `deleted` is done.
 */
function canDeletePost(post: Pick<SocialPostRow, 'status' | 'platform' | 'externalPostId'>): boolean {
  if (post.status === 'draft' || post.status === 'failed') return true
  if (post.status !== 'posted') return false
  if (post.platform === 'x') return !!post.externalPostId
  return post.platform === 'instagram'
}
