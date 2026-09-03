/**
 * Retry and delete state machine for social_posts rows (ticket #4908).
 * Every dependency is injected; nothing here touches a database or a network.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  retryFailedSocialPost,
  deleteSocialPost,
  mediaForRow,
  type PostOpsDeps,
} from './social-post-ops.server'
import type { SocialPublisher } from './social-publish/types'

type Row = Awaited<ReturnType<PostOpsDeps['load']>>

function row(over: Partial<NonNullable<Row>> = {}): NonNullable<Row> {
  return {
    id: 7,
    platform: 'x',
    postType: 'product',
    externalPostId: null,
    parentPostId: null,
    dealHistoryId: null,
    tweetText: 'original caption',
    mediaUrls: ['https://cdn.example/social-a.jpg', 'https://cdn.example/social-b.jpg'],
    mediaIds: null,
    status: 'failed',
    errorMessage: 'boom',
    postedAt: null,
    createdAt: new Date('2026-08-20T00:00:00Z'),
    createdBy: 'agent',
    reviewStatus: 'approved',
    feedback: null,
    editedText: 'the owner edited this',
    reviewedBy: 'mike',
    reviewedAt: null,
    scheduledFor: null,
    reworkedFrom: null,
    videoJobId: null,
    posterUrl: null,
    metricsJson: null,
    shopifyProductId: null,
    altText: null,
    imageBrief: null,
    subject: null,
    scheduledAt: null,
    permalink: null,
    gateStatus: null,
    gateCheckedAt: null,
    gateFindings: null,
    castSlugs: null,
    updatedAt: null,
    episodeId: null,
    mediaKind: null,
    removalSource: 'unknown',
    sceneLocation: null,
    ...over,
  }
}

function harness(post: Row, publishResult: Awaited<ReturnType<SocialPublisher['publish']>> = { ok: true, externalPostId: 'ext-1' }) {
  const updates: { id: number; values: Record<string, unknown> }[] = []
  const publish = vi.fn(async (_input: Parameters<SocialPublisher['publish']>[0]) => publishResult)
  const publisher: SocialPublisher = { platform: 'x', configured: () => true, publish }
  const deps: PostOpsDeps = {
    load: async () => post,
    update: async (id, values) => { updates.push({ id, values: values as Record<string, unknown> }) },
    getPublisher: () => publisher,
    postText: vi.fn(async () => ({ id: 'text-1' })),
    deleteTweet: vi.fn(async () => {}),
    checkStock: async () => ({ ok: true }),
    now: () => new Date('2026-08-23T00:00:00Z'),
  }
  return { deps, updates, publish, publisher }
}

describe('retryFailedSocialPost', () => {
  it('refuses anything that is not failed', async () => {
    const { deps, updates } = harness(row({ status: 'draft' }))
    const r = await retryFailedSocialPost(7, deps)
    expect(r.ok).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('re-sends the edited text and every slide through the platform publisher', async () => {
    const { deps, updates, publish } = harness(row())
    const r = await retryFailedSocialPost(7, deps)
    expect(r).toEqual({ ok: true, externalPostId: 'ext-1' })
    expect(publish).toHaveBeenCalledTimes(1)
    const input = publish.mock.calls[0]![0] as { caption: string; media: { kind: string; imageUrls?: string[] } }
    expect(input.caption).toBe('the owner edited this')
    expect(input.media.kind).toBe('carousel')
    expect(input.media.imageUrls).toHaveLength(2)
    expect(updates[0]!.values).toMatchObject({ status: 'posted', externalPostId: 'ext-1', errorMessage: null })
  })

  it('falls back to tweet_text when there is no edit', async () => {
    const { deps, publish } = harness(row({ editedText: null }))
    await retryFailedSocialPost(7, deps)
    expect((publish.mock.calls[0]![0] as { caption: string }).caption).toBe('original caption')
  })

  it('posts text-only on X when the row has no media', async () => {
    const { deps, publish, updates } = harness(row({ mediaUrls: null }))
    const r = await retryFailedSocialPost(7, deps)
    expect(r.ok).toBe(true)
    expect(publish).not.toHaveBeenCalled()
    expect(deps.postText).toHaveBeenCalledWith('the owner edited this')
    expect(updates[0]!.values).toMatchObject({ externalPostId: 'text-1' })
  })

  it('refuses a media-less Instagram row rather than posting nothing', async () => {
    const { deps, updates } = harness(row({ platform: 'instagram', mediaUrls: null }))
    const r = await retryFailedSocialPost(7, deps)
    expect(r.ok).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('re-runs the stock guard and parks the row on needs_changes', async () => {
    const { deps, updates, publish } = harness(row({ shopifyProductId: 'gid://1' }))
    deps.checkStock = async () => ({ ok: false, detail: 'Sold out.' })
    const r = await retryFailedSocialPost(7, deps)
    expect(r.ok).toBe(false)
    expect(publish).not.toHaveBeenCalled()
    expect(updates[0]!.values).toMatchObject({ status: 'draft', reviewStatus: 'needs_changes' })
  })

  it('keeps the gate stamp behind the stock-guard note (burn-in, #4913)', async () => {
    const stamp = '[publish-gate PASS by social-publish-gate on 2026-08-20, product: dame-aer]\nClean frame, cast present.'
    const { deps, updates } = harness(row({ shopifyProductId: 'gid://1', feedback: stamp }))
    deps.checkStock = async () => ({ ok: false, detail: 'Sold out.' })
    await retryFailedSocialPost(7, deps)
    const fb = updates[0]!.values['feedback'] as string
    expect(fb.startsWith('[stock-guard] Sold out.')).toBe(true)
    expect(fb).toContain(stamp)
  })

  it('records the publisher failure detail and stays failed', async () => {
    const { deps, updates } = harness(row(), { ok: false, reason: 'error', detail: '402 credits' })
    const r = await retryFailedSocialPost(7, deps)
    expect(r).toEqual({ ok: false, error: '402 credits' })
    expect(updates[0]!.values).toEqual({ errorMessage: '402 credits' })
  })
})

describe('deleteSocialPost', () => {
  it('soft-deletes a draft', async () => {
    const { deps, updates } = harness(row({ status: 'draft', reviewStatus: 'pending_review' }))
    const r = await deleteSocialPost(7, deps)
    expect(r).toEqual({ ok: true })
    expect(updates[0]!.values).toEqual({ status: 'deleted' })
  })

  it('deletes on X first, then marks the row', async () => {
    const { deps, updates } = harness(row({ status: 'posted', externalPostId: 'tw-9' }))
    const r = await deleteSocialPost(7, deps)
    expect(r.ok).toBe(true)
    expect(deps.deleteTweet).toHaveBeenCalledWith('tw-9')
    expect(updates[0]!.values).toEqual({ status: 'deleted' })
  })

  it('keeps the row when the X delete fails', async () => {
    const { deps, updates } = harness(row({ status: 'posted', externalPostId: 'tw-9' }))
    deps.deleteTweet = async () => { throw new Error('403') }
    const r = await deleteSocialPost(7, deps)
    expect(r).toEqual({ ok: false, error: '403' })
    expect(updates).toHaveLength(0)
  })

  it('removes an Instagram row and says the post is still live', async () => {
    const { deps, updates } = harness(row({ status: 'posted', platform: 'instagram', externalPostId: 'ig-1' }))
    const r = await deleteSocialPost(7, deps)
    expect(r.ok).toBe(true)
    expect(r.note).toMatch(/still live/)
    expect(updates[0]!.values).toEqual({ status: 'deleted' })
  })

  it('refuses publishing and already-deleted rows', async () => {
    for (const status of ['publishing', 'deleted']) {
      const { deps, updates } = harness(row({ status }))
      const r = await deleteSocialPost(7, deps)
      expect(r.ok).toBe(false)
      expect(updates).toHaveLength(0)
    }
  })
})

describe('mediaForRow', () => {
  it('maps one image, many images, and video', () => {
    expect(mediaForRow(row({ mediaUrls: ['a.jpg'] }))).toEqual({ kind: 'image', imageUrl: 'a.jpg' })
    expect(mediaForRow(row())?.kind).toBe('carousel')
    expect(mediaForRow(row({ mediaUrls: ['v.mp4'], posterUrl: 'p.jpg' }))).toEqual({ kind: 'video', videoUrl: 'v.mp4', posterUrl: 'p.jpg' })
    expect(mediaForRow(row({ mediaUrls: [] }))).toBeNull()
  })
})
