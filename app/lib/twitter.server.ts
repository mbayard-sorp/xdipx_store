import OAuth from 'oauth-1.0a'
import crypto from 'node:crypto'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import { generateTweetCopy } from './claude.server'
import { getDealByShopifyId } from './shopify.server'
import { categoryToLegacyString } from '~/types'
import { eq } from 'drizzle-orm'
import { xPermalink, X_VIDEO_MAX_SIZE_BYTES } from './social-publish/x-limits'

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

/**
 * Is the X credential set still valid?
 *
 * A signed `users/me`, which is free and side-effect-free. Lives here rather
 * than in `credential-health.server.ts` so that OAuth 1.0a signing stays in one
 * file — a second signer would be a second thing to get subtly wrong.
 *
 * Returns the tri-state directly: only a 401 or 403 from a correctly signed
 * request is `dead`. A 429 is the rate limit, not a bad credential, and a
 * network failure is a could-not-ask.
 */
export async function xVerifyCredentials(): Promise<{ state: 'live' | 'dead' | 'unknown'; detail: string }> {
  const url = 'https://api.x.com/2/users/me'
  try {
    const oauth = getOAuth()
    const authHeader = oauth.toHeader(oauth.authorize({ url, method: 'GET' }, getToken()))
    const res = await fetch(url, { headers: { ...authHeader } })
    if (res.ok) {
      const body = await res.json().catch(() => null) as { data?: { username?: string } } | null
      return { state: 'live', detail: body?.data?.username ? `@${body.data.username}` : 'users/me 200' }
    }
    if (res.status === 401 || res.status === 403) {
      return { state: 'dead', detail: `users/me HTTP ${res.status}` }
    }
    return { state: 'unknown', detail: `users/me HTTP ${res.status}` }
  } catch (err) {
    return { state: 'unknown', detail: `could not ask: ${String(err).slice(0, 120)}` }
  }
}

// ─── Low-Level API Calls ─────────────────────────────────────────────────

/**
 * Sign, send, and throw on a non-2xx. Returns the raw `Response` so the caller
 * decides whether a body is expected.
 *
 * Split out of `xFetch` because that decision is not the same for every
 * endpoint and cannot be inferred from the status code. `xFetch` parses JSON and
 * is right for the v2 endpoints that always answer with one. The v1.1 upload
 * host has endpoints that answer a **200 with an empty body**, and parsing that
 * throws `Unexpected end of JSON input` on a request that in fact succeeded.
 * `xSendNoBody` below is for those.
 */
async function xSend(
  url: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
  contentType = 'application/json',
): Promise<Response> {
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

  return res
}

/**
 * A call whose success is the status code and nothing else.
 *
 * Any 2xx resolves, an empty body included. Use this and never `xFetch` where
 * the response is discarded: `xFetch` would parse a body the caller does not
 * read, and turn an endpoint that answers 200-with-no-content into a thrown
 * error on a request X accepted.
 */
async function xSendNoBody(
  url: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
  contentType = 'application/json',
): Promise<void> {
  await xSend(url, method, body, contentType)
}

/**
 * A call whose response body is the point. Throws on a non-2xx, and throws on a
 * 2xx whose body will not parse, because a caller that reads `res.data` cannot
 * be handed `{}`: that is how a tweet with no `id` would reach a row marked
 * posted. 204 stays the one no-content status this accepts, unchanged.
 */
async function xFetch<T>(
  url: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
  contentType = 'application/json',
): Promise<T> {
  const res = await xSend(url, method, body, contentType)
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
  // Response discarded, so `xSendNoBody`: nothing here reads a body, and this
  // must not start failing if X ever answers it with 200-and-nothing.
  await xSendNoBody(`https://api.x.com/2/tweets/${tweetId}`, 'DELETE')
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

/**
 * Attach accessibility alt text to an already-uploaded media id (v1.1
 * `media/metadata/create`, ticket #4204). X truncates or rejects an
 * over-length value; 1000 chars matches the Instagram adapter's own
 * `ALT_TEXT_MAX` (`instagram.server.ts`) so callers can share one constant
 * later if this is ever unified. Non-fatal by design: the caller degrades to
 * publishing without alt text on failure, mirroring how the Instagram
 * adapter degrades on a product-tag failure, rather than failing the post
 * over an accessibility metadata call.
 */
export async function setMediaAltText(
  mediaId: string,
  altText: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const url = 'https://upload.x.com/1.1/media/metadata/create.json'
  try {
    // 200 with an EMPTY BODY on success, which is why this is `xSendNoBody` and
    // not `xFetch`. Under `xFetch` every single X post since alt text shipped
    // logged `Alt text failed, published without it: Unexpected end of JSON
    // input` and carried that note into its run event, on a call X had
    // accepted: the throw came from `res.json()`, downstream of the `res.ok`
    // check, so the alt text was being set and only the report was wrong.
    // Nothing here degrades quietly, so a false failure is not harmless: it is
    // the note the next reader trusts.
    await xSendNoBody(url, 'POST', { media_id: mediaId, alt_text: { text: altText.slice(0, 1000) } })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, detail: message }
  }
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

// ─── Chunked Video Upload (v1.1 INIT / APPEND / FINALIZE / STATUS) ───────

/** X's APPEND ceiling per segment. Our clips are a few MB, so usually one. */
export const X_VIDEO_SEGMENT_BYTES = 5 * 1024 * 1024

/** X's ceiling for a `tweet_video` upload. One definition, in x-limits. */
export const X_VIDEO_MAX_BYTES = X_VIDEO_MAX_SIZE_BYTES

/** Total time we will wait on X's post-FINALIZE processing before giving up. */
export const X_VIDEO_MAX_PROCESSING_WAIT_MS = 120_000

const UPLOAD_URL = 'https://upload.x.com/1.1/media/upload.json'

interface ProcessingInfo {
  state?: 'pending' | 'in_progress' | 'succeeded' | 'failed'
  check_after_secs?: number
  progress_percent?: number
  error?: { code?: number; name?: string; message?: string }
}

interface UploadCommandResponse {
  media_id_string?: string
  processing_info?: ProcessingInfo
}

/**
 * Byte ranges for APPEND, as `[start, end)` pairs. Pure so the boundary cases
 * (exactly one segment, one byte over) are tested without a network.
 */
export function videoSegmentRanges(
  totalBytes: number,
  segmentBytes = X_VIDEO_SEGMENT_BYTES,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (let start = 0; start < totalBytes; start += segmentBytes) {
    ranges.push([start, Math.min(start + segmentBytes, totalBytes)])
  }
  return ranges
}

/**
 * POST one command to the v1.1 upload endpoint as multipart/form-data.
 *
 * Same signing as `uploadMedia`: OAuth 1.0a over url + method only. That is
 * correct for multipart, whose body parameters are excluded from the OAuth
 * signature base string, and it is why multipart carries every command here: a
 * form-urlencoded INIT would need its body params signed too, which is a second
 * signing shape to get subtly wrong. APPEND sends the segment as raw bytes in a
 * `media` part rather than base64 `media_data`, so a 5 MB segment stays 5 MB on
 * the wire.
 */
async function postUploadCommand(fields: Record<string, string | Buffer>): Promise<Response> {
  const oauth = getOAuth()
  const authHeader = oauth.toHeader(oauth.authorize({ url: UPLOAD_URL, method: 'POST' }, getToken()))
  const boundary = `----XBoundary${Date.now()}${Math.random().toString(16).slice(2)}`

  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    if (Buffer.isBuffer(value)) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="blob"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
      ))
      parts.push(value)
      parts.push(Buffer.from('\r\n'))
    } else {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))

  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { ...authHeader, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(parts),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`X video ${String(fields.command)} failed ${res.status}: ${text.slice(0, 300)}`)
  }
  return res
}

/**
 * Parse a command response. INIT, FINALIZE, and STATUS answer JSON; an empty
 * body is tolerated (the caller checks for the fields it needs) because the
 * upload host is known to answer 200-with-nothing on some commands.
 */
async function readUploadJson(res: Response, command: string): Promise<UploadCommandResponse> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as UploadCommandResponse
  } catch {
    throw new Error(`X video ${command} returned a body that is not JSON: ${text.slice(0, 200)}`)
  }
}

async function getUploadStatus(mediaId: string): Promise<UploadCommandResponse> {
  // Query params ride on the URL, which oauth-1.0a folds into the signature.
  const url = `${UPLOAD_URL}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`
  const oauth = getOAuth()
  const authHeader = oauth.toHeader(oauth.authorize({ url, method: 'GET' }, getToken()))
  const res = await fetch(url, { method: 'GET', headers: { ...authHeader } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`X video STATUS failed ${res.status}: ${text.slice(0, 300)}`)
  }
  return readUploadJson(res, 'STATUS')
}

export interface UploadVideoOptions {
  mediaType?: string
  /** Injected so tests do not actually wait out `check_after_secs`. */
  sleep?: (ms: number) => Promise<void>
  maxProcessingWaitMs?: number
}

/**
 * Upload a video (normally a Vercel Blob MP4) to X and return its media id.
 *
 * INIT (`tweet_video`), APPEND in segments of at most 5 MB, FINALIZE, then
 * STATUS polling on `processing_info` until X says `succeeded`. X rejects a
 * post that names a video still processing, so returning before `succeeded`
 * would turn a good upload into a failed post.
 *
 * Throws with a specific message on every failure, unlike `uploadMediaFromUrl`
 * which swallows to null: the caller refuses to post without the video either
 * way, and the message is what the owner reads on the failed row.
 */
export async function uploadVideoFromUrl(videoUrl: string, opts: UploadVideoOptions = {}): Promise<string> {
  const mediaType = opts.mediaType ?? 'video/mp4'
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const maxWaitMs = opts.maxProcessingWaitMs ?? X_VIDEO_MAX_PROCESSING_WAIT_MS
  const label = videoUrl.split('?')[0]

  const download = await fetch(videoUrl)
  if (!download.ok) throw new Error(`Video download failed ${download.status} for ${label}`)
  const declared = Number(download.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > X_VIDEO_MAX_BYTES) {
    throw new Error(`Video is ${declared} bytes; X accepts at most ${X_VIDEO_MAX_BYTES}.`)
  }
  const buffer = Buffer.from(await download.arrayBuffer())
  if (buffer.length === 0) throw new Error(`Video download for ${label} was empty.`)
  if (buffer.length > X_VIDEO_MAX_BYTES) {
    throw new Error(`Video is ${buffer.length} bytes; X accepts at most ${X_VIDEO_MAX_BYTES}.`)
  }

  const init = await readUploadJson(
    await postUploadCommand({
      command: 'INIT',
      total_bytes: String(buffer.length),
      media_type: mediaType,
      media_category: 'tweet_video',
    }),
    'INIT',
  )
  const mediaId = init.media_id_string
  if (!mediaId) throw new Error('X video INIT returned no media_id_string.')

  // APPEND answers 2xx with an empty body; only the status matters.
  const ranges = videoSegmentRanges(buffer.length)
  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i]!
    await postUploadCommand({
      command: 'APPEND',
      media_id: mediaId,
      segment_index: String(i),
      media: buffer.subarray(start, end),
    })
  }

  const finalized = await readUploadJson(
    await postUploadCommand({ command: 'FINALIZE', media_id: mediaId }),
    'FINALIZE',
  )

  // No processing_info on FINALIZE means X is done with it already.
  let info = finalized.processing_info
  let waitedMs = 0
  while (info && info.state !== 'succeeded') {
    if (info.state === 'failed') {
      const e = info.error
      const why = e ? [e.name, e.message, e.code != null ? `(code ${e.code})` : ''].filter(Boolean).join(' ') : 'no detail'
      throw new Error(`X video processing failed: ${why}`)
    }
    const nextMs = Math.max(1, info.check_after_secs ?? 1) * 1000
    if (waitedMs + nextMs > maxWaitMs) {
      throw new Error(
        `X video still ${info.state ?? 'processing'} after ${Math.round(waitedMs / 1000)}s; ` +
        `gave up at the ${Math.round(maxWaitMs / 1000)}s cap.`,
      )
    }
    await sleep(nextMs)
    waitedMs += nextMs
    info = (await getUploadStatus(mediaId)).processing_info
  }

  return mediaId
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
