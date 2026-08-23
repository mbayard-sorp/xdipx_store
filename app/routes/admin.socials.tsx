/**
 * /admin/socials, the social post management interface.
 *
 * Rebuilt (ticket: admin.socials rebuild, 2026-08-22) from a five-tab layout
 * that rendered the same draft up to three times with three different
 * treatments, had no per-post detail view, no image regeneration, and lost
 * feedback on every revalidation. This is an operator workspace: a two-pane
 * list/detail workspace (URL-addressable via `?view=&platform=&post=`), one
 * visual treatment for a post row everywhere it appears, and two new
 * immediate-response actions (regenerate image, rework caption+image now)
 * that answer the owner's actual complaint, "if I want a new image or have
 * feedback, I want an immediate response on it."
 *
 * Publishing has two paths. The owner's explicit clicks (Quick X post, Post-now
 * on an approved draft) always work. Unattended publishing runs on the hourly
 * /cron/social-publish tick and is gated per platform by
 * instagram_autopublish_enabled and x_autopublish_enabled, both default off.
 * Those two govern the UNATTENDED tick only. The owner's Post-now click here
 * publishes a still on either platform regardless (owner direction 2026-08-23);
 * video alone still reads video_autopublish_enabled, which is his frame review.
 *
 * Four views, chosen in the loader from `?view=`:
 *   - queue:     pending_review + needs_changes drafts (the old Review tab)
 *   - scheduled: approved drafts not yet posted, grouped by scheduled_for
 *   - live:      posted rows, with metrics when present
 *   - all:       everything, filterable by status/platform, paginated
 *
 * Publishing still has two paths. The owner's explicit clicks (Quick X post,
 * Post now on an approved draft) always work. Unattended publishing runs on
 * the hourly /cron/social-publish tick, gated per platform by
 * instagram_autopublish_enabled and x_autopublish_enabled (both default off,
 * status shown read-only in the top strip).
 */
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher, Link, redirect } from 'react-router'
import { useState } from 'react'
import { and, desc, eq, gte, inArray, isNull, isNotNull, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { socialPosts } from '../../db/schema'
import { postManualTweet, deleteAndLogTweet, retryFailedPost, postApprovedDraft } from '~/lib/twitter.server'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import {
  getSocialFrequencies, reviewSocialPost, rescheduleSocialPost, recordLivePostFeedback,
  getValve, VALVE_KEYS,
} from '~/lib/team.server'
// Pure encoding, imported from the non-server module: components below render
// a stored verdict, and a component that reaches into a .server module pulls
// the whole module into the client build.
import { isLivePostVerdict } from '~/lib/live-post-feedback'
import { setPipelineSetting } from '~/lib/pricing-webhook.server'
import { SOCIAL_REVIEW_STATUSES, socialFreqKey } from '~/lib/team-keys'
import { parseBatchPostIds, groupByScheduledDay } from '~/components/admin/social/review-batch'
import { PlatformChip } from '~/components/admin/social/PostPreviewCard'
import { PLATFORM_LABELS, isVideoPost, type SocialPostRow } from '~/components/admin/social/types'
import { parseFeedback, type GateVerdict } from '~/components/admin/social/parse-feedback'
import { ElapsedTimer } from '~/components/admin/social/ElapsedTimer'
import { Reveal } from '~/components/motion/Reveal'
import type { PublishMedia } from '~/lib/social-publish/types'
import { decideManualPublish } from '~/lib/social-publish/manual-publish-gate.server'
import { checkLinkedProductStock } from '~/lib/social-publish/stock-guard.server'
import { parseGateStamp } from '~/lib/social-publish-approve.server'
import {
  regenerateSocialImage, reworkCaption, createOwnerReworkRow, ownerApprovePost,
  type ReworkArchetype,
} from '~/lib/social-admin-rework.server'
import { weightedTweetLength, X_CAPTION_MAX } from '~/lib/social-publish/x-limits'

export const meta: MetaFunction = () => [{ title: 'Social posts, xdipx Admin' }]

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const VIEW_KEYS = ['queue', 'scheduled', 'live', 'all'] as const
type ViewKey = (typeof VIEW_KEYS)[number]
const PAGE_SIZE = 50

function asView(v: string | null): ViewKey {
  return (VIEW_KEYS as readonly string[]).includes(v ?? '') ? (v as ViewKey) : 'queue'
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const view = asView(url.searchParams.get('view'))
  const platform = url.searchParams.get('platform') ?? 'all'
  const statusFilter = url.searchParams.get('status') ?? 'all'
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const rawPost = url.searchParams.get('post')
  const selectedPostId = rawPost ? parseInt(rawPost, 10) : NaN
  const hasSelection = Number.isFinite(selectedPostId)

  const platformCond = platform !== 'all' ? eq(socialPosts.platform, platform) : undefined
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [
    needsReviewRow, approvedNoDateRow, scheduledDatedRow, posted7dRow,
    frequencies, igAutopublish, xAutopublish,
  ] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(socialPosts)
      .where(and(eq(socialPosts.status, 'draft'), inArray(socialPosts.reviewStatus, ['pending_review', 'needs_changes']))),
    db.select({ n: sql<number>`count(*)::int` }).from(socialPosts)
      .where(and(eq(socialPosts.status, 'draft'), eq(socialPosts.reviewStatus, 'approved'), isNull(socialPosts.scheduledFor))),
    db.select({ n: sql<number>`count(*)::int` }).from(socialPosts)
      .where(and(eq(socialPosts.status, 'draft'), eq(socialPosts.reviewStatus, 'approved'), isNotNull(socialPosts.scheduledFor))),
    db.select({ n: sql<number>`count(*)::int` }).from(socialPosts)
      .where(and(eq(socialPosts.status, 'posted'), gte(socialPosts.postedAt, sevenDaysAgo))),
    getSocialFrequencies(),
    getValve(VALVE_KEYS.instagramAutopublish),
    getValve(VALVE_KEYS.xAutopublish),
  ])

  let posts: (typeof socialPosts.$inferSelect)[] = []
  let totalForView = 0

  if (view === 'queue') {
    const conds = [eq(socialPosts.status, 'draft'), inArray(socialPosts.reviewStatus, ['pending_review', 'needs_changes'])]
    if (platformCond) conds.push(platformCond)
    posts = await db.select().from(socialPosts).where(and(...conds)).orderBy(desc(socialPosts.createdAt)).limit(200)
  } else if (view === 'scheduled') {
    const conds = [eq(socialPosts.status, 'draft'), eq(socialPosts.reviewStatus, 'approved')]
    if (platformCond) conds.push(platformCond)
    posts = await db.select().from(socialPosts).where(and(...conds)).orderBy(desc(socialPosts.createdAt)).limit(200)
  } else if (view === 'live') {
    const conds = [eq(socialPosts.status, 'posted')]
    if (platformCond) conds.push(platformCond)
    posts = await db.select().from(socialPosts).where(and(...conds)).orderBy(desc(socialPosts.postedAt)).limit(200)
  } else {
    const conds = []
    if (platformCond) conds.push(platformCond)
    if (statusFilter !== 'all') conds.push(eq(socialPosts.status, statusFilter))
    const where = conds.length ? and(...conds) : undefined
    const base = db.select().from(socialPosts)
    const countBase = db.select({ n: sql<number>`count(*)::int` }).from(socialPosts)
    const [rows, totalRows] = await Promise.all([
      (where ? base.where(where) : base).orderBy(desc(socialPosts.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
      where ? countBase.where(where) : countBase,
    ])
    posts = rows
    totalForView = totalRows[0]?.n ?? 0
  }

  let selectedPost: (typeof socialPosts.$inferSelect) | null = null
  let lineageParent: (typeof socialPosts.$inferSelect) | null = null
  let lineageChildren: (typeof socialPosts.$inferSelect)[] = []
  if (hasSelection) {
    const [row] = await db.select().from(socialPosts).where(eq(socialPosts.id, selectedPostId)).limit(1)
    selectedPost = row ?? null
    if (selectedPost?.reworkedFrom) {
      const [parent] = await db.select().from(socialPosts).where(eq(socialPosts.id, selectedPost.reworkedFrom)).limit(1)
      lineageParent = parent ?? null
    }
    lineageChildren = await db.select().from(socialPosts)
      .where(eq(socialPosts.reworkedFrom, selectedPostId)).orderBy(desc(socialPosts.createdAt)).limit(20)
  }

  const productIds = new Set<string>()
  for (const p of posts) if (p.shopifyProductId) productIds.add(p.shopifyProductId)
  if (selectedPost?.shopifyProductId) productIds.add(selectedPost.shopifyProductId)
  const stockEntries = await Promise.all(
    [...productIds].map(async id => [id, (await checkLinkedProductStock(id)).ok] as const),
  )
  const stockByProduct: Record<string, boolean> = Object.fromEntries(stockEntries)

  return {
    view, platform, statusFilter, page, pageSize: PAGE_SIZE, totalForView,
    posts: posts as unknown as SocialPostRow[],
    selectedPost: selectedPost as unknown as SocialPostRow | null,
    lineageParent: lineageParent as unknown as SocialPostRow | null,
    lineageChildren: lineageChildren as unknown as SocialPostRow[],
    stockByProduct,
    counts: {
      needsReview: needsReviewRow[0]?.n ?? 0,
      approvedNoDate: approvedNoDateRow[0]?.n ?? 0,
      scheduledDated: scheduledDatedRow[0]?.n ?? 0,
      posted7d: posted7dRow[0]?.n ?? 0,
    },
    frequencies,
    igAutopublish,
    xAutopublish,
  }
}

/**
 * A rework can start from a draft or from a live post (the owner deleted a
 * live post on 2026-08-22 and wanted a new image for it). Drafts are marked
 * needs_changes with the feedback; posted rows cannot take a review verdict,
 * so the feedback is recorded as a live "off" note the team reads verbatim.
 */
async function markSourceReworked(post: { id: number; status: string }, feedback: string, actor: string) {
  if (post.status === 'posted') {
    await recordLivePostFeedback(post.id, { verdict: 'off', note: feedback, reviewedBy: actor })
    return
  }
  await reviewSocialPost(post.id, { reviewStatus: 'needs_changes', feedback, reviewedBy: actor })
}

const FREQ_ALLOWED_KEYS = (['x', 'instagram', 'tiktok', 'facebook', 'youtube', 'linkedin'] as const).map(p => socialFreqKey(p))
const REWORK_ARCHETYPES: readonly ReworkArchetype[] = ['scene', 'cast', 'metaphor', 'macro', 'plate']

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

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
 * Appended, never prepended, because `parseGateStamp` is anchored at the start
 * of the field and other readers still parse it.
 */
async function recordManualPublish(
  postId: number,
  feedback: string | null,
  by: string,
): Promise<void> {
  const stamp = parseGateStamp(feedback)
  if (stamp?.verdict === 'PASS') return
  const had = stamp ? `over a gate ${stamp.verdict}` : 'with no gate verdict on the row'
  const note =
    `\n\n[manual-publish by ${by} on ${new Date().toISOString().slice(0, 10)}] ` +
    `Published from Post-now ${had}. The deterministic publish checks passed; ` +
    `the agent verdict was the owner's call.`
  await db.update(socialPosts)
    .set({ feedback: `${feedback ?? ''}${note}`.trim() })
    .where(eq(socialPosts.id, postId))
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

  // ── Live-post feedback (owner-only). Review is a gate on drafts, not a way
  // to relabel history, so this writes feedback + reviewer only.
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

  // ── Batch review (Queue view only): approve/reject many drafts at once.
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

  if (intent === 'set-frequency') {
    const key = form.get('key') as string | null
    const raw = form.get('value') as string | null
    const value = raw == null ? NaN : parseInt(raw, 10)
    if (!key || !FREQ_ALLOWED_KEYS.includes(key)) {
      return { ok: false, error: `Invalid key: ${key}` }
    }
    if (!Number.isFinite(value) || value < 0 || value > 5) {
      return { ok: false, error: 'Frequency must be 0-5 posts/day' }
    }
    await setPipelineSetting(key, String(value))
    return { ok: true, saved: key }
  }

  if (intent === 'reschedule') {
    const postId = parseInt(form.get('postId') as string)
    const day = (form.get('scheduledFor') as string | null) ?? ''
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: 'Bad date' }
    await rescheduleSocialPost(postId, day || null)
    return { ok: true }
  }

  // ── Live posting: explicit owner clicks only ─────────────────────────────
  if (intent === 'post-approved-draft') {
    const postId = parseInt(form.get('postId') as string)
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    const [draft] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1)
    if (!draft) return { ok: false, error: 'Post not found' }
    // The durable stock guard the media path already ran, now on X too
    // (ticket #2212). It reads shopify_product_id, which is set at draft time
    // and survives whether or not a gate stamp exists — and since the owner's
    // click no longer requires a stamp, the stamp's product handle can no
    // longer be relied on to carry the stock check.
    const draftStock = await checkLinkedProductStock(draft.shopifyProductId)
    if (!draftStock.ok) {
      await db.update(socialPosts)
        .set({
          reviewStatus: 'needs_changes',
          feedback: `[stock-guard] ${draftStock.detail} Swap the product or re-draft before this can publish.`,
        })
        .where(eq(socialPosts.id, postId))
      return { ok: false, error: `${draftStock.detail} Moved to Needs Changes.` }
    }
    // The owner's click is the approval. What still refuses is a fact the
    // caption does not show him — see manual-publish-gate.server.ts.
    const gate = await decideManualPublish(
      {
        isVideo: false,
        platform: 'x',
        caption: draft.editedText?.trim() || draft.tweetText,
        mediaUrls: draft.mediaUrls,
        productHandle: parseGateStamp(draft.feedback)?.productHandle ?? null,
      },
      getValve,
    )
    if (!gate.ok) return { ok: false, error: gate.error }
    const result = await postApprovedDraft(postId)
    if (result.ok) await recordManualPublish(postId, draft.feedback, await ownerLabel(request))
    return { ok: result.ok, intent: 'post-approved-draft', tweetId: result.tweetId, error: result.error }
  }

  // ── Media posting via platform publishers, double-gated (valve + env).
  if (intent === 'post-media') {
    const postId = parseInt(form.get('postId') as string)
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1)
    if (!post || post.status !== 'draft' || post.reviewStatus !== 'approved') {
      return { ok: false, error: 'Post must be an approved draft' }
    }
    const mediaUrls = post.mediaUrls ?? []
    const mediaUrl = mediaUrls[0]
    if (!mediaUrl) return { ok: false, error: 'Draft has no media URL' }
    // Publish-time stock guard (ticket #2212).
    const stock = await checkLinkedProductStock(post.shopifyProductId)
    if (!stock.ok) {
      await db.update(socialPosts)
        .set({
          status: 'draft',
          reviewStatus: 'needs_changes',
          feedback: `[stock-guard] ${stock.detail} Swap the product or re-draft before this can publish.`,
        })
        .where(eq(socialPosts.id, postId))
      return { ok: false, error: `${stock.detail} Moved to Needs Changes.` }
    }
    const isVideo = post.videoJobId != null || !!mediaUrl.split('?')[0]?.endsWith('.mp4')
    // The manual Post-now path enforces the same two refusals as the scheduled
    // job: a publish-gate PASS stamp must exist (owner approval alone is not a
    // licence to publish), and the surface's autopublish valve must be on — the
    // Instagram kill switch for stills, the video team's valve for video. See
    // manual-publish-gate.server.ts (ticket #3674, incident #3640).
    const gate = await decideManualPublish(
      {
        isVideo,
        caption: post.editedText?.trim() || post.tweetText,
        mediaUrls: post.mediaUrls,
        productHandle: parseGateStamp(post.feedback)?.productHandle ?? null,
      },
      getValve,
    )
    if (!gate.ok) {
      return gate.stub ? { ok: false, stub: true, error: gate.error } : { ok: false, error: gate.error }
    }
    const { getPublisher } = await import('~/lib/social-publish/registry.server')
    const publisher = getPublisher(post.platform)
    if (!publisher) return { ok: false, stub: true, error: `No publisher for ${post.platform}` }
    const media: PublishMedia = isVideo
      ? { kind: 'video', videoUrl: mediaUrl, ...(post.posterUrl ? { posterUrl: post.posterUrl } : {}) }
      : mediaUrls.length > 1
        ? { kind: 'carousel', imageUrls: mediaUrls }
        : { kind: 'image', imageUrl: mediaUrl }
    const result = await publisher.publish({
      postId,
      media,
      caption: post.editedText?.trim() || post.tweetText,
      productTagHandle: parseGateStamp(post.feedback)?.productHandle ?? null,
      // Accessibility description (migration 084). Additive only; adapters
      // without alt-text support ignore it.
      altText: post.altText ?? null,
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
      .set({ status: 'posted', externalPostId: result.externalPostId, postedAt: new Date() })
      .where(eq(socialPosts.id, postId))
    await recordManualPublish(postId, post.feedback, await ownerLabel(request))
    return { ok: true }
  }

  // ── Quick X post (free text + optional media URL) ────────────────────────
  if (intent === 'post-tweet') {
    const tweetText = form.get('tweetText') as string
    const imageUrl = form.get('imageUrl') as string | null

    if (!tweetText?.trim()) {
      return { ok: false, error: 'Tweet text is required' }
    }

    const result = await postManualTweet(tweetText.trim(), imageUrl || undefined)
    return { ok: result.ok, intent: 'post-tweet', tweetId: result.tweetId, error: result.error }
  }

  if (intent === 'delete-tweet') {
    const postId = parseInt(form.get('postId') as string)
    const externalPostId = form.get('externalPostId') as string

    const result = await deleteAndLogTweet(postId, externalPostId)
    return { ok: result.ok, intent: 'delete-tweet', error: result.error }
  }

  if (intent === 'retry-tweet') {
    const postId = parseInt(form.get('postId') as string)
    const result = await retryFailedPost(postId)
    return { ok: result.ok, intent: 'retry-tweet', tweetId: result.tweetId, error: result.error }
  }

  // ── Immediate response: regenerate an image in place ─────────────────────
  if (intent === 'regenerate-image') {
    const postId = parseInt(form.get('postId') as string)
    const feedback = ((form.get('feedback') as string | null) ?? '').trim()
    const archetypeRaw = (form.get('archetype') as string | null) ?? 'cast'
    const archetype = REWORK_ARCHETYPES.includes(archetypeRaw as ReworkArchetype)
      ? (archetypeRaw as ReworkArchetype) : 'cast'
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    if (!feedback) return { ok: false, error: 'Feedback is required to regenerate an image' }

    const user = await getAdminUser(request)
    const actor = user?.name || user?.email || 'admin'
    const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1)
    if (!post) return { ok: false, error: 'Post not found' }

    const gen = await regenerateSocialImage({ postId, feedback, archetype, actor })
    if (!gen.ok) return { ok: false, error: gen.error }

    const newRow = await createOwnerReworkRow({
      fromPostId: postId,
      caption: post.editedText?.trim() || post.tweetText,
      altText: post.altText,
      mediaUrls: [gen.url],
      imageBrief: post.imageBrief,
      subject: post.subject,
      actor,
    })

    await markSourceReworked(post, feedback, actor)

    return redirect(`/admin/socials?post=${newRow.id}&view=queue`)
  }

  // ── Immediate response: rework caption (and optionally the image) now ────
  if (intent === 'rework-now') {
    const postId = parseInt(form.get('postId') as string)
    const feedback = ((form.get('feedback') as string | null) ?? '').trim()
    const regenerate = (form.get('regenerate') as string | null) === 'on'
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    if (!feedback) return { ok: false, error: 'Feedback is required to rework a post' }

    const user = await getAdminUser(request)
    const actor = user?.name || user?.email || 'admin'
    const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1)
    if (!post) return { ok: false, error: 'Post not found' }

    const captionResult = await reworkCaption({ postId, feedback, actor })
    if (!captionResult.ok) return { ok: false, error: captionResult.error }

    let mediaUrls = post.mediaUrls ?? []
    if (regenerate) {
      const gen = await regenerateSocialImage({ postId, feedback, actor })
      if (!gen.ok) return { ok: false, error: gen.error }
      mediaUrls = [gen.url]
    }

    const newRow = await createOwnerReworkRow({
      fromPostId: postId,
      caption: captionResult.caption,
      altText: captionResult.altText,
      mediaUrls,
      imageBrief: post.imageBrief,
      subject: post.subject,
      actor,
    })

    await markSourceReworked(post, feedback, actor)

    return redirect(`/admin/socials?post=${newRow.id}&view=queue`)
  }

  // ── Owner approve with hard checks (bypasses waiting for the gate agent) ──
  if (intent === 'owner-approve') {
    const postId = parseInt(form.get('postId') as string)
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    const user = await getAdminUser(request)
    const actor = user?.name || user?.email || 'admin'
    return ownerApprovePost({ postId, actor })
  }

  return { ok: false, error: 'Unknown intent' }
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function buildUrl(params: {
  view: ViewKey
  platform?: string
  post?: number | null
  page?: number
  status?: string
}): string {
  const sp = new URLSearchParams()
  sp.set('view', params.view)
  if (params.platform && params.platform !== 'all') sp.set('platform', params.platform)
  if (params.status && params.status !== 'all') sp.set('status', params.status)
  if (params.page && params.page > 1) sp.set('page', String(params.page))
  if (params.post != null) sp.set('post', String(params.post))
  return `/admin/socials?${sp.toString()}`
}

function dayLabel(day: string | null): string {
  if (!day) return 'No date set'
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtDate(d: string | Date | null | undefined): string | undefined {
  if (!d) return undefined
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return undefined
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function externalPostUrl(platform: string, externalPostId: string): string | null {
  switch (platform) {
    case 'x': return `https://x.com/xdipx/status/${externalPostId}`
    case 'instagram': return `https://www.instagram.com/p/${externalPostId}/`
    case 'tiktok': return `https://www.tiktok.com/@xdipx/video/${externalPostId}`
    case 'youtube': return `https://www.youtube.com/shorts/${externalPostId}`
    default: return null
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type LoaderData = Awaited<ReturnType<typeof loader>>
type SocialFetcher = ReturnType<typeof useFetcher<typeof action>>

export default function AdminSocialsPage() {
  const data = useLoaderData<typeof loader>()
  const [quickPostOpen, setQuickPostOpen] = useState(false)
  const hasSelection = data.selectedPost != null

  return (
    <div className="space-y-4">
      <TopStrip data={data} onQuickPost={() => setQuickPostOpen(true)} />

      <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-4 items-start">
        <div className={`${hasSelection ? 'hidden md:block' : 'block'} space-y-3 min-w-0`}>
          <ViewTabs view={data.view} platform={data.platform} />
          {data.view === 'queue' && (
            <QueueList posts={data.posts} stockByProduct={data.stockByProduct} view={data.view} platform={data.platform} />
          )}
          {data.view === 'scheduled' && (
            <GroupedList posts={data.posts} stockByProduct={data.stockByProduct} view={data.view} platform={data.platform}
              emptyLabel="Nothing approved and waiting to go out." />
          )}
          {data.view === 'live' && (
            <FlatList posts={data.posts} stockByProduct={data.stockByProduct} view={data.view} platform={data.platform}
              emptyLabel="Nothing has posted yet." />
          )}
          {data.view === 'all' && <AllList data={data} />}
        </div>

        <div className={`${hasSelection ? 'block' : 'hidden md:block'} min-w-0`}>
          {data.selectedPost ? (
            <Reveal key={data.selectedPost.id} variant="fade" disabled>
              <DetailPane
                post={data.selectedPost}
                parent={data.lineageParent}
                children={data.lineageChildren}
                stockByProduct={data.stockByProduct}
                view={data.view}
                platform={data.platform}
              />
            </Reveal>
          ) : (
            <div className="hidden md:flex h-full min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-line text-sm text-ink-4">
              Select a post to see its detail.
            </div>
          )}
        </div>
      </div>

      {quickPostOpen && <QuickXPostDrawer onClose={() => setQuickPostOpen(false)} />}
    </div>
  )
}

// ── Top strip ────────────────────────────────────────────────────────────────

function TopStrip({ data, onQuickPost }: { data: LoaderData; onQuickPost: () => void }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-3 md:p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-ink">Social posts</h1>
          <p className="kicker text-ink-4 mt-0.5">Instagram · X · TikTok · YouTube</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <ValveDot label="IG autopublish" on={data.igAutopublish} />
          <ValveDot label="X autopublish" on={data.xAutopublish} />
          <PlatformSegment view={data.view} platform={data.platform} />
          <button
            type="button"
            onClick={onQuickPost}
            className="px-3 py-1.5 rounded-full bg-coral text-white text-xs font-semibold font-display hover:bg-coral-2 active:scale-95 transition-all"
          >
            Quick X post
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <CountLink label="Needs review" value={data.counts.needsReview} to={buildUrl({ view: 'queue' })} active={data.view === 'queue'} />
        <CountLink label="Approved awaiting publish" value={data.counts.approvedNoDate} to={buildUrl({ view: 'scheduled' })} active={data.view === 'scheduled'} />
        <CountLink label="Scheduled" value={data.counts.scheduledDated} to={buildUrl({ view: 'scheduled' })} active={false} />
        <CountLink label="Posted, 7d" value={data.counts.posted7d} to={buildUrl({ view: 'live' })} active={data.view === 'live'} />
      </div>

      <div className="flex flex-wrap gap-2 pt-1 border-t border-line">
        {Object.entries(data.frequencies).map(([platform, value]) => (
          <FrequencyMini key={platform} platform={platform} value={value} />
        ))}
      </div>
    </div>
  )
}

function ValveDot({ label, on }: { label: string; on: boolean }) {
  return (
    <Link to="/admin/homepage-team?team=social" className="inline-flex items-center gap-1.5 text-[11px] font-mono text-ink-3 hover:text-ink">
      <span className={`w-2 h-2 rounded-full ${on ? 'bg-sage' : 'bg-ink-4'}`} />
      {label}
    </Link>
  )
}

function CountLink({ label, value, to, active }: { label: string; value: number; to: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={`rounded-xl border px-3 py-2 transition-colors ${active ? 'border-plum bg-plum-soft' : 'border-line bg-paper hover:border-ink-4'}`}
    >
      <p className="text-lg font-semibold text-ink tabular-nums font-mono leading-tight">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-ink-4">{label}</p>
    </Link>
  )
}

function FrequencyMini({ platform, value }: { platform: string; value: number }) {
  const fetcher = useFetcher<typeof action>()
  const pending = fetcher.formData?.get('value')
  const shown = pending != null ? Number(pending) : value
  const busy = fetcher.state !== 'idle'
  function set(next: number) {
    if (next < 0 || next > 5) return
    fetcher.submit({ intent: 'set-frequency', key: `social_freq_${platform}`, value: String(next) }, { method: 'post' })
  }
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-xs ${shown === 0 ? 'opacity-60' : ''}`}>
      <span className="text-ink-3">{PLATFORM_LABELS[platform] ?? platform}</span>
      <button type="button" onClick={() => set(shown - 1)} disabled={busy || shown <= 0} className="w-5 h-5 rounded-full border border-line text-ink disabled:opacity-30" aria-label={`Fewer ${platform} posts`}>−</button>
      <span className="w-4 text-center font-mono tabular-nums text-ink">{shown}</span>
      <button type="button" onClick={() => set(shown + 1)} disabled={busy || shown >= 5} className="w-5 h-5 rounded-full border border-line text-ink disabled:opacity-30" aria-label={`More ${platform} posts`}>+</button>
    </div>
  )
}

function PlatformSegment({ view, platform }: { view: ViewKey; platform: string }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const primary = ['all', 'instagram', 'x'] as const
  const more = ['tiktok', 'youtube'] as const
  const moreActive = (more as readonly string[]).includes(platform)
  return (
    <div className="relative inline-flex items-center rounded-full border border-line bg-paper-2 p-0.5">
      {primary.map(p => (
        <Link
          key={p}
          to={buildUrl({ view, platform: p })}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${platform === p ? 'bg-plum-soft text-plum' : 'text-ink-3 hover:text-ink'}`}
        >
          {p === 'all' ? 'All' : PLATFORM_LABELS[p]}
        </Link>
      ))}
      <button
        type="button"
        onClick={() => setMoreOpen(v => !v)}
        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${moreActive ? 'bg-plum-soft text-plum' : 'text-ink-3 hover:text-ink'}`}
      >
        More
      </button>
      {moreOpen && (
        <div className="absolute top-full right-0 mt-1 rounded-lg border border-line bg-paper shadow-sm p-1 z-20">
          {more.map(p => (
            <Link key={p} to={buildUrl({ view, platform: p })} onClick={() => setMoreOpen(false)} className="block px-3 py-1.5 rounded text-xs text-ink hover:bg-paper-2 whitespace-nowrap">
              {PLATFORM_LABELS[p]}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ── View tabs ────────────────────────────────────────────────────────────────

const VIEW_TABS: { key: ViewKey; label: string }[] = [
  { key: 'queue', label: 'Queue' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'live', label: 'Live' },
  { key: 'all', label: 'All' },
]

function ViewTabs({ view, platform }: { view: ViewKey; platform: string }) {
  return (
    <div className="flex gap-1 border-b border-line overflow-x-auto">
      {VIEW_TABS.map(t => (
        <Link
          key={t.key}
          to={buildUrl({ view: t.key, platform })}
          className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
            view === t.key ? 'border-coral text-ink' : 'border-transparent text-ink-3 hover:text-ink'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}

// ── Shared row treatment ─────────────────────────────────────────────────────

function StatusPill({ status, reviewStatus }: { status: string; reviewStatus: string }) {
  if (status === 'posted') return <Pill tone="sage">Posted</Pill>
  if (status === 'failed') return <Pill tone="coral">Failed</Pill>
  if (status === 'deleted') return <Pill tone="muted">Deleted</Pill>
  switch (reviewStatus) {
    case 'pending_review': return <Pill tone="muted">New</Pill>
    case 'needs_changes': return <Pill tone="coral-soft">Changes requested</Pill>
    case 'approved': return <Pill tone="plum">Approved</Pill>
    case 'rejected': return <Pill tone="coral">Rejected</Pill>
    default: return null
  }
}

function Pill({ tone, children }: { tone: 'sage' | 'coral' | 'coral-soft' | 'plum' | 'muted'; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    sage: 'bg-sage/15 text-sage',
    coral: 'bg-coral text-white',
    'coral-soft': 'bg-coral-soft text-ink',
    plum: 'bg-plum-soft text-plum',
    muted: 'bg-paper-3 text-ink-3',
  }
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide font-mono ${styles[tone]}`}>{children}</span>
}

function GateVerdictChip({ verdict }: { verdict: GateVerdict }) {
  const tone = verdict === 'PASS' ? 'sage' : verdict === 'BLOCK' ? 'coral' : 'coral-soft'
  const label = verdict === 'PASS' ? 'Gate: pass' : verdict === 'BLOCK' ? 'Gate: block' : verdict === 'HOLD' ? 'Gate: hold' : 'Gate: revise'
  return <Pill tone={tone}>{label}</Pill>
}

function ProductStockChip({ inStock }: { inStock: boolean | undefined }) {
  if (inStock === undefined) return <span className="text-ink-4">product linked</span>
  return inStock ? <span className="text-sage">in stock</span> : <span className="text-coral font-semibold">out of stock</span>
}

function PostRow({ post, stockByProduct, selected, linkTo }: {
  post: SocialPostRow
  stockByProduct: Record<string, boolean>
  selected: boolean
  linkTo: string
}) {
  const parsed = parseFeedback(post.feedback)
  const media = post.mediaUrls?.[0] ?? null
  const carouselCount = post.mediaUrls?.length ?? 0
  const captionFirstLine = (post.editedText?.trim() || post.tweetText).split('\n')[0]?.trim()

  return (
    <Link
      to={linkTo}
      prefetch="intent"
      className={`flex gap-3 rounded-xl border p-3 transition-colors ${selected ? 'border-plum bg-plum-soft' : 'border-line bg-paper hover:border-ink-4'}`}
    >
      <div className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-paper-3">
        {media ? (
          isVideoPost(post)
            ? <img src={post.posterUrl ?? undefined} alt="" className="w-full h-full object-cover" />
            : <img src={media} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[9px] text-ink-4 text-center px-1">No asset</div>
        )}
        {carouselCount > 1 && (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-ink/70 text-white text-[9px] font-mono px-1">{carouselCount}</span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <PlatformChip platform={post.platform} />
          <StatusPill status={post.status} reviewStatus={post.reviewStatus} />
          {parsed.gateVerdict && <GateVerdictChip verdict={parsed.gateVerdict} />}
        </div>
        <p className="text-sm text-ink truncate">{captionFirstLine || '(empty caption)'}</p>
        <div className="flex items-center gap-2 text-[11px] text-ink-4 font-mono">
          <span className="rounded border border-line bg-paper-2 px-1.5 py-px font-semibold text-ink tabular-nums">#{post.id}</span>
          {post.scheduledFor && <span>{post.scheduledFor}</span>}
          {post.shopifyProductId && <ProductStockChip inStock={stockByProduct[post.shopifyProductId]} />}
        </div>
      </div>
    </Link>
  )
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-2xl border border-line bg-paper p-8 text-center text-sm text-ink-3">{label}</div>
}

// ── Queue view (batch bar lives here only) ───────────────────────────────────

function QueueList({ posts, stockByProduct, view, platform }: {
  posts: SocialPostRow[]
  stockByProduct: Record<string, boolean>
  view: ViewKey
  platform: string
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const batch = useFetcher<typeof action>()
  const groups = groupByScheduledDay(posts)
  const visibleIds = posts.map(p => p.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))
  const busy = batch.state !== 'idle'

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visibleIds))
  }
  function submitBatch(decision: 'approved' | 'rejected') {
    if (selected.size === 0) return
    batch.submit({ intent: 'review-batch', decision, postIds: [...selected].join(',') }, { method: 'post' })
    setSelected(new Set())
  }

  if (posts.length === 0) return <EmptyState label="Nothing waiting on you. The social team drafts on its daily run." />

  return (
    <div className="space-y-3 pb-16">
      <label className="inline-flex items-center gap-2 text-xs font-medium text-ink-3 cursor-pointer">
        <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 rounded border-line text-coral focus:ring-coral/30" />
        Select all ({visibleIds.length})
      </label>

      {groups.map(g => (
        <section key={g.day ?? 'unscheduled'} className="space-y-2">
          <h3 className="kicker text-ink-4 px-1">{dayLabel(g.day)}</h3>
          {g.posts.map(p => (
            <div key={p.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                aria-label={`Select draft ${p.id}`}
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                className="mt-4 w-4 h-4 shrink-0 rounded border-line text-coral focus:ring-coral/30"
              />
              <div className="flex-1 min-w-0">
                <PostRow post={p} stockByProduct={stockByProduct} selected={false} linkTo={buildUrl({ view, platform, post: p.id })} />
              </div>
            </div>
          ))}
        </section>
      ))}

      {selected.size > 0 && (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-coral/40 bg-coral-soft px-3 py-2">
          <span className="text-sm font-semibold text-ink">{selected.size} selected</span>
          <span className="flex-1" />
          <button type="button" onClick={() => submitBatch('approved')} disabled={busy} className="px-3 py-1.5 rounded-full bg-coral text-white text-xs font-semibold disabled:opacity-50 active:scale-95 transition-all">
            {busy ? 'Working…' : `Approve ${selected.size}`}
          </button>
          <button type="button" onClick={() => submitBatch('rejected')} disabled={busy} className="px-3 py-1.5 rounded-full border border-coral/40 text-coral text-xs font-semibold disabled:opacity-50 active:scale-95 transition-all">
            {busy ? 'Working…' : `Reject ${selected.size}`}
          </button>
        </div>
      )}

      {batch.data?.ok === false && <p className="text-xs text-coral px-1">{batch.data.error}</p>}
      {batch.data?.ok && 'updated' in batch.data && (
        <p className="text-xs text-sage px-1">Reviewed {batch.data.updated} draft{batch.data.updated === 1 ? '' : 's'}.</p>
      )}
      {batch.data?.ok && 'blocked' in batch.data && !!batch.data.blocked && (
        <p className="text-xs text-coral px-1">
          {batch.data.blocked} carried an unresolved gate BLOCK and were not approved. Start a fresh draft for those instead.
        </p>
      )}
    </div>
  )
}

// ── Scheduled / Live / All views ─────────────────────────────────────────────

function GroupedList({ posts, stockByProduct, view, platform, emptyLabel }: {
  posts: SocialPostRow[]
  stockByProduct: Record<string, boolean>
  view: ViewKey
  platform: string
  emptyLabel: string
}) {
  if (posts.length === 0) return <EmptyState label={emptyLabel} />
  const groups = groupByScheduledDay(posts)
  return (
    <div className="space-y-4">
      {groups.map(g => (
        <section key={g.day ?? 'unscheduled'} className="space-y-2">
          <h3 className="kicker text-ink-4 px-1">{dayLabel(g.day)}</h3>
          {g.posts.map(p => (
            <PostRow key={p.id} post={p} stockByProduct={stockByProduct} selected={false} linkTo={buildUrl({ view, platform, post: p.id })} />
          ))}
        </section>
      ))}
    </div>
  )
}

function FlatList({ posts, stockByProduct, view, platform, emptyLabel }: {
  posts: SocialPostRow[]
  stockByProduct: Record<string, boolean>
  view: ViewKey
  platform: string
  emptyLabel: string
}) {
  if (posts.length === 0) return <EmptyState label={emptyLabel} />
  return (
    <div className="space-y-2">
      {posts.map(p => (
        <PostRow key={p.id} post={p} stockByProduct={stockByProduct} selected={false} linkTo={buildUrl({ view, platform, post: p.id })} />
      ))}
    </div>
  )
}

const ALL_STATUS_FILTERS = ['all', 'draft', 'posted', 'failed', 'deleted'] as const

function AllList({ data }: { data: LoaderData }) {
  const { posts, stockByProduct, view, platform, statusFilter, page, pageSize, totalForView } = data
  const totalPages = Math.max(1, Math.ceil(totalForView / pageSize))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {ALL_STATUS_FILTERS.map(s => (
          <Link
            key={s}
            to={buildUrl({ view, platform, status: s })}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              statusFilter === s ? 'border-plum bg-plum-soft text-ink' : 'border-line bg-paper text-ink-3 hover:border-ink-4'
            }`}
          >
            {s === 'all' ? 'All statuses' : s}
          </Link>
        ))}
      </div>

      {posts.length === 0 ? (
        <EmptyState label="No posts match these filters." />
      ) : (
        <div className="space-y-2">
          {posts.map(p => (
            <PostRow key={p.id} post={p} stockByProduct={stockByProduct} selected={false}
              linkTo={buildUrl({ view, platform, status: statusFilter, post: p.id, page })} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-ink-4 font-mono px-1">
          <Link
            to={buildUrl({ view, platform, status: statusFilter, page: Math.max(1, page - 1) })}
            className={page <= 1 ? 'pointer-events-none opacity-40' : 'link-coral'}
          >
            Prev
          </Link>
          <span>{page} / {totalPages}</span>
          <Link
            to={buildUrl({ view, platform, status: statusFilter, page: Math.min(totalPages, page + 1) })}
            className={page >= totalPages ? 'pointer-events-none opacity-40' : 'link-coral'}
          >
            Next
          </Link>
        </div>
      )}
    </div>
  )
}

// ── Detail pane ──────────────────────────────────────────────────────────────

type Panel = 'none' | 'changes' | 'regen' | 'rework'

function DetailPane({ post, parent, children, stockByProduct, view, platform }: {
  post: SocialPostRow
  parent: SocialPostRow | null
  children: SocialPostRow[]
  stockByProduct: Record<string, boolean>
  view: ViewKey
  platform: string
}) {
  const fetcher = useFetcher<typeof action>()
  const busy = fetcher.state !== 'idle'
  const [caption, setCaption] = useState(post.editedText ?? post.tweetText)
  const [panel, setPanel] = useState<Panel>('none')
  const [changesFeedback, setChangesFeedback] = useState('')
  const [regenFeedback, setRegenFeedback] = useState('')
  const [archetype, setArchetype] = useState<ReworkArchetype>('cast')
  const [reworkFeedback, setReworkFeedback] = useState('')
  const [reworkAlsoRegen, setReworkAlsoRegen] = useState(false)
  const [genStartedAt, setGenStartedAt] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [prevData, setPrevData] = useState(fetcher.data)

  if (fetcher.data !== prevData) {
    setPrevData(fetcher.data)
    if (dismissed) setDismissed(false)
  }

  const edited = caption.trim() !== (post.editedText ?? post.tweetText).trim()
  const parsed = parseFeedback(post.feedback)
  const isPosted = post.status === 'posted'
  const externalUrl = post.status === 'posted' && post.externalPostId
    ? externalPostUrl(post.platform, post.externalPostId) : null

  function togglePanel(next: Panel) {
    setPanel(p => (p === next ? 'none' : next))
  }

  function submitDecision(decision: 'approved' | 'needs_changes' | 'rejected', feedback?: string) {
    fetcher.submit({
      intent: 'review',
      postId: String(post.id),
      decision,
      feedback: (feedback ?? '').trim(),
      editedText: edited ? caption.trim() : '',
    }, { method: 'post' })
    setPanel('none')
  }

  function submitRegen() {
    if (!regenFeedback.trim()) return
    setGenStartedAt(Date.now())
    fetcher.submit({ intent: 'regenerate-image', postId: String(post.id), feedback: regenFeedback.trim(), archetype }, { method: 'post' })
  }

  function submitRework() {
    if (!reworkFeedback.trim()) return
    if (reworkAlsoRegen) setGenStartedAt(Date.now())
    fetcher.submit({
      intent: 'rework-now',
      postId: String(post.id),
      feedback: reworkFeedback.trim(),
      regenerate: reworkAlsoRegen ? 'on' : '',
    }, { method: 'post' })
  }

  return (
    <div className="rounded-2xl border border-line bg-paper flex flex-col">
      <div className="p-3 md:p-4 border-b border-line flex items-center gap-3">
        <Link to={buildUrl({ view, platform })} className="md:hidden text-xs text-ink-3 hover:text-ink shrink-0">&larr; Back</Link>
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <PlatformChip platform={post.platform} />
          <StatusPill status={post.status} reviewStatus={post.reviewStatus} />
          <span className="font-mono text-xs text-ink-4">#{post.id}</span>
          {externalUrl && <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="link-coral text-xs">View live</a>}
        </div>
      </div>

      {fetcher.data && !dismissed && <ToastBanner data={fetcher.data} onDismiss={() => setDismissed(true)} />}

      <div className="p-3 md:p-4 space-y-4">
        <MediaSlab post={post} genStartedAt={genStartedAt} busy={busy} />

        <div>
          <label className="kicker text-ink-4">Caption</label>
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            rows={5}
            disabled={isPosted}
            className="mt-1 w-full rounded-lg border border-line p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-coral/30 resize-y disabled:opacity-60"
          />
          {edited && <p className="text-xs text-plum font-medium mt-1">Edited, saved with your next decision</p>}
        </div>

        <div>
          <label className="kicker text-ink-4">Alt text</label>
          <p className="mt-1 text-sm text-ink-3">{post.altText || 'Not set.'}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <p className="kicker text-ink-4">Subject</p>
            <p className="text-ink-3">{post.subject || ', '}</p>
          </div>
          <div>
            <p className="kicker text-ink-4">Image brief</p>
            <p className="text-ink-3">{post.imageBrief || ', '}</p>
          </div>
        </div>

        {post.shopifyProductId && (
          <div className="flex items-center gap-2 text-sm">
            <span className="kicker text-ink-4">Product</span>
            <span className="font-mono text-xs text-ink-3">{post.shopifyProductId}</span>
            <ProductStockChip inStock={stockByProduct[post.shopifyProductId]} />
          </div>
        )}

        {!isPosted && (
          <div className="flex items-center gap-3">
            <label className="kicker text-ink-4 shrink-0">Scheduled for</label>
            <input
              type="date"
              defaultValue={post.scheduledFor ?? ''}
              onChange={e => fetcher.submit({ intent: 'reschedule', postId: String(post.id), scheduledFor: e.target.value }, { method: 'post' })}
              className="rounded-lg border border-line px-2 py-1 text-sm text-ink font-mono"
            />
          </div>
        )}

        <PostTimeline post={post} parent={parent} children={children} parsed={parsed} />

        {isPosted && <MetricsBlock metrics={post.metricsJson} />}

        {panel === 'regen' && (
          <div className="rounded-xl border border-plum/30 bg-plum-soft/40 p-3 space-y-2">
            <p className="kicker text-ink-4">New image</p>
            <textarea
              value={regenFeedback}
              onChange={e => setRegenFeedback(e.target.value)}
              rows={3}
              placeholder="What should change about the image? Required."
              className="w-full rounded-lg border border-line p-2 text-sm text-ink"
            />
            <select value={archetype} onChange={e => setArchetype(e.target.value as ReworkArchetype)} className="rounded-lg border border-line px-2 py-1.5 text-sm text-ink">
              {REWORK_ARCHETYPES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !regenFeedback.trim()} onClick={submitRegen}
                className="px-3 py-1.5 rounded-full bg-coral text-white text-xs font-semibold disabled:opacity-50 active:scale-95 transition-all">
                {busy && genStartedAt ? 'Generating…' : 'Generate new image'}
              </button>
              <button type="button" onClick={() => setPanel('none')} className="px-3 py-1.5 text-xs text-ink-3">Cancel</button>
            </div>
          </div>
        )}

        {panel === 'rework' && (
          <div className="rounded-xl border border-plum/30 bg-plum-soft/40 p-3 space-y-2">
            <p className="kicker text-ink-4">Rework now</p>
            <textarea
              value={reworkFeedback}
              onChange={e => setReworkFeedback(e.target.value)}
              rows={3}
              placeholder="What should change? Rewrites the caption immediately. Required."
              className="w-full rounded-lg border border-line p-2 text-sm text-ink"
            />
            <label className="inline-flex items-center gap-2 text-xs text-ink-3 cursor-pointer">
              <input type="checkbox" checked={reworkAlsoRegen} onChange={e => setReworkAlsoRegen(e.target.checked)} className="w-4 h-4 rounded border-line text-coral" />
              Also regenerate the image
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !reworkFeedback.trim()} onClick={submitRework}
                className="px-3 py-1.5 rounded-full bg-coral text-white text-xs font-semibold disabled:opacity-50 active:scale-95 transition-all">
                {busy && genStartedAt ? 'Generating…' : busy ? 'Reworking…' : 'Rework now'}
              </button>
              <button type="button" onClick={() => setPanel('none')} className="px-3 py-1.5 text-xs text-ink-3">Cancel</button>
            </div>
          </div>
        )}
      </div>

      <ActionBar
        post={post}
        fetcher={fetcher}
        busy={busy}
        panel={panel}
        onTogglePanel={togglePanel}
        changesFeedback={changesFeedback}
        onChangesFeedback={setChangesFeedback}
        onSubmitDecision={submitDecision}
      />
    </div>
  )
}

function ToastBanner({ data, onDismiss }: { data: NonNullable<SocialFetcher['data']>; onDismiss: () => void }) {
  const ok = 'ok' in data ? Boolean(data.ok) : false
  const message = ok ? 'Saved ♥' : ('error' in data && data.error ? data.error : 'Something went wrong.')
  const findings = !ok && 'findings' in data && Array.isArray(data.findings) ? data.findings : []
  return (
    <div className={`mx-3 md:mx-4 mt-3 rounded-lg px-3 py-2 text-sm flex items-start justify-between gap-3 ${ok ? 'bg-sage/15 text-ink' : 'bg-coral-soft text-ink'}`}>
      <div className="min-w-0">
        <p>{message}</p>
        {findings.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-ink-3">
            {findings.map((f, i) => <li key={i}>{renderFinding(f)}</li>)}
          </ul>
        )}
      </div>
      <button type="button" onClick={onDismiss} className="text-ink-4 hover:text-ink text-xs shrink-0">Dismiss</button>
    </div>
  )
}

function renderFinding(f: unknown): string {
  if (f && typeof f === 'object' && 'detail' in f) {
    const rec = f as { check?: string; severity?: string; detail?: string }
    return [rec.severity?.toUpperCase(), rec.check, rec.detail].filter(Boolean).join(', ')
  }
  return JSON.stringify(f)
}

function MediaSlab({ post, genStartedAt, busy }: { post: SocialPostRow; genStartedAt: number | null; busy: boolean }) {
  const generating = genStartedAt != null && busy
  const urls = post.mediaUrls ?? []
  return (
    <div className="relative rounded-lg overflow-hidden border border-line bg-paper-3">
      {urls.length === 0 ? (
        <div className="aspect-square flex items-center justify-center text-xs text-ink-4">No media</div>
      ) : urls.length === 1 ? (
        isVideoPost(post) ? (
          <video src={urls[0]} poster={post.posterUrl ?? undefined} controls playsInline className="w-full max-h-[420px] object-contain bg-ink" />
        ) : (
          <img src={urls[0]} alt={post.altText ?? ''} className="w-full max-h-[420px] object-contain" />
        )
      ) : (
        <SlideFlipper key={post.id} urls={urls} alt={post.altText ?? ''} />
      )}
      {generating && (
        <div className="absolute inset-0 bg-ink/70 flex flex-col items-center justify-center gap-2 text-white text-sm">
          <div className="h-8 w-8 rounded-full border-2 border-white/30 border-t-white animate-spin motion-reduce:animate-none" />
          <p>Generating, usually under a minute</p>
          <ElapsedTimer startedAt={genStartedAt} />
        </div>
      )}
    </div>
  )
}

/**
 * Carousel viewer: one slide at a time with prev/next, a slide counter, and a
 * thumbnail strip, the way the post reads on Instagram. Keyed by post id in the
 * caller so the index resets when the selection changes.
 */
function SlideFlipper({ urls, alt }: { urls: string[]; alt: string }) {
  const [index, setIndex] = useState(0)
  const i = Math.min(index, urls.length - 1)
  const go = (n: number) => setIndex((n + urls.length) % urls.length)
  return (
    <div
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'ArrowLeft') go(i - 1); if (e.key === 'ArrowRight') go(i + 1) }}
      className="outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
      aria-label={`Carousel, slide ${i + 1} of ${urls.length}`}
    >
      <div className="relative">
        <img src={urls[i]} alt={alt} className="w-full max-h-[420px] object-contain" />
        <button type="button" onClick={() => go(i - 1)} aria-label="Previous slide"
          className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-paper/90 border border-line text-ink text-lg leading-none shadow-sm hover:bg-paper active:scale-95 transition-all">
          ‹
        </button>
        <button type="button" onClick={() => go(i + 1)} aria-label="Next slide"
          className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-paper/90 border border-line text-ink text-lg leading-none shadow-sm hover:bg-paper active:scale-95 transition-all">
          ›
        </button>
        <span className="absolute bottom-2 right-2 rounded-full bg-ink/75 text-white text-[11px] font-mono tabular-nums px-2 py-0.5">
          {i + 1} / {urls.length}
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto p-1 border-t border-line bg-paper-2">
        {urls.map((u, n) => (
          <button key={n} type="button" onClick={() => setIndex(n)} aria-label={`Go to slide ${n + 1}`}
            className={`relative h-14 w-11 shrink-0 rounded overflow-hidden border-2 transition-colors ${n === i ? 'border-plum' : 'border-transparent hover:border-ink-4'}`}>
            <img src={u} alt="" className="h-full w-full object-cover" />
            <span className="absolute bottom-0 left-0 bg-ink/70 text-white text-[9px] font-mono px-1">{n + 1}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function MetricsBlock({ metrics }: { metrics: Record<string, number> | null | undefined }) {
  if (!metrics || Object.keys(metrics).length === 0) return null
  return (
    <div>
      <p className="kicker text-ink-4 mb-2">Metrics</p>
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(metrics).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line px-2 py-1.5">
            <p className="text-base font-semibold text-ink tabular-nums font-mono">{v}</p>
            <p className="text-[10px] uppercase tracking-wide text-ink-4">{k}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function PostTimeline({ post, parent, children, parsed }: {
  post: SocialPostRow
  parent: SocialPostRow | null
  children: SocialPostRow[]
  parsed: ReturnType<typeof parseFeedback>
}) {
  const events: { label: string; detail?: string | undefined; tone?: 'sage' | 'coral' | 'coral-soft' | 'plum' }[] = []

  events.push({ label: `Drafted by ${post.createdBy ?? 'agent'}`, detail: fmtDate(post.createdAt) })
  if (parent) events.push({ label: `Reworked from #${parent.id}`, tone: 'plum' })

  if (parsed.gateVerdict) {
    events.push({
      label: `Publish gate: ${parsed.gateVerdict}`,
      detail: [parsed.gateReviewer, parsed.gateDate].filter(Boolean).join(' · ') + (parsed.gateNotes ? `, ${parsed.gateNotes}` : ''),
      tone: parsed.gateVerdict === 'PASS' ? 'sage' : parsed.gateVerdict === 'BLOCK' ? 'coral' : 'coral-soft',
    })
  }
  if (parsed.stockGuard) events.push({ label: 'Stock guard', detail: parsed.stockGuard, tone: 'coral' })
  if (parsed.ownerNotes) {
    events.push({
      label: post.reviewStatus === 'rejected' ? 'Rejected' : 'Owner feedback',
      detail: `${parsed.ownerNotes}${post.reviewedBy ? `, ${post.reviewedBy}` : ''}`,
      tone: post.reviewStatus === 'rejected' ? 'coral' : 'coral-soft',
    })
  }
  if (post.reviewStatus === 'approved' && !parsed.gateVerdict) {
    events.push({ label: 'Approved', detail: post.reviewedBy ?? undefined, tone: 'sage' })
  }
  if (post.scheduledFor) events.push({ label: 'Scheduled', detail: post.scheduledFor })
  if (post.status === 'posted') events.push({ label: 'Posted', detail: fmtDate(post.postedAt ?? post.createdAt), tone: 'sage' })
  if (parsed.liveVerdict) {
    events.push({
      label: `Live retro: ${parsed.liveVerdict}`,
      detail: parsed.liveNote ?? undefined,
      tone: parsed.liveVerdict === 'worked' ? 'sage' : parsed.liveVerdict === 'pull' ? 'coral' : 'coral-soft',
    })
  }
  if (children.length) events.push({ label: `Reworked into ${children.map(c => `#${c.id}`).join(', ')}`, tone: 'plum' })

  return (
    <div>
      <p className="kicker text-ink-4 mb-2">Timeline</p>
      <ol className="space-y-2">
        {events.map((e, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
              e.tone === 'sage' ? 'bg-sage' : e.tone === 'coral' ? 'bg-coral' : e.tone === 'coral-soft' ? 'bg-coral-2' : e.tone === 'plum' ? 'bg-plum' : 'bg-ink-4'
            }`} />
            <div className="min-w-0">
              <p className="text-ink font-medium">{e.label}</p>
              {e.detail && <p className="text-ink-3 text-xs break-words">{e.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
      {(parent || children.length > 0) && (
        <div className="mt-2 space-y-1">
          {parent && <Link to={buildUrl({ view: 'all', post: parent.id })} className="link-coral text-xs block">View original draft #{parent.id}</Link>}
          {children.map(c => (
            <Link key={c.id} to={buildUrl({ view: 'all', post: c.id })} className="link-coral text-xs block">
              Rework #{c.id} waiting for publish gate ({c.reviewStatus.replace('_', ' ')})
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Action bar ───────────────────────────────────────────────────────────────

function ActionBar({ post, fetcher, busy, panel, onTogglePanel, changesFeedback, onChangesFeedback, onSubmitDecision }: {
  post: SocialPostRow
  fetcher: SocialFetcher
  busy: boolean
  panel: Panel
  onTogglePanel: (next: Panel) => void
  changesFeedback: string
  onChangesFeedback: (v: string) => void
  onSubmitDecision: (decision: 'approved' | 'needs_changes' | 'rejected', feedback?: string) => void
}) {
  const isPosted = post.status === 'posted'
  const isFailed = post.status === 'failed'
  const isDraft = post.status === 'draft'
  const xLength = weightedTweetLength(post.editedText?.trim() || post.tweetText)
  const overXLimit = post.platform === 'x' && xLength > X_CAPTION_MAX

  return (
    <div className="sticky bottom-0 md:static border-t border-line bg-paper p-3 space-y-2 rounded-b-2xl">
      {panel === 'changes' && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-2">
          <textarea
            value={changesFeedback}
            onChange={e => onChangesFeedback(e.target.value)}
            rows={2}
            placeholder="What should change? The team reads this verbatim."
            className="w-full rounded-lg border border-line p-2 text-sm text-ink"
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !changesFeedback.trim()} onClick={() => onSubmitDecision('needs_changes', changesFeedback)}
              className="px-3 py-1.5 rounded-full bg-coral-soft text-ink text-xs font-semibold disabled:opacity-50 active:scale-95 transition-all">
              Send to team
            </button>
            <button type="button" onClick={() => onTogglePanel('changes')} className="px-3 py-1.5 text-xs text-ink-3">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {isDraft && post.reviewStatus !== 'approved' && (
          <button type="button" onClick={() => onSubmitDecision('approved')} disabled={busy || overXLimit}
            title={overXLimit ? `X counts this caption at ${xLength}/${X_CAPTION_MAX}; trim it before approving` : undefined}
            className="px-4 py-2 rounded-full bg-coral text-white text-sm font-semibold font-display disabled:opacity-50 active:scale-95 transition-all">
            Approve
          </button>
        )}
        {isDraft && post.reviewStatus === 'approved' && <PostNowButton post={post} fetcher={fetcher} busy={busy} />}
        {isDraft && (
          <button type="button" onClick={() => onTogglePanel('changes')} disabled={busy}
            className="px-4 py-2 rounded-full border border-line text-sm font-medium text-ink disabled:opacity-50">
            Request changes
          </button>
        )}
        {isDraft && post.reviewStatus !== 'rejected' && (
          <button type="button" onClick={() => onSubmitDecision('rejected')} disabled={busy}
            className="px-4 py-2 rounded-full border border-line text-sm font-medium text-ink-3 disabled:opacity-50">
            Reject
          </button>
        )}
        {isFailed && (
          <button type="button" onClick={() => fetcher.submit({ intent: 'retry-tweet', postId: String(post.id) }, { method: 'post' })} disabled={busy}
            className="px-4 py-2 rounded-full bg-coral text-white text-sm font-semibold disabled:opacity-50 active:scale-95 transition-all">
            Retry
          </button>
        )}
        <span className="w-px bg-line self-stretch mx-1 hidden sm:block" />
        <button type="button" onClick={() => onTogglePanel('regen')} disabled={busy}
          className="px-4 py-2 rounded-full border border-plum/40 text-plum text-sm font-medium disabled:opacity-50">
          New image
        </button>
        <button type="button" onClick={() => onTogglePanel('rework')} disabled={busy}
          className="px-4 py-2 rounded-full border border-plum/40 text-plum text-sm font-medium disabled:opacity-50">
          Rework now
        </button>
        {!isPosted && (
          <>
            <button
              type="button"
              onClick={() => fetcher.submit({ intent: 'owner-approve', postId: String(post.id) }, { method: 'post' })}
              disabled={busy}
              title="Runs the deterministic publish checks and stamps an owner verdict so the hourly publisher can ship it."
              className="px-4 py-2 rounded-full border border-line text-sm font-medium text-ink disabled:opacity-50"
            >
              Approve and run hard checks
            </button>
          </>
        )}
      </div>

      {isPosted && <LiveVerdictButtons post={post} fetcher={fetcher} busy={busy} />}
      {isPosted && post.platform === 'x' && post.externalPostId && <DeleteTweetControl post={post} fetcher={fetcher} busy={busy} />}
    </div>
  )
}

function PostNowButton({ post, fetcher, busy }: { post: SocialPostRow; fetcher: SocialFetcher; busy: boolean }) {
  const intent = post.platform === 'x' ? 'post-approved-draft' : 'post-media'
  return (
    <button
      type="button"
      onClick={() => fetcher.submit({ intent, postId: String(post.id) }, { method: 'post' })}
      disabled={busy}
      className="px-4 py-2 rounded-full bg-coral text-white text-sm font-semibold font-display disabled:opacity-50 active:scale-95 transition-all"
    >
      Post now
    </button>
  )
}

function DeleteTweetControl({ post, fetcher, busy }: { post: SocialPostRow; fetcher: SocialFetcher; busy: boolean }) {
  const [confirm, setConfirm] = useState(false)
  if (!confirm) {
    return <button type="button" onClick={() => setConfirm(true)} className="text-xs text-coral hover:underline">Delete post</button>
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink-3">Delete this post from X?</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          fetcher.submit({ intent: 'delete-tweet', postId: String(post.id), externalPostId: post.externalPostId ?? '' }, { method: 'post' })
          setConfirm(false)
        }}
        className="text-xs text-coral font-semibold hover:underline disabled:opacity-50"
      >
        Confirm delete
      </button>
      <button type="button" onClick={() => setConfirm(false)} className="text-xs text-ink-4 hover:underline">Cancel</button>
    </div>
  )
}

function LiveVerdictButtons({ post, fetcher, busy }: { post: SocialPostRow; fetcher: SocialFetcher; busy: boolean }) {
  const [note, setNote] = useState('')
  const parsed = parseFeedback(post.feedback)
  return (
    <div className="flex flex-col gap-2 w-full">
      {parsed.liveVerdict && (
        <p className="text-xs text-ink-4">
          Current verdict: <span className="font-semibold text-ink">{parsed.liveVerdict}</span>{parsed.liveNote ? `, ${parsed.liveNote}` : ''}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy}
          onClick={() => fetcher.submit({ intent: 'review-live', postId: String(post.id), verdict: 'worked' }, { method: 'post' })}
          className="px-4 py-2 rounded-full bg-sage/15 text-sage text-sm font-semibold disabled:opacity-50">
          This worked
        </button>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="What was off? Read verbatim by the team."
          className="flex-1 min-w-[160px] rounded-lg border border-line px-2 py-1.5 text-sm"
        />
        <button type="button" disabled={busy || !note.trim()}
          onClick={() => fetcher.submit({ intent: 'review-live', postId: String(post.id), verdict: 'off', note }, { method: 'post' })}
          className="px-3 py-2 rounded-full border border-line text-sm text-ink-3 disabled:opacity-50">
          Note it
        </button>
        <button type="button" disabled={busy || !note.trim()}
          onClick={() => fetcher.submit({ intent: 'review-live', postId: String(post.id), verdict: 'pull', note }, { method: 'post' })}
          className="px-3 py-2 rounded-full border border-coral/40 text-coral text-sm disabled:opacity-50">
          Pull this
        </button>
      </div>
    </div>
  )
}

// ── Quick X post drawer ───────────────────────────────────────────────────────

function QuickXPostDrawer({ onClose }: { onClose: () => void }) {
  const fetcher = useFetcher<typeof action>()
  const [text, setText] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const busy = fetcher.state !== 'idle'
  const posted = fetcher.data?.ok === true && fetcher.formData?.get('intent') === 'post-tweet'

  return (
    <div className="fixed inset-0 z-30 flex items-end md:items-center justify-center bg-ink/40" onClick={onClose}>
      <div className="w-full md:w-[480px] rounded-t-2xl md:rounded-2xl bg-paper border border-line p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-display font-semibold text-ink">Quick X post</p>
          <button type="button" onClick={onClose} className="text-ink-4 text-sm">Close</button>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          placeholder="Free text, up to 280 characters as X counts them"
          className="w-full rounded-lg border border-line p-2 text-sm text-ink"
        />
        <p className={`text-xs font-mono ${weightedTweetLength(text) > X_CAPTION_MAX ? 'text-coral' : 'text-ink-4'}`} title="Links count as 23 characters each, the way X counts them">{weightedTweetLength(text)}/{X_CAPTION_MAX}</p>
        <input
          value={imageUrl}
          onChange={e => setImageUrl(e.target.value)}
          placeholder="Optional media URL"
          className="w-full rounded-lg border border-line px-2 py-1.5 text-sm text-ink"
        />
        <button
          type="button"
          disabled={busy || !text.trim() || weightedTweetLength(text) > X_CAPTION_MAX}
          onClick={() => fetcher.submit(
            { intent: 'post-tweet', tweetText: text.trim(), ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}) },
            { method: 'post' },
          )}
          className="w-full px-4 py-2 rounded-full bg-coral text-white text-sm font-semibold font-display disabled:opacity-50 active:scale-95 transition-all"
        >
          {busy ? 'Posting…' : 'Post to X'}
        </button>
        {fetcher.data && fetcher.data.ok === false && 'error' in fetcher.data && (
          <p className="text-xs text-coral">{fetcher.data.error}</p>
        )}
        {posted && <p className="text-xs text-sage">Posted ♥</p>}
      </div>
    </div>
  )
}
