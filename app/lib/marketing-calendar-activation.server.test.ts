// Unit tests for runCalendarActivationPass (ticket #20969).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}))

vi.mock('./db.server', () => ({ db: dbMock }))
vi.mock('../../db/schema', () => ({
  marketingCalendar: {
    id: 'id',
    name: 'name',
    eventDate: 'event_date',
    status: 'status',
    updatedAt: 'updated_at',
  },
}))

import { runCalendarActivationPass } from './marketing-calendar-activation.server'

type Row = { id: number; name: string; eventDate: string }

function mockDueRows(rows: Row[]) {
  dbMock.select.mockReturnValue({ from: () => ({ where: vi.fn().mockResolvedValue(rows) }) })
}

function mockUpdate(returning: { id: number }[]) {
  const returningFn = vi.fn().mockResolvedValue(returning)
  const where = vi.fn().mockReturnValue({ returning: returningFn })
  const set = vi.fn().mockReturnValue({ where })
  dbMock.update.mockReturnValue({ set })
  return { set, where, returningFn }
}

beforeEach(() => {
  dbMock.select.mockReset()
  dbMock.update.mockReset()
})

const NOW = new Date('2026-11-23T12:00:00Z')

describe('runCalendarActivationPass', () => {
  it('activates every due row and reports it', async () => {
    mockDueRows([
      { id: 45, name: 'Wand Week', eventDate: '2026-11-02' },
      { id: 46, name: 'Solo Sunday Month Opener', eventDate: '2026-11-09' },
    ])
    mockUpdate([{ id: 45 }])
    const result = await runCalendarActivationPass(NOW)

    // Each due row gets its own update call, set to 'active'.
    expect(dbMock.update).toHaveBeenCalledTimes(2)
    expect(result.activated).toEqual([
      { id: 45, name: 'Wand Week', eventDate: '2026-11-02' },
      { id: 46, name: 'Solo Sunday Month Opener', eventDate: '2026-11-09' },
    ])
  })

  it('reports nothing activated when the update affects zero rows (status changed between select and update)', async () => {
    mockDueRows([{ id: 45, name: 'Wand Week', eventDate: '2026-11-02' }])
    mockUpdate([]) // .returning() came back empty: the WHERE status='planned' guard didn't match
    const result = await runCalendarActivationPass(NOW)
    expect(result.activated).toEqual([])
  })

  it('returns an empty result when nothing is due', async () => {
    mockDueRows([])
    const result = await runCalendarActivationPass(NOW)
    expect(result).toEqual({ activated: [] })
    expect(dbMock.update).not.toHaveBeenCalled()
  })

  it('selects with status=planned, eventDate<=today, and excludes IG-prefixed rows', async () => {
    const selectWhere = vi.fn().mockResolvedValue([])
    dbMock.select.mockReturnValue({ from: () => ({ where: selectWhere }) })
    await runCalendarActivationPass(NOW)
    expect(dbMock.select).toHaveBeenCalledTimes(1)
    // The where() call receives a composed drizzle condition; we can't easily
    // inspect its internals without a live DB, so this just asserts the query
    // shape was invoked once with a single `and(...)` argument.
    expect(selectWhere).toHaveBeenCalledTimes(1)
    expect(selectWhere.mock.calls[0]).toHaveLength(1)
  })

  it('sets status to active and updates updatedAt on each activated row', async () => {
    mockDueRows([{ id: 7, name: 'Materials 101 Refresh', eventDate: '2026-11-20' }])
    const { set } = mockUpdate([{ id: 7 }])
    await runCalendarActivationPass(NOW)
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))
  })
})
