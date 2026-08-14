import { describe, it, expect } from 'vitest'
import { railsSlateFingerprint, evaluateRailsFreshness, RENDERED_RAILS } from './rails-freshness'

describe('railsSlateFingerprint', () => {
  it('joins trimmed headings with a pipe, in order', () => {
    expect(railsSlateFingerprint(['  Warm up slow  ', 'For the two of you'])).toBe(
      'Warm up slow|For the two of you',
    )
  })

  it('is order-sensitive (a reorder is a different slate)', () => {
    expect(railsSlateFingerprint(['A', 'B'])).not.toBe(railsSlateFingerprint(['B', 'A']))
  })

  it('drops empty/whitespace headings AFTER taking the first `max`, matching the healthcheck', () => {
    // Five rails; the 4th (within the rendered window) is blank, the 5th is
    // beyond the window. Result: headings 1,2,3 only.
    expect(railsSlateFingerprint(['A', 'B', 'C', '   ', 'E'], 4)).toBe('A|B|C')
  })

  it('never looks past the rendered window', () => {
    expect(railsSlateFingerprint(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A|B|C|D')
    expect(RENDERED_RAILS).toBe(4)
  })

  it('is empty for an empty slate', () => {
    expect(railsSlateFingerprint([])).toBe('')
    expect(railsSlateFingerprint(['', '  '])).toBe('')
  })
})

describe('evaluateRailsFreshness', () => {
  it('is fresh when the slate changed', () => {
    const v = evaluateRailsFreshness('A|B', 'A|C')
    expect(v.fresh).toBe(true)
    expect(v.reason).toMatch(/changed/)
  })

  it('is NOT fresh when byte-identical to the baseline', () => {
    const v = evaluateRailsFreshness('A|B', 'A|B')
    expect(v.fresh).toBe(false)
    expect(v.reason).toMatch(/byte-identical/)
  })

  it('treats a null baseline as fresh (first run is never falsely blocked)', () => {
    expect(evaluateRailsFreshness(null, 'A|B').fresh).toBe(true)
  })

  it('is NOT fresh when the current slate is empty, even against a null baseline', () => {
    const v = evaluateRailsFreshness(null, '')
    expect(v.fresh).toBe(false)
    expect(v.reason).toMatch(/empty/)
  })

  it('carries both fingerprints for the run log', () => {
    const v = evaluateRailsFreshness('A|B', 'A|C')
    expect(v.previous).toBe('A|B')
    expect(v.current).toBe('A|C')
  })
})
