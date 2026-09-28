/**
 * The non-gate staleness-sweep write path (ticket #11758): routine-social-
 * daily.md Step 2.5 (ticket #11144) closes a needs_changes row whose
 * scheduledFor is >7 days past AND whose campaign has since closed, but the
 * only existing writer of review_status='rejected' was op:'gate', which
 * requires a real publish-gate verdict the routine explicitly may not
 * fabricate. This is the narrow alternative: only a needs_changes row, only
 * to rejected, stamped distinctly from a real gate verdict.
 */
import { describe, it, expect } from 'vitest'
import {
  markStaleSocialPostRejected,
  type PostRow,
  type MarkStaleRejectedRepo,
} from './social-publish-approve.server'

function row(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 131, platform: 'instagram', postType: 'campaign', externalPostId: null,
    parentPostId: null, dealHistoryId: null, tweetText: 'a caption',
    mediaUrls: null, mediaIds: null, status: 'draft', errorMessage: null,
    postedAt: null, createdAt: new Date('2026-08-29'), createdBy: 'agent',
    reviewStatus: 'needs_changes', feedback: '[publish-gate REVISE by social-publish-gate on 2026-08-29, product: none]\nold reason',
    editedText: null, reviewedBy: 'social-publish-gate', reviewedAt: new Date('2026-08-29'),
    scheduledFor: '2026-08-30', reworkedFrom: null, videoJobId: null, posterUrl: null,
    gateStatus: 'revise', gateCheckedAt: new Date('2026-08-29'), gateFindings: null,
    removalSource: 'unknown',
    ...over,
  } as PostRow
}

type Patch = { reviewStatus: 'rejected'; feedback: string; reviewedBy: string; reviewedAt: Date; updatedAt: Date }

function fakeRepo(post: PostRow | null) {
  const writes: Array<{ id: number; patch: Patch }> = []
  const repo: MarkStaleRejectedRepo = {
    load: async () => post,
    write: async (id, patch) => { writes.push({ id, patch }) },
  }
  return { repo, writes }
}

describe('markStaleSocialPostRejected', () => {
  it('rejects a needs_changes row with the supplied reason', async () => {
    const { repo, writes } = fakeRepo(row())
    const now = new Date('2026-09-27T12:00:00Z')
    const r = await markStaleSocialPostRejected(131, '16 days past scheduledFor, campaign closed', {
      repo, now: () => now, actor: 'agent:social',
    })
    expect(r).toEqual({ ok: true })
    expect(writes).toHaveLength(1)
    expect(writes[0]?.patch.reviewStatus).toBe('rejected')
    expect(writes[0]?.patch.feedback).toContain('16 days past scheduledFor, campaign closed')
    expect(writes[0]?.patch.reviewedBy).toBe('agent:social')
    expect(writes[0]?.patch.reviewedAt).toEqual(now)
  })

  it('stamps distinctly from a real gate verdict — never [publish-gate ...]', async () => {
    const { repo, writes } = fakeRepo(row())
    await markStaleSocialPostRejected(131, 'stale', { repo })
    expect(writes[0]?.patch.feedback).toMatch(/^\[stale-reject /)
    expect(writes[0]?.patch.feedback).not.toContain('[publish-gate')
  })

  it('defaults the actor when none is supplied', async () => {
    const { repo, writes } = fakeRepo(row())
    await markStaleSocialPostRejected(131, 'stale', { repo })
    expect(writes[0]?.patch.reviewedBy).toBe('agent:social')
  })

  it('refuses a row that is not needs_changes', async () => {
    const { repo, writes } = fakeRepo(row({ reviewStatus: 'approved' }))
    const r = await markStaleSocialPostRejected(131, 'stale', { repo })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
    expect(writes).toHaveLength(0)
  })

  it('refuses an already-rejected row (not re-entrant past terminal)', async () => {
    const { repo, writes } = fakeRepo(row({ reviewStatus: 'rejected' }))
    const r = await markStaleSocialPostRejected(131, 'stale', { repo })
    expect(r.ok).toBe(false)
    expect(writes).toHaveLength(0)
  })

  it('404s a missing post', async () => {
    const { repo } = fakeRepo(null)
    const r = await markStaleSocialPostRejected(999, 'stale', { repo })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })
})
