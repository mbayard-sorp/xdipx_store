import { describe, expect, it, vi } from 'vitest'
import {
  checkSocialZeroDay,
  type ZeroDayTicket,
  isDayCloseHour,
  zeroDayDedupeKey,
  zeroDaySuggestionText,
  type ZeroDayDeps,
} from './social-zero-day.server'

/**
 * The day-close alarm (owner direction 2026-09-06): a live platform with no
 * post by the last tick of the UTC day files a P1 ticket and marks the day's
 * social run. These pin the decision table; the database wiring is thin.
 */

const mockFile = () => vi.fn(async (_input: ZeroDayTicket) => ({ id: 42, deduped: false }))
const mockEvent = () => vi.fn(async (_runId: number, _summary: string) => undefined)
type TestDeps = ZeroDayDeps & { fileTicket: ReturnType<typeof mockFile>; recordEvent: ReturnType<typeof mockEvent> }

function deps(over: Partial<ZeroDayDeps> = {}): TestDeps {
  const fileTicket = mockFile()
  const recordEvent = mockEvent()
  return {
    now: new Date('2026-09-06T23:05:00Z'),
    platforms: ['instagram', 'x'],
    isEnabled: async () => true,
    frequency: async () => 2,
    postedToday: async () => 0,
    draftsToday: async () => [],
    fileTicket,
    latestSocialRunId: async () => 720,
    recordEvent,
    ...over,
  } as TestDeps
}

describe('isDayCloseHour', () => {
  it('is true only on the last hourly tick of the UTC day', () => {
    expect(isDayCloseHour(new Date('2026-09-06T23:00:00Z'))).toBe(true)
    expect(isDayCloseHour(new Date('2026-09-06T22:59:00Z'))).toBe(false)
    expect(isDayCloseHour(new Date('2026-09-06T00:00:00Z'))).toBe(false)
  })
})

describe('checkSocialZeroDay', () => {
  it('files one P1 ticket per live platform at zero and marks the latest social run', async () => {
    const d = deps({
      draftsToday: async p => p === 'instagram'
        ? [{ id: 183, reviewStatus: 'rejected', status: 'draft', feedback: '[publish-gate BLOCK] post-coital read\nmore' }]
        : [],
    })
    const report = await checkSocialZeroDay(d)
    expect(d.fileTicket).toHaveBeenCalledTimes(2)
    const ig = d.fileTicket.mock.calls[0]![0]
    expect(ig.dedupeKey).toBe('social-zero-day:instagram')
    expect(ig.suggestion).toContain('row 183 (rejected/draft): [publish-gate BLOCK] post-coital read')
    expect(ig.suggestion).toContain('DONE WHEN')
    expect(d.recordEvent).toHaveBeenCalledTimes(2)
    expect(d.recordEvent.mock.calls[0]?.[0]).toBe(720)
    expect(d.recordEvent.mock.calls[0]?.[1]).toContain('Ticket #42')
    expect(report.platforms.map(p => p.ticketId)).toEqual([42, 42])
  })

  it('does nothing for a platform that posted today', async () => {
    const d = deps({ postedToday: async p => (p === 'x' ? 1 : 0) })
    const report = await checkSocialZeroDay(d)
    expect(d.fileTicket).toHaveBeenCalledTimes(1)
    expect(d.fileTicket.mock.calls[0]?.[0].platform).toBe('instagram')
    expect(report.platforms.find(p => p.platform === 'x')).toMatchObject({ checked: true, reason: 'posted', postedToday: 1 })
  })

  it('skips a platform whose valve is off or whose frequency is zero, without filing', async () => {
    const d = deps({
      isEnabled: async p => p !== 'instagram',
      frequency: async p => (p === 'x' ? 0 : 2),
    })
    const report = await checkSocialZeroDay(d)
    expect(d.fileTicket).not.toHaveBeenCalled()
    expect(d.recordEvent).not.toHaveBeenCalled()
    expect(report.platforms).toEqual([
      { platform: 'instagram', checked: false, reason: 'valve_off', postedToday: 0, draftsToday: 0 },
      { platform: 'x', checked: false, reason: 'frequency_zero', postedToday: 0, draftsToday: 0 },
    ])
  })

  it('reports a dedupe collision as the existing ticket rather than a new one', async () => {
    const d = deps({ fileTicket: vi.fn(async () => ({ id: 7, deduped: true })) })
    const report = await checkSocialZeroDay(d)
    expect(report.platforms[0]).toMatchObject({ ticketId: 7, deduped: true })
    expect(d.recordEvent.mock.calls[0]?.[1]).toContain('already open')
  })

  it('still files when no social run exists today, skipping only the event', async () => {
    const d = deps({ latestSocialRunId: async () => null })
    await checkSocialZeroDay(d)
    expect(d.fileTicket).toHaveBeenCalledTimes(2)
    expect(d.recordEvent).not.toHaveBeenCalled()
  })
})

describe('zeroDaySuggestionText', () => {
  it('names the platform, the day, the counts, and the three fix surfaces', () => {
    const text = zeroDaySuggestionText('x', '2026-09-06', [
      { id: 184, reviewStatus: 'rejected', status: 'draft', feedback: 'caption-too-long' },
      { id: 186, reviewStatus: 'needs_changes', status: 'draft', feedback: null },
    ])
    expect(text).toContain('Zero-post day on x (2026-09-06 UTC)')
    expect(text).toContain('Drafts today: 2 (rejected 1, needs_changes 1)')
    expect(text).toContain('row 186 (needs_changes/draft): (no feedback)')
    expect(text).toContain('app/lib/team-gates.server.ts')
    expect(text).toContain('routine-social-daily.md')
    expect(zeroDayDedupeKey('x')).toBe('social-zero-day:x')
  })
})
