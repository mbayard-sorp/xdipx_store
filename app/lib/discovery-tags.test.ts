import { describe, expect, it } from 'vitest'
import { displayLabel, normalizeTag } from './discovery-tags'

describe('normalizeTag', () => {
  it('Title-Cases lowercase input', () => {
    expect(normalizeTag('sensual')).toBe('Sensual')
  })

  it('preserves already-Title-Case input', () => {
    expect(normalizeTag('Sensual')).toBe('Sensual')
  })

  it('normalizes SHOUTING and trims', () => {
    expect(normalizeTag('  SENSUAL ')).toBe('Sensual')
  })

  it('preserves hyphens', () => {
    expect(normalizeTag('slow-and-intimate')).toBe('Slow-And-Intimate')
  })

  it('Title-Cases each word on space and hyphen boundaries', () => {
    expect(normalizeTag('body-safe silicone')).toBe('Body-Safe Silicone')
  })

  it('collapses casing duplicates when used to dedupe a list', () => {
    const raw = ['Sensual', 'sensual', 'SENSUAL', '  sensual  ']
    const seen = new Set<string>()
    const out: string[] = []
    for (const r of raw) {
      const v = normalizeTag(r)
      if (v && !seen.has(v)) { seen.add(v); out.push(v) }
    }
    expect(out).toEqual(['Sensual'])
  })

  it('returns empty for whitespace-only input', () => {
    expect(normalizeTag('   ')).toBe('')
    expect(normalizeTag('')).toBe('')
  })
})

describe('displayLabel', () => {
  it('replaces hyphens with spaces', () => {
    expect(displayLabel('Slow-And-Intimate')).toBe('Slow and Intimate')
  })

  it('lowercases small connector words mid-string', () => {
    expect(displayLabel('Body-Safe-Silicone')).toBe('Body Safe Silicone')
    expect(displayLabel('Date Night')).toBe('Date Night')
    expect(displayLabel('Unhurried-Solo')).toBe('Unhurried Solo')
  })

  it('keeps the first word capitalized even when it is a small word', () => {
    expect(displayLabel('A-Partner')).toBe('A Partner')
  })

  it('passes simple single-word values through', () => {
    expect(displayLabel('Sensual')).toBe('Sensual')
  })
})

describe('normalizeTag(displayLabel(x)) composition trap', () => {
  // displayLabel() is a one-way UI formatter, not an inverse of normalizeTag().
  // Feeding its output back into normalizeTag() does NOT reconstruct the
  // original stored/canonical form for a hyphenated tag: displayLabel turns
  // hyphens into spaces, so normalizeTag sees separate words and Title-Cases
  // each one with a space, not a hyphen. This is exactly the trap that let
  // Routine B run 646 read a chip label off the rendered page, re-normalize
  // it, and silently match zero products:
  //
  //   'Slow-And-Intimate'  --displayLabel-->  'Slow and Intimate'
  //                        --normalizeTag-->  'Slow And Intimate'  (dead: not a live tag)
  //
  // Callers must normalizeTag() the raw storage-form value, never the display
  // label. See app/lib/discovery-presets.ts, which does this correctly: it
  // calls normalizeTag() directly on live vocab strings like 'Slow-And-Intimate'
  // and never round-trips through displayLabel() first.
  it('is deliberately NOT identity for a hyphenated multi-word tag', () => {
    const stored = 'Slow-And-Intimate'
    const roundTripped = normalizeTag(displayLabel(stored))
    expect(roundTripped).not.toBe(stored)
    expect(roundTripped).toBe('Slow And Intimate')
  })
})
