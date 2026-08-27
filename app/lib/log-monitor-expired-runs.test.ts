/**
 * Ticket #5431(b): an auto-expired team run must surface to log-monitor
 * instead of sitting as a silent `failed` row, and it must report the phase
 * it died in when one was recorded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({ rows: [] as any[] }))

vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(world.rows),
      }),
    }),
  },
}))

import { fetchExpiredRunGroups } from './log-monitor.server'

beforeEach(() => {
  world.rows = []
})

describe('fetchExpiredRunGroups', () => {
  it('reports the phase a run died in when one was recorded', async () => {
    world.rows = [{
      id: 501,
      team: 'social',
      runType: 'social',
      currentPhase: 'step-4-draft',
      currentAgent: 'social-media-manager',
      startedAt: new Date('2026-08-25T10:00:00.000Z'),
      finishedAt: new Date('2026-08-25T11:00:00.000Z'),
      error: 'auto-expired: no recorded activity for 60 minutes',
    }]

    // now is 2h past finishedAt, well beyond the recovery grace.
    const now = new Date('2026-08-25T13:00:00.000Z').getTime()
    const groups = await fetchExpiredRunGroups(15, now)

    expect(groups).toHaveLength(1)
    expect(groups[0]!.priority).toBe('P1')
    expect(groups[0]!.title).toContain('social run #501')
    expect(groups[0]!.title).toContain('step-4-draft')
    expect(groups[0]!.excerpt).toContain('phase=step-4-draft')
    expect(groups[0]!.excerpt).toContain('agent=social-media-manager')
    expect(groups[0]!.likelyCause).toContain('step-4-draft')
  })

  it('still reports an old run with no phase ever recorded, without throwing', async () => {
    world.rows = [{
      id: 140,
      team: 'social',
      runType: 'social',
      currentPhase: null,
      currentAgent: null,
      startedAt: new Date('2026-08-10T10:00:00.000Z'),
      finishedAt: new Date('2026-08-10T14:00:00.000Z'),
      error: 'auto-expired: no recorded activity for 240 minutes',
    }]

    const now = new Date('2026-08-10T16:00:00.000Z').getTime()
    const groups = await fetchExpiredRunGroups(15, now)

    expect(groups).toHaveLength(1)
    expect(groups[0]!.title).toContain('phase: unknown')
    expect(groups[0]!.excerpt).toContain('phase=NULL')
    expect(groups[0]!.likelyCause).toMatch(/no phase ever recorded/)
  })

  it('returns an empty list when nothing expired in the window', async () => {
    world.rows = []
    const groups = await fetchExpiredRunGroups(15)
    expect(groups).toEqual([])
  })

  // #5632: a long, quiet-but-alive run (content run #517: podcast-reviewer)
  // tripped the 240-min idle reaper, was marked failed, then completed
  // successfully ~37 min later. log-monitor must not page a P1 for a run that
  // was auto-expired only moments ago -- give it a grace window to recover.
  it('suppresses a run auto-expired within the recovery grace window', async () => {
    world.rows = [{
      id: 517,
      team: 'content',
      runType: 'manual',
      currentPhase: 'run-start',
      currentAgent: null,
      startedAt: new Date('2026-08-26T10:14:34.000Z'),
      finishedAt: new Date('2026-08-26T14:14:00.000Z'),
      error: 'auto-expired: no recorded activity for 240 minutes',
    }]

    // Only 6 min after the auto-expiry -- inside the grace window.
    const now = new Date('2026-08-26T14:20:00.000Z').getTime()
    const groups = await fetchExpiredRunGroups(15, now)

    expect(groups).toEqual([])
  })

  it('surfaces a run once it has stayed auto-expired past the grace window', async () => {
    world.rows = [{
      id: 517,
      team: 'content',
      runType: 'manual',
      currentPhase: 'run-start',
      currentAgent: null,
      startedAt: new Date('2026-08-26T10:14:34.000Z'),
      finishedAt: new Date('2026-08-26T14:14:00.000Z'),
      error: 'auto-expired: no recorded activity for 240 minutes',
    }]

    // 66 min after the auto-expiry -- past the 60-min grace, still failed.
    const now = new Date('2026-08-26T15:20:00.000Z').getTime()
    const groups = await fetchExpiredRunGroups(15, now)

    expect(groups).toHaveLength(1)
    expect(groups[0]!.title).toContain('content run #517')
  })
})
