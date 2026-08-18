import { describe, expect, it } from 'vitest'

import {
  EMMA_TAGLINE_BANK_SIZE,
  normalizeTaglineLine,
  buildQuietEndorsementPrompt,
  EMMA_NO_USE_CLAIM_GUARD,
} from './claude.server'

// Ticket #4115 (split from #3776): the quiet_endorsement enrichment prompt used
// to frame Emma as "a trusted, funny friend who has actually tried this" — a
// fabricated first-person lived-experience claim that violates the charter and
// contradicts every sibling enrichment prompt in this file. These assert the
// fabrication is gone and the shared no-lived-experience guard is present, on
// both the primary and retry prompts and for both MAP states.
describe('quiet_endorsement prompt — no fabricated lived experience', () => {
  it('never instructs Emma to claim she tried/tested/used/owns the product', () => {
    for (const mapRestricted of [false, true]) {
      const { primary, retry } = buildQuietEndorsementPrompt({ mapRestricted, productContext: 'Product: Test' })
      const forbidden = /actually tried|has tried|have tried|tried (this|it|both)|tested (this|it|both)|been using|been living with|i tried|i tested|i(?:'ve| have) been using/i
      expect(primary).not.toMatch(forbidden)
      expect(retry).not.toMatch(forbidden)
      expect(primary).toContain(EMMA_NO_USE_CLAIM_GUARD)
      expect(retry).toContain(EMMA_NO_USE_CLAIM_GUARD)
    }
  })

  it('the shared guard asserts no lived experience and forbids use claims', () => {
    expect(EMMA_NO_USE_CLAIM_GUARD.toLowerCase()).toContain('no lived experience')
    expect(EMMA_NO_USE_CLAIM_GUARD.toLowerCase()).toMatch(/never .*\b(tried|tested|owns)\b/)
  })

  it('still carries the MAP-restriction discount rule when the product is MAP-locked', () => {
    const { primary } = buildQuietEndorsementPrompt({ mapRestricted: true, productContext: 'Product: Test' })
    expect(primary).toMatch(/MAP-restricted/)
    expect(primary).toMatch(/do NOT reference a discount/i)
  })
})

// Ticket #3981: the Emma status-line tagline is now served from a shared,
// pre-generated rotating bank instead of a per-request model call. These cover
// the pure parse step that turns one raw model line into a valid tagline (or
// rejects it), which is what makes a one-call bank of N lines usable.
describe('normalizeTaglineLine', () => {
  it('keeps a clean, already-valid tagline unchanged', () => {
    expect(normalizeTaglineLine('here to help you find what you’re into ♥')).toBe(
      'here to help you find what you’re into ♥',
    )
  })

  it('appends the ♥ glyph when the model omits it', () => {
    expect(normalizeTaglineLine('pick my brain, I know the catalog cold')).toBe(
      'pick my brain, I know the catalog cold ♥',
    )
  })

  it('collapses multiple hearts to exactly one trailing glyph', () => {
    expect(normalizeTaglineLine('♥ your no-judgment guide to pleasure ♥')).toBe(
      'your no-judgment guide to pleasure ♥',
    )
  })

  it('strips list bullets and numbering the model adds when asked for many', () => {
    expect(normalizeTaglineLine('1. tell me what you’re curious about')).toBe(
      'tell me what you’re curious about ♥',
    )
    expect(normalizeTaglineLine('- quietly obsessed with the good stuff ♥')).toBe(
      'quietly obsessed with the good stuff ♥',
    )
    expect(normalizeTaglineLine('• say the word, I will find your fit')).toBe(
      'say the word, I will find your fit ♥',
    )
  })

  it('strips wrapping quotes and normalizes internal whitespace', () => {
    expect(normalizeTaglineLine('"curious?   I have got   ideas"')).toBe(
      'curious? I have got ideas ♥',
    )
  })

  it('rejects empty, too-short, and over-long lines', () => {
    expect(normalizeTaglineLine('')).toBeNull()
    expect(normalizeTaglineLine('   ')).toBeNull()
    expect(normalizeTaglineLine('hi')).toBeNull()
    expect(normalizeTaglineLine('♥')).toBeNull()
    expect(normalizeTaglineLine('a'.repeat(200))).toBeNull()
  })

  it('exposes a sane default bank size', () => {
    expect(EMMA_TAGLINE_BANK_SIZE).toBeGreaterThanOrEqual(8)
    expect(EMMA_TAGLINE_BANK_SIZE).toBeLessThanOrEqual(12)
  })
})
