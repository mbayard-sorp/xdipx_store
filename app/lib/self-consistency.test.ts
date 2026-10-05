import { describe, expect, it } from 'vitest'
import { analyzeDraft, analyzeParagraphs } from './self-consistency'

function block(style: string, text: string) {
  return { _type: 'block', style, children: [{ _type: 'span', text }] }
}

describe('ingress codes: undefined-token', () => {
  it('flags a code instructed on but never defined anywhere in the document', () => {
    const report = analyzeParagraphs([
      {
        section: 'Care',
        text: 'Keep the IP67 model dry near the sink, but a quick rinse under a running tap is fine.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'undefined-token')
    expect(hit).toBeDefined()
    expect(hit?.token).toBe('IP67')
  })

  it('does not flag a code the document defines', () => {
    const report = analyzeParagraphs([
      {
        section: 'Care',
        text: 'An IPX4 rating means the toy only resists light splashes, nothing more.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'undefined-token')).toBe(false)
  })
})

describe('ingress codes: conflicting-instruction (run 1239, defect #4 shape)', () => {
  // Run 1239: the Starlet 3 paragraph credited IPX7 with covering a shower
  // while the post's own IPX7 paragraph said immersion does not imply a jet
  // rating. Both sentences name the token explicitly here, which is the
  // reusable-token shape this checker is scoped to.
  it('flags the general rule disagreeing with the product-specific claim', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: 'An IPX7 rating covers immersion, but immersion does not imply a jet rating.',
      },
      {
        section: 'Starlet 3',
        text: "The Starlet 3's IPX7 rating means you can use it right in the shower.",
      },
    ])
    const hit = report.findings.find(f => f.kind === 'conflicting-instruction')
    expect(hit).toBeDefined()
    expect(hit?.token).toBe('IPX7')
    expect(hit?.sites).toHaveLength(2)
    // Defined in both sentences ("covers" / "means"), so this is not also
    // flagged as undefined.
    expect(report.findings.some(f => f.kind === 'undefined-token')).toBe(false)
  })
})

describe('ingress codes: conflicting-instruction (run 1239, defect #1 shape)', () => {
  // Run 1239: the wash instruction said soap and warm water into every
  // crevice while the same post had just told an IPX4 reader not to put the
  // toy under a running tap. Represented here with the token named in both
  // sentences (the real post's wash instruction did not name the rating
  // directly, which is exactly why this checker's reusable-token design can't
  // catch that exact phrasing — see the module header).
  it('flags a later wash instruction contradicting the earlier restriction', () => {
    const report = analyzeParagraphs([
      {
        section: 'Water ratings',
        text: 'An IPX4 rating means the toy only resists light splashes, so never put it under a running tap.',
      },
      {
        section: 'Cleaning',
        text: 'When you clean an IPX4 toy, wash it with soap and warm water right under a running tap, working it into every crevice.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'conflicting-instruction')
    expect(hit).toBeDefined()
    expect(hit?.token).toBe('IPX4')
  })
})

describe('numbered enumerations: count-mismatch across sites (run 327 / run 626 shape)', () => {
  // Run 327: a body/FAQ enumeration split. Run 626: a fever-severity tier
  // change to the body red-flag list left the FAQ's copy of the same
  // enumeration unchanged. Both are represented here as the same shape this
  // checker can decide mechanically: the SAME named enumeration promised with
  // two different counts at two different sites.
  it('flags the body and the FAQ promising different counts for the same enumeration', () => {
    const report = analyzeParagraphs([
      {
        section: 'What to watch for',
        text: 'There are four red flags that mean stop and call a clinician.',
      },
      {
        section: 'FAQ',
        text: 'The three red flags to watch for are fever, spreading redness, and swelling.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'count-mismatch' && f.token === 'red flag')
    expect(hit).toBeDefined()
    expect(hit?.sites).toHaveLength(2)
  })

  it('does not flag two sites that agree on the count', () => {
    const report = analyzeParagraphs([
      { section: 'Body', text: 'There are three red flags that mean stop and call a clinician.' },
      { section: 'FAQ', text: 'The three red flags to watch for are fever, redness, and swelling.' },
    ])
    expect(report.findings.some(f => f.kind === 'count-mismatch' && f.token === 'red flag')).toBe(false)
  })
})

describe('numbered enumerations: count-mismatch inline (own list disagrees with its own number)', () => {
  it('flags a promise whose own inline list does not match the stated count', () => {
    const report = analyzeParagraphs([
      {
        section: 'Pre-flight',
        text: 'Run four checks before you submit: the hero loads, the FAQ renders, and the CTA resolves.',
      },
    ])
    const hit = report.findings.find(f => f.kind === 'count-mismatch' && f.token === 'check')
    expect(hit).toBeDefined()
    expect(hit?.message).toContain('4')
    expect(hit?.message).toContain('3')
  })

  it('does not flag a promise whose inline list matches the stated count', () => {
    const report = analyzeParagraphs([
      {
        section: 'Pre-flight',
        text: 'Run three checks before you submit: the hero loads, the FAQ renders, and the CTA resolves.',
      },
    ])
    expect(report.findings.some(f => f.kind === 'count-mismatch')).toBe(false)
  })
})

describe('analyzeDraft — portable text structure, including the FAQ block', () => {
  it('counts a cross-site mismatch when one site lands only in the FAQ block', () => {
    const report = analyzeDraft({
      title: 'A calm guide to water ratings',
      excerpt: 'A plain, useful intro that states its answer first.',
      body: [
        block('h2', 'Reading the rating'),
        block('normal', 'There are four red flags that mean stop and call a clinician.'),
        block('h2', 'FAQ'),
        block('h2', 'Which symptoms mean I should stop?'),
        block('normal', 'The three red flags to watch for are fever, spreading redness, and swelling.'),
      ],
    })
    const hit = report.findings.find(f => f.kind === 'count-mismatch' && f.token === 'red flag')
    expect(hit).toBeDefined()
    expect(hit?.sites.some(s => s.section === 'Which symptoms mean I should stop?')).toBe(true)
  })

  it('ignores non-block nodes (embeds, images)', () => {
    const report = analyzeDraft({
      body: [
        { _type: 'blogProductEmbed', productHandle: 'magic-wand' },
        block('normal', 'An ordinary sentence with no ingress code or enumeration promise.'),
      ],
    })
    expect(report.findings).toHaveLength(0)
    expect(report.overLimit).toBe(false)
  })
})
