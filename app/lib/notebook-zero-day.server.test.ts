import { describe, expect, it, vi } from 'vitest'
import {
  checkNotebookZeroDay,
  holdReasonFromRunError,
  notebookZeroDaySuggestionText,
  utcDayRange,
  utcPreviousDayRange,
  NOTEBOOK_ZERO_DAY_DEDUPE_KEY,
  type NotebookZeroDayDeps,
} from './notebook-zero-day.server'

/**
 * The Notebook day-close alarm (ticket #13393): with both team valves on, a
 * day with no live post files a P1 ticket and marks the day's content run.
 * These pin the decision table; the Sanity/DB wiring is thin (see
 * `runNotebookZeroDayCheck`, intentionally not unit-tested here).
 */

const mockFile = () => vi.fn(async (_input: { dedupeKey: string; suggestion: string }) => ({ id: 42, deduped: false }))
const mockEvent = () => vi.fn(async (_runId: number, _summary: string) => undefined)
type TestDeps = NotebookZeroDayDeps & {
  fileTicket: ReturnType<typeof mockFile>
  recordEvent: ReturnType<typeof mockEvent>
}

function deps(over: Partial<NotebookZeroDayDeps> = {}): TestDeps {
  const fileTicket = mockFile()
  const recordEvent = mockEvent()
  return {
    now: new Date('2026-10-03T23:40:00Z'),
    isContentEnabled: async () => true,
    isAutopublishOn: async () => true,
    publishedSlugToday: async () => null,
    heldDraftToday: async () => null,
    holdReasonToday: async () => null,
    fileTicket,
    latestContentRunId: async () => 900,
    recordEvent,
    ...over,
  } as TestDeps
}

describe('utcDayRange / utcPreviousDayRange', () => {
  it('bounds the UTC calendar day containing `now`', () => {
    const { start, end, day } = utcDayRange(new Date('2026-10-03T23:40:00Z'))
    expect(day).toBe('2026-10-03')
    expect(start.toISOString()).toBe('2026-10-03T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-10-04T00:00:00.000Z')
  })

  it('bounds the day before, so a next-day check can report on yesterday', () => {
    const { start, end, day } = utcPreviousDayRange(new Date('2026-10-04T00:05:00Z'))
    expect(day).toBe('2026-10-03')
    expect(start.toISOString()).toBe('2026-10-03T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-10-04T00:00:00.000Z')
  })
})

describe('holdReasonFromRunError', () => {
  it('extracts the reason from the zero-post-day:notebook error shape', () => {
    expect(holdReasonFromRunError('zero-post-day:notebook:hero')).toBe('hero')
    expect(holdReasonFromRunError('zero-post-day:notebook:gate-block')).toBe('gate-block')
  })

  it('returns null for anything else, including null/empty', () => {
    expect(holdReasonFromRunError(null)).toBeNull()
    expect(holdReasonFromRunError(undefined)).toBeNull()
    expect(holdReasonFromRunError('')).toBeNull()
    expect(holdReasonFromRunError('some unrelated run error')).toBeNull()
  })
})

describe('checkNotebookZeroDay', () => {
  it('does nothing on a live day: a post published today', async () => {
    const d = deps({ publishedSlugToday: async () => 'does-app-controlled-feel-different' })
    const report = await checkNotebookZeroDay(d)
    expect(d.fileTicket).not.toHaveBeenCalled()
    expect(d.recordEvent).not.toHaveBeenCalled()
    expect(report).toMatchObject({
      checked: true,
      reason: 'live',
      publishedSlug: 'does-app-controlled-feel-different',
    })
  })

  it('files a P1 ticket and marks the run on a missed day with both valves on', async () => {
    const d = deps({
      heldDraftToday: async () => ({ slug: 'can-you-share-sex-toys-safely' }),
      holdReasonToday: async () => 'hero',
    })
    const report = await checkNotebookZeroDay(d)

    expect(d.fileTicket).toHaveBeenCalledTimes(1)
    const call = d.fileTicket.mock.calls[0]![0]
    expect(call.dedupeKey).toBe(NOTEBOOK_ZERO_DAY_DEDUPE_KEY)
    expect(call.suggestion).toContain('can-you-share-sex-toys-safely')
    expect(call.suggestion).toContain('Hold reason: hero')
    expect(call.suggestion).toContain('DONE WHEN')

    expect(d.recordEvent).toHaveBeenCalledTimes(1)
    expect(d.recordEvent.mock.calls[0]?.[0]).toBe(900)
    expect(d.recordEvent.mock.calls[0]?.[1]).toContain('Ticket #42')
    expect(d.recordEvent.mock.calls[0]?.[1]).toContain('can-you-share-sex-toys-safely')

    expect(report).toMatchObject({
      checked: true,
      publishedSlug: null,
      heldDraft: { slug: 'can-you-share-sex-toys-safely' },
      holdReason: 'hero',
      ticketId: 42,
      deduped: false,
    })
  })

  it('still files when no held draft or run exists, naming the gap', async () => {
    const d = deps({ latestContentRunId: async () => null })
    const report = await checkNotebookZeroDay(d)
    expect(d.fileTicket).toHaveBeenCalledTimes(1)
    expect(d.fileTicket.mock.calls[0]![0].suggestion).toContain('may not have run at all today')
    // No run row to mark, so the event is skipped, not thrown.
    expect(d.recordEvent).not.toHaveBeenCalled()
    expect(report.ticketId).toBe(42)
  })

  it('reports a dedupe collision as the existing ticket rather than a new one', async () => {
    const d = deps({ fileTicket: vi.fn(async () => ({ id: 7, deduped: true })) })
    const report = await checkNotebookZeroDay(d)
    expect(report).toMatchObject({ ticketId: 7, deduped: true })
    expect(d.recordEvent.mock.calls[0]?.[1]).toContain('already open')
  })

  it('does nothing when content_team_enabled is off, even at zero posts', async () => {
    const d = deps({ isContentEnabled: async () => false })
    const report = await checkNotebookZeroDay(d)
    expect(d.fileTicket).not.toHaveBeenCalled()
    expect(d.recordEvent).not.toHaveBeenCalled()
    expect(report).toEqual({ day: '2026-10-03', checked: false, reason: 'valve_off' })
  })

  it('does nothing when content_team_autopublish is off, even at zero posts', async () => {
    const d = deps({ isAutopublishOn: async () => false })
    const report = await checkNotebookZeroDay(d)
    expect(d.fileTicket).not.toHaveBeenCalled()
    expect(d.recordEvent).not.toHaveBeenCalled()
    expect(report).toEqual({ day: '2026-10-03', checked: false, reason: 'valve_off' })
  })
})

describe('notebookZeroDaySuggestionText', () => {
  it('names the day, the held draft slug, and the hold reason', () => {
    const text = notebookZeroDaySuggestionText(
      '2026-10-03',
      { slug: 'can-you-share-sex-toys-safely' },
      'hero',
    )
    expect(text).toContain('Zero-post day on the Notebook (2026-10-03 UTC)')
    expect(text).toContain('can-you-share-sex-toys-safely')
    expect(text).toContain('Hold reason: hero')
    expect(text).toContain('routine-content-daily.md')
    expect(text).toContain('DONE WHEN')
  })

  it('says plainly when no held draft exists either', () => {
    const text = notebookZeroDaySuggestionText('2026-10-03', null, null)
    expect(text).toContain('No held draft was found for today either')
    expect(text).toContain('(no hold reason on record)')
  })
})
