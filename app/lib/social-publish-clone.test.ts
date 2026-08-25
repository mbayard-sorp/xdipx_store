// Ticket #5416: rejection was terminal with no way back that carried content
// forward. cloneRejectedSocialPost is the sanctioned escape: it never
// re-verdicts the dead row and never lets the new one inherit an approved
// state, only its content and a `reworkedFrom` lineage pointer.
import { describe, it, expect } from 'vitest'
import { cloneRejectedSocialPost, type CloneRepo, type NewClonedPost } from './social-publish-clone.server'
import type { PostRow } from './social-publish-approve.server'

const CDN = 'https://cdn.shopify.com/s/files/1'

function row(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 74, platform: 'instagram', postType: 'campaign', externalPostId: null,
    parentPostId: null, dealHistoryId: null,
    tweetText: 'This looks like housewares.',
    mediaUrls: [`${CDN}/social-cleaning-scene.jpg`],
    mediaIds: null, status: 'draft', errorMessage: null, postedAt: null,
    createdAt: new Date('2026-08-20'), createdBy: 'agent',
    reviewStatus: 'rejected', feedback: 'Show a cast member cleaning a toy with one of our toy cleaning products',
    editedText: null, reviewedBy: 'mike', reviewedAt: new Date('2026-08-20'),
    scheduledFor: '2026-08-21', reworkedFrom: null, videoJobId: null, posterUrl: null,
    shopifyProductId: 'gid://shopify/Product/1', altText: 'a cast member holding a toy cleaner',
    imageBrief: 'cast member cleaning a toy', subject: 'toy care',
    gateStatus: null, gateCheckedAt: null, gateFindings: null,
    scheduledAt: null, permalink: null, castSlugs: null, updatedAt: null,
    ...over,
  } as PostRow
}

function fakeRepo(post: PostRow | null) {
  const inserted: NewClonedPost[] = []
  const repo: CloneRepo = {
    load: async () => post,
    insert: async (values) => { inserted.push(values); return { id: 900 } },
  }
  return { repo, inserted }
}

describe('cloneRejectedSocialPost', () => {
  it('404s when the row does not exist', async () => {
    const { repo, inserted } = fakeRepo(null)
    const r = await cloneRejectedSocialPost(74, { repo, by: 'mike' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
    expect(inserted).toHaveLength(0)
  })

  it('refuses a row that is not rejected, so it cannot be used to resurrect approved/posted rows', async () => {
    for (const reviewStatus of ['pending_review', 'needs_changes', 'approved'] as const) {
      const { repo, inserted } = fakeRepo(row({ reviewStatus }))
      const r = await cloneRejectedSocialPost(74, { repo, by: 'mike' })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.status).toBe(409)
      expect(inserted).toHaveLength(0)
    }
  })

  it('clones a plain-rejected row content forward, pending_review, gate_status null', async () => {
    const { repo, inserted } = fakeRepo(row())
    const r = await cloneRejectedSocialPost(74, { repo, by: 'mike' })
    expect(r).toEqual({ ok: true, id: 900 })
    expect(inserted).toHaveLength(1)
    const v = inserted[0]!
    expect(v.tweetText).toBe('This looks like housewares.')
    expect(v.mediaUrls).toEqual([`${CDN}/social-cleaning-scene.jpg`])
    expect(v.altText).toBe('a cast member holding a toy cleaner')
    expect(v.shopifyProductId).toBe('gid://shopify/Product/1')
    expect(v.subject).toBe('toy care')
    expect(v.imageBrief).toBe('cast member cleaning a toy')
    expect(v.reworkedFrom).toBe(74)
    expect(v.status).toBe('draft')
    expect(v.reviewStatus).toBe('pending_review')
    expect(v.createdBy).toBe('mike')
    // Never a gate_status, gate_findings, or feedback field on the insert
    // shape at all: the clone cannot inherit an approved (or any) verdict.
    expect(v).not.toHaveProperty('gateStatus')
    expect(v).not.toHaveProperty('feedback')
    expect(v).not.toHaveProperty('reviewedBy')
  })

  it('clones a gate-BLOCKed row (also review_status rejected) the same way', async () => {
    const { repo, inserted } = fakeRepo(row({
      gateStatus: 'block',
      feedback: '[publish-gate BLOCK by social-publish-gate on 2026-08-20, product: none]\nHard fence match.',
    }))
    const r = await cloneRejectedSocialPost(74, { repo, by: 'mike' })
    expect(r.ok).toBe(true)
    expect(inserted[0]!.reviewStatus).toBe('pending_review')
  })

  it('prefers editedText over tweetText when the owner had edited the dead row', async () => {
    const { repo, inserted } = fakeRepo(row({ editedText: '  a tighter line  ' }))
    await cloneRejectedSocialPost(74, { repo, by: 'mike' })
    expect(inserted[0]!.tweetText).toBe('a tighter line')
  })
})
