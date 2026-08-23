import OAuth from 'oauth-1.0a'
import crypto from 'node:crypto'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import { generateTweetCopy } from './claude.server'
import { getDealByShopifyId } from './shopify.server'
import { categoryToLegacyString } from '~/types'
import { eq } from 'drizzle-orm'
import { xPermalink } from './social-publish/x-limits'

// ─── Types ────────────────────────────────────────────────────────────────

export interface DealTweetData {
  dealHistoryId: number
  seoTitle: string
  tagline: string
  dealPrice: number
  msrp: number
  brand: string
  category: string
  handle: string
  imageUrl: string
  shopifyProductId?: string
}

export interface SocialPostResult {
  ok: boolean
  tweetId?: string
  tweetText?: string
  error?: string
}

// ─── OAuth 1.0a Client ───────────────────────────────────────────────────

function getOAuth() {
  return new OAuth({
    consumer: {
      key: process.env['X_API_KEY']!,
      secret: process.env['X_API_SECRET']!,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64')
    },
  })
}

function getToken() {
  return {
    key: process.env['X_ACCESS_TOKEN']!,
    secret: process.env['X_ACCESS_TOKEN_SECRET']!,
  }
}

// ─── Low-Level API Calls ─────────────────────────────────────────────────

async function xFetch<T>(
  url: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
  contentType = 'application/json',
): Promise<T> {
  const oauth = getOAuth()
  const token = getToken()
  const authHeader = oauth.toHeader(
    oauth.authorize({ url, method }, token),
  )

  const headers: Record<string, string> = {
    ...authHeader,
    'Content-Type': contentType,
  }

  const init: RequestInit = { method, headers }
  if (body) {
    init.body = contentType === 'application/json'
      ? JSON.stringify(body)
      : (body as string)
  }

  const res = await fetch(url, init)

  if (!res.ok) {
    const text = await res.text()
    const err = new Error(`X API ${method} ${url} → ${res.status}: ${text}`)
    ;(err as Error & { status: number }).status = res.status
    throw err
  }

  if (res.status === 204) return {} as T
  return (await res.json()) as T
}

// ─── Tweet Operations ────────────────────────────────────────────────────

export async function postTweet(
  text: string,
  mediaIds?: string[],
): Promise<{ id: string; text: string }> {
  const body: Record<string, unknown> = { text }
  if (mediaIds?.length) {
    body.media = { media_ids: mediaIds }
  }

  const res = await xFetch<{ data: { id: string; text: string } }>(
    'https://api.x.com/2/tweets',
    'POST',
    body,
  )
  return res.data
}

export async function deleteTweet(tweetId: string): Promise<void> {
  await xFetch(`https://api.x.com/2/tweets/${tweetId}`, 'DELETE')
}

export async function replyToTweet(
  tweetId: string,
  text: string,
  mediaIds?: string[],
): Promise<{ id: string; text: string }> {
  const body: Record<string, unknown> = {
    text,
    reply: { in_reply_to_tweet_id: tweetId },
  }
  if (mediaIds?.length) {
    body.media = { media_ids: mediaIds }
  }

  const res = await xFetch<{ data: { id: string; text: string } }>(
    'https://api.x.com/2/tweets',
    'POST',
    body,
  )
  return res.data
}

// ─── Batch Tweet Lookup ──────────────────────────────────────────────────

/** The counters X returns under `tweet.fields=public_metrics`. */
export interface TweetPublicMetrics {
  impression_count?: number
  like_count?: number
  reply_count?: number
  retweet_count?: number
  quote_count?: number
  bookmark_count?: number
}

export interface TweetLookupResult {
  /** Tweets X returned normally, keyed by id. */
  found: Map<string, { publicMetrics?: TweetPublicMetrics }>
  /** Ids X reported gone (deleted or withheld), keyed to the error detail. */
  gone: Map<string, string>
  /** Per-id errors that are not a verdict (rate limit shapes etc.). */
  unknown: Map<string, string>
}

interface TweetLookupError {
  value?: string
  resource_id?: string
  title?: string
  type?: string
  detail?: string
}

/**
 * One GET /2/tweets for up to 100 ids, shared by the removal watch (ticket
 * #3745) and the engagement capture (ticket #3734), so both read X on the
 * same request/error convention.
 *
 * A deleted tweet does not 404: the request succeeds and the id comes back in
 * the `errors` array as `resource-not-found`. A withheld or suspended-account
 * tweet comes back as `not-authorized-for-resource`. Both mean the post is no
 * longer publicly on the account, which is the removal watcher's question, so
 * both land in `gone`. Anything else per-id is `unknown`, and a whole-request
 * failure (expired keys, a 429) is `{ ok: false }` so the caller can tell a
 * broken credential from a purged feed.
 */
export async function lookupTweets(
  ids: string[],
): Promise<{ ok: true; result: TweetLookupResult } | { ok: false; detail: string }> {
  const result: TweetLookupResult = { found: new Map(), gone: new Map(), unknown: new Map() }
  if (ids.length === 0) return { ok: true, result }

  const url = `https://api.x.com/2/tweets?ids=${encodeURIComponent(ids.join(','))}&tweet.fields=${encodeURIComponent('public_metrics')}`

  let res: { data?: Array<{ id: string; public_metrics?: TweetPublicMetrics }>; errors?: TweetLookupError[] }
  try {
    res = await xFetch(url, 'GET')
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }

  for (const tweet of res.data ?? []) {
    result.found.set(tweet.id, tweet.public_metrics ? { publicMetrics: tweet.public_metrics } : {})
  }
  for (const error of res.errors ?? []) {
    const id = error.resource_id ?? error.value
    if (!id) continue
    const detail = error.detail ?? error.title ?? 'X reported an error for this tweet'
    if (error.type?.endsWith('resource-not-found') || error.type?.endsWith('not-authorized-for-resource')) {
      result.gone.set(id, detail)
    } else {
      result.unknown.set(id, detail)
    }
  }
  // An id X neither returned nor flagged has no verdict either way.
  for (const id of ids) {
    if (!result.found.has(id) && !result.gone.has(id) && !result.unknown.has(id)) {
      result.unknown.set(id, 'X returned no data and no error for this id')
    }
  }
  return { ok: true, result }
}

// ─── Media Upload (v1.1 endpoint) ────────────────────────────────────────

export async function uploadMedia(
  imageBuffer: Buffer,
  _mimeType: string,
): Promise<string> {
  const oauth = getOAuth()
  const token = getToken()
  const url = 'https://upload.x.com/1.1/media/upload.json'

  const boundary = `----XBoundary${Date.now()}`
  const mediaData = imageBuffer.toString('base64')

  // Build multipart form body
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="media_data"\r\n\r\n${mediaData}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="media_category"\r\n\r\ntweet_image\r\n`,
    `--${boundary}--\r\n`,
  ]
  const bodyStr = parts.join('')

  const authHeader = oauth.toHeader(
    oauth.authorize({ url, method: 'POST' }, token),
  )

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeader,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: bodyStr,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`X media upload failed ${res.status}: ${text}`)
  }

  const data = (await res.json()) as { media_id_string: string }
  return data.media_id_string
}

export async function uploadMediaFromUrl(
  imageUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    const mimeType = res.headers.get('content-type') ?? 'image/jpeg'
    return await uploadMedia(buffer, mimeType)
  } catch (err) {
    console.error('[twitter] Media upload from URL failed:', err)
    return null
  }
}

// ─── High-Level Deal Tweet ───────────────────────────────────────────────

export async function postDealTweet(
  deal: DealTweetData,
): Promise<SocialPostResult> {
  try {
    // Enrich deal data from Shopify if we have a product ID
    let imageUrl = deal.imageUrl
    let brand = deal.brand
    let tagline = deal.tagline
    let category = deal.category

    if (deal.shopifyProductId && (!imageUrl || !brand)) {
      const numericId = deal.shopifyProductId.replace('gid://shopify/Product/', '')
      const fullDeal = await getDealByShopifyId(numericId)
      if (fullDeal) {
        imageUrl = imageUrl || fullDeal.images[0]?.url || ''
        brand = brand || fullDeal.brand
        tagline = tagline || fullDeal.tagline
        category = category || categoryToLegacyString(fullDeal.category)
      }
    }

    // Generate tweet copy via Claude
    const copy = await generateTweetCopy({
      title: deal.seoTitle,
      brand,
      tagline,
      dealPrice: deal.dealPrice,
      msrp: deal.msrp,
      category,
      handle: deal.handle,
    })

    // Upload product image
    let mediaIds: string[] | undefined
    const uploadedMediaUrls: string[] = []
    if (imageUrl) {
      const mediaId = await uploadMediaFromUrl(imageUrl)
      if (mediaId) {
        mediaIds = [mediaId]
        uploadedMediaUrls.push(imageUrl)
      }
    }

    // Post the main tweet
    const tweet = await postTweet(copy.mainTweet, mediaIds)

    // Log to DB
    await db.insert(socialPosts).values({
      platform: 'x',
      postType: 'auto_deal',
      externalPostId: tweet.id,
      permalink: xPermalink(tweet.id),
      dealHistoryId: deal.dealHistoryId,
      tweetText: copy.mainTweet,
      mediaUrls: uploadedMediaUrls.length ? uploadedMediaUrls : null,
      mediaIds: mediaIds ?? null,
      status: 'posted',
      postedAt: new Date(),
      createdBy: 'system',
    })

    // Post thread reply if generated
    if (copy.threadReply) {
      try {
        const reply = await replyToTweet(tweet.id, copy.threadReply)
        await db.insert(socialPosts).values({
          platform: 'x',
          postType: 'thread_reply',
          externalPostId: reply.id,
          permalink: xPermalink(reply.id),
          parentPostId: undefined, // Will use externalPostId linkage
          dealHistoryId: deal.dealHistoryId,
          tweetText: copy.threadReply,
          status: 'posted',
          postedAt: new Date(),
          createdBy: 'system',
        })
      } catch (replyErr) {
        console.error('[twitter] Thread reply failed (main tweet OK):', replyErr)
      }
    }

    return { ok: true, tweetId: tweet.id, tweetText: copy.mainTweet }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[twitter] postDealTweet failed:', errorMessage)

    // Log the failure
    try {
      await db.insert(socialPosts).values({
        platform: 'x',
        postType: 'auto_deal',
        dealHistoryId: deal.dealHistoryId,
        tweetText: `[Failed to generate] ${deal.seoTitle}`,
        status: 'failed',
        errorMessage,
        createdBy: 'system',
      })
    } catch { /* don't fail on logging */ }

    return { ok: false, error: errorMessage }
  }
}

// ─── Manual Post Helper ──────────────────────────────────────────────────

export async function postManualTweet(
  text: string,
  imageUrl?: string,
  dealHistoryId?: number,
): Promise<SocialPostResult> {
  try {
    let mediaIds: string[] | undefined
    const uploadedMediaUrls: string[] = []

    if (imageUrl) {
      const mediaId = await uploadMediaFromUrl(imageUrl)
      if (mediaId) {
        mediaIds = [mediaId]
        uploadedMediaUrls.push(imageUrl)
      }
    }

    const tweet = await postTweet(text, mediaIds)

    await db.insert(socialPosts).values({
      platform: 'x',
      postType: 'manual',
      externalPostId: tweet.id,
      permalink: xPermalink(tweet.id),
      dealHistoryId: dealHistoryId ?? null,
      tweetText: text,
      mediaUrls: uploadedMediaUrls.length ? uploadedMediaUrls : null,
      mediaIds: mediaIds ?? null,
      status: 'posted',
      postedAt: new Date(),
      createdBy: 'admin',
    })

    return { ok: true, tweetId: tweet.id, tweetText: text }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[twitter] postManualTweet failed:', errorMessage)
    return { ok: false, error: errorMessage }
  }
}

/**
 * Post an owner-APPROVED X draft from the Social Studio review queue. Guarded
 * to approved drafts on x only, and reachable only from the /admin/socials
 * action (owner click) — the agent's team API has no path here. Posts the
 * owner's edited text when present, then flips the same row to posted so the
 * review history stays on one row.
 */
export async function postApprovedDraft(postId: number): Promise<SocialPostResult> {
  const [post] = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.id, postId))
    .limit(1)

  if (!post || post.status !== 'draft' || post.reviewStatus !== 'approved') {
    return { ok: false, error: 'Post not found or not an approved draft' }
  }
  if (post.platform !== 'x') {
    return { ok: false, error: 'Only X has live posting plumbing; post this one manually' }
  }

  const text = post.editedText?.trim() || post.tweetText

  try {
    let mediaIds: string[] | undefined
    const imageUrl = post.mediaUrls?.[0]
    if (imageUrl) {
      const mediaId = await uploadMediaFromUrl(imageUrl)
      if (mediaId) mediaIds = [mediaId]
    }

    const tweet = await postTweet(text, mediaIds)

    await db
      .update(socialPosts)
      .set({
        externalPostId: tweet.id,
        permalink: xPermalink(tweet.id),
        mediaIds: mediaIds ?? null,
        status: 'posted',
        postedAt: new Date(),
        errorMessage: null,
      })
      .where(eq(socialPosts.id, postId))

    return { ok: true, tweetId: tweet.id, tweetText: text }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db
      .update(socialPosts)
      .set({ errorMessage })
      .where(eq(socialPosts.id, postId))
    return { ok: false, error: errorMessage }
  }
}

// Delete and retry moved to social-post-ops.server.ts (ticket #4908): the
// old retry re-sent tweet_text with no media and no edited_text.
