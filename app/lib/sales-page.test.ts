import { describe, it, expect } from 'vitest'
import { normalizeSalesPage, normalizeSection } from './sales-page'

const base = {
  slug: 'quiet-pulse',
  productHandle: 'quiet-pulse-wand',
  headline: 'Quiet enough to *forget* the walls',
  subhead: 'Deep, rumbly, and hushed.',
}

describe('normalizeSalesPage', () => {
  it('maps a minimal page and fills defaults', () => {
    const p = normalizeSalesPage(base)!
    expect(p.slug).toBe('quiet-pulse')
    expect(p.live).toBe(false)
    expect(p.buttonLabel).toBe("I'll take it ♥")
    expect(p.closer).toBe(base.headline)
    expect(p.sections).toEqual([])
  })

  it('refuses a bad slug, a bad handle, or a missing headline', () => {
    expect(normalizeSalesPage({ ...base, slug: 'Bad Slug' })).toBeNull()
    expect(normalizeSalesPage({ ...base, productHandle: '/products/x' })).toBeNull()
    expect(normalizeSalesPage({ ...base, headline: '  ' })).toBeNull()
    expect(normalizeSalesPage(null)).toBeNull()
  })

  it('only accepts whitelisted button labels', () => {
    expect(normalizeSalesPage({ ...base, buttonLabel: 'Buy now' })!.buttonLabel).toBe("I'll take it ♥")
    expect(normalizeSalesPage({ ...base, buttonLabel: 'Show me' })!.buttonLabel).toBe('Show me')
  })

  it('turns em and en dashes into commas', () => {
    expect(normalizeSalesPage({ ...base, subhead: 'Deep — and hushed – always' })!.subhead).toBe('Deep, and hushed, always')
  })

  it('keeps live only when it is exactly true', () => {
    expect(normalizeSalesPage({ ...base, live: 'yes' })!.live).toBe(false)
    expect(normalizeSalesPage({ ...base, live: true })!.live).toBe(true)
  })

  it('drops unknown and empty sections, keeps the rest in order', () => {
    const p = normalizeSalesPage({
      ...base,
      sections: [
        { _type: 'spFaq', _key: 'a', heading: 'Questions', items: [{ q: 'Loud?', a: 'No.' }] },
        { _type: 'spMystery', _key: 'b', heading: 'x' },
        { _type: 'spFeatures', _key: 'c', heading: 'Specs', items: [] },
        { _type: 'spBuyBand', _key: 'd', heading: 'Yours *tonight*' },
      ],
    })!
    expect(p.sections.map(s => s.type)).toEqual(['faq', 'buyBand'])
  })
})

describe('normalizeSection', () => {
  it('never carries a review source to the page', () => {
    const s = normalizeSection({ _type: 'spProof', heading: 'Said by buyers', reviews: [{ quote: 'Love it', name: 'J.', source: 'judge.me/123' }] }, 0)
    expect(s).toEqual({ key: 's0', kicker: '', heading: 'Said by buyers', tone: 'paper', type: 'proof', reviews: [{ quote: 'Love it', name: 'J.' }] })
  })

  it('falls back to paper for an unknown tone', () => {
    expect(normalizeSection({ _type: 'spStory', heading: 'Hi', tone: 'neon' }, 1)!.tone).toBe('paper')
  })

  it('requires an image on an image section', () => {
    expect(normalizeSection({ _type: 'spImage', caption: 'x' }, 0)).toBeNull()
    expect(normalizeSection({ _type: 'spImage', image: { url: 'https://cdn.sanity.io/a.jpg', alt: 'A' } }, 0)).toMatchObject({ type: 'image' })
  })
})
