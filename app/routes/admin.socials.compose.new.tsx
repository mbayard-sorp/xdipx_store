/**
 * /admin/socials/compose/new — an owner-composed draft from scratch.
 * Saving creates a `social_posts` row at draft/pending_review (createdBy
 * 'owner', postType 'manual') plus its `social_post_slides`, then redirects
 * to /compose/:id. The legacy X quick post (generate-tweet / post-tweet,
 * live-deal-bound, posts immediately) is kept below the Composer unchanged.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState } from 'react'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { dealHistory } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { generateTweetCopy } from '~/lib/claude.server'
import { getDealByShopifyId } from '~/lib/shopify.server'
import { postManualTweet } from '~/lib/twitter.server'
import { categoryToLegacyString } from '~/types'
import { weightedTweetLength, X_CAPTION_MAX } from '~/lib/social-publish/x-limits'
import { Composer } from '~/components/admin/social/Composer'
import { blankInitial, composerRoster, handleComposerIntent, slidesFromAssetsParam } from '~/lib/social-composer.server'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const platform = url.searchParams.get('platform') ?? 'instagram'
  const [roster, slides, liveDealRows] = await Promise.all([
    composerRoster(),
    slidesFromAssetsParam(url),
    db.select().from(dealHistory).where(eq(dealHistory.status, 'live')).limit(1),
  ])
  const liveDeal = liveDealRows[0] ?? null
  let liveDealImage: string | null = null
  let liveDealBrand = ''
  let liveDealTagline = ''
  let liveDealCategory = ''
  if (liveDeal?.shopifyProductId) {
    const numericId = liveDeal.shopifyProductId.replace('gid://shopify/Product/', '')
    const fullDeal = await getDealByShopifyId(numericId).catch(() => null)
    if (fullDeal) {
      liveDealImage = fullDeal.images[0]?.url ?? null
      liveDealBrand = fullDeal.brand
      liveDealTagline = fullDeal.tagline
      liveDealCategory = categoryToLegacyString(fullDeal.category)
    }
  }
  return {
    initial: blankInitial(['instagram', 'x', 'linkedin'].includes(platform) ? platform : 'instagram', slides),
    roster,
    liveDeal, liveDealImage, liveDealBrand, liveDealTagline, liveDealCategory,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const handled = await handleComposerIntent(form, null)
  if (handled) return handled
  const intent = form.get('intent') as string

  if (intent === 'generate-tweet') {
    const copy = await generateTweetCopy({
      title: form.get('seoTitle') as string,
      brand: form.get('brand') as string,
      tagline: form.get('tagline') as string,
      dealPrice: parseFloat(form.get('dealPrice') as string),
      msrp: parseFloat(form.get('msrp') as string),
      category: form.get('category') as string,
      handle: form.get('handle') as string,
    })
    return { ok: true, intent: 'generate-tweet', copy }
  }

  if (intent === 'post-tweet') {
    const tweetText = form.get('tweetText') as string
    const imageUrl = form.get('imageUrl') as string | null
    const dealHistoryId = form.get('dealHistoryId') as string | null
    if (!tweetText?.trim()) return { ok: false, error: 'Tweet text is required' }
    const result = await postManualTweet(
      tweetText.trim(),
      imageUrl || undefined,
      dealHistoryId ? parseInt(dealHistoryId) : undefined,
    )
    return { ok: result.ok, intent: 'post-tweet', tweetId: result.tweetId, error: result.error }
  }

  return { ok: false, error: 'Unknown intent' }
}

export default function ComposeNew() {
  const data = useLoaderData<typeof loader>()
  return (
    <Composer
      postId={null}
      initial={data.initial}
      roster={data.roster}
      extra={<QuickPost data={data} />}
    />
  )
}

// ── Legacy quick post to X (live-deal-bound, posts immediately) ─────────────

function QuickPost({ data }: { data: ReturnType<typeof useLoaderData<typeof loader>> }) {
  const { liveDeal, liveDealImage, liveDealBrand, liveDealTagline, liveDealCategory } = data
  const generateFetcher = useFetcher<{ ok: boolean; copy?: { mainTweet: string; threadReply?: string } }>()
  const postFetcher = useFetcher<{ ok: boolean; tweetId?: string; error?: string }>()
  const [open, setOpen] = useState(false)
  const [tweetText, setTweetText] = useState('')
  const [includeImage, setIncludeImage] = useState(true)

  if (generateFetcher.data?.ok && generateFetcher.data.copy && tweetText === '' && generateFetcher.state === 'idle') {
    setTweetText(generateFetcher.data.copy.mainTweet)
  }
  const charCount = weightedTweetLength(tweetText)

  return (
    <details className="rounded-2xl border border-line bg-paper-2 p-4" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-medium text-ink-3 min-h-11 flex items-center">
        Quick post to X from the live deal (posts immediately, no review)
      </summary>
      {!liveDeal ? (
        <p className="mt-3 text-xs text-ink-3">No live deal right now, so there is nothing to quick-post. Use the Composer above for a reviewed draft.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex items-start gap-3">
            {liveDealImage && <img src={liveDealImage} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-paper-3" />}
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink truncate">{liveDeal.seoTitle ?? liveDeal.sku}</p>
              <p className="font-mono text-xs text-ink-3">${liveDeal.dealPrice}{liveDeal.msrp ? ` (msrp $${liveDeal.msrp})` : ''}</p>
            </div>
          </div>
          <generateFetcher.Form method="post">
            <input type="hidden" name="intent" value="generate-tweet" />
            <input type="hidden" name="seoTitle" value={liveDeal.seoTitle ?? ''} />
            <input type="hidden" name="brand" value={liveDealBrand} />
            <input type="hidden" name="tagline" value={liveDealTagline} />
            <input type="hidden" name="dealPrice" value={liveDeal.dealPrice ?? '0'} />
            <input type="hidden" name="msrp" value={liveDeal.msrp ?? '0'} />
            <input type="hidden" name="category" value={liveDealCategory} />
            <input type="hidden" name="handle" value={liveDeal.sku} />
            <button type="submit" disabled={generateFetcher.state !== 'idle'} className="min-h-11 px-4 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-50">
              {generateFetcher.state !== 'idle' ? 'Generating' : 'Generate with Emma'}
            </button>
          </generateFetcher.Form>
          <textarea
            value={tweetText}
            onChange={e => setTweetText(e.target.value)}
            rows={4}
            placeholder="Write the post or generate one."
            className="w-full rounded-xl border border-line bg-paper p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-coral/30 resize-none"
          />
          <div className="flex items-center justify-between">
            <span className={`font-mono text-xs tabular-nums ${charCount > X_CAPTION_MAX ? 'text-red-700' : 'text-ink-4'}`}>{charCount}/{X_CAPTION_MAX}</span>
            {liveDealImage && (
              <label className="inline-flex items-center gap-2 text-xs text-ink-3 min-h-11">
                <input type="checkbox" checked={includeImage} onChange={e => setIncludeImage(e.target.checked)} className="w-4 h-4" />
                Attach product image
              </label>
            )}
          </div>
          <postFetcher.Form method="post" className="flex items-center gap-3 flex-wrap">
            <input type="hidden" name="intent" value="post-tweet" />
            <input type="hidden" name="tweetText" value={tweetText} />
            <input type="hidden" name="dealHistoryId" value={liveDeal.id} />
            {includeImage && liveDealImage && <input type="hidden" name="imageUrl" value={liveDealImage} />}
            <button
              type="submit"
              disabled={postFetcher.state !== 'idle' || !tweetText.trim() || charCount > X_CAPTION_MAX}
              className="min-h-11 px-4 rounded-full border border-ink bg-ink text-white text-sm font-semibold hover:bg-ink-2 disabled:opacity-50"
            >
              {postFetcher.state !== 'idle' ? 'Posting' : 'Post to X now'}
            </button>
            {postFetcher.data && postFetcher.state === 'idle' && (
              <span className={`text-xs ${postFetcher.data.ok ? 'text-[#4F6150]' : 'text-red-700'}`}>
                {postFetcher.data.ok ? `Posted, id ${postFetcher.data.tweetId}` : `Failed: ${postFetcher.data.error}`}
              </span>
            )}
          </postFetcher.Form>
        </div>
      )}
    </details>
  )
}
