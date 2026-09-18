import { describe, expect, it } from 'vitest'
import {
  matchCommaAntithesis,
  matchCrossSentenceAntithesis,
  analyzeDraft,
  analyzeParagraphs,
  ANTITHESIS_CAPS,
} from './antithesis-cap'

function block(style: string, text: string) {
  return { _type: 'block', style, children: [{ _type: 'span', text }] }
}

describe('matchCommaAntithesis — strong hits', () => {
  it('flags the charter\'s own example', () => {
    const c = matchCommaAntithesis("It's a change, not a loss.")
    expect(c?.strength).toBe('strong')
    expect(c?.match).toBe('not a loss')
  })

  it('flags a mid-sentence comma antithesis', () => {
    expect(matchCommaAntithesis('This is a routine, not a ritual, and it should stay that way.')?.strength).toBe(
      'strong',
    )
  })

  it('does not flag "not only ... but also ..." (an addition, not a contrast)', () => {
    expect(matchCommaAntithesis('It works well, not only for beginners but also for couples.')).toBeNull()
  })

  it('does not flag a sentence with no comma', () => {
    expect(matchCommaAntithesis('It does not lower the threshold.')).toBeNull()
  })

  it('does not flag an ordinary comma with no "not"', () => {
    expect(matchCommaAntithesis('It is quiet, discreet, and easy to clean.')).toBeNull()
  })
})

describe('matchCommaAntithesis — rather than / instead of are a different family', () => {
  it('does not flag "rather than"', () => {
    expect(matchCommaAntithesis('The fix is usually a change in frequency, rather than a jump in intensity.')).toBeNull()
  })

  it('does not flag "instead of"', () => {
    expect(matchCommaAntithesis('Reach for a lower setting, instead of the highest one.')).toBeNull()
  })
})

describe('matchCrossSentenceAntithesis — borderline hits', () => {
  it('flags the charter\'s own two-sentence example', () => {
    const c = matchCrossSentenceAntithesis('It does not lower the threshold.', 'It meets it.')
    expect(c?.strength).toBe('borderline')
  })

  it('does not flag when the second sentence also negates', () => {
    expect(matchCrossSentenceAntithesis('It does not lower the threshold.', 'It does not raise it either.')).toBeNull()
  })

  it('does not flag when the second sentence is long (not a tight contrasting beat)', () => {
    expect(
      matchCrossSentenceAntithesis(
        'It does not lower the threshold.',
        'It happens to be one of the quieter options in this particular category of motors.',
      ),
    ).toBeNull()
  })

  it('does not flag a first sentence with no negation', () => {
    expect(matchCrossSentenceAntithesis('It lowers the threshold.', 'It meets it.')).toBeNull()
  })
})

describe('analyzeParagraphs — caps', () => {
  it('is clean within caps', () => {
    const report = analyzeParagraphs([{ section: 'Getting started', text: "It's a change, not a loss." }])
    expect(report.overCap).toBe(false)
    expect(report.totalPost).toBe(1)
  })

  it('flags more than three strong hits per post', () => {
    const report = analyzeParagraphs([
      { section: 'S1', text: 'A wand is a choice, not a compromise.' },
      { section: 'S2', text: 'This is a step, not a leap.' },
      { section: 'S3', text: 'It is a fit, not a fluke.' },
      { section: 'S4', text: 'It is a habit, not a hassle.' },
    ])
    expect(report.totalPost).toBe(4)
    expect(report.violations.some(v => new RegExp(`cap ${ANTITHESIS_CAPS.perPost}`).test(v))).toBe(true)
  })

  it('flags more than one heading hit', () => {
    const report = analyzeParagraphs([
      { section: 'A', text: 'A fantasy is not a request.', isHeading: true },
      { section: 'B', text: 'The pause is not the verdict.', isHeading: true },
    ])
    // Neither sentence has a comma before "not", so restate with the comma shape.
    const withCommas = analyzeParagraphs([
      { section: 'A', text: 'A fantasy is a wish, not a request.', isHeading: true },
      { section: 'B', text: 'The pause is a beat, not the verdict.', isHeading: true },
    ])
    expect(report.headingHits).toBe(0)
    expect(withCommas.headingHits).toBe(2)
    expect(withCommas.overCap).toBe(true)
    expect(withCommas.violations.some(v => /on a heading/i.test(v))).toBe(true)
  })

  it('does not count borderline candidates toward the caps', () => {
    const report = analyzeParagraphs([{ section: 'A', text: 'It does not lower the threshold. It meets it.' }])
    expect(report.totalPost).toBe(0)
    expect(report.borderline.length).toBe(1)
    expect(report.overCap).toBe(false)
  })

  it('separates heading hits from body hits', () => {
    const report = analyzeParagraphs([
      { section: 'A', text: 'A fantasy is a wish, not a request.', isHeading: true },
      { section: 'A', text: 'This is a routine, not a ritual.' },
    ])
    expect(report.headingHits).toBe(1)
    expect(report.bodyHits).toBe(1)
    expect(report.totalPost).toBe(2)
  })
})

describe('analyzeDraft — portable text structure, including the FAQ block', () => {
  it('counts a heading hit and a body hit under it', () => {
    const report = analyzeDraft({
      title: 'A calm guide',
      excerpt: 'A plain, useful intro that states its answer first.',
      body: [
        block('h2', 'A fantasy is a wish, not a request'),
        block('normal', 'This is a routine, not a ritual, and that is fine.'),
      ],
    })
    expect(report.headingHits).toBe(1)
    expect(report.bodyHits).toBe(1)
    expect(report.totalPost).toBe(2)
  })

  it('counts hits inside an FAQ block the same as any other section', () => {
    const report = analyzeDraft({
      body: [
        block('h2', 'FAQ'),
        block('h2', 'Is this loud'),
        block('normal', 'It is a hum, not a buzz.'),
      ],
    })
    expect(report.totalPost).toBe(1)
    expect(report.hits[0]?.section).toBe('Is this loud')
  })

  it('ignores non-block nodes (embeds, images)', () => {
    const report = analyzeDraft({
      body: [
        { _type: 'blogProductEmbed', productHandle: 'magic-wand' },
        block('normal', 'A wand is a broad, rumbly option.'),
      ],
    })
    expect(report.totalPost).toBe(0)
    expect(report.overCap).toBe(false)
  })
})
