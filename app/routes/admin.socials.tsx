import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState } from 'react'
import { db } from '~/lib/db.server'
import { dealHistory, socialPosts } from '../../db/schema'
import { eq, desc } from 'drizzle-orm'
import { generateTweetCopy } from '~/lib/claude.server'
import { getDealByShopifyId } from '~/lib/shopify.server'
import { postManualTweet, deleteAndLogTweet, retryFailedPost } from '~/lib/twitter.server'
import { requireAdmin } from '~/lib/session.server'
import { categoryToLegacyString } from '~/types'

export const meta: MetaFunction = () => [{ title: 'Socials — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const [posts, liveDealRows] = await Promise.all([
    db
      .select()
      .from(socialPosts)
      .orderBy(desc(socialPosts.createdAt))
      .limit(50),
    db
      .select()
      .from(dealHistory)
      .where(eq(dealHistory.status, 'live'))
      .limit(1),
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
    autoPostEnabled: process.env['X_AUTO_POST_ENABLED'] === 'true',
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = form.get('intent') as string

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

export default function AdminSocialsPage() {
  const {
    posts,
    liveDeal,
    liveDealImage,
    liveDealBrand,
    liveDealTagline,
    liveDealCategory,
    autoPostEnabled,
  } = useLoaderData<typeof loader>()

  const generateFetcher = useFetcher<typeof action>()
  const postFetcher = useFetcher<typeof action>()
  const deleteFetcher = useFetcher<typeof action>()
  const retryFetcher = useFetcher<typeof action>()

  const [tweetText, setTweetText] = useState('')
  const [includeImage, setIncludeImage] = useState(true)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  // Populate textarea when Claude generates copy
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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold font-display text-ink">Socials</h1>

      {/* ── Quick Post ───────────────────────────────── */}
      <section className="bg-white rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold font-display text-ink mb-4">
          Quick Post to X
        </h2>

        {liveDeal ? (
          <div className="space-y-4">
            {/* Deal preview */}
            <div className="flex items-start gap-4 p-4 bg-cream-2 rounded-xl">
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

            {/* Generate button */}
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
                className="px-4 py-2 bg-cream-2 text-sage rounded-full text-sm font-medium hover:bg-sage/10 transition-colors disabled:opacity-50"
              >
                {generateFetcher.state !== 'idle' ? 'Generating...' : 'Generate Tweet with AI'}
              </button>
            </generateFetcher.Form>

            {/* Tweet editor */}
            <div>
              <textarea
                value={tweetText}
                onChange={(e) => setTweetText(e.target.value)}
                rows={4}
                placeholder="Write your tweet or generate one with AI..."
                className="w-full rounded-xl border border-gray-200 p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-sage/30 resize-none"
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

            {/* Image toggle */}
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

            {/* Post button */}
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

            {/* Post result feedback */}
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

      {/* ── Settings ─────────────────────────────────── */}
      <section className="bg-white rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold font-display text-ink mb-3">
          Settings
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink/70">Auto-post on deal activation:</span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
            autoPostEnabled
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${autoPostEnabled ? 'bg-green-500' : 'bg-gray-400'}`} />
            {autoPostEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <p className="text-xs text-ink/40 mt-2">
          Toggle via <code className="bg-gray-100 px-1 rounded">X_AUTO_POST_ENABLED</code> environment variable in Vercel.
        </p>
      </section>

      {/* ── Post History ─────────────────────────────── */}
      <section className="bg-white rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold font-display text-ink mb-4">
          Post History
        </h2>

        {posts.length === 0 ? (
          <p className="text-ink/50 text-sm">No posts yet.</p>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <div
                key={post.id}
                className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4 p-4 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors"
              >
                {/* Platform icon */}
                <div className="w-8 h-8 rounded-full bg-ink flex items-center justify-center shrink-0 mt-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4l11.733 16h4.267l-11.733-16z" />
                    <path d="M4 20l6.768-6.768M17.5 4l-6.768 6.768" />
                  </svg>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink whitespace-pre-wrap break-words">
                    {post.tweetText.length > 200
                      ? `${post.tweetText.slice(0, 200)}...`
                      : post.tweetText
                    }
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-ink/40">
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
                  </div>
                  {post.status === 'failed' && post.errorMessage && (
                    <p className="text-xs text-red-500 mt-1 truncate">{post.errorMessage}</p>
                  )}
                </div>

                {/* Status + Actions */}
                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <StatusBadge status={post.status} />

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
        )}
      </section>
    </div>
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
