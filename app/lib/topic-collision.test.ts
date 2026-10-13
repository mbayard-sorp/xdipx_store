import { describe, it, expect } from 'vitest'
import {
  analyzeTopicCollision,
  extractH2Headings,
  extractProductEmbeds,
  jaccard,
  normalizeTokenSet,
  topicStemWords,
} from './topic-collision'

function block(style: string, text: string) {
  return { _type: 'block', style, children: [{ _type: 'span', text }] }
}
function embed(productHandle: string) {
  return { _type: 'blogProductEmbed', productHandle }
}

describe('normalizeTokenSet / jaccard', () => {
  it('strips stopwords and punctuation, lowercases', () => {
    expect(normalizeTokenSet('What About Numbing Products?')).toEqual(new Set(['numbing', 'products']))
  })

  it('is 0 for disjoint sets, 1 for identical sets', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['c', 'd']))).toBe(0)
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1)
  })

  it('is 0 when either set is empty, never NaN or divide-by-zero', () => {
    expect(jaccard(new Set(), new Set(['a']))).toBe(0)
    expect(jaccard(new Set(), new Set())).toBe(0)
  })
})

describe('extractH2Headings', () => {
  it('pulls only h2 blocks, not h1/h3/h4 or plain prose', () => {
    const body = [
      block('h1', 'Title-level heading'),
      block('h2', 'A Real H2'),
      block('h3', 'A Sub-sub-heading'),
      block('normal', 'Just prose.'),
    ]
    expect(extractH2Headings(body)).toEqual(['A Real H2'])
  })

  it('returns empty for a non-array body', () => {
    expect(extractH2Headings(undefined)).toEqual([])
    expect(extractH2Headings(null)).toEqual([])
  })
})

describe('extractProductEmbeds', () => {
  it('pulls productHandle from blogProductEmbed blocks, deduped, in order', () => {
    const body = [embed('product-a'), block('normal', 'text'), embed('product-b'), embed('product-a')]
    expect(extractProductEmbeds(body)).toEqual(['product-a', 'product-b'])
  })

  it('skips an embed block with no productHandle rather than counting an empty handle', () => {
    expect(extractProductEmbeds([{ _type: 'blogProductEmbed' }])).toEqual([])
  })
})

describe('topicStemWords', () => {
  it('derives content words from a slug, stripping stopwords and short tokens', () => {
    expect(topicStemWords('how-do-you-start-anal-play')).toEqual(
      expect.arrayContaining(['start', 'anal', 'play']),
    )
    expect(topicStemWords('how-do-you-start-anal-play')).not.toContain('how')
    expect(topicStemWords('how-do-you-start-anal-play')).not.toContain('do')
  })
})

describe('analyzeTopicCollision — the three evidenced incidents (#14988)', () => {
  it('flags the anal-play draft against does-anal-have-to-hurt (run 1397, row 17)', () => {
    // Candidate: content-plan row 17, "how-do-you-start-anal-play". Headings
    // reconstructed from the ticket's own description of the prior post's
    // coverage, reworded the way a second draft on the same beginner ground
    // plausibly would: same core nouns, different surrounding phrasing.
    const draft = {
      title: 'How Do You Start Anal Play?',
      body: [
        block('h2', 'Dilators Or Plugs For A Beginner'),
        block('h2', 'Picking The Right Anal Lube'),
        block('h2', 'What About Numbing Products'),
      ],
    }
    const priors = [{
      slug: 'does-anal-have-to-hurt',
      title: 'Does Anal Have to Hurt?',
      body: [
        block('h2', 'Dilators Versus Plugs For A Beginner'),
        block('h2', 'The Anal Lube Default'),
        block('h2', 'Numbing Products'),
        block('h2', 'Douching'),
        block('h2', 'Stretching And The Clinician Hand-Off'),
      ],
    }]

    const report = analyzeTopicCollision(draft, priors)
    expect(report.collision).toBe(true)
    expect(report.headingHits.some(h => h.priorSlug === 'does-anal-have-to-hurt' && h.priorHeading === 'Numbing Products')).toBe(true)
    expect(report.headingHits.some(h => h.priorHeading === 'Dilators Versus Plugs For A Beginner')).toBe(true)
  })

  it('flags the sizing draft against what-size-dildo-should-you-start-with (run 1397, sizing skeleton)', () => {
    const draft = {
      title: 'Converting Circumference to a Diameter You Can Compare',
      body: [
        block('h2', 'Circumference To Diameter, Converted'),
        block('h2', 'Firmness Versus Felt Size, Explained'),
        block('h2', 'Which Number Actually Matters'),
      ],
    }
    const priors = [{
      slug: 'what-size-dildo-should-you-start-with',
      title: 'What Size Dildo Should You Start With?',
      body: [
        block('h2', 'Circumference To Diameter'),
        block('h2', 'Firmness Versus Felt Size'),
        block('h2', 'Which Number Matters'),
      ],
    }]

    const report = analyzeTopicCollision(draft, priors)
    expect(report.collision).toBe(true)
    expect(report.headingHits.length).toBeGreaterThanOrEqual(2)
  })

  it('flags the premature-ejaculation reword via shared embeds, where titles and headings share no vocabulary (run 760, row 15)', () => {
    // The actual run-760 collision was identified "down to the same three
    // candidate embeds" — this is the one incident where the heading/title
    // signal genuinely cannot fire (zero shared subject vocabulary), so the
    // embed-overlap signal is what the ticket's own evidence says to use.
    const draft = {
      title: 'What Helps When You Finish Faster Than You Want?',
      body: [
        block('h2', 'Why Timing Feels Out Of Your Control'),
        embed('performance-training-ring'),
        embed('delay-spray-mild'),
        embed('thicker-ribbed-condom'),
      ],
    }
    const priors = [{
      slug: 'what-counts-as-premature-ejaculation',
      title: 'What Counts as Premature Ejaculation?',
      body: [
        block('h2', 'A Clinical Definition, Not A Stopwatch'),
        embed('performance-training-ring'),
        embed('delay-spray-mild'),
        embed('thicker-ribbed-condom'),
      ],
    }]

    const report = analyzeTopicCollision(draft, priors)
    expect(report.headingHits).toEqual([])
    expect(report.titleHits).toEqual([])
    expect(report.collision).toBe(true)
    expect(report.embedHits[0]?.priorSlug).toBe('what-counts-as-premature-ejaculation')
    expect(report.embedHits[0]?.sharedHandles).toEqual(
      ['performance-training-ring', 'delay-spray-mild', 'thicker-ribbed-condom'],
    )
  })

  it('returns clean (no collision) for a genuinely fresh topic', () => {
    const draft = {
      title: 'Packing a Travel-Size Lube Bottle Without a Leak',
      body: [
        block('h2', 'Which Bottles Actually Seal'),
        block('h2', 'TSA Carry-On Limits, In Plain Numbers'),
        embed('travel-lube-mini'),
      ],
    }
    const priors = [{
      slug: 'does-anal-have-to-hurt',
      title: 'Does Anal Have to Hurt?',
      body: [
        block('h2', 'Dilators Versus Plugs For A Beginner'),
        block('h2', 'The Anal Lube Default'),
        embed('performance-training-ring'),
      ],
    }, {
      slug: 'what-size-dildo-should-you-start-with',
      title: 'What Size Dildo Should You Start With?',
      body: [block('h2', 'Circumference To Diameter'), block('h2', 'Which Number Matters')],
    }]

    const report = analyzeTopicCollision(draft, priors)
    expect(report).toEqual({ headingHits: [], titleHits: [], embedHits: [], collision: false })
  })

  it('never throws on a prior post missing a body or title', () => {
    const draft = { title: 'A Fresh Topic', body: [block('h2', 'A Fresh Heading')] }
    const priors = [{ slug: 'bare-prior' }, { slug: 'no-slug-prior', title: null, body: undefined }]
    expect(() => analyzeTopicCollision(draft, priors)).not.toThrow()
    expect(analyzeTopicCollision(draft, priors).collision).toBe(false)
  })
})
