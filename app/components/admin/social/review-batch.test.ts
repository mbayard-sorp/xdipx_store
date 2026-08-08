import { describe, it, expect } from 'vitest'
import { parseBatchPostIds, groupByScheduledDay } from './review-batch'
import type { SocialPostRow } from './types'

function row(id: number, scheduledFor: string | null): SocialPostRow {
  return {
    id,
    platform: 'instagram',
    postType: 'product',
    externalPostId: null,
    tweetText: `draft ${id}`,
    mediaUrls: null,
    status: 'draft',
    errorMessage: null,
    createdAt: null,
    createdBy: 'agent',
    reviewStatus: 'pending_review',
    feedback: null,
    editedText: null,
    reviewedBy: null,
    reviewedAt: null,
    scheduledFor,
    reworkedFrom: null,
    videoJobId: null,
    posterUrl: null,
  }
}

describe('parseBatchPostIds', () => {
  it('parses a comma-joined list into positive ints', () => {
    expect(parseBatchPostIds('3,1,2')).toEqual([3, 1, 2])
  })

  it('trims whitespace and dedupes while preserving order', () => {
    expect(parseBatchPostIds(' 5 , 5, 7 ,5')).toEqual([5, 7])
  })

  it('drops non-numeric, zero, and negative entries', () => {
    expect(parseBatchPostIds('4,foo,0,-2,6')).toEqual([4, 6])
  })

  it('returns empty for empty / null / undefined', () => {
    expect(parseBatchPostIds('')).toEqual([])
    expect(parseBatchPostIds(null)).toEqual([])
    expect(parseBatchPostIds(undefined)).toEqual([])
  })
})

describe('groupByScheduledDay', () => {
  it('groups by day and orders dated groups chronologically', () => {
    const groups = groupByScheduledDay([
      row(1, '2026-08-12'),
      row(2, '2026-08-10'),
      row(3, '2026-08-12'),
    ])
    expect(groups.map(g => g.day)).toEqual(['2026-08-10', '2026-08-12'])
    expect(groups[1]!.posts.map(p => p.id)).toEqual([1, 3])
  })

  it('collects unscheduled drafts into a trailing null-day group', () => {
    const groups = groupByScheduledDay([
      row(1, null),
      row(2, '2026-08-11'),
      row(3, null),
    ])
    expect(groups.map(g => g.day)).toEqual(['2026-08-11', null])
    expect(groups[groups.length - 1]!.posts.map(p => p.id)).toEqual([1, 3])
  })

  it('returns no null group when every draft is scheduled', () => {
    const groups = groupByScheduledDay([row(1, '2026-08-11')])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.day).toBe('2026-08-11')
  })

  it('returns empty for no posts', () => {
    expect(groupByScheduledDay([])).toEqual([])
  })
})
