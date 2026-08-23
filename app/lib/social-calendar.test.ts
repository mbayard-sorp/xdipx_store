// Week grid arithmetic (Phase 4, #4939). DST weeks are the interesting cases.
import { describe, it, expect } from 'vitest'
import {
  weekOf, cellFor, capsByDay, nextOpenSlot, addDays, weekdayIndex, bandOf, slotOf, countsAgainstCap,
} from './social-calendar'

describe('weekOf', () => {
  it('snaps any day to its Monday', () => {
    expect(weekOf('2026-08-22').monday).toBe('2026-08-17') // Saturday
    expect(weekOf('2026-08-17').monday).toBe('2026-08-17') // Monday itself
    expect(weekOf('2026-08-23').monday).toBe('2026-08-17') // Sunday belongs to the week before
  })

  it('returns seven consecutive days', () => {
    const w = weekOf('2026-08-20')
    expect(w.days).toEqual(['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'])
  })

  it('crosses a month and a year boundary', () => {
    expect(weekOf('2026-01-01').days[0]).toBe('2025-12-29')
    expect(weekOf('2026-03-01').days[6]).toBe('2026-03-01')
  })

  it('spring-forward week (2026-03-08) and fall-back week (2026-11-01) still have seven labelled days', () => {
    expect(weekOf('2026-03-08').days).toHaveLength(7)
    expect(weekOf('2026-03-08').monday).toBe('2026-03-02')
    expect(weekOf('2026-11-01').monday).toBe('2026-10-26')
    expect(weekOf('2026-11-01').days[6]).toBe('2026-11-01')
  })
})

describe('addDays / weekdayIndex', () => {
  it('is pure calendar arithmetic', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(weekdayIndex('2026-08-17')).toBe(0)
    expect(weekdayIndex('2026-08-23')).toBe(6)
  })
})

describe('cellFor', () => {
  it('lands a summer slot in the LA cell, not the UTC one', () => {
    // 16:00Z on Aug 23 is 9 AM PDT Aug 23.
    expect(cellFor(new Date('2026-08-23T16:00:00Z'))).toEqual({ date: '2026-08-23', hour: 9, band: 'main' })
    // 05:30Z on Aug 23 is 10:30 PM PDT Aug 22.
    expect(cellFor(new Date('2026-08-23T05:30:00Z'))).toEqual({ date: '2026-08-22', hour: 22, band: 'late' })
  })

  it('uses the offset that applied on each side of the spring-forward switch', () => {
    // 09:30Z on Mar 8 is 01:30 PST; 10:30Z is 03:30 PDT.
    expect(cellFor(new Date('2026-03-08T09:30:00Z'))).toEqual({ date: '2026-03-08', hour: 1, band: 'early' })
    expect(cellFor(new Date('2026-03-08T10:30:00Z'))).toEqual({ date: '2026-03-08', hour: 3, band: 'early' })
    // 9 AM PDT on Mar 9 is 16:00Z.
    expect(cellFor(new Date('2026-03-09T16:00:00Z')).hour).toBe(9)
  })

  it('uses the offset that applied on each side of the fall-back switch', () => {
    // 07:30Z on Nov 1 is 00:30 PDT; 11:30Z is 03:30 PST.
    expect(cellFor(new Date('2026-11-01T07:30:00Z'))).toEqual({ date: '2026-11-01', hour: 0, band: 'early' })
    expect(cellFor(new Date('2026-11-01T11:30:00Z'))).toEqual({ date: '2026-11-01', hour: 3, band: 'early' })
    // 9 AM PST on Nov 2 is 17:00Z.
    expect(cellFor(new Date('2026-11-02T17:00:00Z')).hour).toBe(9)
  })

  it('bands', () => {
    expect(bandOf(5)).toBe('early')
    expect(bandOf(6)).toBe('main')
    expect(bandOf(21)).toBe('main')
    expect(bandOf(22)).toBe('late')
  })
})

const post = (over: Partial<Parameters<typeof slotOf>[0]> & { id: number }) => ({
  platform: 'instagram', status: 'draft', reviewStatus: 'approved', ...over,
})

describe('slotOf / countsAgainstCap', () => {
  it('prefers posted_at for published rows and the effective slot otherwise', () => {
    expect(slotOf(post({ id: 1, status: 'posted', postedAt: '2026-08-23T16:00:00Z', scheduledAt: '2026-08-23T15:00:00Z' }))?.toISOString()).toBe('2026-08-23T16:00:00.000Z')
    expect(slotOf(post({ id: 2, scheduledAt: '2026-08-23T15:00:00Z' }))?.toISOString()).toBe('2026-08-23T15:00:00.000Z')
    expect(slotOf(post({ id: 3, scheduledFor: '2026-08-23' }))?.toISOString()).toBe('2026-08-23T00:00:00.000Z')
    expect(slotOf(post({ id: 4 }))).toBeNull()
  })

  it('rejected, deleted and failed rows free their slot', () => {
    expect(countsAgainstCap(post({ id: 1, reviewStatus: 'rejected' }))).toBe(false)
    expect(countsAgainstCap(post({ id: 2, status: 'deleted' }))).toBe(false)
    expect(countsAgainstCap(post({ id: 3, status: 'failed' }))).toBe(false)
    expect(countsAgainstCap(post({ id: 4, reviewStatus: 'pending_review' }))).toBe(true)
  })
})

describe('capsByDay', () => {
  it('counts per LA day and platform', () => {
    const caps = capsByDay([
      post({ id: 1, scheduledAt: '2026-08-23T16:00:00Z' }),
      post({ id: 2, scheduledAt: '2026-08-23T18:00:00Z' }),
      post({ id: 3, platform: 'x', scheduledAt: '2026-08-23T18:00:00Z' }),
      post({ id: 4, scheduledAt: '2026-08-23T05:30:00Z' }), // Aug 22 in LA
      post({ id: 5, reviewStatus: 'rejected', scheduledAt: '2026-08-23T19:00:00Z' }),
    ])
    expect(caps).toEqual({
      '2026-08-23': { instagram: 2, x: 1 },
      '2026-08-22': { instagram: 1 },
    })
  })
})

describe('nextOpenSlot', () => {
  const caps = { instagram: 3, x: 2 }

  it('picks the next whole hour inside the main band', () => {
    // 16:20Z Aug 23 = 9:20 AM PDT, so the next whole hour is 10:00 AM.
    const r = nextOpenSlot({ posts: [], caps, from: new Date('2026-08-23T16:20:00Z'), platform: 'instagram' })
    expect(r).toEqual({ date: '2026-08-23', time: '10:00', at: new Date('2026-08-23T17:00:00Z') })
  })

  it('skips hours already holding the same platform and days at cap', () => {
    const posts = [
      post({ id: 1, scheduledAt: '2026-08-23T17:00:00Z' }), // 10 AM
      post({ id: 2, scheduledAt: '2026-08-23T18:00:00Z' }), // 11 AM
      post({ id: 3, scheduledAt: '2026-08-23T19:00:00Z' }), // noon: IG day is now at cap 3
      post({ id: 4, platform: 'x', scheduledAt: '2026-08-24T13:00:00Z' }), // 6 AM Aug 24, other platform
    ]
    const r = nextOpenSlot({ posts, caps, from: new Date('2026-08-23T16:20:00Z'), platform: 'instagram' })
    expect(r?.date).toBe('2026-08-24')
    expect(r?.time).toBe('06:00')
  })

  it('ignores the post being moved', () => {
    const posts = [post({ id: 9, scheduledAt: '2026-08-23T17:00:00Z' })]
    const r = nextOpenSlot({ posts, caps, from: new Date('2026-08-23T16:20:00Z'), platform: 'instagram', excludeId: 9 })
    expect(r?.time).toBe('10:00')
  })

  it('rolls to the next morning after the evening cutoff', () => {
    // 05:10Z Aug 24 = 10:10 PM PDT Aug 23, past HOUR_END.
    const r = nextOpenSlot({ posts: [], caps, from: new Date('2026-08-24T05:10:00Z'), platform: 'x' })
    expect(r).toEqual({ date: '2026-08-24', time: '06:00', at: new Date('2026-08-24T13:00:00Z') })
  })

  it('returns null when the horizon is full', () => {
    const posts = Array.from({ length: 3 }, (_, i) => post({ id: i + 1, scheduledAt: `2026-08-23T${17 + i}:00:00Z` }))
    const r = nextOpenSlot({ posts, caps, from: new Date('2026-08-23T16:20:00Z'), platform: 'instagram', horizonDays: 0 })
    expect(r).toBeNull()
  })

  it('produces a PST instant after the fall-back switch', () => {
    const r = nextOpenSlot({ posts: [], caps, from: new Date('2026-11-01T12:00:00Z'), platform: 'x' })
    // 12:00Z Nov 1 is 4:00 AM PST, so the first open cell is 6:00 AM PST = 14:00Z.
    expect(r).toEqual({ date: '2026-11-01', time: '06:00', at: new Date('2026-11-01T14:00:00Z') })
  })
})
