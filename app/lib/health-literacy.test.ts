import { describe, it, expect } from 'vitest'
import { buildHealthBlockContent, HEALTH_DISCLAIMER } from './health-literacy'

describe('buildHealthBlockContent', () => {
  it('returns null when the product carries none of the fields (no invented text)', () => {
    expect(buildHealthBlockContent({})).toBeNull()
    expect(buildHealthBlockContent({ specifications: ['Color: Red'], audienceTags: [], careInstructions: [] })).toBeNull()
  })

  it('builds mechanism from the product type and verbatim specs', () => {
    const c = buildHealthBlockContent({
      productTypeDial: 'vibrator',
      specifications: ['Material: Body-safe silicone', 'Waterproof: IPX7', 'Color: Red', 'Noise: Quiet'],
    })!
    expect(c.mechanism).toMatch(/motor/)
    expect(c.mechanismSpecs).toEqual(['Waterproof: IPX7', 'Noise: Quiet'])
    expect(c.materials).toEqual(['Material: Body-safe silicone'])
  })

  it('does not mistake a compatibility line for a material', () => {
    const c = buildHealthBlockContent({
      productTypeDial: 'lube',
      specifications: ['Toy compatibility: Safe for use with silicone, glass, and metal toys', 'Condom compatibility: Safe with latex and non-latex condoms'],
    })!
    expect(c.materials).toEqual([])
  })

  it('humanizes audience tags and dedupes', () => {
    const c = buildHealthBlockContent({ audienceTags: ['beginner-friendly', 'beginner-friendly', 'for_couples'] })!
    expect(c.audience).toEqual(['beginner friendly', 'for couples'])
  })

  it('passes care steps through', () => {
    const c = buildHealthBlockContent({ careInstructions: ['Wash with warm water and mild soap.'] })!
    expect(c.care).toHaveLength(1)
  })

  it('has the fixed disclaimer line', () => {
    expect(HEALTH_DISCLAIMER).toBe('This is a personal wellness product, not a medical device.')
  })
})
