import { describe, it, expect } from 'vitest'
import {
  laWallClockToUtcIso, utcIsoToLaWallClock, laZoneAbbrev, formatLaWallClock,
  nextReworkPassUtc, formatNextReworkPass, formatWaitingAge,
} from './social-schedule-ui'

describe('laWallClockToUtcIso', () => {
  it('converts a summer (PDT, UTC-7) wall clock', () => {
    expect(laWallClockToUtcIso('2026-08-25', '09:30')).toBe('2026-08-25T16:30:00.000Z')
  })
  it('converts a winter (PST, UTC-8) wall clock', () => {
    expect(laWallClockToUtcIso('2026-01-15', '09:30')).toBe('2026-01-15T17:30:00.000Z')
  })
  it('crosses the date line late in the evening', () => {
    expect(laWallClockToUtcIso('2026-08-25', '23:15')).toBe('2026-08-26T06:15:00.000Z')
  })
  it('is correct on both sides of the 2026 spring-forward (Mar 8) and fall-back (Nov 1)', () => {
    expect(laWallClockToUtcIso('2026-03-08', '05:00')).toBe('2026-03-08T12:00:00.000Z')
    expect(laWallClockToUtcIso('2026-03-07', '05:00')).toBe('2026-03-07T13:00:00.000Z')
    expect(laWallClockToUtcIso('2026-11-01', '05:00')).toBe('2026-11-01T13:00:00.000Z')
    expect(laWallClockToUtcIso('2026-10-31', '05:00')).toBe('2026-10-31T12:00:00.000Z')
  })
  it('rejects malformed input', () => {
    expect(laWallClockToUtcIso('2026-8-25', '09:30')).toBeNull()
    expect(laWallClockToUtcIso('2026-08-25', '9:30')).toBeNull()
    expect(laWallClockToUtcIso('2026-08-25', '25:00')).toBeNull()
  })
})

describe('utcIsoToLaWallClock / round trip', () => {
  it('round-trips summer and winter instants', () => {
    expect(utcIsoToLaWallClock('2026-08-25T16:30:00.000Z')).toEqual({ date: '2026-08-25', time: '09:30' })
    expect(utcIsoToLaWallClock('2026-01-15T17:30:00.000Z')).toEqual({ date: '2026-01-15', time: '09:30' })
    expect(utcIsoToLaWallClock('2026-08-26T06:15:00.000Z')).toEqual({ date: '2026-08-25', time: '23:15' })
  })
  it('handles midnight without printing 24:00', () => {
    expect(utcIsoToLaWallClock('2026-08-25T07:00:00.000Z')?.time).toBe('00:00')
  })
})

describe('labels', () => {
  it('names the zone in force', () => {
    expect(laZoneAbbrev(new Date('2026-08-25T16:30:00Z'))).toBe('PDT')
    expect(laZoneAbbrev(new Date('2026-01-15T17:30:00Z'))).toBe('PST')
  })
  it('formats a slot with its zone', () => {
    expect(formatLaWallClock('2026-08-25T16:30:00.000Z')).toMatch(/Aug 25.*9:30 AM PDT$/)
    expect(formatLaWallClock(null)).toBeNull()
  })
})

describe('nextReworkPassUtc / formatNextReworkPass (#5415)', () => {
  it('picks the same-day 14:00 pass when before it', () => {
    expect(nextReworkPassUtc(new Date('2026-08-25T10:00:00Z')).toISOString()).toBe('2026-08-25T14:00:00.000Z')
  })
  it('picks the same-day 22:00 pass when between the two', () => {
    expect(nextReworkPassUtc(new Date('2026-08-25T15:00:00Z')).toISOString()).toBe('2026-08-25T22:00:00.000Z')
  })
  it('rolls to tomorrow 14:00 once both today passes are behind', () => {
    expect(nextReworkPassUtc(new Date('2026-08-25T23:00:00Z')).toISOString()).toBe('2026-08-26T14:00:00.000Z')
  })
  it('rolls over a month boundary', () => {
    expect(nextReworkPassUtc(new Date('2026-08-31T23:00:00Z')).toISOString()).toBe('2026-09-01T14:00:00.000Z')
  })
  it('formats the wait as an hour count', () => {
    expect(formatNextReworkPass(new Date('2026-08-25T10:00:00Z'))).toBe('next pass in 4h')
    expect(formatNextReworkPass(new Date('2026-08-25T13:45:00Z'))).toBe('next pass in under an hour')
  })
})

describe('formatWaitingAge', () => {
  const NOW = new Date('2026-08-25T12:00:00Z')
  it('is null for absent or unparseable input', () => {
    expect(formatWaitingAge(null, NOW)).toBeNull()
    expect(formatWaitingAge('not a date', NOW)).toBeNull()
  })
  it('rounds sub-hour waits to <1h', () => {
    expect(formatWaitingAge('2026-08-25T11:45:00Z', NOW)).toBe('<1h')
  })
  it('rounds hour-scale waits', () => {
    expect(formatWaitingAge('2026-08-25T09:00:00Z', NOW)).toBe('3h')
  })
  it('rounds day-scale waits', () => {
    expect(formatWaitingAge('2026-08-22T12:00:00Z', NOW)).toBe('3d')
  })
})
