import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyFile } from '../migration-classify.server'
import {
  AD_ACTION_STATUSES,
  IllegalAdActionTransitionError,
  LEGAL_TRANSITIONS,
  assertLegalTransition,
  buildIdempotencyKey,
  canonicalJson,
  isLegalTransition,
  isTerminalStatus,
  type AdActionStatus,
} from './ledger-core'

const base = {
  platform: 'meta',
  level: 'adset',
  externalId: '120200000000001',
  verb: 'set_budget' as const,
  day: '2026-10-19',
}

describe('buildIdempotencyKey', () => {
  it('is the verb, a colon and 48 hex chars', () => {
    const key = buildIdempotencyKey({ ...base, params: { dailyBudgetCents: 2000 } })
    expect(key).toMatch(/^set_budget:[0-9a-f]{48}$/)
  })

  it('is stable across params key order, at every depth', () => {
    const a = buildIdempotencyKey({ ...base, params: { a: 1, b: { x: 1, y: [1, 2] } } })
    const b = buildIdempotencyKey({ ...base, params: { b: { y: [1, 2], x: 1 }, a: 1 } })
    expect(a).toBe(b)
  })

  it('is stable across input key order and repeat calls', () => {
    const a = buildIdempotencyKey({ ...base, params: { p: 1 } })
    const b = buildIdempotencyKey({
      params: { p: 1 }, day: base.day, verb: base.verb, externalId: base.externalId,
      level: base.level, platform: base.platform,
    })
    expect(a).toBe(b)
    expect(buildIdempotencyKey({ ...base, params: { p: 1 } })).toBe(a)
  })

  it('changes when any param value changes', () => {
    const a = buildIdempotencyKey({ ...base, params: { dailyBudgetCents: 2000 } })
    expect(buildIdempotencyKey({ ...base, params: { dailyBudgetCents: 2001 } })).not.toBe(a)
    expect(buildIdempotencyKey({ ...base, params: { dailyBudgetCents: '2000' } })).not.toBe(a)
    expect(buildIdempotencyKey({ ...base, params: { dailyBudgetCents: 2000, x: true } })).not.toBe(a)
    expect(buildIdempotencyKey({ ...base })).not.toBe(a)
  })

  it('keeps array order significant', () => {
    expect(buildIdempotencyKey({ ...base, params: { ids: [1, 2] } }))
      .not.toBe(buildIdempotencyKey({ ...base, params: { ids: [2, 1] } }))
  })

  it('treats missing, undefined and null params alike', () => {
    const none = buildIdempotencyKey({ ...base })
    expect(buildIdempotencyKey({ ...base, params: undefined })).toBe(none)
    expect(buildIdempotencyKey({ ...base, params: null })).toBe(none)
  })

  it('changes with platform, level, target, verb and day', () => {
    const a = buildIdempotencyKey(base)
    expect(buildIdempotencyKey({ ...base, platform: 'microsoft' })).not.toBe(a)
    expect(buildIdempotencyKey({ ...base, level: 'campaign' })).not.toBe(a)
    expect(buildIdempotencyKey({ ...base, externalId: '120200000000002' })).not.toBe(a)
    expect(buildIdempotencyKey({ ...base, day: '2026-10-20' })).not.toBe(a)
    const pause = buildIdempotencyKey({ ...base, verb: 'pause' })
    expect(pause).toMatch(/^pause:/)
    expect(pause.slice(6)).not.toBe(a.slice(11))
  })

  it('refuses a bad day or verb', () => {
    expect(() => buildIdempotencyKey({ ...base, day: '2026-10-19T00:00:00Z' })).toThrow(/YYYY-MM-DD/)
    expect(() => buildIdempotencyKey({ ...base, verb: 'delete' as never })).toThrow(/verb/)
  })
})

describe('canonicalJson', () => {
  it('sorts keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: undefined, c: { z: 1, y: 2 } })).toBe('{"b":1,"c":{"y":2,"z":1}}')
  })
})

describe('status machine', () => {
  const legal: Array<[AdActionStatus, AdActionStatus]> = [
    ['proposed', 'approved'],
    ['proposed', 'rejected'],
    ['proposed', 'expired'],
    ['approved', 'applied'],
    ['approved', 'failed'],
    ['approved', 'expired'],
  ]

  it('table lists exactly the six legal moves', () => {
    const fromTable = Object.entries(LEGAL_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => `${from}->${to}`),
    )
    expect(fromTable.sort()).toEqual(legal.map(([f, t]) => `${f}->${t}`).sort())
  })

  for (const from of AD_ACTION_STATUSES) {
    for (const to of AD_ACTION_STATUSES) {
      const ok = legal.some(([f, t]) => f === from && t === to)
      it(`${from} -> ${to} is ${ok ? 'legal' : 'refused'}`, () => {
        expect(isLegalTransition(from, to)).toBe(ok)
        if (ok) {
          expect(() => assertLegalTransition(1, from, to)).not.toThrow()
        } else {
          let caught: unknown
          try {
            assertLegalTransition(7, from, to)
          } catch (e) {
            caught = e
          }
          expect(caught).toBeInstanceOf(IllegalAdActionTransitionError)
          const err = caught as IllegalAdActionTransitionError
          expect(err.code).toBe('illegal_transition')
          expect(err.actionId).toBe(7)
          expect(err.from).toBe(from)
          expect(err.to).toBe(to)
        }
      })
    }
  }

  it('dry_run, applied, failed, rejected and expired are terminal', () => {
    for (const s of ['dry_run', 'applied', 'failed', 'rejected', 'expired'] as const) {
      expect(isTerminalStatus(s)).toBe(true)
    }
    expect(isTerminalStatus('proposed')).toBe(false)
    expect(isTerminalStatus('approved')).toBe(false)
  })
})

describe('migration 130', () => {
  it('classifies as additive-only (auto) for the migration-dry-run lane', () => {
    const sql = readFileSync(join(process.cwd(), 'db/migrations/130_ad_actions.sql'), 'utf8')
    const result = classifyFile(sql)
    expect(result.reason).toBeUndefined()
    expect(result.verdict).toBe('auto')
    expect(result.statements).toHaveLength(3)
  })
})
