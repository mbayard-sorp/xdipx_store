/**
 * Publish-time stock guard on the manual Post-now path (ticket #2212,
 * admin.socials.tsx `post-media` intent). No network calls: db and the stock
 * lookup are both mocked.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included (same
 * note as api-team-social-post.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))
const checkStockMock = vi.hoisted(() => vi.fn())
const decideManualPublishMock = vi.hoisted(() => vi.fn())
const selectResult = vi.hoisted(() => ({ rows: [] as unknown[] }))
const updateCalls = vi.hoisted(() => [] as { values: unknown }[])

vi.mock('~/lib/session.server', () => ({
  requireAdmin: requireAdminMock,
  getAdminUser: vi.fn(async () => null),
}))
vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResult.rows,
        }),
        // loader-only shape (dealHistory); unused by the action tests here.
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
vi.mock('~/lib/social-publish-approve.server', () => ({
  parseGateStamp: vi.fn(() => null),
}))
vi.mock('~/lib/claude.server', () => ({ generateTweetCopy: vi.fn() }))
vi.mock('~/lib/shopify.server', () => ({ getDealByShopifyId: vi.fn(async () => null) }))
vi.mock('~/lib/twitter.server', () => ({
  postManualTweet: vi.fn(), postApprovedDraft: vi.fn(),
}))
vi.mock('~/lib/social-post-ops.server', () => ({
  retryFailedSocialPost: vi.fn(), deleteSocialPost: vi.fn(),
}))
vi.mock('~/lib/team.server', () => ({
  getSocialFrequencies: vi.fn(async () => ({})),
  reviewSocialPost: vi.fn(),
  rescheduleSocialPost: vi.fn(),
  recordLivePostFeedback: vi.fn(),
  getValve: vi.fn(async () => true),
  VALVE_KEYS: { instagramAutopublish: 'instagram_autopublish_enabled', xAutopublish: 'x_autopublish_enabled' },
}))
vi.mock('~/lib/pricing-webhook.server', () => ({ setPipelineSetting: vi.fn() }))

import { action } from '~/routes/admin.socials'

function postForm(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields)
  return new Request('http://localhost/admin/socials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

const basePost = {
  id: 7,
  platform: 'instagram',
  status: 'draft',
  reviewStatus: 'approved',
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
})

describe('post-media intent — stock guard', () => {
  it('refuses an out-of-stock linked product and moves the row to needs_changes, without ever reaching decideManualPublish', async () => {
    selectResult.rows = [{ ...basePost, shopifyProductId: 'gid://shopify/Product/999' }]
    checkStockMock.mockResolvedValue({ ok: false, detail: 'Linked product gid://shopify/Product/999 is out of stock.' })

    const res = await action({
      request: postForm({ intent: 'post-media', postId: '7' }),
      params: {}, context: {},
    } as never) as { ok: boolean; error?: string }

    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/out of stock/)
    expect(checkStockMock).toHaveBeenCalledWith('gid://shopify/Product/999')
    expect(decideManualPublishMock).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]?.values).toMatchObject({
      status: 'draft',
      reviewStatus: 'needs_changes',
    })
    expect((updateCalls[0]?.values as { feedback: string }).feedback).toContain('[stock-guard]')
  })

  it('fails closed when the linked product cannot be verified', async () => {
    selectResult.rows = [{ ...basePost, shopifyProductId: 'gid://shopify/Product/404' }]
    checkStockMock.mockResolvedValue({ ok: false, detail: 'Linked product gid://shopify/Product/404 could not be verified as in stock (not on the storefront, or the lookup failed).' })

    const res = await action({
      request: postForm({ intent: 'post-media', postId: '7' }),
      params: {}, context: {},
    } as never) as { ok: boolean; error?: string }

    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/could not be verified/)
    expect(decideManualPublishMock).not.toHaveBeenCalled()
  })

  it('proceeds past the stock guard for an in-stock linked product', async () => {
    selectResult.rows = [{ ...basePost, shopifyProductId: 'gid://shopify/Product/1' }]
    checkStockMock.mockResolvedValue({ ok: true })
    // Short-circuit right after the stock guard so this stays a guard test,
    // not a full publish-path integration test.
    decideManualPublishMock.mockResolvedValue({ ok: false, error: 'no gate stamp' })

    const res = await action({
      request: postForm({ intent: 'post-media', postId: '7' }),
      params: {}, context: {},
    } as never) as { ok: boolean; error?: string }

    expect(checkStockMock).toHaveBeenCalledWith('gid://shopify/Product/1')
    expect(decideManualPublishMock).toHaveBeenCalled()
    // Reached the NEXT gate, so the stock guard passed it through.
    expect(res.error).toBe('no gate stamp')
    expect(updateCalls).toHaveLength(0)
  })

  it('skips the check entirely for a row with no product linkage', async () => {
    selectResult.rows = [{ ...basePost, shopifyProductId: null }]
    checkStockMock.mockResolvedValue({ ok: true })
    decideManualPublishMock.mockResolvedValue({ ok: false, error: 'no gate stamp' })

    await action({
      request: postForm({ intent: 'post-media', postId: '7' }),
      params: {}, context: {},
    } as never)

    // checkLinkedProductStock is still called (it owns the null-check itself,
    // see stock-guard.test.ts), but with null, and it must not block the row.
    expect(checkStockMock).toHaveBeenCalledWith(null)
    expect(decideManualPublishMock).toHaveBeenCalled()
  })
})

// X Post-now had no stock guard at all: it selected only `feedback` and leaned
// on the gate stamp's product handle. Once the owner's click stopped requiring
// a stamp (owner direction 2026-08-23), that handle stopped being reliably
// present, so the durable shopify_product_id guard the media path already ran
// now runs here too.
describe('post-approved-draft intent — stock guard', () => {
  const xPost = { ...basePost, platform: 'x', tweetText: 'a tweet' }

  it('refuses an out-of-stock linked product before reaching the publish decision', async () => {
    selectResult.rows = [{ ...xPost, shopifyProductId: 'gid://shopify/Product/999' }]
    checkStockMock.mockResolvedValue({ ok: false, detail: 'Linked product gid://shopify/Product/999 is out of stock.' })

    const res = await action({
      request: postForm({ intent: 'post-approved-draft', postId: '7' }),
      params: {}, context: {},
    } as never) as { ok: boolean; error?: string }

    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/out of stock/)
    expect(decideManualPublishMock).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]?.values).toMatchObject({ reviewStatus: 'needs_changes' })
  })

  it('passes an in-stock row through to the publish decision', async () => {
    selectResult.rows = [{ ...xPost, shopifyProductId: 'gid://shopify/Product/1' }]
    checkStockMock.mockResolvedValue({ ok: true })
    // Short-circuit right after the guard, same as the media cases above.
    decideManualPublishMock.mockResolvedValue({ ok: false, error: 'refused downstream' })

    const res = await action({
      request: postForm({ intent: 'post-approved-draft', postId: '7' }),
      params: {}, context: {},
    } as never) as { ok: boolean; error?: string }

    expect(checkStockMock).toHaveBeenCalledWith('gid://shopify/Product/1')
    expect(res.error).toBe('refused downstream')
    expect(updateCalls).toHaveLength(0)
  })

  it('sends the caption and media it is actually about to publish to the decision', async () => {
    selectResult.rows = [{ ...xPost, shopifyProductId: null, editedText: '  the edited caption  ' }]
    checkStockMock.mockResolvedValue({ ok: true })
    decideManualPublishMock.mockResolvedValue({ ok: false, error: 'refused downstream' })

    await action({
      request: postForm({ intent: 'post-approved-draft', postId: '7' }),
      params: {}, context: {},
    } as never)

    // The owner's edit wins over the original text, trimmed — the same string
    // the publisher sends to X.
    expect(decideManualPublishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'x',
        caption: 'the edited caption',
        mediaUrls: xPost.mediaUrls,
      }),
      expect.anything(),
    )
  })
})
