import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  MIN_DISCOUNT_BADGE_PCT,
  showDiscountBadge,
  formatSavings,
  formatSavingsRange,
  formatDiscountBadge,
} from './discount-badge'

/**
 * Discount-badge floor (ticket #467). A "1% off" badge next to genuine 10-37%
 * ones is a self-inflicted credibility wound on an honest-curation store, so
 * nothing below the floor renders a badge or savings line. These pin the
 * threshold — including the exact 1% case the ticket observed — and pin that
 * every save-percentage surface routes through the shared helper, so the three
 * cards cannot drift back to an ad-hoc `> 0` gate.
 */

describe('showDiscountBadge — the floor', () => {
  it('hides a 1% discount (the observed Lovense Hush 2 case: $97.99 vs $99.00)', () => {
    const pct = Math.round(((99.0 - 97.99) / 99.0) * 100) // = 1
    expect(pct).toBe(1)
    expect(showDiscountBadge(pct)).toBe(false)
  })

  it('hides everything below the floor and shows everything at or above it', () => {
    expect(showDiscountBadge(0)).toBe(false)
    expect(showDiscountBadge(MIN_DISCOUNT_BADGE_PCT - 1)).toBe(false)
    expect(showDiscountBadge(MIN_DISCOUNT_BADGE_PCT)).toBe(true)
    expect(showDiscountBadge(37)).toBe(true)
  })

  it('keeps the floor at a meaningful, non-trivial value', () => {
    // A regression to 0 or 1 would reopen the exact wound this ticket closed.
    expect(MIN_DISCOUNT_BADGE_PCT).toBeGreaterThanOrEqual(5)
  })
})

describe('every save-percentage surface routes through the shared floor', () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

  const surfaces = [
    '../components/store/StorefrontProductCard.tsx',
    '../components/store/VaultCard.tsx',
    '../components/discovery/ProductCard.tsx',
  ]

  for (const rel of surfaces) {
    it(`${rel.split('/').pop()} imports and uses showDiscountBadge`, () => {
      const src = read(rel)
      expect(src).toContain('showDiscountBadge')
      expect(src).toContain("from '~/lib/discount-badge'")
    })
  }
})

describe('formatSavings — one wording, no colon (ticket #842)', () => {
  it('renders the canonical savings line without a colon', () => {
    expect(formatSavings(12.5, 25)).toBe('You save $12.50 (25%)')
  })

  it('renders the range variant', () => {
    expect(formatSavingsRange(30, 40)).toBe('Save up to $30.00 (40%)')
  })

  it('renders the compact home-rail pill', () => {
    expect(formatDiscountBadge(37)).toBe('37% off')
  })
})

describe('every save-copy surface routes through the shared formatter (ticket #842)', () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

  it('VaultCard uses the shared formatters and no longer hard-codes "You save"', () => {
    const src = read('../components/store/VaultCard.tsx')
    expect(src).toContain('formatSavings(')
    expect(src).toContain('formatSavingsRange(')
    // The colon variant this ticket removed must not come back.
    expect(src).not.toContain('You save:')
  })

  it('discovery/ProductCard uses the shared formatter', () => {
    const src = read('../components/discovery/ProductCard.tsx')
    expect(src).toContain('formatSavings(')
  })

  it('StorefrontProductCard sources its pill string from the shared module', () => {
    const src = read('../components/store/StorefrontProductCard.tsx')
    expect(src).toContain('formatDiscountBadge(')
  })
})
