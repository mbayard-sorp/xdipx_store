/**
 * Ticket #12877: a day of N publish batches must produce AT MOST ONE
 * "products went live" suggestion row, every batch's products included.
 * Same shape as restock-digest.test.ts for fileRestockDigestEntry — the
 * pattern this file's own header comment says it mirrors.
 *
 * Defect verified live: 2026-09-25 published 15 products across two publish
 * ticks (10 then 5) and the row listed only 10; 2026-09-16 published 28 and
 * the row listed 25. `createSuggestionDetailed`'s dedupe-collision path
 * returns the EXISTING row untouched, so a repeat create silently dropped
 * everything after the first tick of the day.
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

import { fileWentLiveSuggestion, type WentLiveProduct } from './import-enrich.server'

function product(over: Partial<WentLiveProduct> & { handle: string; title: string }): WentLiveProduct {
  return {
    category: 'uncategorized',
    vendor: 'unknown',
    productType: null,
    totalInventory: null,
    bareRefUrl: null,
    excludeReason: null,
    ...over,
  }
}

beforeEach(() => {
  world.createCalls = []
  world.createResult = null
  world.updateCalls = []
})

describe('fileWentLiveSuggestion — batches a UTC day into one row (#12877)', () => {
  it('the first publish batch of a day creates a new row', async () => {
    world.createResult = { id: 701, deduped: false }
    const res = await fileWentLiveSuggestion(
      [product({ handle: 'a', title: 'A' })],
      { now: new Date('2026-09-25T12:30:00.000Z') },
    )
    expect(res).toEqual({ id: 701, created: true })
    expect(world.createCalls).toHaveLength(1)
    expect(world.createCalls[0].dedupeKey).toBe('new-products:enrich:2026-09-25')
    expect(world.createCalls[0].dedupeScope).toBe('daily')
    expect(world.createCalls[0].suggestion).toContain('handle: a')
    expect(world.updateCalls).toHaveLength(0)
  })

  it('a second publish batch the same day appends to the existing row instead of dropping it', async () => {
    world.createResult = { id: 701, deduped: true }
    const res = await fileWentLiveSuggestion(
      [product({ handle: 'b', title: 'B' }), product({ handle: 'c', title: 'C' })],
      { now: new Date('2026-09-25T13:00:00.000Z') },
    )
    expect(res).toEqual({ id: 701, created: false })
    expect(world.updateCalls).toHaveLength(1)
    const appended = world.updateCalls[0]!.set.suggestion
    expect(appended).toBeDefined()
    // sql`` template: the literal string param is one of the queryChunks;
    // assert both new handles actually made it into it, which is the exact
    // defect (verified 2026-09-25: 10 of 15 products, the SECOND batch's 5,
    // were the ones silently dropped).
    const appendedText = (appended.queryChunks as unknown[]).filter((c): c is string => typeof c === 'string').join('')
    expect(appendedText).toContain('handle: b')
    expect(appendedText).toContain('handle: c')
  })

  it('a batch on the NEXT UTC day mints a fresh row rather than reusing yesterday\'s', async () => {
    world.createResult = { id: 701, deduped: false }
    await fileWentLiveSuggestion([product({ handle: 'a', title: 'A' })], { now: new Date('2026-09-25T23:59:59.999Z') })

    world.createResult = { id: 702, deduped: false }
    const res = await fileWentLiveSuggestion(
      [product({ handle: 'd', title: 'D' })],
      { now: new Date('2026-09-26T00:00:00.000Z') },
    )
    expect(res).toEqual({ id: 702, created: true })
    expect(world.createCalls).toHaveLength(2)
    expect(world.createCalls[0]!.dedupeKey).toBe('new-products:enrich:2026-09-25')
    expect(world.createCalls[1]!.dedupeKey).toBe('new-products:enrich:2026-09-26')
    expect(world.updateCalls).toHaveLength(0)
  })

  it('a dedupe collision with no resolvable live row is reported, not thrown', async () => {
    world.createResult = { id: 0, deduped: true }
    const res = await fileWentLiveSuggestion([product({ handle: 'z', title: 'Z' })], { now: new Date('2026-09-25T00:00:00.000Z') })
    expect(res).toEqual({ id: 0, created: false })
    expect(world.updateCalls).toHaveLength(0)
  })

  it('an empty batch never calls createSuggestionDetailed', async () => {
    const res = await fileWentLiveSuggestion([])
    expect(res).toEqual({ id: 0, created: false })
    expect(world.createCalls).toHaveLength(0)
  })

  it('curates the line with type, inventory, Instagram eligibility, and bare ref when present (#12877)', async () => {
    world.createResult = { id: 701, deduped: false }
    await fileWentLiveSuggestion(
      [
        product({
          handle: 'eligible-wand', title: 'Eligible Wand', category: 'Wands', vendor: 'Acme',
          productType: 'Wand Massager', totalInventory: 42, bareRefUrl: 'https://cdn/wand.jpg', excludeReason: null,
        }),
        product({
          handle: 'ineligible-dildo', title: 'Realistic Dildo', category: 'Dildos', vendor: 'Shots',
          productType: 'Realistic Dildo', totalInventory: 5, bareRefUrl: null,
          excludeReason: 'not Instagram-eligible by category (instagram-campaigns.md §4b: never a dildo, never an anatomically realistic product)',
        }),
      ],
      { now: new Date('2026-10-01T12:00:00.000Z') },
    )
    const suggestion = world.createCalls[0].suggestion as string
    expect(suggestion).toContain('type: Wand Massager')
    expect(suggestion).toContain('inventory: 42')
    expect(suggestion).toContain('Instagram-eligible: yes')
    expect(suggestion).toContain('bare ref: https://cdn/wand.jpg')
    expect(suggestion).toContain('Instagram-eligible: no (not Instagram-eligible by category')
  })
})
