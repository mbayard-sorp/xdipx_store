import { describe, it, expect } from 'vitest'
import {
  slotSignalCount,
  evaluateGateStall,
  readStallCount,
  GATE_STALL_LIMIT,
} from '../discovery-circuit-breaker'

// ─── slotSignalCount ──────────────────────────────────────────────────────────

describe('slotSignalCount', () => {
  it('counts zero for empty slots', () => {
    expect(slotSignalCount({})).toBe(0)
  })

  it('counts the four gate-relevant signals', () => {
    expect(
      slotSignalCount({
        category: 'vibrator',
        audience: 'for-her',
        mood: ['playful'],
        matters: ['Discreet'],
      }),
    ).toBe(4)
  })

  it('ignores empty arrays', () => {
    expect(slotSignalCount({ mood: [], matters: [] })).toBe(0)
  })

  it('does not count non-gate fields like priceMax or experience', () => {
    expect(slotSignalCount({ priceMax: 50, experience: 'curious' })).toBe(0)
  })
})

// ─── evaluateGateStall ────────────────────────────────────────────────────────

describe('evaluateGateStall', () => {
  it('resets when searchNow is already true', () => {
    const r = evaluateGateStall({
      priorStallCount: 5,
      priorSlots: {},
      mergedSlots: {},
      gate: 'MOOD',
      searchNow: true,
    })
    expect(r).toEqual({ stallCount: 0, circuitBroken: false })
  })

  it('resets when the gate has left the forcing set (READY)', () => {
    const r = evaluateGateStall({
      priorStallCount: 5,
      priorSlots: {},
      mergedSlots: {},
      gate: 'READY',
      searchNow: false,
    })
    expect(r).toEqual({ stallCount: 0, circuitBroken: false })
  })

  it('resets when a new discovery signal was added this turn', () => {
    const r = evaluateGateStall({
      priorStallCount: 1,
      priorSlots: { mood: ['playful'] },
      mergedSlots: { mood: ['playful'], audience: 'for-her' },
      gate: 'MATTERS',
      searchNow: false,
    })
    expect(r).toEqual({ stallCount: 0, circuitBroken: false })
  })

  it('increments when stuck at a forcing gate with no new signal', () => {
    const r = evaluateGateStall({
      priorStallCount: 0,
      priorSlots: {},
      mergedSlots: {},
      gate: 'MOOD',
      searchNow: false,
    })
    expect(r).toEqual({ stallCount: 1, circuitBroken: false })
  })

  it('trips the breaker on the second consecutive no-progress turn', () => {
    const r = evaluateGateStall({
      priorStallCount: 1,
      priorSlots: { category: 'vibrator' },
      mergedSlots: { category: 'vibrator' },
      gate: 'WHO',
      searchNow: false,
    })
    expect(r.stallCount).toBe(GATE_STALL_LIMIT)
    expect(r.circuitBroken).toBe(true)
  })

  it('simulates a stuck pill conversation ending in a trip within three turns', () => {
    // Turn 1: shopper names a mood → progress, no stall.
    let stall = 0
    let prior: Record<string, unknown> = {}
    const t1 = evaluateGateStall({
      priorStallCount: stall,
      priorSlots: prior,
      mergedSlots: { mood: ['playful'] },
      gate: 'WHO',
      searchNow: false,
    })
    expect(t1.circuitBroken).toBe(false)
    stall = t1.stallCount
    prior = { mood: ['playful'] }

    // Turn 2: taps a pill the extractor can't map → no new signal, stall 1.
    const t2 = evaluateGateStall({
      priorStallCount: stall,
      priorSlots: prior,
      mergedSlots: { mood: ['playful'] },
      gate: 'WHO',
      searchNow: false,
    })
    expect(t2).toEqual({ stallCount: 1, circuitBroken: false })
    stall = t2.stallCount

    // Turn 3: still nothing new → stall 2 → breaker trips, caller searches.
    const t3 = evaluateGateStall({
      priorStallCount: stall,
      priorSlots: prior,
      mergedSlots: { mood: ['playful'] },
      gate: 'WHO',
      searchNow: false,
    })
    expect(t3.circuitBroken).toBe(true)
  })

  it('treats a malformed prior stall count as zero', () => {
    const r = evaluateGateStall({
      priorStallCount: Number.NaN,
      priorSlots: {},
      mergedSlots: {},
      gate: 'MOOD',
      searchNow: false,
    })
    expect(r.stallCount).toBe(1)
  })
})

// ─── readStallCount ───────────────────────────────────────────────────────────

describe('readStallCount', () => {
  it('reads a valid stall count from the blob', () => {
    expect(readStallCount({ gate: 'MOOD', slots: {}, stallCount: 2 })).toBe(2)
  })

  it('returns 0 for a blob with no stall count', () => {
    expect(readStallCount({ gate: 'MOOD', slots: {} })).toBe(0)
  })

  it('returns 0 for null / non-object / negative / non-finite', () => {
    expect(readStallCount(null)).toBe(0)
    expect(readStallCount(undefined)).toBe(0)
    expect(readStallCount('nope')).toBe(0)
    expect(readStallCount({ stallCount: -3 })).toBe(0)
    expect(readStallCount({ stallCount: Number.POSITIVE_INFINITY })).toBe(0)
  })

  it('floors a fractional stall count', () => {
    expect(readStallCount({ stallCount: 2.9 })).toBe(2)
  })
})
