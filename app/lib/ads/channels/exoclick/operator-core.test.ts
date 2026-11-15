import { describe, expect, it } from 'vitest'
import {
  classifyExoVerb, evaluateExoGate, normalizeHostname, parseExoBool, parseExoCapCents, projectTotalSpendCents, chunk,
  type ExoCampaignMoney,
} from './operator-core'

const camp = (over: Partial<ExoCampaignMoney> = {}): ExoCampaignMoney => ({
  id: '1', status: 'ACTIVE', dailyBudgetCents: 2000, totalBudgetCents: 3000, spentCents: 1000, ...over,
})

describe('settings parsing', () => {
  it('reads a missing row as off and as a zero cap', () => {
    expect(parseExoBool(null)).toBe(false)
    expect(parseExoBool(undefined)).toBe(false)
    expect(parseExoCapCents(null)).toBe(0)
    expect(parseExoCapCents('')).toBe(0)
  })

  it('reads on values and positive caps, and treats junk as off or zero', () => {
    for (const v of ['true', 'TRUE', '1', 'on']) expect(parseExoBool(v)).toBe(true)
    for (const v of ['false', '0', 'off', 'yes', 'x']) expect(parseExoBool(v)).toBe(false)
    expect(parseExoCapCents('13500')).toBe(13500)
    expect(parseExoCapCents('-5')).toBe(0)
    expect(parseExoCapCents('abc')).toBe(0)
  })
})

describe('classifyExoVerb', () => {
  it('pause and block_placement are brakes', () => {
    expect(classifyExoVerb('pause', null, null)).toBe('brake')
    expect(classifyExoVerb('block_placement', { hostnames: ['a.com'] }, null)).toBe('brake')
  })

  it('resume, upload and create are gas', () => {
    expect(classifyExoVerb('resume', null, null)).toBe('gas')
    expect(classifyExoVerb('update_creative', {}, null)).toBe('gas')
    expect(classifyExoVerb('create_paused', null, null)).toBe('gas')
  })

  it('a budget change is a brake only when it goes down', () => {
    expect(classifyExoVerb('set_budget', { dailyBudgetCents: 2000 }, 5000)).toBe('brake')
    expect(classifyExoVerb('set_budget', { dailyBudgetCents: 5000 }, 5000)).toBe('gas')
    expect(classifyExoVerb('set_budget', { dailyBudgetCents: 6000 }, 5000)).toBe('gas')
    expect(classifyExoVerb('set_budget', { dailyBudgetCents: 2000 }, null)).toBe('gas')
    expect(classifyExoVerb('set_budget', {}, 5000)).toBe('gas')
  })
})

describe('evaluateExoGate', () => {
  const on = { operatorEnabled: true, totalCapCents: 13500 }

  it('holds everything while the switch is off, brakes included', () => {
    expect(evaluateExoGate({ kind: 'brake', settings: { operatorEnabled: false, totalCapCents: 99999 }, projectedTotalCents: null }))
      .toMatchObject({ allowed: false, code: 'not_enabled' })
    expect(evaluateExoGate({ kind: 'gas', settings: { operatorEnabled: false, totalCapCents: 99999 }, projectedTotalCents: 1 }))
      .toMatchObject({ allowed: false, code: 'not_enabled' })
  })

  it('lets a brake through with the switch on whatever the cap says', () => {
    expect(evaluateExoGate({ kind: 'brake', settings: { operatorEnabled: true, totalCapCents: 0 }, projectedTotalCents: null }).allowed).toBe(true)
  })

  it('refuses all gas at a zero cap, even a zero-cost one', () => {
    expect(evaluateExoGate({ kind: 'gas', settings: { operatorEnabled: true, totalCapCents: 0 }, projectedTotalCents: 0 }))
      .toMatchObject({ allowed: false, code: 'cap_not_set' })
  })

  it('allows gas at or under the cap and refuses over it', () => {
    expect(evaluateExoGate({ kind: 'gas', settings: on, projectedTotalCents: 13500 }).allowed).toBe(true)
    expect(evaluateExoGate({ kind: 'gas', settings: on, projectedTotalCents: 13501 })).toMatchObject({ allowed: false, code: 'over_cap' })
  })

  it('refuses gas it could not project', () => {
    expect(evaluateExoGate({ kind: 'gas', settings: on, projectedTotalCents: null })).toMatchObject({ allowed: false, code: 'over_cap' })
  })
})

describe('projectTotalSpendCents', () => {
  it('adds spent to what running campaigns can still spend', () => {
    // spent 1000 + remaining total budget 2000 on the one active campaign.
    expect(projectTotalSpendCents([camp()])).toBe(3000)
  })

  it('counts a paused campaign for what it spent only', () => {
    expect(projectTotalSpendCents([camp({ status: 'PAUSED' })])).toBe(1000)
  })

  it('uses one day of the daily budget when there is no total budget', () => {
    expect(projectTotalSpendCents([camp({ totalBudgetCents: null })])).toBe(1000 + 2000)
  })

  it('resuming a paused campaign adds its remaining commitment once', () => {
    const paused = camp({ status: 'PAUSED' })
    expect(projectTotalSpendCents([paused], { campaign: paused })).toBe(1000 + 2000)
  })

  it('a new campaign adds its own budget on top', () => {
    const fresh = camp({ id: 'new', spentCents: 0, totalBudgetCents: null, dailyBudgetCents: 2500 })
    expect(projectTotalSpendCents([camp({ status: 'PAUSED' })], { campaign: fresh })).toBe(1000 + 2500)
  })

  it('a raise on a running campaign is not counted twice', () => {
    const raised = camp({ totalBudgetCents: null, dailyBudgetCents: 4000 })
    expect(projectTotalSpendCents([camp({ totalBudgetCents: null })], { campaign: raised })).toBe(1000 + 4000)
  })
})

describe('normalizeHostname', () => {
  it('accepts plain hostnames, lower-cased', () => {
    expect(normalizeHostname('Rat.XXX')).toBe('rat.xxx')
    expect(normalizeHostname(' m.youjizz.com ')).toBe('m.youjizz.com')
  })

  it('rejects anything that is not a bare hostname', () => {
    for (const bad of ['', 'localhost', 'http://a.com', 'a.com/path', 'a.com?x=1', 'a b.com', '-a.com', 'a..com', 42, null, undefined, '*.a.com']) {
      expect(normalizeHostname(bad)).toBeNull()
    }
  })
})

describe('chunk', () => {
  it('splits into parts of at most size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })
})
