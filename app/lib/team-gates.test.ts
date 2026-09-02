/**
 * Pure-function coverage for the model-output parsers behind ticket #6916's
 * voice-gate and publish-gate HTTP endpoints. These parsers are the
 * fail-closed boundary between a model's free-text response and a verdict
 * `POST /api/team/social-post` will act on, so an unparseable or malformed
 * response must never read as a PASS.
 */
import { describe, expect, it } from 'vitest'
import { parsePublishGateModelOutput, parseVoiceGateModelOutput } from './team-gates.server'

describe('parseVoiceGateModelOutput', () => {
  it('parses a clean PASS', () => {
    const out = parseVoiceGateModelOutput('{"verdict":"PASS","notes":"Clean register-9 caption, no hard-rule hits."}')
    expect(out).toEqual({ verdict: 'PASS', notes: 'Clean register-9 caption, no hard-rule hits.' })
  })

  it('tolerates a ```json fence around the object', () => {
    const raw = '```json\n{"verdict":"REVISE","notes":"Closes on a number."}\n```'
    expect(parseVoiceGateModelOutput(raw)).toEqual({ verdict: 'REVISE', notes: 'Closes on a number.' })
  })

  it('uppercases a lowercase verdict', () => {
    expect(parseVoiceGateModelOutput('{"verdict":"block","notes":"Em-dash present."}').verdict).toBe('BLOCK')
  })

  it('fails closed to BLOCK on unparseable output', () => {
    const out = parseVoiceGateModelOutput('Sorry, I cannot help with that request.')
    expect(out.verdict).toBe('BLOCK')
    expect(out.notes).toContain('could not parse a verdict')
  })

  it('fails closed to BLOCK when verdict is missing from otherwise-valid JSON', () => {
    const out = parseVoiceGateModelOutput('{"notes":"looks fine"}')
    expect(out.verdict).toBe('BLOCK')
  })

  it('fails closed to BLOCK on an invalid verdict value', () => {
    expect(parseVoiceGateModelOutput('{"verdict":"MAYBE","notes":"unsure"}').verdict).toBe('BLOCK')
  })

  it('substitutes a placeholder when notes is missing', () => {
    expect(parseVoiceGateModelOutput('{"verdict":"PASS"}').notes).toBe('(no notes returned)')
  })
})

describe('parsePublishGateModelOutput', () => {
  it('parses a PASS with findings', () => {
    const raw = JSON.stringify({
      verdict: 'PASS',
      notes: 'Image matches the caption, proportion reads correctly, no baked-in text.',
      findings: [{ check: 'withholding-test', verdict: 'pass', note: 'Withholds the next move, not the body.' }],
    })
    const out = parsePublishGateModelOutput(raw)
    expect(out.verdict).toBe('PASS')
    expect(out.findings).toEqual([{ check: 'withholding-test', verdict: 'pass', note: 'Withholds the next move, not the body.' }])
  })

  it('normalizes HOLD-FOR-OWNER-style verdicts are rejected, not silently accepted', () => {
    // The model is instructed to return exactly HOLD; a wrapped or hyphenated
    // variant it might still emit should not parse as one of the four valid
    // verdicts, and must fail closed to BLOCK rather than passing through.
    const out = parsePublishGateModelOutput('{"verdict":"HOLD-FOR-OWNER","notes":"needs a human"}')
    expect(out.verdict).toBe('BLOCK')
  })

  it('fails closed to BLOCK on unparseable output', () => {
    const out = parsePublishGateModelOutput('not json at all')
    expect(out.verdict).toBe('BLOCK')
    expect(out.findings).toEqual([])
  })

  it('drops a finding with no check name rather than throwing', () => {
    const raw = JSON.stringify({ verdict: 'REVISE', notes: 'One real issue.', findings: [{ note: 'no check field' }, { check: 'too-tame', verdict: 'revise' }] })
    const out = parsePublishGateModelOutput(raw)
    expect(out.findings).toEqual([{ check: 'too-tame', verdict: 'revise' }])
  })

  it('normalizes an unrecognized finding verdict to pass rather than throwing', () => {
    const raw = JSON.stringify({ verdict: 'PASS', notes: 'fine', findings: [{ check: 'x', verdict: 'whatever' }] })
    expect(parsePublishGateModelOutput(raw).findings).toEqual([{ check: 'x', verdict: 'pass' }])
  })
})
