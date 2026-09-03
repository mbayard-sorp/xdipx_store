/**
 * X publisher, live via the X API v2 (posts) and v1.1 (media upload).
 *
 * The transport already existed and is exercised by the owner's "Post now"
 * button in the Social Studio: `twitter.server.ts` holds the OAuth 1.0a client,
 * `postTweet`, and `uploadMediaFromUrl`. This adapter is the thin shim that lets
 * the unattended publish job reach it through the same `SocialPublisher`
 * interface every other platform uses, so the job never learns what X is.
 *
 * Verified end to end against the live @hello_xdipx account on 2026-08-16:
 * OAuth 1.0a signing, write scope, text post, and image upload plus post, each
 * followed by a delete. The v1.1 media endpoint was suspected dead after X's
 * February 2026 API overhaul; it is not.
 *
 * ## Two X-specific facts the job cannot know
 *
 * X bills per post, and a post carrying a link costs more than 13x a plain one
 * (see `x-limits.ts`). The spend guard lives in the job, but the cost model is
 * here beside the thing that spends.
 *
 * X rejects an over-length post outright, and it does so AFTER the media upload
 * has already been billed. So length is checked before anything is uploaded,
 * not after.
 *
 * ## What this deliberately does not do
 *
 * Video. X requires chunked INIT/APPEND/FINALIZE upload for video, which the
 * existing `uploadMedia` does not implement. A video draft fails with a clear
 * detail rather than silently posting as text, which would strip the media the
 * post was built around.
 */

import type { SocialPublisher, PublishInput, PublishResult } from './types'
import { X_CAPTION_MAX, X_MEDIA_MAX, weightedTweetLength } from './x-limits'

/** All four OAuth 1.0a values must be present; a partial set cannot sign. */
const REQUIRED_ENV = [
  'X_API_KEY',
  'X_API_SECRET',
  'X_ACCESS_TOKEN',
  'X_ACCESS_TOKEN_SECRET',
] as const

export const xPublisher: SocialPublisher = {
  platform: 'x',

  configured(): boolean {
    return REQUIRED_ENV.every(k => !!process.env[k]?.trim())
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!this.configured()) return { ok: false, reason: 'not_configured' }

    const caption = input.caption.trim()

    // Length first, before any billable upload. X counts links at t.co width,
    // so this uses the weighted length rather than String.length.
    const length = weightedTweetLength(caption)
    if (length > X_CAPTION_MAX) {
      return {
        ok: false,
        reason: 'error',
        detail: `Post is ${length} characters as X counts them (limit ${X_CAPTION_MAX}). Links count as ${23} regardless of real length.`,
      }
    }
    if (!caption) {
      return { ok: false, reason: 'error', detail: 'Post has no text.' }
    }

    if (input.media.kind === 'video') {
      return {
        ok: false,
        reason: 'error',
        detail: 'X video posting needs chunked upload (INIT/APPEND/FINALIZE), which is not implemented. Post this one by hand from the Social Studio.',
      }
    }

    const imageUrls = input.media.kind === 'carousel'
      ? input.media.imageUrls.slice(0, X_MEDIA_MAX)
      : [input.media.imageUrl]

    if (input.media.kind === 'carousel' && input.media.imageUrls.length > X_MEDIA_MAX) {
      // Not an error: X takes the first 4 and the post is still coherent. Worth
      // saying out loud in the log rather than silently dropping slides.
      console.warn(
        `[x-publisher] post ${input.postId} has ${input.media.imageUrls.length} images; X takes ${X_MEDIA_MAX}. Publishing the first ${X_MEDIA_MAX}.`,
      )
    }

    const { uploadMediaFromUrl, postTweet, setMediaAltText } = await import('../twitter.server')

    // uploadMediaFromUrl swallows its own failures and returns null. Treat that
    // as terminal rather than posting text-only: an image post that quietly
    // becomes a text post is a content change nothing reviewed.
    const mediaIds: string[] = []
    for (const url of imageUrls) {
      const id = await uploadMediaFromUrl(url)
      if (!id) {
        return {
          ok: false,
          reason: 'error',
          detail: `Media upload failed for ${url.split('?')[0]}. Not posting without the image.`,
        }
      }
      mediaIds.push(id)
    }

    // Alt text (social_posts.alt_text, ticket #4204), on the first image only,
    // mirroring the Instagram adapter's own carousel convention. Additive and
    // non-fatal: a metadata-call failure degrades to publishing without alt
    // text rather than failing the post, the same shape as the Instagram
    // product tag's degrade-on-failure (instagram.server.ts
    // createContainerWithOptionalTag).
    const altText = input.altText?.trim()
    let altTextNote: string | undefined
    if (altText && mediaIds[0]) {
      const attached = await setMediaAltText(mediaIds[0], altText)
      if (!attached.ok) {
        console.warn(`[x-publisher] post ${input.postId} alt text failed, publishing without it: ${attached.detail}`)
        altTextNote = `Alt text failed, published without it: ${attached.detail}`
      }
    }

    try {
      const tweet = await postTweet(caption, mediaIds)
      return { ok: true, externalPostId: tweet.id, ...(altTextNote ? { note: altTextNote } : {}) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, reason: 'error', detail: describeXApiError(message) }
    }
  },
}

/**
 * Name the two failures that are configuration rather than code, because both
 * present as an opaque HTTP status and both have a specific remedy.
 *
 * 402 is the one that will actually happen: X moved to pay-per-use credits in
 * February 2026, and a depleted balance stops every write while leaving auth
 * working perfectly, which reads as a code bug if you do not know to look.
 */
export function describeXApiError(message: string): string {
  if (message.includes('402')) {
    return `${message}. X API credits are depleted. Add credits at developer.x.com; posting stays blocked until you do.`
  }
  if (message.includes('403')) {
    return `${message}. The access token is likely read-only. Set App permissions to Read and Write, then REGENERATE the access token and secret (changing the permission does not upgrade an existing token) and update the Vercel env vars.`
  }
  return message
}
