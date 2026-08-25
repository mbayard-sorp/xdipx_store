/**
 * Ticket #5417 (a): which of the calendar sheet's verbs (Edit / Approve /
 * Post now / Delete) show for a given row. Pure predicates so the gating is
 * a direct unit test rather than only provable by rendering the sheet; the
 * actual writes always go through the queue route's own review /
 * post-approved-draft / post-media / delete-post intents (see
 * team-social-review-gate-block.test.ts for the server-side gate-BLOCK
 * refusal these buttons inherit for free).
 */
import { describe, expect, it } from 'vitest'
import {
  canApproveCalendarPost, canDeleteCalendarPost, canEditCalendarPost, canPostCalendarNow, postNowIntent,
} from './calendar-types'

describe('canApproveCalendarPost', () => {
  it('true for a pending_review or needs_changes draft', () => {
    expect(canApproveCalendarPost({ status: 'draft', reviewStatus: 'pending_review' })).toBe(true)
    expect(canApproveCalendarPost({ status: 'draft', reviewStatus: 'needs_changes' })).toBe(true)
  })
  it('false once already approved, rejected (gate BLOCK), posted, or failed', () => {
    expect(canApproveCalendarPost({ status: 'draft', reviewStatus: 'approved' })).toBe(false)
    expect(canApproveCalendarPost({ status: 'draft', reviewStatus: 'rejected' })).toBe(false)
    expect(canApproveCalendarPost({ status: 'posted', reviewStatus: 'pending_review' })).toBe(false)
    expect(canApproveCalendarPost({ status: 'failed', reviewStatus: 'pending_review' })).toBe(false)
  })
})

describe('canPostCalendarNow', () => {
  it('an approved X draft can post with no media', () => {
    expect(canPostCalendarNow({ status: 'draft', reviewStatus: 'approved', platform: 'x', mediaUrls: null })).toBe(true)
  })
  it('an approved Instagram draft needs at least one media URL', () => {
    expect(canPostCalendarNow({ status: 'draft', reviewStatus: 'approved', platform: 'instagram', mediaUrls: null })).toBe(false)
    expect(canPostCalendarNow({ status: 'draft', reviewStatus: 'approved', platform: 'instagram', mediaUrls: [] })).toBe(false)
    expect(canPostCalendarNow({ status: 'draft', reviewStatus: 'approved', platform: 'instagram', mediaUrls: ['https://x/y.jpg'] })).toBe(true)
  })
  it('false when not an approved draft (pending, rejected, posted, failed)', () => {
    expect(canPostCalendarNow({ status: 'draft', reviewStatus: 'pending_review', platform: 'x', mediaUrls: null })).toBe(false)
    expect(canPostCalendarNow({ status: 'draft', reviewStatus: 'rejected', platform: 'x', mediaUrls: null })).toBe(false)
    expect(canPostCalendarNow({ status: 'posted', reviewStatus: 'approved', platform: 'x', mediaUrls: null })).toBe(false)
    expect(canPostCalendarNow({ status: 'failed', reviewStatus: 'approved', platform: 'x', mediaUrls: null })).toBe(false)
  })
})

describe('canEditCalendarPost', () => {
  it('true for everything except a posted row (history is not edited)', () => {
    expect(canEditCalendarPost({ status: 'draft' })).toBe(true)
    expect(canEditCalendarPost({ status: 'failed' })).toBe(true)
    expect(canEditCalendarPost({ status: 'deleted' })).toBe(true)
    expect(canEditCalendarPost({ status: 'posted' })).toBe(false)
  })
})

describe('canDeleteCalendarPost (mirrors admin.socials.queue.tsx canDeletePost)', () => {
  it('drafts and failed rows are always deletable', () => {
    expect(canDeleteCalendarPost({ status: 'draft', platform: 'instagram', externalPostId: null })).toBe(true)
    expect(canDeleteCalendarPost({ status: 'failed', platform: 'x', externalPostId: null })).toBe(true)
  })
  it('a live X post needs an external id to delete on X first', () => {
    expect(canDeleteCalendarPost({ status: 'posted', platform: 'x', externalPostId: '123' })).toBe(true)
    expect(canDeleteCalendarPost({ status: 'posted', platform: 'x', externalPostId: null })).toBe(false)
  })
  it('a live Instagram post is a row-only removal', () => {
    expect(canDeleteCalendarPost({ status: 'posted', platform: 'instagram', externalPostId: null })).toBe(true)
  })
  it('never a hard delete on any other live platform', () => {
    expect(canDeleteCalendarPost({ status: 'posted', platform: 'tiktok', externalPostId: null })).toBe(false)
  })
  it('publishing and deleted rows are refused', () => {
    expect(canDeleteCalendarPost({ status: 'publishing', platform: 'x', externalPostId: '123' })).toBe(false)
    expect(canDeleteCalendarPost({ status: 'deleted', platform: 'x', externalPostId: '123' })).toBe(false)
  })
})

describe('postNowIntent', () => {
  it('routes X to post-approved-draft and everything else to post-media, reusing the queue intents verbatim', () => {
    expect(postNowIntent('x')).toBe('post-approved-draft')
    expect(postNowIntent('instagram')).toBe('post-media')
    expect(postNowIntent('tiktok')).toBe('post-media')
  })
})
