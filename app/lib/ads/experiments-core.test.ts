import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyFile } from '../migration-classify.server'
import {
  FLOORS,
  IllegalExperimentTransitionError,
  assertExperimentTransition,
  canTransition,
  compareArms,
  daysRunning,
  parseMinSpendDollars,
  parseNewExperiment,
  type AdExperimentArm,
  type ArmMetrics,
  type CompareContext,
} from './experiments-core'

const NOW = new Date('2026-10-19T12:00:00Z')
const DAY = 86_400_000
const arm = (id: string): AdExperimentArm => ({ label: `Arm ${id}`, platform: 'meta', level: 'ad', externalId: id })
const m = (over: Partial<ArmMetrics> = {}): ArmMetrics => ({
  spendCents: 5000, impressions: 3000, leads: 12, orders: 0, netRevenueCents: 0, ...over,
})
const ctx = (over: Partial<CompareContext> = {}): CompareContext => ({
  metric: 'cpl', minSpendCents: 4000, startsAt: new Date(NOW.getTime() - 7 * DAY), endsAt: null, now: NOW, ...over,
})

describe('cpl floors', () => {
  it('is readable at 10 leads and 2,000 impressions with spend over the minimum', () => {
    const c = compareArms([
      { arm: arm('a'), metrics: m({ leads: FLOORS.cplLeads, impressions: FLOORS.cplImpressions }) },
      { arm: arm('b'), metrics: m() },
    ], ctx())
    expect(c.arms.every(r => r.readable)).toBe(true)
    expect(c.arms[0]!.value).toBe(500)
  })

  it('is not readable at 9 leads, and says so', () => {
    const c = compareArms([{ arm: arm('a'), metrics: m({ leads: 9 }) }, { arm: arm('b'), metrics: m() }], ctx())
    expect(c.arms[0]!.readable).toBe(false)
    expect(c.arms[0]!.reason).toContain('9 of 10 leads')
    expect(c.leaderIndex).toBeNull()
  })

  it('is not readable under 2,000 impressions', () => {
    const c = compareArms([{ arm: arm('a'), metrics: m({ impressions: 1999 }) }, { arm: arm('b'), metrics: m() }], ctx())
    expect(c.arms[0]!.reason).toContain('1,999 of 2,000 impressions')
  })
})

describe('cpa floors', () => {
  it('needs 40 leads and 30 days', () => {
    const c = compareArms([
      { arm: arm('a'), metrics: m({ leads: 39, orders: 3 }) },
      { arm: arm('b'), metrics: m({ leads: 45, orders: 3 }) },
    ], ctx({ metric: 'cpa', startsAt: new Date(NOW.getTime() - 20 * DAY) }))
    expect(c.arms[0]!.reason).toBe('39 of 40 leads, 20 of 30 days')
    expect(c.arms[1]!.reason).toBe('20 of 30 days')
  })

  it('is readable at 40 leads after 30 days with orders', () => {
    const c = compareArms([
      { arm: arm('a'), metrics: m({ leads: 40, orders: 2 }) },
      { arm: arm('b'), metrics: m({ leads: 50, orders: 5 }) },
    ], ctx({ metric: 'cpa', startsAt: new Date(NOW.getTime() - 30 * DAY) }))
    expect(c.allReadable).toBe(true)
    expect(c.leaderIndex).toBe(1) // $10 CPA beats $25
  })

  it('is not readable with zero orders even past the floors', () => {
    const c = compareArms([
      { arm: arm('a'), metrics: m({ leads: 40, orders: 0 }) },
      { arm: arm('b'), metrics: m({ leads: 40, orders: 1 }) },
    ], ctx({ metric: 'cpa', startsAt: new Date(NOW.getTime() - 31 * DAY) }))
    expect(c.arms[0]!.reason).toBe('no orders yet')
    expect(c.leaderIndex).toBeNull()
  })
})

describe('roas floors', () => {
  it('needs 10 orders, and the higher ratio leads', () => {
    const under = compareArms([
      { arm: arm('a'), metrics: m({ orders: 9, netRevenueCents: 30000 }) },
      { arm: arm('b'), metrics: m({ orders: 10, netRevenueCents: 20000 }) },
    ], ctx({ metric: 'roas' }))
    expect(under.arms[0]!.reason).toBe('9 of 10 orders')
    expect(under.leaderIndex).toBeNull()

    const over = compareArms([
      { arm: arm('a'), metrics: m({ orders: 10, netRevenueCents: 30000 }) },
      { arm: arm('b'), metrics: m({ orders: 12, netRevenueCents: 20000 }) },
    ], ctx({ metric: 'roas' }))
    expect(over.leaderIndex).toBe(0)
    expect(over.arms[0]!.value).toBeCloseTo(6)
  })
})

describe('min spend gate', () => {
  it('blocks a verdict when one arm is under min_spend_cents, whatever the leads', () => {
    const c = compareArms([
      { arm: arm('a'), metrics: m({ spendCents: 3999, leads: 30 }) },
      { arm: arm('b'), metrics: m() },
    ], ctx())
    expect(c.arms[0]!.readable).toBe(false)
    expect(c.arms[0]!.reason).toBe('$39.99 of $40.00 spend')
    expect(c.leaderIndex).toBeNull()
  })

  it('applies to roas too', () => {
    const c = compareArms([
      { arm: arm('a'), metrics: m({ spendCents: 1000, orders: 20, netRevenueCents: 50000 }) },
      { arm: arm('b'), metrics: m({ orders: 20, netRevenueCents: 10000 }) },
    ], ctx({ metric: 'roas' }))
    expect(c.arms[0]!.readable).toBe(false)
    expect(c.leaderIndex).toBeNull()
  })
})

describe('leader', () => {
  it('names the lowest CPL only when every arm is readable', () => {
    const c = compareArms([
      { arm: arm('a'), metrics: m({ spendCents: 6000, leads: 12 }) },
      { arm: arm('b'), metrics: m({ spendCents: 6000, leads: 20 }) },
      { arm: arm('c'), metrics: m({ spendCents: 6000, leads: 15 }) },
    ], ctx())
    expect(c.leaderIndex).toBe(1)
    expect(c.note).toBeNull()
  })

  it('names no leader when one of three arms is under the floor', () => {
    const c = compareArms([
      { arm: arm('a'), metrics: m({ leads: 20 }) },
      { arm: arm('b'), metrics: m({ leads: 2 }) },
      { arm: arm('c'), metrics: m({ leads: 15 }) },
    ], ctx())
    expect(c.allReadable).toBe(false)
    expect(c.leaderIndex).toBeNull()
    expect(c.note).toContain('1 of 3 arms')
  })

  it('names no leader on an exact tie', () => {
    const c = compareArms([{ arm: arm('a'), metrics: m() }, { arm: arm('b'), metrics: m() }], ctx())
    expect(c.allReadable).toBe(true)
    expect(c.leaderIndex).toBeNull()
  })

  it('reports not started for a planned experiment', () => {
    const c = compareArms([{ arm: arm('a'), metrics: m() }, { arm: arm('b'), metrics: m() }], ctx({ startsAt: null }))
    expect(c.arms[0]!.reason).toBe('not started')
  })
})

describe('daysRunning', () => {
  it('counts whole days to ends_at when it is in the past', () => {
    expect(daysRunning(new Date(NOW.getTime() - 10 * DAY), new Date(NOW.getTime() - 3 * DAY), NOW)).toBe(7)
    expect(daysRunning(null, null, NOW)).toBe(0)
  })
})

describe('status machine', () => {
  it('allows planned to running to decided, and abandon from either', () => {
    expect(canTransition('planned', 'running')).toBe(true)
    expect(canTransition('running', 'decided')).toBe(true)
    expect(canTransition('planned', 'abandoned')).toBe(true)
    expect(canTransition('running', 'abandoned')).toBe(true)
  })
  it('refuses decide from planned and anything from a terminal state', () => {
    expect(() => assertExperimentTransition('planned', 'decided')).toThrow(IllegalExperimentTransitionError)
    expect(canTransition('decided', 'running')).toBe(false)
    expect(canTransition('abandoned', 'running')).toBe(false)
  })
})

describe('parseNewExperiment', () => {
  const base = {
    hypothesis: 'Question hook beats benefit hook on CPL.',
    variable: 'hook', primaryMetric: 'cpl', minSpend: '', notes: '',
    arms: [{ choice: 'meta|ad|111', label: 'Question' }, { choice: 'meta|ad|222', label: '' }],
  }
  it('accepts two arms and defaults min spend to $40', () => {
    const r = parseNewExperiment(base)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.minSpendCents).toBe(4000)
      expect(r.value.arms[1]!.label).toBe('Arm B')
    }
  })
  it('refuses one arm, a duplicate arm, a creative-level arm, and a bad lever', () => {
    expect(parseNewExperiment({ ...base, arms: [base.arms[0]!] }).ok).toBe(false)
    expect(parseNewExperiment({ ...base, arms: [base.arms[0]!, base.arms[0]!] }).ok).toBe(false)
    expect(parseNewExperiment({ ...base, arms: [base.arms[0]!, { choice: 'meta|creative|9', label: '' }] }).ok).toBe(false)
    expect(parseNewExperiment({ ...base, variable: 'bid' }).ok).toBe(false)
  })
  it('parses dollars', () => {
    expect(parseMinSpendDollars('$25.50')).toEqual({ ok: true, value: 2550 })
    expect(parseMinSpendDollars('0').ok).toBe(false)
  })
})

describe('migration 133', () => {
  it('classifies as additive-only (auto) for the migration-dry-run lane', () => {
    const sql = readFileSync(join(process.cwd(), 'db/migrations/133_ad_experiments.sql'), 'utf8')
    const result = classifyFile(sql)
    expect(result.verdict).toBe('auto')
    expect(result.statements.length).toBe(2)
  })
})
