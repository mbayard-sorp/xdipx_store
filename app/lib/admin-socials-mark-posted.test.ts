/**
 * The manual-publish platforms can leave the queue (LinkedIn and friends).
 *
 * `PublishPlatform` is instagram|x, so the hourly job never runs LinkedIn, and
 * Post-now dead-ends on `No publisher for linkedin`. An approved LinkedIn
 * draft therefore had no terminal state at all: #37 and #38 were scheduled for
 * 2026-08-13 and were still sitting in the Approved tab a fortnight later.
 * `mark-posted` records a post the owner shipped by hand so the row moves to
 * History and onto the calendar at the hour it went out.
 *
 * Lives in app/lib rather than next to the route, same reason as its siblings:
 * anything in app/routes is picked up by flatRoutes/typegen as a route module,
 * tests included.
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


describe('mark-posted intent', () => {
  const linkedinPost = {
    ...basePost,
    id: 37,
    platform: 'linkedin',
    reviewStatus: 'approved',
    mediaUrls: null,
    tweetText: 'Two growth signals for the sexual wellness market',
  }

  it('marks an approved manual-platform draft as posted', async () => {
    selectResult.rows = [linkedinPost]

    const res = await action({
      request: postForm({ intent: 'mark-posted', postId: '37' }), params: {}, context: {},
    } as never) as { ok: boolean }

    expect(res.ok).toBe(true)
    expect(updateCalls).toHaveLength(1)
    const values = updateCalls[0]!.values as Record<string, unknown>
    expect(values['status']).toBe('posted')
    expect(values['postedAt']).toBeInstanceOf(Date)
  })

  it('records who marked it and that there is no post id to look up', async () => {
    selectResult.rows = [linkedinPost]

    await action({ request: postForm({ intent: 'mark-posted', postId: '37' }), params: {}, context: {} } as never)

    const feedback = String((updateCalls[0]!.values as Record<string, unknown>)['feedback'])
    expect(feedback).toContain('[posted-by-hand by Mike')
    expect(feedback).toContain('linkedin')
    expect(feedback).toContain('no post id or permalink')
  })

  it('never writes an externalPostId or permalink, so livePostUrl offers no dead link', async () => {
    selectResult.rows = [linkedinPost]

    await action({ request: postForm({ intent: 'mark-posted', postId: '37' }), params: {}, context: {} } as never)

    const values = updateCalls[0]!.values as Record<string, unknown>
    expect(values).not.toHaveProperty('externalPostId')
    expect(values).not.toHaveProperty('permalink')
  })

  it('appends its note, leaving an existing gate stamp intact for the burn-in readers', async () => {
    const stamp = '[publish-gate PASS by social-publish-gate on 2026-08-13, product: none]'
    selectResult.rows = [{ ...linkedinPost, feedback: stamp }]

    await action({ request: postForm({ intent: 'mark-posted', postId: '37' }), params: {}, context: {} } as never)

    const feedback = String((updateCalls[0]!.values as Record<string, unknown>)['feedback'])
    expect(feedback.startsWith(stamp)).toBe(true)
  })

  it('refuses a platform that really publishes from here, so it cannot fake a live post', async () => {
    for (const platform of ['instagram', 'x']) {
      updateCalls.length = 0
      selectResult.rows = [{ ...linkedinPost, platform }]

      const res = await action({
        request: postForm({ intent: 'mark-posted', postId: '37' }), params: {}, context: {},
      } as never) as { ok: boolean; error?: string }

      expect(res.ok).toBe(false)
      expect(res.error).toContain('Post now')
      expect(updateCalls).toHaveLength(0)
    }
  })

  it('refuses anything that is not an approved draft', async () => {
    for (const row of [
      { ...linkedinPost, reviewStatus: 'pending_review' },
      { ...linkedinPost, reviewStatus: 'needs_changes' },
      { ...linkedinPost, reviewStatus: 'rejected' },
      { ...linkedinPost, status: 'posted' },
    ]) {
      updateCalls.length = 0
      selectResult.rows = [row]

      const res = await action({
        request: postForm({ intent: 'mark-posted', postId: '37' }), params: {}, context: {},
      } as never) as { ok: boolean }

      expect(res.ok).toBe(false)
      expect(updateCalls).toHaveLength(0)
    }
  })

  it('covers the other unpublishable platforms, not just linkedin', async () => {
    // tiktok and youtube have registry adapters, but they are not_configured
    // stubs and the hourly job does not run them either.
    for (const platform of ['tiktok', 'youtube', 'facebook']) {
      updateCalls.length = 0
      selectResult.rows = [{ ...linkedinPost, platform }]

      const res = await action({
        request: postForm({ intent: 'mark-posted', postId: '37' }), params: {}, context: {},
      } as never) as { ok: boolean }

      expect(res.ok).toBe(true)
      expect((updateCalls[0]!.values as Record<string, unknown>)['status']).toBe('posted')
    }
  })

  it('reports a missing row rather than writing', async () => {
    selectResult.rows = []
    const res = await action({
      request: postForm({ intent: 'mark-posted', postId: '37' }), params: {}, context: {},
    } as never) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(updateCalls).toHaveLength(0)
  })
})
