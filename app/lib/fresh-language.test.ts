// Unit tests for the fresh-language cross-post reuse pre-check (ticket #3009).
//
// The two real tics that hardened across live podcast-notes posts before a hand
// diff caught them are the fixtures: the H2 "Where does this need a caveat?"
// (published verbatim in two posts) and "What does the episode get right?"
// (in the second). Both are six-word question headings, which is exactly what a
// word-6-gram catches and a whole-post similarity score misses.
import { describe, it, expect } from 'vitest'
import {
  analyzeFreshness,
  shingles,
  normalizeWords,
  toTextUnits,
  SHINGLE_N,
  type DraftInput,
  type PriorPost,
} from './fresh-language'

const h2 = (text: string) => ({ _type: 'block', style: 'h2', children: [{ text }] })
const p = (text: string) => ({ _type: 'block', style: 'normal', children: [{ text }] })

describe('normalizeWords / shingles', () => {
  it('lowercases and strips punctuation into word tokens', () => {
    expect(normalizeWords('Where does THIS need a caveat?')).toEqual(['where', 'does', 'this', 'need', 'a', 'caveat'])
  })

  it('produces sliding word-6-grams and nothing for short text', () => {
    expect(SHINGLE_N).toBe(6)
    expect(shingles('Where does this need a caveat?')).toEqual(['where does this need a caveat'])
    // Seven words -> two overlapping 6-grams.
    expect(shingles('one two three four five six seven')).toEqual([
      'one two three four five six',
      'two three four five six seven',
    ])
    // A short structural heading yields no 6-gram, so it never trips.
    expect(shingles('Sources')).toEqual([])
    expect(shingles('Real talk about lube')).toEqual([])
  })
})

describe('toTextUnits', () => {
  it('tags title and headings as headings, excerpt and paragraphs as body', () => {
    const units = toTextUnits({
      title: 'A Title',
      excerpt: 'An excerpt.',
      body: [h2('A Heading'), p('Some body prose.')],
    })
    expect(units).toEqual([
      { kind: 'heading', label: 'Title', text: 'A Title' },
      { kind: 'body', label: 'Excerpt', text: 'An excerpt.' },
      { kind: 'heading', label: 'A Heading', text: 'A Heading' },
      { kind: 'body', label: 'Body', text: 'Some body prose.' },
    ])
  })

  it('skips non-block content like embeds and images', () => {
    const units = toTextUnits({ body: [{ _type: 'blogProductEmbed' }, p('kept')] as unknown[] } as PriorPost)
    expect(units).toEqual([{ kind: 'body', label: 'Body', text: 'kept' }])
  })
})

describe('analyzeFreshness', () => {
  const priorWithCaveatHeading: PriorPost = {
    slug: 'what-is-a-sexual-history',
    body: [h2('Where does this need a caveat?'), p('Unique prior body sentence here entirely.')],
  }

  it('flags a verbatim repeated question heading as a high-risk heading hit', () => {
    const draft: DraftInput = {
      title: 'How do you get out of your head during sex',
      body: [h2('Where does this need a caveat?'), p('Fresh body prose that overlaps nothing at all here.')],
    }
    const report = analyzeFreshness(draft, [priorWithCaveatHeading])

    expect(report.overlap).toBe(true)
    expect(report.hits).toHaveLength(1)
    const hit = report.hits[0]!
    expect(hit.ngram).toBe('where does this need a caveat')
    expect(hit.draftKind).toBe('heading')
    expect(hit.priorInHeading).toBe(true)
    expect(hit.priorSlugs).toEqual(['what-is-a-sexual-history'])
    // A draft-heading hit is in the weighted subset.
    expect(report.headingHits).toEqual(report.hits)
  })

  it('also catches "What does the episode get right?" (the second live tic)', () => {
    const prior: PriorPost = { slug: 'prior-2', body: [h2('What does the episode get right?')] }
    const draft: DraftInput = { body: [h2('What does the episode get right?')] }
    const report = analyzeFreshness(draft, [prior])
    expect(report.overlap).toBe(true)
    expect(report.hits[0]!.ngram).toBe('what does the episode get right')
  })

  it('does not flag short structural headings that repeat by format', () => {
    // "Sources" and "Real talk" recur across posts by design; too short for a 6-gram.
    const prior: PriorPost = { slug: 'p', body: [h2('Sources'), h2('Real talk')] }
    const draft: DraftInput = { body: [h2('Sources'), h2('Real talk'), p('Wholly original body prose with no reuse.')] }
    const report = analyzeFreshness(draft, [prior])
    expect(report.overlap).toBe(false)
    expect(report.hits).toHaveLength(0)
  })

  it('flags recycled body prose (six consecutive shared words)', () => {
    const shared = 'the quietest bullet in the drawer'
    const prior: PriorPost = { slug: 'p', body: [p(`I keep ${shared} for late nights.`)] }
    const draft: DraftInput = { body: [p(`For beginners, ${shared} is the pick.`)] }
    const report = analyzeFreshness(draft, [prior])
    expect(report.overlap).toBe(true)
    expect(report.hits.some(h => h.ngram === shared && h.draftKind === 'body')).toBe(true)
  })

  it('weights a draft-body 6-gram that matches a prior HEADING into headingHits', () => {
    const prior: PriorPost = { slug: 'p', body: [h2('does this need a caveat here')] }
    const draft: DraftInput = { body: [p('I wonder does this need a caveat here really.')] }
    const report = analyzeFreshness(draft, [prior])
    expect(report.overlap).toBe(true)
    const hit = report.hits.find(h => h.ngram === 'does this need a caveat here')!
    expect(hit.draftKind).toBe('body')
    expect(hit.priorInHeading).toBe(true)
    expect(report.headingHits).toContain(hit)
  })

  it('is clean when there are no priors or no overlap', () => {
    const draft: DraftInput = { title: 'Totally novel', body: [h2('An entirely original heading here now'), p('Fresh prose.')] }
    expect(analyzeFreshness(draft, []).overlap).toBe(false)
    expect(analyzeFreshness(draft, [{ slug: 'p', body: [p('Nothing in common whatsoever between these two.')] }]).overlap).toBe(false)
  })

  it('dedupes a repeated 6-gram to one hit per draft unit', () => {
    const prior: PriorPost = { slug: 'p', body: [p('one two three four five six here')] }
    // Same 6-gram appears twice in one draft paragraph.
    const draft: DraftInput = { body: [p('one two three four five six then one two three four five six.')] }
    const report = analyzeFreshness(draft, [prior])
    const matches = report.hits.filter(h => h.ngram === 'one two three four five six')
    expect(matches).toHaveLength(1)
  })
})
