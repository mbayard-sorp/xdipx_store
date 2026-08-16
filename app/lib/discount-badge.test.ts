import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  MIN_DISCOUNT_BADGE_PCT,
  showDiscountBadge,
  formatSavings,
  formatSavingsRange,
  formatDiscountBadge,
  mapAllowsDiscountDisplay,
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

describe('mapAllowsDiscountDisplay — the MAP gate (ticket #3675)', () => {
  it('SUPPRESSES discount framing when map_price equals the regular price (MAP = MSRP)', () => {
    // The exact live case: date-night-water-based-personal-lubricant, 15.99 vs
    // an 18.99 compare-at, with map_price == original_price (18.99). 1,639
    // active products had map == original on 2026-08-16; 113 were rendering a
    // struck price + badge they may not advertise.
    expect(mapAllowsDiscountDisplay(18.99, 18.99)).toBe(false)
  })

  it('allows discount framing when MAP sits below the regular price', () => {
    expect(mapAllowsDiscountDisplay(12.0, 18.99)).toBe(true)
  })

  it('suppresses when MAP sits above the regular price', () => {
    expect(mapAllowsDiscountDisplay(20.0, 18.99)).toBe(false)
  })

  it('allows discount framing when there is no MAP (null, undefined, or 0)', () => {
    expect(mapAllowsDiscountDisplay(null, 18.99)).toBe(true)
    expect(mapAllowsDiscountDisplay(undefined, 18.99)).toBe(true)
    expect(mapAllowsDiscountDisplay(0, 18.99)).toBe(true)
  })

  it('never advertises a discount when map_restricted is set, whatever the prices', () => {
    expect(mapAllowsDiscountDisplay(0, 18.99, true)).toBe(false)
    expect(mapAllowsDiscountDisplay(1.0, 18.99, true)).toBe(false)
  })

  it('suppresses when there is no regular price to strike through', () => {
    expect(mapAllowsDiscountDisplay(10.0, null)).toBe(false)
    expect(mapAllowsDiscountDisplay(10.0, 0)).toBe(false)
  })

  it('tolerates sub-cent float noise at the equality boundary', () => {
    // map effectively equal to regular (within half a cent) is not a discount.
    expect(mapAllowsDiscountDisplay(18.99, 18.991)).toBe(false)
    expect(mapAllowsDiscountDisplay(18.98, 18.99)).toBe(true)
  })
})

describe('every discount-display surface routes through the MAP gate (ticket #3675)', () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

  // The five general product cards + the PDP the ticket audited, plus VaultCard
  // (the PLP card the others mirror) and the CMS carousel card. Before this
  // shipped only the five hero surfaces and the Google feed consulted MAP; a
  // card that computes a percentage straight from compare-at vs price is the
  // exact defect, so every one of these must reference the shared gate.
  const surfaces = [
    '../components/store/StorefrontProductCard.tsx',
    '../components/discovery/ProductCard.tsx',
    '../components/category/CategoryProductCard.tsx',
    '../components/store/SearchProductGrid.tsx',
    '../components/store/ProductCard.tsx',
    '../components/store/VaultCard.tsx',
    '../components/cms/ProductCarousel.tsx',
    '../routes/_layout.products.$slug.tsx',
  ]

  for (const rel of surfaces) {
    it(`${rel.split('/').pop()} gates discount framing on mapAllowsDiscountDisplay`, () => {
      const src = read(rel)
      expect(src).toContain('mapAllowsDiscountDisplay')
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
