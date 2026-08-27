/**
 * The overdue-approved alarm (the loud half of the expiry sweep).
 *
 * `expireStaleUnapproved` deliberately leaves approved rows alone: an approved
 * row past its slot is due, not abandoned, and the tick is supposed to publish
 * it. When the tick does not — the valve is off, the cap is met, the spend
 * ceiling is hit — nothing said so, and the row sat approved indefinitely.
 * These cover what gets filed, how often, and what it refuses to touch.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('./db.server', () => ({ db: {} }))
vi.mock('./owner-blockers.server', () => ({ fileBlocker: vi.fn() }))

import {
  reportOverdueApproved,
  OVERDUE_AFTER_MS,
  type OverdueApproved,
} from './social-publish-job.server'

/** Stands in for the database read, which has its own coverage elsewhere. */
const finding = (rows: OverdueApproved[]) => async () => rows

describe('reportOverdueApproved', () => {
  it('files nothing at all when nothing is late', async () => {
    const file = vi.fn()

    const n = await reportOverdueApproved('instagram', new Date('2026-08-27T12:00:00Z'), { find: finding([]), file })

    expect(n).toBe(0)
    expect(file).not.toHaveBeenCalled()
  })

  it('names the rows and the worst lateness', async () => {
    const file = vi.fn()
    const find = finding([{ id: 37, daysLate: 14 }, { id: 38, daysLate: 4 }])

    const n = await reportOverdueApproved('instagram', new Date('2026-08-27T12:00:00Z'), { find, file })

    expect(n).toBe(2)
    const filed = file.mock.calls[0]![0] as Record<string, unknown>
    expect(filed['title']).toContain('2 approved post(s)')
    expect(filed['title']).toContain('14 days late')
    expect(String(filed['detail'])).toContain('#37, #38')
  })

  it('dedupes per platform, so an hourly tick re-observes instead of filing 24 a day', async () => {
    const file = vi.fn()
    const find = finding([{ id: 37, daysLate: 14 }])

    await reportOverdueApproved('instagram', new Date('2026-08-27T12:00:00Z'), { find, file })
    await reportOverdueApproved('x', new Date('2026-08-27T12:00:00Z'), { find, file })

    expect(file.mock.calls[0]![0].dedupeKey).toBe('social-overdue-approved-instagram')
    expect(file.mock.calls[1]![0].dedupeKey).toBe('social-overdue-approved-x')
  })

  it('carries the probe that closes it when the backlog drains', async () => {
    const file = vi.fn()
    const find = finding([{ id: 37, daysLate: 14 }])

    await reportOverdueApproved('instagram', new Date('2026-08-27T12:00:00Z'), { find, file })

    const filed = file.mock.calls[0]![0] as Record<string, unknown>
    expect(filed['verifyProbe']).toBe('social_no_overdue')
    expect(filed['verifyArg']).toBe('instagram')
  })

  it('points at the valve and the caps, which is where every cause of this lives', async () => {
    const file = vi.fn()
    const find = finding([{ id: 37, daysLate: 14 }])

    await reportOverdueApproved('instagram', new Date('2026-08-27T12:00:00Z'), { find, file })

    const filed = file.mock.calls[0]![0] as Record<string, unknown>
    expect(String(filed['detail'])).toContain('valve')
    expect(String(filed['detail'])).toContain('cap')
    // It is read-only, and says so: late is not a reason to publish something.
    expect(String(filed['detail'])).toContain('Nothing was changed.')
    expect(String(filed['whereToGo'])).toContain('/admin/socials/queue')
  })

  it('returns the count even when filing throws, so a broken advisory cannot stop a publish', async () => {
    const file = vi.fn().mockRejectedValue(new Error('blocker table is unreachable'))
    const find = finding([{ id: 37, daysLate: 14 }])

    await expect(reportOverdueApproved('instagram', new Date('2026-08-27T12:00:00Z'), { find, file }))
      .resolves.toBe(1)
  })

  it('states the threshold it used in whole days', async () => {
    const file = vi.fn()
    const find = finding([{ id: 37, daysLate: 14 }])

    await reportOverdueApproved('instagram', new Date('2026-08-27T12:00:00Z'), { find, file })

    const detail = String((file.mock.calls[0]![0] as Record<string, unknown>)['detail'])
    expect(detail).toContain(`${OVERDUE_AFTER_MS / 86_400_000} days ago`)
  })
})
