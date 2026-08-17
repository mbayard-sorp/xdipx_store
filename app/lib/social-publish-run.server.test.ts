import { describe, it, expect, vi, beforeEach } from 'vitest'
import { instagramTickDeps } from './social-publish-run.server'
import type { PostRow } from './social-publish-job.server'

/**
 * Coverage for the publish closure the scheduled tick runs (`publishViaRegistry`,
 * reached here through the exported `instagramTickDeps().publish`).
 *
 * The regression this guards (ticket #3744): the closure called the adapter,
 * which returns `{ ok, externalPostId, note }` when a post published with a
 * caveat (e.g. untagged because the product was not approved for tagging), but
 * dropped `note` on the way out, so the reason reached only a `console.warn`
 * and never the tick report. The file had zero test coverage, which is why the
 * drop was never caught.
 */

const publishMock = vi.fn()

vi.mock('./social-publish/registry.server', () => ({
  getPublisher: () => ({
    platform: 'instagram',
    configured: () => true,
    publish: publishMock,
  }),
}))

vi.mock('./social-publish-approve.server', () => ({
  // The featured handle is irrelevant to note-forwarding; the gate stamp path
  // is exercised by the job suite. Return no product so the closure is simple.
  parseGateStamp: () => ({ productHandle: null }),
}))

function post(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 1, platform: 'instagram', postType: 'campaign', externalPostId: null,
    parentPostId: null, dealHistoryId: null,
    tweetText: 'a caption', mediaUrls: ['https://cdn.example/social-a.jpg'],
    mediaIds: null, status: 'draft', errorMessage: null, postedAt: null,
    createdAt: new Date('2026-08-01'), createdBy: 'agent',
    reviewStatus: 'approved', feedback: null, editedText: null,
    reviewedBy: null, reviewedAt: null, scheduledFor: '2026-08-17',
    reworkedFrom: null, videoJobId: null, posterUrl: null,
    ...over,
  } as PostRow
}

describe('publishViaRegistry (the scheduled tick publish closure)', () => {
  beforeEach(() => publishMock.mockReset())

  it('forwards the adapter note on a successful publish, so the reason survives past console.warn (ticket #3744)', async () => {
    const note = 'published untagged: product not approved for tagging'
    publishMock.mockResolvedValue({ ok: true, externalPostId: 'ig_1', note })
    const deps = await instagramTickDeps()
    const result = await deps.publish(post())
    expect(result).toEqual({ ok: true, externalPostId: 'ig_1', note })
  })

  it('omits note when the adapter returns none, rather than forwarding undefined', async () => {
    publishMock.mockResolvedValue({ ok: true, externalPostId: 'ig_1' })
    const deps = await instagramTickDeps()
    const result = await deps.publish(post())
    expect(result).toEqual({ ok: true, externalPostId: 'ig_1' })
    expect(result).not.toHaveProperty('note')
  })

  it('reports a failure with its detail unchanged', async () => {
    publishMock.mockResolvedValue({ ok: false, detail: 'Meta 500' })
    const deps = await instagramTickDeps()
    const result = await deps.publish(post())
    expect(result).toEqual({ ok: false, detail: 'Meta 500' })
  })
})
