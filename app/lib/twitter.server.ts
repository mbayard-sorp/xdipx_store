import OAuth from 'oauth-1.0a'
import crypto from 'node:crypto'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import { generateTweetCopy } from './claude.server'
import { getDealByShopifyId } from './shopify.server'
import { categoryToLegacyString } from '~/types'
import { eq } from 'drizzle-orm'

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

// ─── Delete + Retry Helpers ──────────────────────────────────────────────

export async function deleteAndLogTweet(
  postId: number,
  externalPostId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await deleteTweet(externalPostId)
    await db
      .update(socialPosts)
      .set({ status: 'deleted' })
      .where(eq(socialPosts.id, postId))
    return { ok: true }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    return { ok: false, error: errorMessage }
  }
}

export async function retryFailedPost(
  postId: number,
): Promise<SocialPostResult> {
  const [post] = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.id, postId))
    .limit(1)

  if (!post || post.status !== 'failed') {
    return { ok: false, error: 'Post not found or not in failed state' }
  }

  try {
    const tweet = await postTweet(post.tweetText)

    await db
      .update(socialPosts)
      .set({
        externalPostId: tweet.id,
        status: 'posted',
        postedAt: new Date(),
        errorMessage: null,
      })
      .where(eq(socialPosts.id, postId))

    return { ok: true, tweetId: tweet.id, tweetText: post.tweetText }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db
      .update(socialPosts)
      .set({ errorMessage })
      .where(eq(socialPosts.id, postId))
    return { ok: false, error: errorMessage }
  }
}
