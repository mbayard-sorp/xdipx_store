// LA wall clock <-> UTC (Phase 4, #4939). The DST cases are the whole point.
import { describe, it, expect } from 'vitest'
import { laWallClockToUtc, utcToLaParts, formatLaSlot, effectiveScheduledAt } from './social-schedule'

describe('laWallClockToUtc', () => {
  it('converts a summer slot at PDT (-7)', () => {
    expect(laWallClockToUtc('2026-08-23', '09:00').toISOString()).toBe('2026-08-23T16:00:00.000Z')
  })

  it('converts a winter slot at PST (-8)', () => {
    expect(laWallClockToUtc('2026-01-15', '09:00').toISOString()).toBe('2026-01-15T17:00:00.000Z')
  })

  it('spring forward 2026-03-08: 01:30 is still PST, 03:30 is already PDT', () => {
    expect(laWallClockToUtc('2026-03-08', '01:30').toISOString()).toBe('2026-03-08T09:30:00.000Z')
    expect(laWallClockToUtc('2026-03-08', '03:30').toISOString()).toBe('2026-03-08T10:30:00.000Z')
  })

  it('fall back 2026-11-01: 00:30 is PDT, 03:30 is PST, and 01:30 resolves to its first occurrence', () => {
    expect(laWallClockToUtc('2026-11-01', '00:30').toISOString()).toBe('2026-11-01T07:30:00.000Z')
    expect(laWallClockToUtc('2026-11-01', '03:30').toISOString()).toBe('2026-11-01T11:30:00.000Z')
    expect(laWallClockToUtc('2026-11-01', '01:30').toISOString()).toBe('2026-11-01T08:30:00.000Z')
  })

  it('round-trips through utcToLaParts', () => {
    for (const [date, time] of [['2026-08-23', '09:00'], ['2026-12-31', '23:45'], ['2026-03-08', '03:30']]) {
      expect(utcToLaParts(laWallClockToUtc(date!, time!))).toEqual({ date, time })
    }
  })

  it('rejects malformed input', () => {
    expect(() => laWallClockToUtc('2026-8-23', '09:00')).toThrow()
    expect(() => laWallClockToUtc('2026-08-23', '9am')).toThrow()
  })
})

describe('utcToLaParts', () => {
  it('rolls the date back across midnight', () => {
    expect(utcToLaParts(new Date('2026-08-23T05:30:00Z'))).toEqual({ date: '2026-08-22', time: '22:30' })
  })
})

describe('formatLaSlot', () => {
  it('labels the zone that actually applied', () => {
    expect(formatLaSlot(new Date('2026-08-23T16:00:00Z'))).toBe('Sun Aug 23, 9:00 AM PDT')
    expect(formatLaSlot(new Date('2026-01-15T17:05:00Z'))).toBe('Thu Jan 15, 9:05 AM PST')
  })
})

describe('effectiveScheduledAt', () => {
  it('prefers scheduled_at', () => {
    expect(effectiveScheduledAt({ scheduledAt: '2026-08-23T16:00:00Z', scheduledFor: '2026-08-30' })?.toISOString())
      .toBe('2026-08-23T16:00:00.000Z')
    expect(effectiveScheduledAt({ scheduledAt: new Date('2026-08-23T16:00:00Z'), scheduledFor: null })?.toISOString())
      .toBe('2026-08-23T16:00:00.000Z')
  })

  it('casts a legacy date-only row to midnight UTC of that day, matching the SQL', () => {
    expect(effectiveScheduledAt({ scheduledAt: null, scheduledFor: '2026-08-23' })?.toISOString())
      .toBe('2026-08-23T00:00:00.000Z')
  })

  it('is null when both are null', () => {
    expect(effectiveScheduledAt({ scheduledAt: null, scheduledFor: null })).toBeNull()
  })
})
