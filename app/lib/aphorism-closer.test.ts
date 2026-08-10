import { describe, expect, it } from 'vitest'
import {
  matchSentence,
  splitSentences,
  analyzeDraft,
  analyzeParagraphs,
  APHORISM_CAPS,
} from './aphorism-closer'

function block(style: string, text: string) {
  return { _type: 'block', style, children: [{ _type: 'span', text }] }
}

describe('matchSentence — strong hits (recap-tag shape)', () => {
  it('flags "That is what ..."', () => {
    const c = matchSentence('That is what keeps the moment alive.')
    expect(c?.strength).toBe('strong')
    expect(c?.subject).toBe('That')
  })

  it('flags "This is why ..."', () => {
    expect(matchSentence('This is why the material matters.')?.strength).toBe('strong')
  })

  it('flags the "That\'s what ..." contraction', () => {
    expect(matchSentence("That's what most people reach for.")?.strength).toBe('strong')
  })

  it('flags "It is what ..." with a pronoun subject', () => {
    expect(matchSentence('It is what makes the difference.')?.strength).toBe('strong')
  })

  it('flags a tolerated adverb between subject and copula', () => {
    expect(matchSentence('That is really what everyone means.')?.strength).toBe('strong')
  })

  it('flags a leading coordinating conjunction', () => {
    expect(matchSentence('And that is why it works.')?.strength).toBe('strong')
  })
})

describe('matchSentence — charter non-hits (must NOT flag)', () => {
  // The three explicit non-hits from docs/emma-voice.md, all PASS.
  it('does not flag a concrete-noun subject (the charter PASS example)', () => {
    expect(matchSentence('The fix is usually a change in frequency rather than a jump in intensity.')).toBeNull()
  })

  it('does not flag the ticket\'s "Silicone is the practical default..." line (noun subject)', () => {
    // The ticket claims this matches the banned shape; under the binding
    // three-part test its subject is a concrete noun, so it is a PASS. The
    // subordinate "it is what" is not the sentence subject.
    expect(
      matchSentence('Silicone is the practical default, because it is what most good vibrators are made from.'),
    ).toBeNull()
  })

  it('does not flag a "Here is ..." topic sentence', () => {
    expect(matchSentence('Here is what you need to know.')).toBeNull()
  })

  it('does not flag a demonstrative used as a determiner (noun subject)', () => {
    expect(matchSentence('This product is quiet enough for shared walls.')).toBeNull()
  })

  it('does not flag a demonstrative subject with a predicate adjective', () => {
    expect(matchSentence('That is quiet.')).toBeNull()
  })

  it('returns borderline (not strong) for a bare predicate nominal', () => {
    const c = matchSentence('This is the practical default for most people.')
    expect(c?.strength).toBe('borderline')
  })
})

describe('splitSentences', () => {
  it('splits on sentence-final punctuation', () => {
    expect(splitSentences('One thing. Two things! Three?')).toEqual(['One thing.', 'Two things!', 'Three?'])
  })
  it('returns [] for empty input', () => {
    expect(splitSentences('   ')).toEqual([])
  })
})

describe('analyzeParagraphs — caps', () => {
  it('is clean within caps', () => {
    const report = analyzeParagraphs([
      { section: 'Getting started', text: 'This is what most people ask first. A wand is a broad, rumbly option.' },
    ])
    expect(report.overCap).toBe(false)
    expect(report.totalPost).toBe(1)
  })

  it('flags two strong hits in one paragraph (never two in a paragraph)', () => {
    const report = analyzeParagraphs([
      { section: 'A', text: 'That is what people mean. This is why it matters.' },
    ])
    expect(report.totalPost).toBe(2)
    expect(report.overCap).toBe(true)
    expect(report.violations.some(v => /never two in one paragraph/i.test(v))).toBe(true)
  })

  it('flags more than one per section across paragraphs', () => {
    const report = analyzeParagraphs([
      { section: 'Same section', text: 'That is what people mean.' },
      { section: 'Same section', text: 'This is why it matters.' },
    ])
    expect(report.perSection['Same section']).toBe(2)
    expect(report.overCap).toBe(true)
    expect(report.violations.some(v => /per section/i.test(v))).toBe(true)
  })

  it('flags more than three per post', () => {
    const report = analyzeParagraphs([
      { section: 'S1', text: 'That is what one means.' },
      { section: 'S2', text: 'This is why two matters.' },
      { section: 'S3', text: 'That is how three works.' },
      { section: 'S4', text: 'This is where four lands.' },
    ])
    expect(report.totalPost).toBe(4)
    expect(report.violations.some(v => new RegExp(`cap ${APHORISM_CAPS.perPost}`).test(v))).toBe(true)
  })

  it('does not count borderline candidates toward the caps', () => {
    const report = analyzeParagraphs([
      { section: 'A', text: 'This is the default. That is the alternative.' },
    ])
    expect(report.totalPost).toBe(0)
    expect(report.borderline.length).toBe(2)
    expect(report.overCap).toBe(false)
  })
})

describe('analyzeDraft — portable text structure', () => {
  it('splits sections on h2 and attributes hits to the current section', () => {
    const report = analyzeDraft({
      title: 'A calm guide',
      excerpt: 'A plain, useful intro that states its answer first.',
      body: [
        block('h2', 'How do I start'),
        block('normal', 'That is what beginners ask. This is why the answer helps.'),
        block('h2', 'What about noise'),
        block('normal', 'A wand hums at a low pitch.'),
      ],
    })
    // Two strong hits, both under "How do I start".
    expect(report.totalPost).toBe(2)
    expect(report.perSection['How do I start']).toBe(2)
    expect(report.overCap).toBe(true)
  })

  it('scans the title and excerpt as their own sections', () => {
    const report = analyzeDraft({
      title: 'This is what you came for',
      excerpt: 'A normal, answer-first excerpt.',
      body: [],
    })
    expect(report.perSection['Title']).toBe(1)
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
