import { describe, expect, it } from 'vitest'
import { matchSentence, analyzeDraft, analyzeParagraphs } from './unsourced-frequency'

function block(style: string, text: string) {
  return { _type: 'block', style, children: [{ _type: 'span', text }] }
}

describe('matchSentence: the named regression strings (must flag)', () => {
  // The five run-269 v1 strings that drove the cycle-1 voice REVISE, plus the
  // run-196 v1 string that took a BLOCK. Each must be a candidate.
  const flagged: [string, string][] = [
    ['run-269 #1', 'What follows is usually one of three things.'],
    ['run-269 #2', 'Almost every article on this subject opens at the decibel level.'],
    ['run-269 #3', 'Most advice on this topic only ever reaches the sound.'],
    ['run-269 #4', 'Most people assume a trade they do not actually have to make.'],
    ['run-269 #5', 'That fear is why people keep buying the loud one.'],
    ['run-196', 'It happens when someone writes in to say a toy irritated them.'],
  ]
  for (const [name, sentence] of flagged) {
    it(`flags ${name}`, () => {
      expect(matchSentence(sentence)).not.toBeNull()
    })
  }
})

describe('matchSentence: legitimate neighbours (must NOT flag)', () => {
  // Every one of these is a real sentence from the published v2 of
  // when-vibration-feels-like-too-much-noise, or its exact shape. The whole
  // point of the subject test is that these pass.
  const passing: [string, string][] = [
    ['product-category "usually"', 'Pressing hard enough to silence it usually costs you the sensation you were there for.'],
    ['physics "usually not"', 'What travels through a wall is usually not the airborne sound, it is vibration that has gotten into the structure.'],
    ['category quantifier', 'As a category, small bullets run quietest and wands run loudest.'],
    ['second-person "keep you"', 'That fear will keep you buying the loud one and living with the vigilance.'],
    ['attributed finding', 'Sex educators describe it as one of the body’s external brakes.'],
    ['attributed reviewers', 'Which is the buzzy-versus-rumbly distinction reviewers draw between bullets and wands.'],
    ['people + non-frequency verb', 'We built the Notebook for the questions people would rather not ask out loud.'],
    ['anyone as object', 'It always sounds louder to you than to anyone past a closed door.'],
  ]
  for (const [name, sentence] of passing) {
    it(`passes ${name}`, () => {
      expect(matchSentence(sentence)).toBeNull()
    })
  }
})

describe('analyzeParagraphs', () => {
  it('reports every candidate and sets overLimit', () => {
    const report = analyzeParagraphs([
      { section: 'Intro', text: 'Most people assume a trade. This one is calm.' },
      { section: 'Body', text: 'People keep buying the loud one.' },
    ])
    expect(report.total).toBe(2)
    expect(report.overLimit).toBe(true)
  })

  it('is clean (overLimit false) when nothing matches', () => {
    const report = analyzeParagraphs([
      { section: 'Intro', text: 'A wand is a broad, rumbly option. Bullets sit at the quiet end.' },
    ])
    expect(report.total).toBe(0)
    expect(report.overLimit).toBe(false)
  })
})

describe('analyzeDraft: portable text structure', () => {
  it('scans title, excerpt, and body, attributing hits to their section', () => {
    const report = analyzeDraft({
      title: 'A calm guide',
      excerpt: 'Most people assume a trade they do not have to make.',
      body: [
        block('h2', 'The noise'),
        block('normal', 'A running motor pressed against a frame turns it into a soundboard.'),
        block('h2', 'The fear'),
        block('normal', 'That fear is why people keep buying the loud one.'),
      ],
    })
    expect(report.total).toBe(2)
    const sections = report.hits.map(h => h.section).sort()
    expect(sections).toEqual(['Excerpt', 'The fear'])
  })

  it('ignores non-block nodes (embeds, images)', () => {
    const report = analyzeDraft({
      body: [
        { _type: 'blogProductEmbed', productHandle: 'me-you-us-bullet' },
        block('normal', 'A smaller motor trades depth for focus.'),
      ],
    })
    expect(report.total).toBe(0)
    expect(report.overLimit).toBe(false)
  })
})
