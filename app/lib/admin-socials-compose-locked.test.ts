/**
 * Ticket #5417 (c): the Composer's `locked` computation on an existing row
 * must match `revertSocialPostToDraft` (social-publish-approve.server.ts)
 * exactly, since that server function is the actual gate `save` runs
 * through. It refuses ONLY `posted`, `deleted`, and a gate-BLOCK
 * (`reviewStatus === 'rejected'`) row. Before this fix the route also locked
 * `failed` rows for no server-side reason, so a failed publish could not
 * have its image swapped and retried.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included (same
 * note as admin-socials-post-media-stock-guard.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('~/lib/session.server', () => ({
  requireAdmin: requireAdminMock,
}))

vi.mock('~/lib/social-composer.server', () => ({
  composerRoster: vi.fn(async () => []),
  handleComposerIntent: vi.fn(),
  initialFromPost: vi.fn(() => ({
    platform: 'instagram', caption: '', slides: [], product: null, castSlugs: [],
    scheduledDate: '', scheduledTime: '', feedback: '',
    status: 'draft', reviewStatus: 'pending_review',
    gateStatus: null, gateCheckedAt: null, gateFindings: null, createdBy: null, updatedAt: null,
  })),
  loadComposerPost: vi.fn(),
  resolvePickedProduct: vi.fn(async () => null),
  slidesFromAssetsParam: vi.fn(async () => []),
}))

import { loader } from '~/routes/admin.socials.compose.$id'
import { loadComposerPost } from '~/lib/social-composer.server'

function baseRow(over: Record<string, unknown> = {}) {
  return {
    id: 42,
    platform: 'instagram',
    status: 'draft',
    reviewStatus: 'pending_review',
    tweetText: 'a caption',
    editedText: null,
    mediaUrls: ['https://cdn.shopify.com/files/a.jpg'],
    shopifyProductId: null,
    castSlugs: [],
    feedback: null,
    gateStatus: null,
    gateCheckedAt: null,
    gateFindings: null,
    createdBy: 'agent',
    scheduledAt: null,
    scheduledFor: null,
    updatedAt: null,
    ...over,
  }
}

function req() {
  return new Request('http://localhost/admin/socials/compose/42')
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAdminMock.mockResolvedValue(undefined)
})

describe('compose/:id locked computation (#5417)', () => {
  it('a failed row opens EDITABLE (this is the bug fix)', async () => {
    vi.mocked(loadComposerPost).mockResolvedValue({ row: baseRow({ status: 'failed', reviewStatus: 'approved' }), slides: [] } as never)
    const data = await loader({ request: req(), params: { id: '42' }, context: {} } as never)
    expect(data.locked).toBe(false)
    expect(data.lockReason).toBeNull()
  })

  it('pending_review, needs_changes and approved drafts stay editable', async () => {
    for (const reviewStatus of ['pending_review', 'needs_changes', 'approved']) {
      vi.mocked(loadComposerPost).mockResolvedValue({ row: baseRow({ status: 'draft', reviewStatus }), slides: [] } as never)
      const data = await loader({ request: req(), params: { id: '42' }, context: {} } as never)
      expect(data.locked).toBe(false)
    }
  })

  it('a posted row is locked with the history reason', async () => {
    vi.mocked(loadComposerPost).mockResolvedValue({ row: baseRow({ status: 'posted', reviewStatus: 'approved' }), slides: [] } as never)
    const data = await loader({ request: req(), params: { id: '42' }, context: {} } as never)
    expect(data.locked).toBe(true)
    expect(data.lockReason).toMatch(/published/i)
  })

  it('a deleted row is locked with the deleted reason', async () => {
    vi.mocked(loadComposerPost).mockResolvedValue({ row: baseRow({ status: 'deleted', reviewStatus: 'approved' }), slides: [] } as never)
    const data = await loader({ request: req(), params: { id: '42' }, context: {} } as never)
    expect(data.locked).toBe(true)
    expect(data.lockReason).toMatch(/deleted/i)
  })

  it('a gate-BLOCK (rejected) row is locked with no-override reason, even if status is draft', async () => {
    vi.mocked(loadComposerPost).mockResolvedValue({ row: baseRow({ status: 'draft', reviewStatus: 'rejected' }), slides: [] } as never)
    const data = await loader({ request: req(), params: { id: '42' }, context: {} } as never)
    expect(data.locked).toBe(true)
    expect(data.lockReason).toMatch(/gate BLOCK/)
  })

  it('a rejected AND failed row still locks on the rejected branch, not the (removed) failed one', async () => {
    vi.mocked(loadComposerPost).mockResolvedValue({ row: baseRow({ status: 'failed', reviewStatus: 'rejected' }), slides: [] } as never)
    const data = await loader({ request: req(), params: { id: '42' }, context: {} } as never)
    expect(data.locked).toBe(true)
    expect(data.lockReason).toMatch(/gate BLOCK/)
  })
})
