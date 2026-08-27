/**
 * Owner-click operations on a single social_posts row: retry a failed publish
 * and delete a post. Social Studio v2 Phase 0 (ticket #4908, ADR-013).
 *
 * ## Why retry lives here and not in twitter.server.ts
 *
 * The old `retryFailedPost` re-sent `tweet_text` through `postTweet` with no
 * media, so a retry published a caption nobody reviewed (the owner's
 * `edited_text` was dropped) with the image stripped, and it only knew about
 * X. A retry is a re-run of the publish the row already earned, so it goes
 * through the same platform adapter the hourly tick uses, with the same
 * caption rule (`edited_text` wins) and the same media shape, and it re-runs
 * the durable stock guard because the product may have sold out since the
 * first attempt. It does NOT re-run the pre-publish gate: the row reached
 * `failed` by being claimed from the approved queue, so the stamp was already
 * checked once, and nothing about the content has changed since.
 *
 * ## Delete semantics per state
 *
 * - draft / failed (any review status): soft delete, `status='deleted'`. The
 *   row stays for the history tab and for `reworked_from` references.
 * - posted on X: the tweet is deleted on X first, then the row is marked.
 * - posted on Instagram: the Graph API has no delete endpoint for published
 *   media, so the row is marked `deleted` here and the caller is told the
 *   post is still live until removed in the Instagram app. The Studio shows
 *   that note rather than pretending.
 * - publishing: refused, a tick owns the row.
 * - deleted: refused, nothing to do.
 *
 * Every dependency is injectable so the state machine is unit-testable
 * without a database or a network.
 */

import { eq } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import type { PublishMedia, SocialPublisher } from './social-publish/types'
import { checkLinkedProductStock } from './social-publish/stock-guard.server'
import { preserveGateStamp } from './social-publish-approve.server'
import { isVideoPost } from '~/components/admin/social/types'

type SocialPostRow = typeof socialPosts.$inferSelect

export interface PostOpsDeps {
  load: (postId: number) => Promise<SocialPostRow | null>
  update: (postId: number, values: Partial<SocialPostRow>) => Promise<void>
  getPublisher: (platform: string) => SocialPublisher | null
  /** X text-only post; the adapter requires media, the owner's text post does not. */
  postText: (caption: string) => Promise<{ id: string }>
  deleteTweet: (externalPostId: string) => Promise<void>
  checkStock: (shopifyProductId: string | null) => Promise<{ ok: boolean; detail?: string }>
  now: () => Date
}

const liveDeps: PostOpsDeps = {
  load: async (postId) => {
    const [row] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1)
    return row ?? null
  },
  update: async (postId, values) => {
    await db.update(socialPosts).set(values).where(eq(socialPosts.id, postId))
  },
  // Replaced in resolveDeps with the real registry, imported lazily so this
  // module does not pull every platform adapter in at load.
  getPublisher: () => null,
  postText: async (caption) => {
    const { postTweet } = await import('./twitter.server')
    return postTweet(caption)
  },
  deleteTweet: async (externalPostId) => {
    const { deleteTweet } = await import('./twitter.server')
    await deleteTweet(externalPostId)
  },
  checkStock: (id) => checkLinkedProductStock(id),
  now: () => new Date(),
}

async function resolveDeps(over: Partial<PostOpsDeps>): Promise<PostOpsDeps> {
  const deps: PostOpsDeps = { ...liveDeps, ...over }
  if (!over.getPublisher) {
    const { getPublisher } = await import('./social-publish/registry.server')
    deps.getPublisher = getPublisher
  }
  return deps
}

export function isVideoRow(post: Pick<SocialPostRow, 'videoJobId' | 'mediaUrls'> & { mediaKind?: string | null }): boolean {
  // One definition (ticket #5715): stored media_kind wins, inference falls back.
  return isVideoPost(post)
}

/** The media shape the publish job builds from a row; shared by retry and Post now. */
export function mediaForRow(post: Pick<SocialPostRow, 'videoJobId' | 'mediaUrls' | 'posterUrl'>): PublishMedia | null {
  const urls = post.mediaUrls ?? []
  const first = urls[0]
  if (!first) return null
  if (isVideoRow(post)) {
    return { kind: 'video', videoUrl: first, ...(post.posterUrl ? { posterUrl: post.posterUrl } : {}) }
  }
  return urls.length > 1 ? { kind: 'carousel', imageUrls: urls } : { kind: 'image', imageUrl: first }
}

export interface RetryResult {
  ok: boolean
  externalPostId?: string
  error?: string
}

export async function retryFailedSocialPost(
  postId: number,
  over: Partial<PostOpsDeps> = {},
): Promise<RetryResult> {
  const deps = await resolveDeps(over)
  const post = await deps.load(postId)
  if (!post || post.status !== 'failed') {
    return { ok: false, error: 'Post not found or not in failed state' }
  }

  const stock = await deps.checkStock(post.shopifyProductId)
  if (!stock.ok) {
    await deps.update(postId, {
      status: 'draft',
      reviewStatus: 'needs_changes',
      // The legacy stamp rides behind the note for burn-in readers (#4913).
      feedback: preserveGateStamp(
        post.feedback,
        `[stock-guard] ${stock.detail ?? 'Linked product is not in stock.'} Swap the product or re-draft before this can publish.`,
      ),
    })
    return { ok: false, error: `${stock.detail ?? 'Linked product is not in stock.'} Moved to Needs Changes.` }
  }

  const caption = post.editedText?.trim() || post.tweetText
  const media = mediaForRow(post)

  try {
    let externalPostId: string
    if (!media) {
      if (post.platform !== 'x') {
        return { ok: false, error: `A ${post.platform} post needs media; this row has none.` }
      }
      const tweet = await deps.postText(caption)
      externalPostId = tweet.id
    } else {
      const publisher = deps.getPublisher(post.platform)
      if (!publisher) return { ok: false, error: `No publisher for ${post.platform}` }
      const result = await publisher.publish({ postId, media, caption })
      if (!result.ok) {
        const detail = result.reason === 'not_configured'
          ? `${post.platform} publisher is not configured`
          : result.detail ?? 'Publish failed'
        await deps.update(postId, { errorMessage: detail })
        return { ok: false, error: detail }
      }
      externalPostId = result.externalPostId
    }

    await deps.update(postId, {
      externalPostId,
      status: 'posted',
      postedAt: deps.now(),
      errorMessage: null,
    })
    return { ok: true, externalPostId }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await deps.update(postId, { errorMessage })
    return { ok: false, error: errorMessage }
  }
}

export interface DeleteResult {
  ok: boolean
  /** Set when the row is gone from the Studio but the post is still live. */
  note?: string
  error?: string
}

export async function deleteSocialPost(
  postId: number,
  over: Partial<PostOpsDeps> = {},
): Promise<DeleteResult> {
  const deps = await resolveDeps(over)
  const post = await deps.load(postId)
  if (!post) return { ok: false, error: 'Post not found' }
  if (post.status === 'deleted') return { ok: false, error: 'Already deleted' }
  if (post.status === 'publishing') {
    return { ok: false, error: 'A publish tick owns this row right now; try again in a minute.' }
  }

  if (post.status === 'posted') {
    if (post.platform === 'x' && post.externalPostId) {
      try {
        await deps.deleteTweet(post.externalPostId)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      await deps.update(postId, { status: 'deleted' })
      return { ok: true }
    }
    if (post.platform === 'instagram') {
      await deps.update(postId, { status: 'deleted' })
      return {
        ok: true,
        note: 'Removed from the Studio. Instagram has no delete API, so the post is still live until you remove it in the Instagram app.',
      }
    }
    // Other platforms have no delete plumbing; removing the row would hide a
    // live post with no way back.
    return { ok: false, error: `Cannot delete a live ${post.platform} post from here; remove it on the platform first.` }
  }

  // draft or failed: soft delete.
  await deps.update(postId, { status: 'deleted' })
  return { ok: true }
}
