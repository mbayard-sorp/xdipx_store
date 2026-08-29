import { describe, it, expect } from 'vitest'
import {
  computeOosStreaks,
  filterOversellRiskyFlags,
  utcDaysBetween,
  type OosFlag,
  type OosStreakState,
} from './oos-monitor.server'
import type { VariantInventoryPolicy } from './shopify.server'

describe('utcDaysBetween', () => {
  it('counts whole UTC days forward', () => {
    expect(utcDaysBetween('2026-08-14', '2026-08-17')).toBe(3)
    expect(utcDaysBetween('2026-08-17', '2026-08-17')).toBe(0)
  })
  it('never goes negative and survives a bad date', () => {
    expect(utcDaysBetween('2026-08-20', '2026-08-17')).toBe(0)
    expect(utcDaysBetween('not-a-date', '2026-08-17')).toBe(0)
  })
  it('spans month boundaries', () => {
    expect(utcDaysBetween('2026-07-30', '2026-08-02')).toBe(3)
  })
})

describe('computeOosStreaks (#3884)', () => {
  const THRESHOLD = 3

  it('starts a streak for a newly-zero SKU without flagging it', () => {
    const { nextState, flagged } = computeOosStreaks(['A'], {}, '2026-08-17', THRESHOLD)
    expect(nextState).toEqual({ A: '2026-08-17' })
    expect(flagged).toEqual([])
  })

  it('does not flag before the threshold is reached', () => {
    const prior: OosStreakState = { A: '2026-08-15' } // 2 days ago
    const { flagged } = computeOosStreaks(['A'], prior, '2026-08-17', THRESHOLD)
    expect(flagged).toEqual([])
  })

  it('flags once the zero-streak reaches the threshold, carrying the since date', () => {
    const prior: OosStreakState = { A: '2026-08-14' } // 3 days ago
    const { nextState, flagged } = computeOosStreaks(['A'], prior, '2026-08-17', THRESHOLD)
    expect(nextState).toEqual({ A: '2026-08-14' }) // since date preserved
    expect(flagged).toEqual([{ sku: 'A', sinceStr: '2026-08-14', streakDays: 3 }])
  })

  it('resets the streak when a SKU recovers (absent from zeroSkus)', () => {
    const prior: OosStreakState = { A: '2026-08-10', B: '2026-08-14' }
    // A recovered (not in zeroSkus), B still zero and now past threshold.
    const { nextState, flagged } = computeOosStreaks(['B'], prior, '2026-08-17', THRESHOLD)
    expect(nextState).toEqual({ B: '2026-08-14' })
    expect(nextState['A']).toBeUndefined()
    expect(flagged.map(f => f.sku)).toEqual(['B'])
  })

  it('re-arms a recovered SKU from today if it goes zero again later', () => {
    // A was zero long ago, recovered (dropped), now zero again today.
    const prior: OosStreakState = {}
    const { nextState, flagged } = computeOosStreaks(['A'], prior, '2026-08-20', THRESHOLD)
    expect(nextState).toEqual({ A: '2026-08-20' })
    expect(flagged).toEqual([])
  })

  it('orders flagged SKUs longest-out-of-stock first, then by sku', () => {
    const prior: OosStreakState = {
      short: '2026-08-14', // 3d
      long:  '2026-08-01', // 16d
      tie1:  '2026-08-13', // 4d
      tie2:  '2026-08-13', // 4d
    }
    const { flagged } = computeOosStreaks(
      ['short', 'long', 'tie1', 'tie2'],
      prior,
      '2026-08-17',
      THRESHOLD,
    )
    expect(flagged.map(f => f.sku)).toEqual(['long', 'tie1', 'tie2', 'short'])
  })

  it('respects a higher threshold', () => {
    const prior: OosStreakState = { A: '2026-08-14' } // 3d
    expect(computeOosStreaks(['A'], prior, '2026-08-17', 5).flagged).toEqual([])
    expect(computeOosStreaks(['A'], prior, '2026-08-19', 5).flagged.map(f => f.sku)).toEqual(['A'])
  })
})

describe('filterOversellRiskyFlags (#5213)', () => {
  const flag = (sku: string): OosFlag => ({ sku, sinceStr: '2026-08-14', streakDays: 3 })
  const policy = (
    inventoryPolicy: VariantInventoryPolicy['inventoryPolicy'],
    tracked: boolean,
  ): VariantInventoryPolicy => ({ inventoryPolicy, tracked })

  it('suppresses a tracked, inventoryPolicy=DENY variant (already blocked at checkout)', () => {
    const map = new Map([['deny', policy('DENY', true)]])
    expect(filterOversellRiskyFlags([flag('deny')], map)).toEqual([])
  })

  it('keeps a tracked, inventoryPolicy=CONTINUE variant (oversell allowed)', () => {
    const map = new Map([['cont', policy('CONTINUE', true)]])
    expect(filterOversellRiskyFlags([flag('cont')], map).map(f => f.sku)).toEqual(['cont'])
  })

  it('keeps an untracked variant regardless of policy (Shopify never blocks it)', () => {
    const map = new Map([
      ['untrackedDeny', policy('DENY', false)],
      ['untrackedCont', policy('CONTINUE', false)],
    ])
    expect(
      filterOversellRiskyFlags([flag('untrackedDeny'), flag('untrackedCont')], map).map(f => f.sku),
    ).toEqual(['untrackedDeny', 'untrackedCont'])
  })

  it('keeps a SKU whose policy could not be resolved (unknown fails safe)', () => {
    expect(filterOversellRiskyFlags([flag('missing')], new Map()).map(f => f.sku)).toEqual(['missing'])
  })

  it('filters a mixed batch to only the oversell-risky and unknown SKUs', () => {
    const map = new Map([
      ['deny',       policy('DENY', true)],      // suppressed
      ['continue',   policy('CONTINUE', true)],  // kept
      ['untracked',  policy('DENY', false)],     // kept
      // 'unknown' absent → kept
    ])
    const flags = [flag('deny'), flag('continue'), flag('untracked'), flag('unknown')]
    expect(filterOversellRiskyFlags(flags, map).map(f => f.sku)).toEqual([
      'continue', 'untracked', 'unknown',
    ])
  })
})
