import { describe, expect, it } from 'vitest'
import { contentSlotForDate } from './content-slot'

describe('contentSlotForDate', () => {
  // 2026-07-06 is a Monday; 16:00 UTC = 9am PT, the routine's window.
  const cases: [string, string, string, string | null][] = [
    ['2026-07-06T16:00:00Z', 'Monday', 'guides', null],
    ['2026-07-07T16:00:00Z', 'Tuesday', 'real-talk', null],
    ['2026-07-08T16:00:00Z', 'Wednesday', 'guides', null],
    ['2026-07-09T16:00:00Z', 'Thursday', 'podcast-notes', 'care'],
    ['2026-07-10T16:00:00Z', 'Friday', 'real-talk', null],
    ['2026-07-11T16:00:00Z', 'Saturday', 'care', null],
    ['2026-07-12T16:00:00Z', 'Sunday', 'comparisons', 'wellness-basics'],
  ]

  it.each(cases)('%s -> %s (%s)', (iso, weekday, expectedCategory, fallbackCategory) => {
    expect(contentSlotForDate(new Date(iso))).toEqual({ weekday, expectedCategory, fallbackCategory })
  })

  it('computes the weekday in Pacific time, not UTC', () => {
    // 2026-07-13T03:00Z is Monday in UTC but still Sunday 8pm in PT.
    expect(contentSlotForDate(new Date('2026-07-13T03:00:00Z'))).toEqual({
      weekday: 'Sunday',
      expectedCategory: 'comparisons',
      fallbackCategory: 'wellness-basics',
    })
  })
})
