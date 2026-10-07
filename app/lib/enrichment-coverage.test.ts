import { describe, expect, it } from 'vitest'
import {
  ENRICHMENT_FIELDS,
  hasEnrichedStory,
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

function node(id: string, mf: Record<string, string | null>, description: string | null = null): CoverageProductNode {
  return {
    id,
    metafields: Object.entries(mf).map(([key, value]) => ({ key, value })),
    description,
  }
}

describe('tallyCoverage', () => {
  it('reports zeroed fields and 0% for an empty catalog without dividing by zero', () => {
    const result = tallyCoverage([])
    expect(result.totalProducts).toBe(0)
    // ENRICHMENT_FIELDS plus the one derived 'story' row appended in tallyCoverage.
    expect(result.fields).toHaveLength(ENRICHMENT_FIELDS.length + 1)
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

// Ticket #13673: full_story is a metafield the current enricher no longer
// writes (it rewrites the product's own description/body_html instead,
// alongside tagline and specifications), so a per-metafield row keyed on it
// always read 0% and wrongly flagged every recently-enriched product as
// unenriched (inventory-sentinel reported Gush 2 this way on 2026-10-05). The
// PDP itself was unaffected (shopify.server.ts already reads
// full_story || description); only this coverage signal was stale.
describe('hasEnrichedStory (ticket #13673)', () => {
  const byKey = (mf: Record<string, string | null>) => new Map(Object.entries(mf))

  it('counts as enriched with tagline + specifications + a rewritten description, and NO full_story metafield at all', () => {
    const fields = byKey({ tagline: 'Made for slow evenings', specifications: '["Material: Silicone","Length: 6in"]' })
    expect(hasEnrichedStory(fields, 'A slow, deliberate design for couples who like to take their time.')).toBe(true)
  })

  it('tolerates the legacy HTML <ul><li> specifications shape, not only the new JSON-array shape', () => {
    const fields = byKey({ tagline: 'Made for slow evenings', specifications: '<ul><li>Material: Silicone</li></ul>' })
    expect(hasEnrichedStory(fields, 'A slow, deliberate design.')).toBe(true)
  })

  it('is false when tagline is missing even if specifications and description are present', () => {
    const fields = byKey({ specifications: '["Material: Silicone"]' })
    expect(hasEnrichedStory(fields, 'A slow, deliberate design.')).toBe(false)
  })

  it('is false when specifications is missing or empty even if tagline and description are present', () => {
    expect(hasEnrichedStory(byKey({ tagline: 'Made for slow evenings' }), 'A slow design.')).toBe(false)
    expect(hasEnrichedStory(byKey({ tagline: 'Made for slow evenings', specifications: '[]' }), 'A slow design.')).toBe(false)
  })

  it('is false when the description is missing, empty, or whitespace, even with tagline and specifications present', () => {
    const fields = byKey({ tagline: 'Made for slow evenings', specifications: '["Material: Silicone"]' })
    expect(hasEnrichedStory(fields, null)).toBe(false)
    expect(hasEnrichedStory(fields, undefined)).toBe(false)
    expect(hasEnrichedStory(fields, '   ')).toBe(false)
  })

  it('a product with no metafields at all but a description is not enriched (description alone is every raw import, not a signal)', () => {
    expect(hasEnrichedStory(byKey({}), 'Whatever Shopify imported from the vendor feed.')).toBe(false)
  })
})

describe('tallyCoverage story row (ticket #13673)', () => {
  it('counts a product with tagline + specifications + description as enriched, with no full_story field in the fixture at all', () => {
    const nodes: CoverageProductNode[] = [
      node('enriched', { tagline: 'Made for slow evenings', specifications: '["Material: Silicone"]' }, 'A full rewritten description.'),
      node('bare-import', {}, 'Vendor-supplied copy, never touched by enrichment.'),
    ]
    const result = tallyCoverage(nodes)
    const story = result.fields.find((f: FieldCoverage) => f.key === 'story')!
    expect(story.covered).toBe(1)
    expect(story.pct).toBe(50)
    // full_story no longer appears in ENRICHMENT_FIELDS at all.
    expect(result.fields.find((f: FieldCoverage) => f.key === 'full_story')).toBeUndefined()
    expect(ENRICHMENT_FIELDS.some(f => f.key === 'full_story')).toBe(false)
  })

  it('a node with no description field at all (an older fixture shape) scores the story row as not covered, not as a crash', () => {
    const nodes: CoverageProductNode[] = [
      { id: 'legacy-fixture', metafields: [{ key: 'tagline', value: 'Set the mood' }, { key: 'specifications', value: '["x"]' }] },
    ]
    const result = tallyCoverage(nodes)
    const story = result.fields.find((f: FieldCoverage) => f.key === 'story')!
    expect(story.covered).toBe(0)
  })
})
