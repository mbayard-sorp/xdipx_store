/**
 * Pure-function coverage for the model-output parsers behind ticket #6916's
 * voice-gate and publish-gate HTTP endpoints. These parsers are the
 * fail-closed boundary between a model's free-text response and a verdict
 * `POST /api/team/social-post` will act on, so an unparseable or malformed
 * response must never read as a PASS.
 */
import { describe, expect, it } from 'vitest'
import {
  computePublishGateContentHash,
  parsePublishGateModelOutput,
  parseVoiceGateModelOutput,
  verdictConsistencyCheck,
} from './team-gates.server'

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

describe('publish-gate register-too-tame stability (ticket #7896)', () => {
  it('pins a fixed, non-empty product-free register precedent set', async () => {
    const { PRODUCT_FREE_REGISTER_PRECEDENTS } = await import('./team-gates.server')
    expect(PRODUCT_FREE_REGISTER_PRECEDENTS.length).toBeGreaterThan(0)
    for (const p of PRODUCT_FREE_REGISTER_PRECEDENTS) {
      expect(typeof p.id).toBe('number')
      expect(p.text.length).toBeGreaterThan(0)
    }
  })

  it('describeRegisterPrecedents names the anchors as a fixed, call-stable set', async () => {
    const { describeRegisterPrecedents, PRODUCT_FREE_REGISTER_PRECEDENTS } = await import('./team-gates.server')
    const block = describeRegisterPrecedents()
    expect(block).toContain('fixed set, does not change between')
    for (const p of PRODUCT_FREE_REGISTER_PRECEDENTS) {
      expect(block).toContain(`#${p.id}`)
    }
  })

  it('the too-tame rule points a product-free register call at the pinned anchor set', async () => {
    const { PUBLISH_GATE_SYSTEM } = await import('./team-gates.server')
    expect(PUBLISH_GATE_SYSTEM).toContain('calibrate this call against the pinned')
    expect(PUBLISH_GATE_SYSTEM).toContain('product-free register precedents')
  })
})

describe('publish-gate feeling-first register anchors (ticket #8212)', () => {
  it('pins a fixed, non-empty feeling-first anchor set quoting the emma-voice #5862 exemplars', async () => {
    const { FEELING_FIRST_REGISTER_ANCHORS } = await import('./team-gates.server')
    expect(FEELING_FIRST_REGISTER_ANCHORS.length).toBeGreaterThan(0)
    for (const line of FEELING_FIRST_REGISTER_ANCHORS) {
      expect(typeof line).toBe('string')
      expect(line.length).toBeGreaterThan(0)
    }
    expect(FEELING_FIRST_REGISTER_ANCHORS).toContain(
      'Nobody is going to hand you permission. You get to just take it.',
    )
  })

  it('describeRegisterPrecedents includes both the category and feeling-first anchor groups', async () => {
    const { describeRegisterPrecedents, PRODUCT_FREE_REGISTER_PRECEDENTS, FEELING_FIRST_REGISTER_ANCHORS } =
      await import('./team-gates.server')
    const block = describeRegisterPrecedents()
    expect(block).toContain('Group A, "category"')
    expect(block).toContain('Group B, "feeling-first"')
    for (const p of PRODUCT_FREE_REGISTER_PRECEDENTS) {
      expect(block).toContain(`#${p.id}`)
    }
    for (const line of FEELING_FIRST_REGISTER_ANCHORS) {
      expect(block).toContain(line)
    }
  })

  it('the too-tame rule tells the gate the two shapes are equally licensed, not one imitating the other', async () => {
    const { PUBLISH_GATE_SYSTEM } = await import('./team-gates.server')
    expect(PUBLISH_GATE_SYSTEM).toContain('Two distinct, equally licensed shapes')
    expect(PUBLISH_GATE_SYSTEM).toContain('never require one\n  shape to imitate the other')
  })
})

describe('verdictConsistencyCheck (ticket #8060)', () => {
  it('flags a BLOCK verdict against an all-pass findings array (the row 207 incident)', () => {
    const out = verdictConsistencyCheck(
      'BLOCK',
      [{ check: 'withholding-test', verdict: 'pass' }, { check: 'age-ambiguity', verdict: 'pass' }],
      'Re-derived every check and each one clears. Final verdict: PASS.',
    )
    expect(out.consistent).toBe(false)
    expect(out.reason).toContain('findings array, which implies "PASS"')
  })

  it('flags a verdict that disagrees with an explicit "Final verdict:" conclusion even with no findings', () => {
    const out = verdictConsistencyCheck('REVISE', [], 'Everything checks out. Final verdict: PASS.')
    expect(out.consistent).toBe(false)
    expect(out.reason).toContain('notes\' own conclusion')
  })

  it('passes a BLOCK verdict that matches a blocking finding', () => {
    const out = verdictConsistencyCheck(
      'BLOCK',
      [{ check: 'age-ambiguity', verdict: 'block', note: 'ambiguous age' }],
      'One BLOCK-class finding on age ambiguity.',
    )
    expect(out.consistent).toBe(true)
  })

  it('passes a clean PASS with all-pass findings and no contradicting notes', () => {
    const out = verdictConsistencyCheck('PASS', [{ check: 'withholding-test', verdict: 'pass' }], 'Clears every check.')
    expect(out.consistent).toBe(true)
  })

  it('does not misfire on a REVISE verdict backed by a revise-only findings array', () => {
    const out = verdictConsistencyCheck(
      'REVISE',
      [{ check: 'too-tame', verdict: 'revise' }, { check: 'withholding-test', verdict: 'pass' }],
      'Register reads too tame against the live precedents.',
    )
    expect(out.consistent).toBe(true)
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

describe('computePublishGateContentHash (ticket #8452)', () => {
  const base = {
    platform: 'instagram' as const,
    tweetText: 'a caption about pjur aqua',
    mediaUrls: ['https://cdn.example/social-a.jpg'],
    altText: 'a bottle on a counter',
    productHandle: 'pjur-aqua',
  }

  it('is stable across repeated calls on identical input, the exact incident this closes', () => {
    // Run 786 (2026-09-09) gated row 215 twice minutes apart with no caption
    // or media change and got PASS then BLOCK. The hash must not be a source
    // of that: same input, same hash, every time.
    expect(computePublishGateContentHash(base)).toBe(computePublishGateContentHash({ ...base }))
  })

  it('changes when the caption changes (a genuine rework judges fresh)', () => {
    const h1 = computePublishGateContentHash(base)
    const h2 = computePublishGateContentHash({ ...base, tweetText: 'a different caption entirely' })
    expect(h1).not.toBe(h2)
  })

  it('changes when the media changes', () => {
    const h1 = computePublishGateContentHash(base)
    const h2 = computePublishGateContentHash({ ...base, mediaUrls: ['https://cdn.example/social-b.jpg'] })
    expect(h1).not.toBe(h2)
  })

  it('changes when alt text or the resolved product handle changes', () => {
    const h1 = computePublishGateContentHash(base)
    expect(h1).not.toBe(computePublishGateContentHash({ ...base, altText: 'different alt text' }))
    expect(h1).not.toBe(computePublishGateContentHash({ ...base, productHandle: 'some-other-handle' }))
  })

  it('treats null and missing mediaUrls/altText the same way (no accidental cache miss on that alone)', () => {
    const withNulls = computePublishGateContentHash({ ...base, mediaUrls: null, altText: null })
    const withUndefined = computePublishGateContentHash({ ...base, mediaUrls: undefined, altText: undefined })
    expect(withNulls).toBe(withUndefined)
  })

  it('is platform-sensitive: the same caption gated for a different platform is a different judgment', () => {
    const h1 = computePublishGateContentHash(base)
    const h2 = computePublishGateContentHash({ ...base, platform: 'x' })
    expect(h1).not.toBe(h2)
  })
})
