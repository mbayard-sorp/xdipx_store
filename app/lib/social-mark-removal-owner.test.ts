/**
 * The admin "I removed this" action (ticket #6758): lets the owner tell the
 * removal watchers what they cannot see for themselves — that a deleted post
 * was his own removal, not a platform takedown — so it never counts toward
 * the pattern that steps drafting frequency down or turns an autopublish
 * valve off.
 */
import { describe, it, expect } from 'vitest'
import {
  markSocialPostRemovalOwner,
  type PostRow,
  type MarkRemovalOwnerRepo,
} from './social-publish-approve.server'

function row(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 145, platform: 'instagram', postType: 'campaign', externalPostId: 'ig_145',
    parentPostId: null, dealHistoryId: null, tweetText: 'a caption',
    mediaUrls: null, mediaIds: null, status: 'deleted', errorMessage: 'gone',
    postedAt: new Date('2026-08-29'), createdAt: new Date('2026-08-29'), createdBy: 'agent',
    reviewStatus: 'approved', feedback: null, editedText: null,
    reviewedBy: 'social-publish-gate', reviewedAt: new Date('2026-08-29'),
    scheduledFor: null, reworkedFrom: null, videoJobId: null, posterUrl: null,
    gateStatus: 'pass', gateCheckedAt: new Date('2026-08-29'), gateFindings: null,
    removalSource: 'unknown',
    ...over,
  } as PostRow
}

function fakeRepo(post: PostRow | null) {
  const writes: Array<{ id: number; patch: { removalSource: 'owner' } }> = []
  const repo: MarkRemovalOwnerRepo = {
    load: async () => post,
    write: async (id, patch) => { writes.push({ id, patch }) },
  }
  return { repo, writes }
}

describe('markSocialPostRemovalOwner', () => {
  it('sets removalSource to owner on a deleted row', async () => {
    const { repo, writes } = fakeRepo(row())
    const r = await markSocialPostRemovalOwner(145, { repo })
    expect(r).toEqual({ ok: true })
    expect(writes).toEqual([{ id: 145, patch: { removalSource: 'owner' } }])
  })

  it('is idempotent — re-marking an already-owner row still succeeds', async () => {
    const { repo, writes } = fakeRepo(row({ removalSource: 'owner' }))
    const r = await markSocialPostRemovalOwner(145, { repo })
    expect(r.ok).toBe(true)
    expect(writes).toHaveLength(1)
  })

  it('refuses a row that is not deleted (nothing to attribute yet)', async () => {
    const { repo, writes } = fakeRepo(row({ status: 'posted' }))
    const r = await markSocialPostRemovalOwner(145, { repo })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
    expect(writes).toHaveLength(0)
  })

  it('404s a missing post', async () => {
    const { repo } = fakeRepo(null)
    const r = await markSocialPostRemovalOwner(999, { repo })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })
})
