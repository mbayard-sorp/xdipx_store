/**
 * /admin/socials — the Social Studio.
 *
 * Review-first social management: every agent draft (Instagram, X, TikTok)
 * lands in the Review tab as a platform-native preview the owner approves,
 * requests changes on (feedback goes back to the team verbatim), or rejects.
 * Per-platform posting frequency lives in Settings (social_freq_* keys).
 * This is the internal review period: nothing posts publicly except the
 * owner's own explicit clicks (Compose quick-post, Post-now on an approved X
 * draft) — autoposting stays behind social_team_autopost + X_AUTO_POST_ENABLED.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState } from 'react'
import { db } from '~/lib/db.server'
import { dealHistory, socialPosts } from '../../db/schema'
import { eq, desc } from 'drizzle-orm'
import { generateTweetCopy } from '~/lib/claude.server'
import { getDealByShopifyId } from '~/lib/shopify.server'
import { postManualTweet, deleteAndLogTweet, retryFailedPost, postApprovedDraft } from '~/lib/twitter.server'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { getSocialFrequencies, reviewSocialPost, rescheduleSocialPost, getValve, VALVE_KEYS } from '~/lib/team.server'
import { setPipelineSetting } from '~/lib/pricing-webhook.server'
import { SOCIAL_PLATFORMS, SOCIAL_REVIEW_STATUSES, socialFreqKey } from '~/lib/team-keys'
import { categoryToLegacyString } from '~/types'
import { ReviewQueue } from '~/components/admin/social/ReviewQueue'
import { parseBatchPostIds } from '~/components/admin/social/review-batch'
import { FrequencyPanel } from '~/components/admin/social/FrequencyPanel'
import { PlatformChip } from '~/components/admin/social/PostPreviewCard'
import { isVideoPost, type SocialPostRow } from '~/components/admin/social/types'
import type { PublishMedia } from '~/lib/social-publish/types'

export const meta: MetaFunction = () => [{ title: 'Social Studio — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const [posts, liveDealRows, frequencies, autopostValve] = await Promise.all([
    db
      .select()
      .from(socialPosts)
      .orderBy(desc(socialPosts.createdAt))
      .limit(100),
    db
      .select()
      .from(dealHistory)
      .where(eq(dealHistory.status, 'live'))
      .limit(1),
    getSocialFrequencies(),
    getValve(VALVE_KEYS.socialAutopost),
  ])

  const liveDeal = liveDealRows[0] ?? null

  // Fetch Shopify data for the live deal to get images + brand
  let liveDealImage: string | null = null
  let liveDealBrand = ''
  let liveDealTagline = ''
  let liveDealCategory = ''
  if (liveDeal?.shopifyProductId) {
    const numericId = liveDeal.shopifyProductId.replace('gid://shopify/Product/', '')
    const fullDeal = await getDealByShopifyId(numericId)
    if (fullDeal) {
      liveDealImage = fullDeal.images[0]?.url ?? null
      liveDealBrand = fullDeal.brand
      liveDealTagline = fullDeal.tagline
      liveDealCategory = categoryToLegacyString(fullDeal.category)
    }
  }

  return {
    posts,
    liveDeal,
    liveDealImage,
    liveDealBrand,
    liveDealTagline,
    liveDealCategory,
    frequencies,
    autopostValve,
    autoPostEnabled: process.env['X_AUTO_POST_ENABLED'] === 'true',
  }
}

const FREQ_ALLOWED_KEYS = SOCIAL_PLATFORMS.map(p => socialFreqKey(p))

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
    const ok = await reviewSocialPost(postId, {
      reviewStatus: decision as 'approved' | 'needs_changes' | 'rejected',
      feedback: feedback || undefined,
      editedText: editedText || undefined,
      reviewedBy: user?.name || user?.email || 'admin',
    })
    return ok ? { ok: true } : { ok: false, error: 'Post not found or already posted' }
  }

  // ── Batch review (owner-only): approve/reject many selected drafts at once.
  // Reuses the same reviewSocialPost writer per id, so the review_status
  // transition + reviewed_by/reviewed_at contract is identical to the single
  // 'review' intent. needs_changes is intentionally not batchable — it requires
  // per-draft feedback, so it stays on the single-draft path.
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
    for (const id of ids) {
      const ok = await reviewSocialPost(id, {
        reviewStatus: decision as 'approved' | 'rejected',
        reviewedBy,
      })
      if (ok) updated++
    }
    return { ok: true, intent: 'review-batch', updated, requested: ids.length }
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
    const result = await postApprovedDraft(postId)
    return { ok: result.ok, intent: 'post-approved-draft', tweetId: result.tweetId, error: result.error }
  }

  // ── Media posting via platform publishers, double-gated (valve + env).
  // Instagram is live; TikTok and YouTube are still stubs and report the
  // manual path. The owner's click is always the trigger: nothing here runs
  // on a schedule.
  if (intent === 'post-media') {
    const postId = parseInt(form.get('postId') as string)
    if (!Number.isFinite(postId)) return { ok: false, error: 'Bad post id' }
    const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1)
    if (!post || post.status !== 'draft' || post.reviewStatus !== 'approved') {
      return { ok: false, error: 'Post must be an approved draft' }
    }
    const valveOn = await getValve(VALVE_KEYS.videoAutopublish)
    if (!valveOn) {
      return { ok: false, stub: true, error: 'Autopublish valve is OFF (Homepage Team > Video tab). Copy the caption and download the media to post manually.' }
    }
    const { getPublisher } = await import('~/lib/social-publish/registry.server')
    const publisher = getPublisher(post.platform)
    if (!publisher) return { ok: false, stub: true, error: `No publisher for ${post.platform}` }
    const mediaUrls = post.mediaUrls ?? []
    const mediaUrl = mediaUrls[0]
    if (!mediaUrl) return { ok: false, error: 'Draft has no media URL' }
    const isVideo = post.videoJobId != null || !!mediaUrl.split('?')[0]?.endsWith('.mp4')
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
    return { ok: true }
  }

  if (intent === 'generate-tweet') {
    const seoTitle = form.get('seoTitle') as string
    const brand = form.get('brand') as string
    const tagline = form.get('tagline') as string
    const dealPrice = parseFloat(form.get('dealPrice') as string)
    const msrp = parseFloat(form.get('msrp') as string)
    const category = form.get('category') as string
    const handle = form.get('handle') as string

    const copy = await generateTweetCopy({
      title: seoTitle,
      brand,
      tagline,
      dealPrice,
      msrp,
      category,
      handle,
    })

    return { ok: true, intent: 'generate-tweet', copy }
  }

  if (intent === 'post-tweet') {
    const tweetText = form.get('tweetText') as string
    const imageUrl = form.get('imageUrl') as string | null
    const dealHistoryId = form.get('dealHistoryId') as string | null

    if (!tweetText?.trim()) {
      return { ok: false, error: 'Tweet text is required' }
    }

    const result = await postManualTweet(
      tweetText.trim(),
      imageUrl || undefined,
      dealHistoryId ? parseInt(dealHistoryId) : undefined,
    )

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

  return { ok: false, error: 'Unknown intent' }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TABS = ['Review', 'Approved', 'Compose', 'History', 'Settings'] as const
type Tab = (typeof TABS)[number]

export default function AdminSocialsPage() {
  const data = useLoaderData<typeof loader>()
  const [tab, setTab] = useState<Tab>('Review')

  const posts = data.posts as unknown as SocialPostRow[]
  const pending = posts.filter(
    p => p.status === 'draft' && (p.reviewStatus === 'pending_review' || p.reviewStatus === 'needs_changes'),
  )
  const approved = posts.filter(p => p.status === 'draft' && p.reviewStatus === 'approved')

  const counts: Record<Tab, number | null> = {
    Review: pending.length,
    Approved: approved.length,
    Compose: null,
    History: null,
    Settings: null,
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">Social Studio</h1>
          <p className="text-xs text-ink-4 mt-0.5">
            Internal review period — drafts only, nothing posts without you.
          </p>
        </div>
        {/* Stat row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
          <Stat label="Waiting" value={pending.length} accent={pending.length > 0} />
          <Stat label="Approved" value={approved.length} />
          <Stat label="Posted" value={posts.filter(p => p.status === 'posted').length} />
          <Stat label="Rejected" value={posts.filter(p => p.reviewStatus === 'rejected').length} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-line pb-px">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-coral text-ink' : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            {t}
            {counts[t] != null && counts[t]! > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-coral text-white text-[10px] font-bold">
                {counts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'Review' && <ReviewQueue posts={pending} />}
      {tab === 'Approved' && <ApprovedList posts={approved} />}
      {tab === 'Compose' && <ComposeTab data={data} />}
      {tab === 'History' && <HistoryTab posts={posts} />}
      {tab === 'Settings' && (
        <FrequencyPanel
          frequencies={data.frequencies}
          autopostValve={data.autopostValve}
          autoPostEnv={data.autoPostEnabled}
        />
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-1.5 ${accent ? 'border-coral/40 bg-coral-soft' : 'border-line bg-white'}`}>
      <p className="text-base font-bold text-ink tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-ink-4">{label}</p>
    </div>
  )
}

// ── Approved tab ─────────────────────────────────────────────────────────────

function ApprovedList({ posts }: { posts: SocialPostRow[] }) {
  if (posts.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-white p-10 text-center">
        <p className="text-sm text-ink-3">No approved drafts waiting.</p>
        <p className="text-xs text-ink-4 mt-1">Approve drafts in Review and they queue up here.</p>
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
  const fetcher = useFetcher<{ ok: boolean; error?: string; tweetId?: string; stub?: boolean }>()
  const [copied, setCopied] = useState(false)
  const text = post.editedText?.trim() || post.tweetText
  const media = post.mediaUrls?.[0] ?? null
  const video = isVideoPost(post)
  const isSubmitting = fetcher.state !== 'idle'

  async function copyCaption() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4 flex flex-col md:flex-row gap-3 md:items-center">
      {media && (video ? (
        <div className="relative shrink-0">
          <img src={post.posterUrl ?? undefined} alt="" className="w-14 h-14 rounded-lg object-cover bg-ink" />
          <span className="absolute inset-0 flex items-center justify-center text-white text-lg drop-shadow">▶</span>
        </div>
      ) : (
        <img src={media} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
      ))}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <PlatformChip platform={post.platform} />
          {post.scheduledFor && (
            <span className="text-xs text-ink-4">
              for {new Date(`${post.scheduledFor}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        <p className="text-sm text-ink break-words">{text.length > 160 ? `${text.slice(0, 160)}…` : text}</p>
        {fetcher.data?.ok === false && <p className="text-xs text-red-500 mt-1">{fetcher.data.error}</p>}
        {fetcher.data?.ok && fetcher.data.tweetId && (
          <p className="text-xs text-green-600 mt-1">Posted — tweet {fetcher.data.tweetId}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        {post.platform === 'x' ? (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="post-approved-draft" />
            <input type="hidden" name="postId" value={post.id} />
            <button
              type="submit"
              disabled={isSubmitting || Boolean(fetcher.data?.ok)}
              className="px-4 py-2 bg-coral text-white rounded-full text-sm font-semibold hover:bg-coral-2 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Posting…' : 'Post now'}
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
                  className="px-4 py-2 bg-coral text-white rounded-full text-sm font-semibold hover:bg-coral-2 transition-colors disabled:opacity-50"
                  title="Publishes via the platform API once keys + the autopublish valve are set; until then this reports the manual path."
                >
                  {isSubmitting ? 'Trying…' : 'Post now'}
                </button>
              </fetcher.Form>
            )}
            <button
              onClick={copyCaption}
              className="px-4 py-2 bg-paper-2 text-ink rounded-full text-sm font-medium border border-line hover:border-ink-4 transition-colors"
            >
              {copied ? 'Copied ♥' : 'Copy caption'}
            </button>
            {media && (
              <a
                href={media}
                target="_blank"
                rel="noopener noreferrer"
                download={video || undefined}
                className="px-4 py-2 bg-paper-2 text-ink-3 rounded-full text-sm font-medium border border-line hover:border-ink-4 transition-colors"
              >
                {video ? 'Download video' : 'Open media'}
              </a>
            )}
          </>
        )}
        {fetcher.data?.stub && (
          <p className="w-full text-xs text-ink-4">
            {fetcher.data.error ?? 'Platform posting is not configured yet. Copy the caption and download the video to post manually.'}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Compose tab (the original Quick Post, unchanged behavior) ───────────────

function ComposeTab({ data }: { data: ReturnType<typeof useLoaderData<typeof loader>> }) {
  const { liveDeal, liveDealImage, liveDealBrand, liveDealTagline, liveDealCategory } = data

  const generateFetcher = useFetcher<typeof action>()
  const postFetcher = useFetcher<typeof action>()

  const [tweetText, setTweetText] = useState('')
  const [includeImage, setIncludeImage] = useState(true)

  const generateData = generateFetcher.data as { ok: boolean; copy?: { mainTweet: string; threadReply?: string } } | undefined
  if (generateData?.ok && generateData.copy && tweetText === '' && generateFetcher.state === 'idle') {
    setTweetText(generateData.copy.mainTweet)
  }

  const charCount = tweetText.length
  const charColor = charCount > 280 ? 'text-red-500' : charCount > 240 ? 'text-amber-500' : 'text-ink/40'

  const discountPct = liveDeal?.msrp && liveDeal?.dealPrice
    ? Math.round(100 - (parseFloat(liveDeal.dealPrice) / parseFloat(liveDeal.msrp)) * 100)
    : 0

  return (
    <section className="bg-white rounded-2xl p-6 shadow-sm">
      <h2 className="text-lg font-semibold font-display text-ink mb-4">
        Quick Post to X
      </h2>

      {liveDeal ? (
        <div className="space-y-4">
          <div className="flex items-start gap-4 p-4 bg-paper-2 rounded-xl">
            {liveDealImage && (
              <img
                src={liveDealImage}
                alt={liveDeal.seoTitle ?? ''}
                className="w-16 h-16 rounded-lg object-cover shrink-0"
              />
            )}
            <div className="min-w-0">
              <p className="font-semibold text-ink truncate">
                {liveDeal.seoTitle ?? liveDeal.sku}
              </p>
              <p className="text-sm text-ink/60">
                ${liveDeal.dealPrice}
                {liveDeal.msrp && (
                  <span className="line-through ml-2">${liveDeal.msrp}</span>
                )}
                {discountPct > 0 && (
                  <span className="ml-2 text-coral font-semibold">{discountPct}% off</span>
                )}
              </p>
            </div>
          </div>

          <generateFetcher.Form method="post">
            <input type="hidden" name="intent" value="generate-tweet" />
            <input type="hidden" name="dealHistoryId" value={liveDeal.id} />
            <input type="hidden" name="seoTitle" value={liveDeal.seoTitle ?? ''} />
            <input type="hidden" name="brand" value={liveDealBrand} />
            <input type="hidden" name="tagline" value={liveDealTagline} />
            <input type="hidden" name="dealPrice" value={liveDeal.dealPrice ?? '0'} />
            <input type="hidden" name="msrp" value={liveDeal.msrp ?? '0'} />
            <input type="hidden" name="category" value={liveDealCategory} />
            <input type="hidden" name="handle" value={liveDeal.sku} />
            <button
              type="submit"
              disabled={generateFetcher.state !== 'idle'}
              className="px-4 py-2 bg-paper-2 text-sage rounded-full text-sm font-medium hover:bg-sage/10 transition-colors disabled:opacity-50"
            >
              {generateFetcher.state !== 'idle' ? 'Generating...' : 'Generate Tweet with AI'}
            </button>
          </generateFetcher.Form>

          <div>
            <textarea
              value={tweetText}
              onChange={(e) => setTweetText(e.target.value)}
              rows={4}
              placeholder="Write your tweet or generate one with AI..."
              className="w-full rounded-xl border border-line p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-sage/30 resize-none"
            />
            <div className="flex items-center justify-between mt-1">
              <span className={`text-xs font-medium ${charColor}`}>
                {charCount}/280
              </span>
              {generateData?.copy?.threadReply && (
                <span className="text-xs text-sage">
                  Thread reply also generated
                </span>
              )}
            </div>
          </div>

          {liveDealImage && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeImage}
                onChange={(e) => setIncludeImage(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-sage focus:ring-sage/30"
              />
              <span className="text-sm text-ink/70">Attach product image</span>
              {includeImage && (
                <img
                  src={liveDealImage}
                  alt=""
                  className="w-8 h-8 rounded object-cover"
                />
              )}
            </label>
          )}

          <postFetcher.Form method="post">
            <input type="hidden" name="intent" value="post-tweet" />
            <input type="hidden" name="tweetText" value={tweetText} />
            <input type="hidden" name="dealHistoryId" value={liveDeal.id} />
            {includeImage && liveDealImage && (
              <input type="hidden" name="imageUrl" value={liveDealImage} />
            )}
            <button
              type="submit"
              disabled={postFetcher.state !== 'idle' || !tweetText.trim() || charCount > 280}
              className="px-6 py-2.5 bg-coral text-white rounded-full text-sm font-semibold font-display shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {postFetcher.state !== 'idle' ? 'Posting...' : 'Post to X'}
            </button>
          </postFetcher.Form>

          {postFetcher.data && postFetcher.state === 'idle' && (
            <div className={`text-sm p-3 rounded-xl ${
              (postFetcher.data as { ok: boolean }).ok
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}>
              {(postFetcher.data as { ok: boolean }).ok
                ? `Posted successfully! Tweet ID: ${(postFetcher.data as { tweetId?: string }).tweetId}`
                : `Failed: ${(postFetcher.data as { error?: string }).error}`
              }
            </div>
          )}
        </div>
      ) : (
        <p className="text-ink/50 text-sm">No live deal right now. Activate a deal first.</p>
      )}
    </section>
  )
}

// ── History tab ──────────────────────────────────────────────────────────────

function HistoryTab({ posts }: { posts: SocialPostRow[] }) {
  const deleteFetcher = useFetcher<typeof action>()
  const retryFetcher = useFetcher<typeof action>()
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  if (posts.length === 0) {
    return (
      <section className="bg-white rounded-2xl p-6 shadow-sm">
        <p className="text-ink/50 text-sm">No posts yet.</p>
      </section>
    )
  }

  return (
    <section className="bg-white rounded-2xl p-4 md:p-6 shadow-sm">
      <div className="space-y-3">
        {posts.map((post) => (
          <div
            key={post.id}
            className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4 p-4 rounded-xl border border-line hover:border-ink-4/40 transition-colors"
          >
            <div className="shrink-0 mt-0.5">
              <PlatformChip platform={post.platform} />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink whitespace-pre-wrap break-words">
                {post.tweetText.length > 200
                  ? `${post.tweetText.slice(0, 200)}...`
                  : post.tweetText
                }
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-ink/40 flex-wrap">
                <span>
                  {post.createdAt
                    ? new Date(post.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      })
                    : '—'
                  }
                </span>
                <span className="capitalize">{post.postType.replace('_', ' ')}</span>
                <span className="capitalize">{post.createdBy}</span>
                {post.reviewedBy && <span>reviewed by {post.reviewedBy}</span>}
              </div>
              {post.feedback && (
                <p className="text-xs text-ink-3 mt-1 italic" title={post.feedback}>
                  Feedback: {post.feedback.length > 120 ? `${post.feedback.slice(0, 120)}…` : post.feedback}
                </p>
              )}
              {post.status === 'failed' && post.errorMessage && (
                <p className="text-xs text-red-500 mt-1 truncate">{post.errorMessage}</p>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <StatusBadge status={post.status} />
              <ReviewBadge status={post.reviewStatus} />

              {post.status === 'posted' && post.externalPostId && (
                <>
                  <a
                    href={`https://x.com/xdipx/status/${post.externalPostId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-sage hover:underline"
                  >
                    View
                  </a>
                  {deleteConfirmId === post.id ? (
                    <div className="flex items-center gap-1">
                      <deleteFetcher.Form method="post">
                        <input type="hidden" name="intent" value="delete-tweet" />
                        <input type="hidden" name="postId" value={post.id} />
                        <input type="hidden" name="externalPostId" value={post.externalPostId} />
                        <button
                          type="submit"
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => setDeleteConfirmId(null)}
                        >
                          Confirm
                        </button>
                      </deleteFetcher.Form>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="text-xs text-ink/40 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(post.id)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Delete
                    </button>
                  )}
                </>
              )}

              {post.status === 'failed' && (
                <retryFetcher.Form method="post">
                  <input type="hidden" name="intent" value="retry-tweet" />
                  <input type="hidden" name="postId" value={post.id} />
                  <button
                    type="submit"
                    disabled={retryFetcher.state !== 'idle'}
                    className="text-xs text-sage hover:underline disabled:opacity-50"
                  >
                    Retry
                  </button>
                </retryFetcher.Form>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    posted:  'bg-green-100 text-green-700',
    failed:  'bg-red-100 text-red-700',
    deleted: 'bg-gray-100 text-gray-500',
    draft:   'bg-amber-100 text-amber-700',
  }

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  )
}

function ReviewBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending_review: 'bg-paper-3 text-ink-3',
    approved:       'bg-green-50 text-green-600',
    needs_changes:  'bg-amber-50 text-amber-600',
    rejected:       'bg-red-50 text-red-500',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${styles[status] ?? 'bg-paper-3 text-ink-3'}`}>
      {status.replace('_', ' ')}
    </span>
  )
}
