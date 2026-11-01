import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { GAWK_COMPARE_COLUMNS, GAWK_COMPARE_ROWS, GAWK_UPGRADES, gawkOffer, gawkUpgradeGap } from './gawk-sales-page'

describe('gawkUpgradeGap', () => {
  it('is the live price difference', () => {
    expect(gawkUpgradeGap(69.99, 89.99)).toBe(20)
    expect(gawkUpgradeGap(69.99, 79.99)).toBe(10)
  })

  it('shows nothing when the upgrade is not actually more, or a price is missing', () => {
    expect(gawkUpgradeGap(69.99, 69.99)).toBeNull()
    expect(gawkUpgradeGap(79.99, 71.99)).toBeNull()
    expect(gawkUpgradeGap(69.99, null)).toBeNull()
    expect(gawkUpgradeGap(0, 89.99)).toBeNull()
  })
})

describe('GAWK_UPGRADES', () => {
  it('has exactly one featured Rose, for the hero card', () => {
    expect(GAWK_UPGRADES.filter(u => u.featured).map(u => u.name)).toEqual(['Male Rose 3'])
  })

  it('never hardcodes a price or a dash, and the compare grid has a cell per column', () => {
    const words = GAWK_UPGRADES.flatMap(u => [u.headline, u.pitch, u.cta, ...u.adds]).join(' ')
    expect(words).not.toMatch(/\$\d/)
    expect(words).not.toContain('\u2014')
    for (const r of GAWK_COMPARE_ROWS) expect(r.has).toHaveLength(GAWK_COMPARE_COLUMNS.length)
  })
})

describe('gawkOffer', () => {
  it('has no offer without a compare-at price', () => {
    expect(gawkOffer(69.97, null)).toBeNull()
  })

  it('has no offer below the badge floor, which is the live price today', () => {
    expect(gawkOffer(69.97, 69.99)).toBeNull()
  })

  it('has no offer when compare-at is not above the price', () => {
    expect(gawkOffer(69.97, 69.97)).toBeNull()
  })

  it('computes a real discount from Shopify numbers', () => {
    expect(gawkOffer(69.97, 99.99)).toEqual({ label: '30% OFF', was: 99.99, save: 30.02 })
  })
})

describe('page copy', () => {
  const copy =
    readFileSync(new URL('./gawk-sales-page.ts', import.meta.url), 'utf8') +
    readFileSync(new URL('../components/funnel/GawkSalesView.tsx', import.meta.url), 'utf8')

  it('has no em or en dashes', () => {
    expect(copy).not.toMatch(/[—–]/)
  })

  it('makes no scarcity claims and hardcodes no price', () => {
    expect(copy).not.toMatch(/sold out everywhere|sell out|while (this batch|stock) lasts|limited offer|back in stock|before it's gone/i)
    expect(copy).not.toMatch(/\$(69|142)\.\d\d/)
  })
})
