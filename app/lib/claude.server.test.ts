import { describe, expect, it } from 'vitest'

import { EMMA_TAGLINE_BANK_SIZE, normalizeTaglineLine } from './claude.server'

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
