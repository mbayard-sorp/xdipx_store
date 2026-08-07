/**
 * ivr-search-audience-relax.test.ts
 *
 * Regression tests for the audience-tag relaxation in ivr-search.server.
 *
 * A caller said the two most ordinary things in sequence — "I'm looking for a
 * new vibrator", then "with a partner" — and the discovery agent turned that
 * into { query: 'vibrator', productTypeDial: 'vibrator', tags: ['couples'] },
 * which returned ZERO results out of 696 vibrator-dial products.
 *
 * Cause: audience tag coverage in the catalog is thin (2 of 696 vibrator-dial
 * products carry `couples`, 0 carry `for-him`), so ANDing an audience tag
 * against a category dial is very nearly a guaranteed empty set. The strict
 * category path detected `filtered-to-zero` and returned empty instead of
 * relaxing the soft filter and retrying.
 *
 * Audience is dropped on retry; category, dial, subtype and price are not —
 * those are the filters a caller would notice being ignored.
 */
import { describe, it, expect } from 'vitest'
import { dropAudienceTagConditions } from '../../ivr-search.server'

// Mirrors what the main query builder pushes, in order.
const DIAL = 'productTypeDial == $typeDial'
const SUBTYPE = 'productSubtypeDial == $subtypeDial'
const CATEGORY = '$cat in category'
const MATTERS = '($mt0 in mattersTags)'

describe('dropAudienceTagConditions', () => {
  it('drops the couples clause that emptied the vibrator search', () => {
    const conditions = [CATEGORY, '$tag0 in tags', DIAL]
    expect(dropAudienceTagConditions(conditions, ['couples'])).toEqual([CATEGORY, DIAL])
  })

  it('keeps dial, subtype, category and matters filters intact', () => {
    const conditions = [CATEGORY, '$tag0 in tags', MATTERS, DIAL, SUBTYPE]
    const kept = dropAudienceTagConditions(conditions, ['couples'])
    expect(kept).toEqual([CATEGORY, MATTERS, DIAL, SUBTYPE])
    expect(kept).not.toContain('$tag0 in tags')
  })

  it.each(['for-her', 'for-him', 'couples'])('treats %s as a droppable audience tag', (aud) => {
    expect(dropAudienceTagConditions(['$tag0 in tags', DIAL], [aud])).toEqual([DIAL])
  })

  it('drops only the audience tag when mixed with a non-audience tag', () => {
    // tags: ['waterproof', 'couples'] → $tag0 is NOT audience, $tag1 is.
    const conditions = ['$tag0 in tags', '$tag1 in tags', DIAL]
    expect(dropAudienceTagConditions(conditions, ['waterproof', 'couples'])).toEqual([
      '$tag0 in tags',
      DIAL,
    ])
  })

  it('respects positional alignment when the audience tag is not first', () => {
    // A naive implementation that always strips $tag0 would drop the wrong one.
    const conditions = ['$tag0 in tags', '$tag1 in tags', '$tag2 in tags']
    expect(dropAudienceTagConditions(conditions, ['quiet', 'travel-ready', 'for-him'])).toEqual([
      '$tag0 in tags',
      '$tag1 in tags',
    ])
  })

  it('returns null when there are no tags at all', () => {
    expect(dropAudienceTagConditions([DIAL], undefined)).toBeNull()
    expect(dropAudienceTagConditions([DIAL], [])).toBeNull()
  })

  it('returns null when no tag is an audience tag — nothing to relax', () => {
    // Prevents a pointless identical retry.
    expect(dropAudienceTagConditions(['$tag0 in tags', DIAL], ['waterproof'])).toBeNull()
  })

  it('returns null when the audience clause is absent from the conditions', () => {
    // Defends the retry against builder drift: if the clause naming ever
    // changes, relaxation must no-op rather than silently re-run the same query.
    expect(dropAudienceTagConditions([DIAL, CATEGORY], ['couples'])).toBeNull()
  })
})
