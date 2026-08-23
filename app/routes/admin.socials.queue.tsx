/**
 * /admin/socials/queue — Review, Approved and History in one list-plus-detail
 * screen (Social Studio v2 Phase 3, ticket #4938).
 *
 * Every review and posting intent from the old single-route Social Studio
 * lives here unchanged: review, review-live, review-batch, reschedule,
 * post-approved-draft, post-media, delete-tweet, retry-tweet. New here:
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
import { deleteAndLogTweet, retryFailedPost, postApprovedDraft } from '~/lib/twitter.server'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { reviewSocialPost, rescheduleSocialPost, recordLivePostFeedback, getValve } from '~/lib/team.server'
import { isLivePostVerdict, parseLiveFeedback } from '~/lib/live-post-feedback'
import { SOCIAL_REVIEW_STATUSES } from '~/lib/team-keys'
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
import { parseGateStamp, revertSocialPostToDraft } from '~/lib/social-publish-approve.server'
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
 * Appended, never prepended, because `parseGateStamp` is anchored at the start
 * of the field and other readers still parse it.
 */
async function recordManualPublish(postId: number, feedback: string | null, by: string): Promise<void> {
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
    await rescheduleSocialPost(postId, day || null)
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

  // ── Live posting: explicit owner clicks only ─────────────────────────────
  if (intent === 'post-approved-draft') {
    const postId = parseInt(form.get('postId') as string)
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    const [draft] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1)
    if (!draft) return { ok: false, error: 'Post not found' }
    // The durable stock guard the media path already ran, now on X too
    // (ticket #2212). It reads shopify_product_id, set at draft time.
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

  // ── Media posting via platform publishers. Instagram is live; TikTok and
  // YouTube are still stubs and report the manual path.
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
    // Publish-time stock guard (ticket #2212), independent of the gate
    // stamp's own product handle. See stock-guard.server.ts.
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
      productTagHandle: parseGateStamp(post.feedback)?.productHandle ?? null,
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
          className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full bg-coral text-white text-sm font-semibold hover:bg-coral-2"
          title="New post (n)"
        >
          <PlusIcon size={14} /> New post
        </Link>
      </div>

      {view === 'review' && (
        <div data-focused-post={focusedId ?? undefined} className="[&_[data-post-id]]:transition-shadow">
          {focusedId && (
            <style>{`[data-post-id="${focusedId}"]{box-shadow:0 0 0 2px var(--color-coral)}`}</style>
          )}
          <ReviewQueue posts={pending} />
          <p className="mt-3 text-[11px] text-ink-4 hidden md:block">
            Keys: <span className="font-mono">j</span>/<span className="font-mono">k</span> move, <span className="font-mono">a</span> approve, <span className="font-mono">r</span> request changes, <span className="font-mono">n</span> new post.
          </p>
        </div>
      )}
      {view === 'approved' && <ApprovedList posts={approved} />}
      {view === 'history' && <HistoryTable posts={history} />}
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
        {post.platform === 'x' ? (
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
            {media && (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="post-media" />
                <input type="hidden" name="postId" value={post.id} />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-11 px-4 bg-coral text-white rounded-full text-sm font-semibold hover:bg-coral-2 transition-colors disabled:opacity-50"
                  title="Publishes via the platform API once keys are set; until then this reports the manual path."
                >
                  {isSubmitting ? 'Trying' : 'Post now'}
                </button>
              </fetcher.Form>
            )}
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

/** Client-side read of the legacy stamp header so the pill shows it before Phase 5 cuts readers over. */
function parseGateStampClient(feedback: string | null): string | null {
  const m = /^\[publish-gate (PASS|REVISE|BLOCK|HOLD) /.exec(feedback ?? '')
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

function HistoryTable({ posts }: { posts: SocialPostRow[] }) {
  const deleteFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const retryFetcher = useFetcher<{ ok: boolean; error?: string }>()
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
                        <div className="flex items-center gap-2 mb-0.5">
                          <PlatformChip platform={post.platform} />
                          <span className="font-mono text-[11px] text-ink-4">#{post.id}</span>
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
                      {post.status === 'posted' && post.externalPostId && post.platform === 'x' && (
                        deleteConfirmId === post.id ? (
                          <span className="inline-flex items-center gap-2">
                            <deleteFetcher.Form method="post">
                              <input type="hidden" name="intent" value="delete-tweet" />
                              <input type="hidden" name="postId" value={post.id} />
                              <input type="hidden" name="externalPostId" value={post.externalPostId} />
                              <button type="submit" className="text-xs text-red-700 hover:underline min-h-9" onClick={() => setDeleteConfirmId(null)}>
                                Confirm delete on X
                              </button>
                            </deleteFetcher.Form>
                            <button type="button" onClick={() => setDeleteConfirmId(null)} className="text-xs text-ink-4 hover:underline min-h-9">
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setDeleteConfirmId(post.id)} className="text-xs text-ink-3 hover:text-red-700 min-h-9">
                            Delete
                          </button>
                        )
                      )}
                      {post.status === 'failed' && (
                        <retryFetcher.Form method="post">
                          <input type="hidden" name="intent" value="retry-tweet" />
                          <input type="hidden" name="postId" value={post.id} />
                          <button type="submit" disabled={retryFetcher.state !== 'idle'} className="text-xs text-[#4F6150] hover:underline disabled:opacity-50 min-h-9">
                            Retry
                          </button>
                        </retryFetcher.Form>
                      )}
                      {post.status === 'draft' && post.reviewStatus === 'rejected' && (
                        <span className="text-[11px] text-ink-4">no override; start a fresh draft</span>
                      )}
                    </div>
                    {deleteFetcher.data?.ok === false && <p className="text-xs text-red-700 mt-1">{deleteFetcher.data.error}</p>}
                    {retryFetcher.data?.ok === false && <p className="text-xs text-red-700 mt-1">{retryFetcher.data.error}</p>}
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
