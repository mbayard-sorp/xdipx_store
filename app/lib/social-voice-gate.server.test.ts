// Fail-closed voice-gate verdict contract (ticket #3208).
//
// The cases below are the ones that matter at the draft-write boundary: the
// 2026-08-14 run that could not invoke the gate at all (which must now refuse to
// draft), a non-PASS verdict (which must not create a row), and a clean PASS from
// a named reviewer (the only shape that ships).
import { describe, it, expect } from 'vitest'
import { parseVoiceGateVerdict, VOICE_GATE_VERDICTS } from './social-voice-gate.server'

describe('parseVoiceGateVerdict', () => {
  it('refuses a draft when no verdict is supplied (gate unreachable)', () => {
    const r = parseVoiceGateVerdict(undefined)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toMatch(/voiceGate verdict required/i)
    }
  })

  it('refuses a null verdict', () => {
    expect(parseVoiceGateVerdict(null).ok).toBe(false)
  })

  it('rejects a non-object verdict', () => {
    expect(parseVoiceGateVerdict('PASS').ok).toBe(false)
    expect(parseVoiceGateVerdict(['PASS']).ok).toBe(false)
    expect(parseVoiceGateVerdict(42).ok).toBe(false)
  })

  it('rejects an unknown verdict value', () => {
    const r = parseVoiceGateVerdict({ verdict: 'APPROVED', reviewer: 'emma-empathy-reviewer' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/verdict must be one of/i)
  })

  it('rejects a missing or blank reviewer (no self-anonymous PASS)', () => {
    expect(parseVoiceGateVerdict({ verdict: 'PASS' }).ok).toBe(false)
    expect(parseVoiceGateVerdict({ verdict: 'PASS', reviewer: '   ' }).ok).toBe(false)
  })

  it('drops a BLOCK verdict without creating a draft', () => {
    const r = parseVoiceGateVerdict({ verdict: 'BLOCK', reviewer: 'emma-empathy-reviewer' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/BLOCK/)
  })

  it('drops a REVISE verdict (redraft before writing)', () => {
    const r = parseVoiceGateVerdict({ verdict: 'REVISE', reviewer: 'emma-empathy-reviewer' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/only a PASS/i)
  })

  it('accepts a clean PASS from a named reviewer', () => {
    const r = parseVoiceGateVerdict({
      verdict: 'PASS',
      reviewer: 'emma-empathy-reviewer',
      addendum: 'social',
      notes: 'plain nouns, fresh language, no lived experience',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.verdict.verdict).toBe('PASS')
      expect(r.verdict.reviewer).toBe('emma-empathy-reviewer')
      expect(r.verdict.addendum).toBe('social')
      expect(r.verdict.notes).toContain('fresh language')
    }
  })

  it('trims the reviewer and tolerates missing optional fields', () => {
    const r = parseVoiceGateVerdict({ verdict: 'PASS', reviewer: '  emma-empathy-reviewer  ' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.verdict.reviewer).toBe('emma-empathy-reviewer')
      expect(r.verdict.addendum).toBeUndefined()
      expect(r.verdict.notes).toBeUndefined()
    }
  })

  it('exposes exactly the three reviewer verdicts', () => {
    expect([...VOICE_GATE_VERDICTS]).toEqual(['PASS', 'REVISE', 'BLOCK'])
  })
})
