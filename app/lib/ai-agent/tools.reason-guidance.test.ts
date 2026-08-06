import { describe, it, expect } from 'vitest'
import { searchReasonGuidance } from './tools.server'

// searchReasonGuidance is what lets the model tell "loosen your filters" from
// "the catalog is down" — the fix for ticket #1268, where runQaTool discarded
// the reason entirely and the model could only ever say "no results". The
// example phrasings in each branch passed the emma-empathy-reviewer voice gate.

describe('searchReasonGuidance', () => {
  it('gives no guidance when results matched', () => {
    expect(searchReasonGuidance('matched')).toBeUndefined()
  })

  it('offers agency to relax a filter on filtered-to-zero', () => {
    const g = searchReasonGuidance('filtered-to-zero')
    expect(g).toBeDefined()
    expect(g!.toLowerCase()).toMatch(/loosen|relax|drop/)
  })

  it('tells the model not to blame filters on no-base-results', () => {
    const g = searchReasonGuidance('no-base-results')
    expect(g).toBeDefined()
    expect(g!.toLowerCase()).toContain('do not blame filters')
  })

  it('gives an honest outage apology for a Sanity outage', () => {
    const g = searchReasonGuidance('sanity-unavailable')
    expect(g).toBeDefined()
    expect(g!.toLowerCase()).toMatch(/slow right now|degraded|try again/)
  })

  it('treats a catalog (Shopify) outage the same honest way, never as empty', () => {
    // The whole point of the distinct reason is that a hydration failure is NOT
    // "no results" — it must route to the same degraded-search apology, not the
    // filtered/no-base guidance.
    const catalog = searchReasonGuidance('catalog-unavailable')
    const sanity = searchReasonGuidance('sanity-unavailable')
    expect(catalog).toBe(sanity)
  })

  it('no em-dashes in any guidance string (house rule)', () => {
    for (const reason of ['filtered-to-zero', 'no-base-results', 'sanity-unavailable', 'catalog-unavailable'] as const) {
      expect(searchReasonGuidance(reason)).not.toContain('—')
    }
  })
})
