import { describe, it, expect } from 'vitest'
import { slidesReducer, slidesFromMediaUrls, serializeSlides, SLIDE_MAX, type ComposerSlide } from './composer-slides'

const s = (k: string): ComposerSlide => ({ key: k, url: `https://cdn/${k}.jpg`, assetId: null, altText: '' })

describe('slidesReducer', () => {
  it('adds without duplicates and caps at 10', () => {
    const base = [s('a'), s('b')]
    const next = slidesReducer(base, { type: 'add', slides: [s('b'), s('c')] })
    expect(next.map(x => x.key)).toEqual(['a', 'b', 'c'])
    const many = Array.from({ length: 12 }, (_, i) => s(`m${i}`))
    expect(slidesReducer([], { type: 'add', slides: many })).toHaveLength(SLIDE_MAX)
  })
  it('removes by key', () => {
    expect(slidesReducer([s('a'), s('b')], { type: 'remove', key: 'a' }).map(x => x.key)).toEqual(['b'])
  })
  it('moves and clamps', () => {
    const base = [s('a'), s('b'), s('c')]
    expect(slidesReducer(base, { type: 'move', key: 'a', to: 2 }).map(x => x.key)).toEqual(['b', 'c', 'a'])
    expect(slidesReducer(base, { type: 'move', key: 'c', to: -5 }).map(x => x.key)).toEqual(['c', 'a', 'b'])
    expect(slidesReducer(base, { type: 'move', key: 'zz', to: 0 })).toBe(base)
  })
  it('shift is the arrow-key primitive and is a no-op at the edges', () => {
    const base = [s('a'), s('b'), s('c')]
    expect(slidesReducer(base, { type: 'shift', key: 'b', by: 1 }).map(x => x.key)).toEqual(['a', 'c', 'b'])
    expect(slidesReducer(base, { type: 'shift', key: 'a', by: -1 })).toBe(base)
  })
  it('clips alt text at 1000', () => {
    const next = slidesReducer([s('a')], { type: 'alt', key: 'a', altText: 'x'.repeat(1200) })
    expect(next[0]?.altText).toHaveLength(1000)
  })
})

describe('helpers', () => {
  it('derives slides from legacy mediaUrls', () => {
    const out = slidesFromMediaUrls(['https://cdn/1.jpg', 'https://cdn/2.jpg'])
    expect(out).toHaveLength(2)
    expect(out[1]?.url).toBe('https://cdn/2.jpg')
    expect(out[0]?.assetId).toBeNull()
  })
  it('serialises only what the action needs', () => {
    expect(JSON.parse(serializeSlides([{ ...s('a'), assetId: 4, altText: 'alt' }])))
      .toEqual([{ url: 'https://cdn/a.jpg', assetId: 4, altText: 'alt' }])
  })
})
