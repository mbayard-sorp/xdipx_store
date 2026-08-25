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
      error: 'auto-expired: no recorded activity for 60 minutes',
    }]

    const groups = await fetchExpiredRunGroups(15)

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
      error: 'auto-expired: no recorded activity for 240 minutes',
    }]

    const groups = await fetchExpiredRunGroups(15)

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
})
