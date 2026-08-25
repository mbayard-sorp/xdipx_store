/**
 * Ticket #5412(a,b,e): Post-now performs its own approval.
 *
 * Before this, `post-media`/`post-approved-draft` refused anything that was
 * not already `review_status='approved'`, so a pending_review or
 * needs_changes draft had NO post affordance anywhere and the owner's path
 * was Review -> Approve -> switch tabs -> Post now. The click now approves
 * first (via `reviewSocialPost`, the one write path that already refuses an
 * unresolved gate BLOCK) and only then runs the existing stock guard /
 * deterministic checks / publish.
 *
 * Lives in app/lib rather than next to the route, same reason as the sibling
 * stock-guard test: anything in app/routes is picked up by flatRoutes/typegen
 * as a route module, tests included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))
const checkStockMock = vi.hoisted(() => vi.fn())
const decideManualPublishMock = vi.hoisted(() => vi.fn())
const reviewSocialPostMock = vi.hoisted(() => vi.fn())
const selectResult = vi.hoisted(() => ({ rows: [] as unknown[] }))
const updateCalls = vi.hoisted(() => [] as { values: unknown }[])

vi.mock('~/lib/session.server', () => ({
  requireAdmin: requireAdminMock,
  getAdminUser: vi.fn(async () => ({ name: 'Mike' })),
}))
vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResult.rows,
        }),
        orderBy: () => ({ limit: async () => [] }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => { updateCalls.push({ values }); return undefined },
      }),
    }),
  },
}))
vi.mock('~/lib/social-publish/stock-guard.server', () => ({
  checkLinkedProductStock: checkStockMock,
}))
vi.mock('~/lib/social-publish/manual-publish-gate.server', () => ({
  decideManualPublish: decideManualPublishMock,
  manualPublishValveKey: vi.fn(),
}))
vi.mock('~/lib/social-publish-approve.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/social-publish-approve.server')>(
    '~/lib/social-publish-approve.server',
  )
  return {
    parseGateStamp: actual.parseGateStamp,
    preserveGateStamp: actual.preserveGateStamp,
    effectiveGateStatus: actual.effectiveGateStatus,
    revertSocialPostToDraft: vi.fn(),
  }
})
vi.mock('~/lib/social-publish-clone.server', () => ({
  cloneRejectedSocialPost: vi.fn(),
}))
vi.mock('~/lib/social-publish/product-handle.server', () => ({
  resolvePostProductHandle: vi.fn(async () => null),
}))
vi.mock('~/lib/claude.server', () => ({ generateTweetCopy: vi.fn() }))
vi.mock('~/lib/shopify.server', () => ({ getDealByShopifyId: vi.fn(async () => null) }))
vi.mock('~/lib/twitter.server', () => ({
  postManualTweet: vi.fn(), postApprovedDraft: vi.fn(async () => ({ ok: true, tweetId: 'tw_1' })),
}))
vi.mock('~/lib/social-post-ops.server', () => ({
  retryFailedSocialPost: vi.fn(), deleteSocialPost: vi.fn(),
}))
vi.mock('~/lib/team.server', () => ({
  getSocialFrequencies: vi.fn(async () => ({})),
  reviewSocialPost: reviewSocialPostMock,
  rescheduleSocialPost: vi.fn(),
  recordLivePostFeedback: vi.fn(),
  getValve: vi.fn(async () => true),
  VALVE_KEYS: { instagramAutopublish: 'instagram_autopublish_enabled', xAutopublish: 'x_autopublish_enabled' },
}))
vi.mock('~/lib/pricing-webhook.server', () => ({ setPipelineSetting: vi.fn() }))

import { action } from '~/routes/admin.socials.queue'

function postForm(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields)
  return new Request('http://localhost/admin/socials/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

const basePost = {
  id: 7,
  platform: 'instagram',
  status: 'draft',
  reviewStatus: 'pending_review',
  mediaUrls: ['https://cdn.shopify.com/files/social-ig-scene-1.jpg'],
  videoJobId: null,
  posterUrl: null,
  editedText: null,
  tweetText: 'a caption',
  feedback: null,
  shopifyProductId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAdminMock.mockResolvedValue(undefined)
  updateCalls.length = 0
  selectResult.rows = []
  checkStockMock.mockResolvedValue({ ok: true })
})

describe('post-media intent, click performs approval (#5412b)', () => {
  it('approves a pending_review row before publishing it', async () => {
    selectResult.rows = [{ ...basePost, reviewStatus: 'pending_review' }]
    reviewSocialPostMock.mockResolvedValue({ ok: true })
    decideManualPublishMock.mockResolvedValue({ ok: false, error: 'stop here' }) // short-circuit

    await action({ request: postForm({ intent: 'post-media', postId: '7' }), params: {}, context: {} } as never)

    expect(reviewSocialPostMock).toHaveBeenCalledWith(7, expect.objectContaining({
      reviewStatus: 'approved',
      reviewedBy: 'Mike',
    }))
  })

  it('approves a needs_changes row before publishing it too', async () => {
    selectResult.rows = [{ ...basePost, reviewStatus: 'needs_changes' }]
    reviewSocialPostMock.mockResolvedValue({ ok: true })
    decideManualPublishMock.mockResolvedValue({ ok: false, error: 'stop here' })

    const res = await action({ request: postForm({ intent: 'post-media', postId: '7' }), params: {}, context: {} } as never) as { ok: boolean }
    expect(reviewSocialPostMock).toHaveBeenCalledOnce()
    expect(res.ok).toBe(false) // decideManualPublish's refusal, not a precondition rejection
  })

  it('never calls reviewSocialPost for an already-approved row', async () => {
    selectResult.rows = [{ ...basePost, reviewStatus: 'approved' }]
    decideManualPublishMock.mockResolvedValue({ ok: false, error: 'stop here' })

    await action({ request: postForm({ intent: 'post-media', postId: '7' }), params: {}, context: {} } as never)

    expect(reviewSocialPostMock).not.toHaveBeenCalled()
  })

  it('a gate BLOCK refuses to approve and the row is never checked for stock or published (#3895 hard stop inherited)', async () => {
    selectResult.rows = [{ ...basePost, reviewStatus: 'pending_review', gateStatus: 'block' }]
    reviewSocialPostMock.mockResolvedValue({
      ok: false, reason: 'gate_block', error: 'This draft carries an unresolved publish-gate BLOCK and cannot be approved.',
    })

    const res = await action({ request: postForm({ intent: 'post-media', postId: '7' }), params: {}, context: {} } as never) as { ok: boolean; error?: string }

    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/BLOCK/)
    expect(checkStockMock).not.toHaveBeenCalled()
    expect(decideManualPublishMock).not.toHaveBeenCalled()
  })

  it('refuses a rejected row outright (not an eligible review state)', async () => {
    selectResult.rows = [{ ...basePost, reviewStatus: 'rejected' }]
    const res = await action({ request: postForm({ intent: 'post-media', postId: '7' }), params: {}, context: {} } as never) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(reviewSocialPostMock).not.toHaveBeenCalled()
    expect(checkStockMock).not.toHaveBeenCalled()
  })
})

describe('post-approved-draft intent (X), click performs approval and derives isVideo (#5412b,e)', () => {
  const xPost = { ...basePost, platform: 'x', tweetText: 'a tweet', reviewStatus: 'pending_review' }

  it('approves a pending_review X draft before publishing', async () => {
    selectResult.rows = [xPost]
    reviewSocialPostMock.mockResolvedValue({ ok: true })
    decideManualPublishMock.mockResolvedValue({ ok: false, error: 'stop here' })

    await action({ request: postForm({ intent: 'post-approved-draft', postId: '7' }), params: {}, context: {} } as never)

    expect(reviewSocialPostMock).toHaveBeenCalledWith(7, expect.objectContaining({ reviewStatus: 'approved' }))
  })

  it('a gate BLOCK on an X draft refuses before the stock guard or the publish decision run', async () => {
    selectResult.rows = [{ ...xPost, gateStatus: 'block' }]
    reviewSocialPostMock.mockResolvedValue({ ok: false, reason: 'gate_block', error: 'gate BLOCK, no override' })

    const res = await action({ request: postForm({ intent: 'post-approved-draft', postId: '7' }), params: {}, context: {} } as never) as { ok: boolean; error?: string }

    expect(res.ok).toBe(false)
    expect(checkStockMock).not.toHaveBeenCalled()
    expect(decideManualPublishMock).not.toHaveBeenCalled()
  })

  it('derives isVideo from the row instead of hardcoding false (#5412e)', async () => {
    selectResult.rows = [{ ...xPost, reviewStatus: 'approved', videoJobId: 42 }]
    decideManualPublishMock.mockResolvedValue({ ok: false, error: 'stop here' })

    await action({ request: postForm({ intent: 'post-approved-draft', postId: '7' }), params: {}, context: {} } as never)

    expect(decideManualPublishMock).toHaveBeenCalledWith(
      expect.objectContaining({ isVideo: true, platform: 'x' }),
      expect.anything(),
    )
  })

  it('still reports isVideo:false for a plain still on X', async () => {
    selectResult.rows = [{ ...xPost, reviewStatus: 'approved', videoJobId: null }]
    decideManualPublishMock.mockResolvedValue({ ok: false, error: 'stop here' })

    await action({ request: postForm({ intent: 'post-approved-draft', postId: '7' }), params: {}, context: {} } as never)

    expect(decideManualPublishMock).toHaveBeenCalledWith(
      expect.objectContaining({ isVideo: false }),
      expect.anything(),
    )
  })
})

describe('save-caption intent (#5418a)', () => {
  it('persists editedText without touching review state', async () => {
    selectResult.rows = [{ status: 'draft', tweetText: 'original text' }]

    const res = await action({
      request: postForm({ intent: 'save-caption', postId: '7', caption: 'a better line' }),
      params: {}, context: {},
    } as never) as { ok: boolean }

    expect(res.ok).toBe(true)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]!.values).toMatchObject({ editedText: 'a better line' })
  })

  it('nulls editedText back out when the caption matches the original', async () => {
    selectResult.rows = [{ status: 'draft', tweetText: 'original text' }]

    await action({
      request: postForm({ intent: 'save-caption', postId: '7', caption: 'original text' }),
      params: {}, context: {},
    } as never)

    expect(updateCalls[0]!.values).toMatchObject({ editedText: null })
  })

  it('refuses an empty caption', async () => {
    const res = await action({
      request: postForm({ intent: 'save-caption', postId: '7', caption: '   ' }),
      params: {}, context: {},
    } as never) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(updateCalls).toHaveLength(0)
  })

  it('refuses a posted row', async () => {
    selectResult.rows = [{ status: 'posted', tweetText: 'x' }]
    const res = await action({
      request: postForm({ intent: 'save-caption', postId: '7', caption: 'new' }),
      params: {}, context: {},
    } as never) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(updateCalls).toHaveLength(0)
  })
})

describe('clone-to-new-draft intent (#5416b)', () => {
  it('wires through to cloneRejectedSocialPost with the owner label', async () => {
    const { cloneRejectedSocialPost } = await import('~/lib/social-publish-clone.server')
    vi.mocked(cloneRejectedSocialPost).mockResolvedValue({ ok: true, id: 900 })

    const res = await action({
      request: postForm({ intent: 'clone-to-new-draft', postId: '74' }),
      params: {}, context: {},
    } as never) as { ok: boolean; id?: number }

    expect(cloneRejectedSocialPost).toHaveBeenCalledWith(74, expect.objectContaining({ by: 'Mike' }))
    expect(res).toMatchObject({ ok: true, id: 900 })
  })

  it('relays a 409 from cloneRejectedSocialPost (e.g. not a rejected row)', async () => {
    const { cloneRejectedSocialPost } = await import('~/lib/social-publish-clone.server')
    vi.mocked(cloneRejectedSocialPost).mockResolvedValue({ ok: false, status: 409, error: 'not rejected' })

    const res = await action({
      request: postForm({ intent: 'clone-to-new-draft', postId: '74' }),
      params: {}, context: {},
    } as never) as { ok: boolean; error?: string }

    expect(res).toEqual({ ok: false, error: 'not rejected' })
  })
})
