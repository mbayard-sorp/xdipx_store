import { describe, expect, it } from 'vitest'
import { buildFallback, type DiscoveryArgs, type DiscoveryCandidate } from './emma-discovery.server'

/**
 * Voice guard for the templated fallback in `buildFallback()`.
 *
 * Charter rule (docs/emma-voice.md, CLAUDE.md): "Emma is an AI guide with no
 * lived experience (never 'I tried/tested/own it')." Two shipped fallback
 * strings once broke it ("I've been wandering this shelf too. I'll mark the
 * ones I keep reaching for." and "Been testing this one. A reliable pick.").
 * These tests pin the rule on the strings those replaced so a future edit
 * cannot silently reintroduce a first-person experience claim.
 */

// First-person lived/tested/owned/used claims. "I'll star" / "I'll mark" are a
// stated process, not a lived-experience claim, and are intentionally allowed.
const LIVED_EXPERIENCE =
  /\b(i've\s+been|i\s+have\s+been|been\s+testing|been\s+using|keep\s+reaching|reaching\s+for|i\s+tried|i\s+tested|i've\s+tried|i've\s+tested|i've\s+used|i\s+own\b|i\s+use\b|wandering)\b/i

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return { handle: 'test-product', title: 'Test Product', ...overrides }
}

function args(overrides: Partial<DiscoveryArgs> = {}): DiscoveryArgs {
  return {
    surface:    'collection',
    query:      '',
    collection: 'pleasure',
    filters:    {},
    candidates: [candidate()],
    ...overrides,
  }
}

describe('buildFallback voice — no lived experience', () => {
  it('collection narrator makes no first-person experience claim', () => {
    // No cart / order / recentViews / query, collection set → the narrator
    // branch that once read "I've been wandering this shelf too."
    const { narrator } = buildFallback(args())
    expect(narrator).not.toMatch(LIVED_EXPERIENCE)
    expect(narrator).not.toContain('—')
  })

  it('default starred reason makes no first-person experience claim', () => {
    // Empty query + filters make scoreCandidates return nothing, so the
    // starred picks fall back to the default reason string that once read
    // "Been testing this one."
    const { starredHandles } = buildFallback(args())
    expect(starredHandles.length).toBeGreaterThan(0)
    for (const { reason } of starredHandles) {
      expect(reason).not.toMatch(LIVED_EXPERIENCE)
      expect(reason).not.toContain('—')
    }
  })

  it('the lived-experience matcher catches the exact strings it replaced', () => {
    // Guards the guard: the two original violations must still trip the regex,
    // so the test cannot rot into a no-op that passes anything.
    expect('I\'ve been wandering this shelf too. I\'ll mark the ones I keep reaching for.')
      .toMatch(LIVED_EXPERIENCE)
    expect('Been testing this one. A reliable pick.').toMatch(LIVED_EXPERIENCE)
  })
})
