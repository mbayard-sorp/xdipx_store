import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { gawkOffer } from './gawk-sales-page'

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
