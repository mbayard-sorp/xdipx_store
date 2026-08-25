/**
 * Ticket #5430: a day of N restock crossings must produce AT MOST ONE
 * suggestion row. The interesting case is the DAY ROLLOVER boundary, tested
 * explicitly below.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({
  createCalls: [] as any[],
  createResult: null as any,
  updateCalls: [] as Array<{ set: any; where: any }>,
}))

vi.mock('~/lib/team.server', () => ({
  createSuggestionDetailed: vi.fn(async (input: any) => {
    world.createCalls.push(input)
    return world.createResult
  }),
}))

vi.mock('~/lib/db.server', () => ({
  db: {
    update: () => ({
      set: (vals: any) => ({
        where: (whereClause: any) => {
          world.updateCalls.push({ set: vals, where: whereClause })
          return Promise.resolve()
        },
      }),
    }),
  },
}))

import {
  restockDigestDay,
  restockDigestDedupeKey,
  formatRestockDigestLine,
  buildRestockDigestHeader,
  fileRestockDigestEntry,
} from './restock-digest.server'

beforeEach(() => {
  world.createCalls = []
  world.createResult = null
  world.updateCalls = []
})

describe('restockDigestDay / restockDigestDedupeKey — day rollover boundary', () => {
  it('two crossings one second apart, straddling midnight UTC, land on different days', () => {
    const beforeMidnight = new Date('2026-08-25T23:59:59.999Z')
    const afterMidnight  = new Date('2026-08-26T00:00:00.000Z')

    const dayBefore = restockDigestDay(beforeMidnight)
    const dayAfter  = restockDigestDay(afterMidnight)

    expect(dayBefore).toBe('2026-08-25')
    expect(dayAfter).toBe('2026-08-26')
    expect(restockDigestDedupeKey(dayBefore)).not.toBe(restockDigestDedupeKey(dayAfter))
  })

  it('two crossings on the same UTC day produce the same key regardless of time', () => {
    const morning = new Date('2026-08-25T00:00:01.000Z')
    const night   = new Date('2026-08-25T23:59:58.000Z')
    expect(restockDigestDedupeKey(restockDigestDay(morning)))
      .toBe(restockDigestDedupeKey(restockDigestDay(night)))
  })
})

describe('formatRestockDigestLine', () => {
  it('carries handle, title, and deal score', () => {
    const line = formatRestockDigestLine(
      { handle: 'magic-wand-rechargeable', title: 'Magic Wand Rechargeable', dealScore: 87.3 },
      new Date('2026-08-25T14:30:00.000Z'),
    )
    expect(line).toContain('Magic Wand Rechargeable')
    expect(line).toContain('handle: magic-wand-rechargeable')
    expect(line).toContain('deal score: 87.3')
  })

  it('renders a missing deal score as n/a rather than throwing or printing NaN', () => {
    const line = formatRestockDigestLine({ handle: 'x', title: 'X', dealScore: null })
    expect(line).toContain('deal score: n/a')
    expect(line).not.toContain('NaN')
  })
})

describe('buildRestockDigestHeader', () => {
  it('names the day and the caption constraint against scarcity framing', () => {
    const header = buildRestockDigestHeader('2026-08-25')
    expect(header).toContain('2026-08-25')
    expect(header.toLowerCase()).toContain('scarcity')
  })
})

describe('fileRestockDigestEntry — batches a day into one row', () => {
  it('the first crossing of a day creates a new digest row', async () => {
    world.createResult = { id: 501, deduped: false }
    const res = await fileRestockDigestEntry(
      { handle: 'a', title: 'A', dealScore: 10 },
      { now: new Date('2026-08-25T10:00:00.000Z') },
    )
    expect(res).toEqual({ id: 501, created: true })
    expect(world.createCalls).toHaveLength(1)
    expect(world.createCalls[0].dedupeKey).toBe('restock-digest:2026-08-25')
    expect(world.createCalls[0].dedupeScope).toBe('daily')
    expect(world.createCalls[0].suggestion).toContain('handle: a')
    expect(world.updateCalls).toHaveLength(0)
  })

  it('a second crossing the same day appends to the existing row instead of creating a sibling', async () => {
    world.createResult = { id: 501, deduped: true }
    const res = await fileRestockDigestEntry(
      { handle: 'b', title: 'B', dealScore: 20 },
      { now: new Date('2026-08-25T18:00:00.000Z') },
    )
    expect(res).toEqual({ id: 501, created: false })
    expect(world.updateCalls).toHaveLength(1)
    expect(world.updateCalls[0]!.set.suggestion).toBeDefined()
    expect(world.updateCalls[0]!.where).toBeDefined()
  })

  it('a crossing on the NEXT day mints a fresh digest row rather than reusing yesterday\'s', async () => {
    // First call: yesterday, deduped against nothing, new row #501.
    world.createResult = { id: 501, deduped: false }
    await fileRestockDigestEntry(
      { handle: 'a', title: 'A' },
      { now: new Date('2026-08-25T23:59:59.999Z') },
    )
    // Second call: one millisecond later, but the NEXT UTC day. The dedupeKey
    // must differ, so createSuggestionDetailed is asked to create a new row
    // (#502), not append to #501 across midnight.
    world.createResult = { id: 502, deduped: false }
    const res = await fileRestockDigestEntry(
      { handle: 'c', title: 'C' },
      { now: new Date('2026-08-26T00:00:00.000Z') },
    )

    expect(res).toEqual({ id: 502, created: true })
    expect(world.createCalls).toHaveLength(2)
    expect(world.createCalls[0]!.dedupeKey).toBe('restock-digest:2026-08-25')
    expect(world.createCalls[1]!.dedupeKey).toBe('restock-digest:2026-08-26')
    expect(world.updateCalls).toHaveLength(0)
  })

  it('a dedupe collision with no resolvable live row is reported, not thrown', async () => {
    world.createResult = { id: 0, deduped: true }
    const res = await fileRestockDigestEntry(
      { handle: 'z', title: 'Z' },
      { now: new Date('2026-08-25T00:00:00.000Z') },
    )
    expect(res).toEqual({ id: 0, created: false })
    expect(world.updateCalls).toHaveLength(0)
  })
})
