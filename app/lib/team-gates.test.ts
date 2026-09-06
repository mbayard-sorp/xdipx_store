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

describe('publish-gate calibration (owner direction 2026-09-06)', () => {
  it('labels live precedents as PASSED-and-live calibration, never a BLOCK licence', async () => {
    const { describePrecedents } = await import('./team-gates.server')
    const block = describePrecedents(['a live caption', 'another'])
    expect(block).toContain('PASSED this gate and stayed live')
    expect(block).toContain('Not a licence for any BLOCK-class risk')
    expect(block).toContain('- a live caption')
    expect(describePrecedents([])).toContain('(none yet)')
  })

  it('carries the split close-call rule, the sale-attempt definition, and the section 3.2a ceiling', async () => {
    const { PUBLISH_GATE_SYSTEM, IMAGERY_CEILING_EXCERPT } = await import('./team-gates.server')
    expect(PUBLISH_GATE_SYSTEM).toContain('Close calls split by class')
    expect(PUBLISH_GATE_SYSTEM).toContain('a price, a discount, a promo code, or a shop CTA')
    expect(PUBLISH_GATE_SYSTEM).not.toContain('it is not close')
    expect(IMAGERY_CEILING_EXCERPT).toContain('Licensed at the ceiling')
    expect(IMAGERY_CEILING_EXCERPT).toContain('The ceiling stops here')
    expect(PUBLISH_GATE_SYSTEM).toContain(IMAGERY_CEILING_EXCERPT)
  })
})

describe('publish-gate baked-in-text vs product-identity (ticket #7890)', () => {
  it('never lets a glyph-free colour band trip the baked-in-text check on its own', async () => {
    const { PUBLISH_GATE_SYSTEM } = await import('./team-gates.server')
    expect(PUBLISH_GATE_SYSTEM).toContain(
      'A solid\n  colour band, stripe, or cap colour with no glyphs on it is the product\'s own packaging, never\n  baked-in text on its own',
    )
    expect(PUBLISH_GATE_SYSTEM).toContain('Compare silhouette,\n  proportion, cap type, and colour bands against the real packshot')
  })

  it('carries the worked example distinguishing a bare band from a lettered one', async () => {
    const { PUBLISH_GATE_SYSTEM } = await import('./team-gates.server')
    expect(PUBLISH_GATE_SYSTEM).toContain('a yellow band\n  with no letters on the Pjur bottle is identity (PASS)')
    expect(PUBLISH_GATE_SYSTEM).toContain('the same band with garbled letters on it is\n  text (BLOCK)')
  })
})
