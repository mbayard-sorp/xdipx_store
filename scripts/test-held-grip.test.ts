import { describe, it, expect } from 'vitest'
import { summarizeAttempts, type AttemptResult } from './test-held-grip'

function attempt(over: Partial<AttemptResult> & Pick<AttemptResult, 'attempt'>): AttemptResult {
  return { survived: true, assetId: over.attempt, url: `https://cdn.example.com/${over.attempt}.jpg`, productPhysics: 'supported', ...over }
}

describe('summarizeAttempts (ticket #11925)', () => {
  it('reports a perfect pass rate when every attempt survives supported', () => {
    const results = [attempt({ attempt: 1 }), attempt({ attempt: 2 }), attempt({ attempt: 3 })]
    const summary = summarizeAttempts(results)
    expect(summary).toEqual({
      attempts: 3, survived: 3, supported: 3, unsupported: 0, notApplicable: 0, incomplete: 0, passRate: 1,
    })
  })

  it('counts an unsupported grip as survived but not passing', () => {
    const results = [
      attempt({ attempt: 1, productPhysics: 'unsupported' }),
      attempt({ attempt: 2 }),
    ]
    const summary = summarizeAttempts(results)
    expect(summary.survived).toBe(2)
    expect(summary.unsupported).toBe(1)
    expect(summary.supported).toBe(1)
    expect(summary.passRate).toBe(0.5)
  })

  it('does not count a dropped (non-surviving) attempt toward supported, unsupported, or incomplete', () => {
    const results = [
      attempt({ attempt: 1, survived: false, assetId: null, url: null, productPhysics: null, dropReason: 'vision_gate_reject' }),
      attempt({ attempt: 2 }),
    ]
    const summary = summarizeAttempts(results)
    expect(summary.attempts).toBe(2)
    expect(summary.survived).toBe(1)
    expect(summary.incomplete).toBe(0)
    expect(summary.passRate).toBe(0.5)
  })

  it('counts a surviving candidate with no productPhysics read as incomplete, not unsupported', () => {
    const results = [attempt({ attempt: 1, productPhysics: null })]
    const summary = summarizeAttempts(results)
    expect(summary.incomplete).toBe(1)
    expect(summary.unsupported).toBe(0)
    expect(summary.supported).toBe(0)
    expect(summary.passRate).toBe(0)
  })

  it('does not count not_applicable as a pass or a fail', () => {
    const results = [attempt({ attempt: 1, productPhysics: 'not_applicable' })]
    const summary = summarizeAttempts(results)
    expect(summary.notApplicable).toBe(1)
    expect(summary.supported).toBe(0)
    expect(summary.passRate).toBe(0)
  })

  it('reports a zero pass rate when nothing survived, not a divide-by-zero', () => {
    const results = [
      attempt({ attempt: 1, survived: false, assetId: null, url: null, productPhysics: null }),
      attempt({ attempt: 2, survived: false, assetId: null, url: null, productPhysics: null }),
    ]
    const summary = summarizeAttempts(results)
    expect(summary.survived).toBe(0)
    expect(summary.passRate).toBe(0)
  })

  it('reports all zeros for an empty attempt list', () => {
    const summary = summarizeAttempts([])
    expect(summary).toEqual({
      attempts: 0, survived: 0, supported: 0, unsupported: 0, notApplicable: 0, incomplete: 0, passRate: 0,
    })
  })

  it('pass rate is against total attempts, not only survivors (a low survival rate is not masked)', () => {
    const results = [
      attempt({ attempt: 1, productPhysics: 'supported' }),
      attempt({ attempt: 2, survived: false, assetId: null, url: null, productPhysics: null, dropReason: 'vision_gate_reject' }),
      attempt({ attempt: 3, survived: false, assetId: null, url: null, productPhysics: null, dropReason: 'vision_gate_reject' }),
      attempt({ attempt: 4, survived: false, assetId: null, url: null, productPhysics: null, dropReason: 'vision_gate_reject' }),
    ]
    const summary = summarizeAttempts(results)
    // 1 supported out of 4 total attempts, not 1 out of 1 survivor.
    expect(summary.passRate).toBe(0.25)
  })
})
