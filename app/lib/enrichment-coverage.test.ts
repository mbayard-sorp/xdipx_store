import { describe, expect, it } from 'vitest'
import {
  ENRICHMENT_FIELDS,
  isFieldPresent,
  tallyCoverage,
  type CoverageProductNode,
  type FieldCoverage,
} from './enrichment-coverage'

describe('isFieldPresent — text', () => {
  it('present for a non-empty string', () => {
    expect(isFieldPresent('text', 'A quiet luxury')).toBe(true)
  })
  it('absent for null, empty, or whitespace', () => {
    expect(isFieldPresent('text', null)).toBe(false)
    expect(isFieldPresent('text', '')).toBe(false)
    expect(isFieldPresent('text', '   ')).toBe(false)
  })
})

describe('isFieldPresent — list', () => {
  it('present for a JSON array with entries', () => {
    expect(isFieldPresent('list', '["playful","intimate"]')).toBe(true)
  })
  it('absent for an empty JSON array', () => {
    expect(isFieldPresent('list', '[]')).toBe(false)
  })
  it('absent for an array of only blanks', () => {
    expect(isFieldPresent('list', '[""," "]')).toBe(false)
  })
  it('tolerates legacy comma-separated values', () => {
    expect(isFieldPresent('list', 'playful, intimate')).toBe(true)
    expect(isFieldPresent('list', ' , ')).toBe(false)
  })
})

describe('isFieldPresent — json', () => {
  it('present for a non-empty object', () => {
    expect(isFieldPresent('json', '{"softness":3,"power":4}')).toBe(true)
  })
  it('absent for an empty object or array', () => {
    expect(isFieldPresent('json', '{}')).toBe(false)
    expect(isFieldPresent('json', '[]')).toBe(false)
  })
  it('absent for null or empty string', () => {
    expect(isFieldPresent('json', 'null')).toBe(false)
    expect(isFieldPresent('json', '')).toBe(false)
  })
})

function node(id: string, mf: Record<string, string | null>): CoverageProductNode {
  return {
    id,
    metafields: Object.entries(mf).map(([key, value]) => ({ key, value })),
  }
}

describe('tallyCoverage', () => {
  it('reports zeroed fields and 0% for an empty catalog without dividing by zero', () => {
    const result = tallyCoverage([])
    expect(result.totalProducts).toBe(0)
    expect(result.fields).toHaveLength(ENRICHMENT_FIELDS.length)
    for (const f of result.fields) {
      expect(f.covered).toBe(0)
      expect(f.total).toBe(0)
      expect(f.pct).toBe(0)
    }
  })

  it('counts per-field presence and rounds percentages across the catalog', () => {
    const nodes: CoverageProductNode[] = [
      node('a', {
        tagline: 'Made for slow evenings',
        mood_tags: '["playful"]',
        sensation_dial: '{"softness":3}',
      }),
      node('b', {
        tagline: 'Bold and unhurried',
        mood_tags: '[]', // present-key-but-empty must NOT count
      }),
      node('c', {
        // tagline missing entirely
        mood_tags: '["intimate","warm"]',
      }),
    ]
    const result = tallyCoverage(nodes)
    expect(result.totalProducts).toBe(3)

    const get = (k: string): FieldCoverage => {
      const f = result.fields.find((x: FieldCoverage) => x.key === k)
      if (!f) throw new Error(`missing field ${k}`)
      return f
    }
    // tagline on a + b => 2/3 => 67%
    expect(get('tagline').covered).toBe(2)
    expect(get('tagline').pct).toBe(67)
    // mood_tags on a + c ('[]' on b is empty) => 2/3 => 67%
    expect(get('mood_tags').covered).toBe(2)
    expect(get('mood_tags').pct).toBe(67)
    // sensation_dial only on a => 1/3 => 33%
    expect(get('sensation_dial').covered).toBe(1)
    expect(get('sensation_dial').pct).toBe(33)
    // a field nothing carries => 0
    expect(get('audience_tags').covered).toBe(0)
    expect(get('audience_tags').pct).toBe(0)
  })

  it('ignores null metafield entries from the identifiers query', () => {
    const nodes: CoverageProductNode[] = [
      { id: 'a', metafields: [null, { key: 'tagline', value: 'Set the mood' }, null] },
    ]
    const result = tallyCoverage(nodes)
    const tagline = result.fields.find((f: FieldCoverage) => f.key === 'tagline')!
    expect(tagline.covered).toBe(1)
    expect(tagline.pct).toBe(100)
  })
})
