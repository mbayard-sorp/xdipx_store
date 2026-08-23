/**
 * Revert-to-draft (Social Studio v2 Phase 3, ADR-013 decision 4): approved
 * back to draft always burns the stamp and the gate columns.
 */
import { describe, it, expect } from 'vitest'
import {
  revertSocialPostToDraft,
  stripGateStamp,
  formatGateStamp,
  type PostRow,
  type RevertPatch,
  type RevertRepo,
} from './social-publish-approve.server'

function row(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 9, platform: 'instagram', postType: 'campaign', externalPostId: null,
    parentPostId: null, dealHistoryId: null, tweetText: 'a caption',
    mediaUrls: ['https://cdn.shopify.com/files/social-x-scene-20260820-1.jpg'],
    mediaIds: null, status: 'draft', errorMessage: null, postedAt: null,
    createdAt: new Date('2026-08-20'), createdBy: 'agent',
    reviewStatus: 'approved', feedback: null, editedText: null,
    reviewedBy: 'social-publish-gate', reviewedAt: new Date('2026-08-21'),
    scheduledFor: '2026-08-25', reworkedFrom: null, videoJobId: null, posterUrl: null,
    gateStatus: 'pass', gateCheckedAt: new Date('2026-08-21'),
    gateFindings: [{ check: 'image-provenance', verdict: 'pass' }],
    ...over,
  } as PostRow
}

function fakeRepo(post: PostRow | null) {
  const writes: Array<{ id: number; patch: RevertPatch }> = []
  const repo: RevertRepo = {
    load: async () => post,
    write: async (id, patch) => { writes.push({ id, patch }) },
  }
  return { repo, writes }
}

const stamp = formatGateStamp(
  { verdict: 'PASS', reviewer: 'social-publish-gate', notes: 'Clean scene, cast present, no selling language in the caption.', productHandle: 'dame-aer' },
  new Date('2026-08-21T10:00:00Z'),
)

describe('revertSocialPostToDraft', () => {
  it('approved -> draft clears review fields, gate columns and the stamp, and touches updatedAt', async () => {
    const { repo, writes } = fakeRepo(row({ feedback: stamp }))
    const now = new Date('2026-08-22T12:00:00Z')
    const r = await revertSocialPostToDraft(9, { repo, now: () => now })
    expect(r).toEqual({ ok: true, reviewStatus: 'pending_review' })
    expect(writes).toHaveLength(1)
    expect(writes[0]!.patch).toEqual({
      status: 'draft',
      reviewStatus: 'pending_review',
      feedback: null,
      reviewedBy: null,
      reviewedAt: null,
      gateStatus: null,
      gateCheckedAt: null,
      gateFindings: null,
      updatedAt: now,
    })
  })

  it('keeps owner notes written after the stamp', async () => {
    const { repo, writes } = fakeRepo(row({ feedback: `${stamp}\n\nOwner: swap the mug for a candle next time.` }))
    await revertSocialPostToDraft(9, { repo })
    expect(writes[0]!.patch.feedback).toBe('Owner: swap the mug for a candle next time.')
  })

  it('also accepts needs_changes and pending_review rows (owner edits on pending are allowed)', async () => {
    for (const reviewStatus of ['needs_changes', 'pending_review'] as const) {
      const { repo, writes } = fakeRepo(row({ reviewStatus, gateStatus: 'revise' }))
      const r = await revertSocialPostToDraft(9, { repo })
      expect(r.ok).toBe(true)
      expect(writes[0]!.patch.gateStatus).toBeNull()
    }
  })

  it('refuses a rejected (gate BLOCK) row', async () => {
    const { repo, writes } = fakeRepo(row({ reviewStatus: 'rejected' }))
    const r = await revertSocialPostToDraft(9, { repo })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
    expect(writes).toHaveLength(0)
  })

  it('refuses a posted row and 404s a missing one', async () => {
    const posted = await revertSocialPostToDraft(9, { repo: fakeRepo(row({ status: 'posted' })).repo })
    expect(posted.ok).toBe(false)
    const missing = await revertSocialPostToDraft(9, { repo: fakeRepo(null).repo })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.status).toBe(404)
  })
})

describe('stripGateStamp', () => {
  it('passes through feedback with no stamp', () => {
    expect(stripGateStamp('just a note')).toBe('just a note')
    expect(stripGateStamp(null)).toBeNull()
  })
  it('removes the stamp header and the gate notes paragraph', () => {
    expect(stripGateStamp(stamp)).toBeNull()
  })
})
