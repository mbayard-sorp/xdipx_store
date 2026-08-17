import { describe, it, expect } from 'vitest'
import {
  feedShippingLines,
  stripDollarAmounts,
  US_SHIPPING_FLAT_RATE,
  REMOTE_FREE_SHIPPING_THRESHOLD,
} from '~/lib/gmc-feed'
import { FREE_SHIPPING_THRESHOLD } from '~/lib/shipping'

// Ticket #3425: the feed's <g:shipping> blocks must mirror what checkout
// charges for a single-unit cart, and no <g:description> may carry a
// literal dollar amount. A blanket 0.00 (or absent) shipping block while
// checkout charges $9.99 is a Merchant Center misrepresentation risk.

describe('feedShippingLines', () => {
  it('charges the flat rate below the free-shipping threshold', () => {
    const lines = feedShippingLines(29.99)
    // Below both thresholds every region pays the same flat rate, so a
    // single country-level block suffices.
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('<g:country>US</g:country>')
    expect(lines[0]).not.toContain('<g:region>')
    expect(lines[0]).toContain(`<g:price>${US_SHIPPING_FLAT_RATE.toFixed(2)} USD</g:price>`)
  })

  it('ships free at the US threshold but still charges HI/AK/PR', () => {
    const lines = feedShippingLines(FREE_SHIPPING_THRESHOLD)
    expect(lines).toHaveLength(4)
    for (const region of ['AK', 'HI', 'PR']) {
      const block = lines.find(l => l.includes(`<g:region>${region}</g:region>`))
      expect(block).toBeDefined()
      expect(block).toContain(`<g:price>${US_SHIPPING_FLAT_RATE.toFixed(2)} USD</g:price>`)
    }
    const countryBlock = lines[lines.length - 1]
    expect(countryBlock).not.toContain('<g:region>')
    expect(countryBlock).toContain('<g:price>0.00 USD</g:price>')
  })

  it('ships free everywhere at the remote threshold', () => {
    const lines = feedShippingLines(REMOTE_FREE_SHIPPING_THRESHOLD)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('<g:price>0.00 USD</g:price>')
  })

  it('never emits a 0.00 country block for a sub-threshold item', () => {
    for (const price of [0.01, 9.99, 49.5, FREE_SHIPPING_THRESHOLD - 0.01]) {
      const lines = feedShippingLines(price)
      expect(lines.join('')).not.toContain('<g:price>0.00 USD</g:price>')
    }
  })
})

describe('stripDollarAmounts', () => {
  it('passes price-free text through unchanged', () => {
    const text = 'Soft silicone, ten settings, fully waterproof.'
    expect(stripDollarAmounts(text)).toBe(text)
  })

  it('drops the sentence carrying an interpolated price', () => {
    const text = 'A quiet little wand with real range. Yours for $29.99 at xdipx. Ships discreetly.'
    const out = stripDollarAmounts(text)
    expect(out).toBe('A quiet little wand with real range. Ships discreetly.')
    expect(out).not.toMatch(/\$\d/)
  })

  it('excises the amount when the whole text is one sentence', () => {
    const out = stripDollarAmounts('Now $1,299.00 and worth every bit of it')
    expect(out).not.toMatch(/\$\s?\d/)
    expect(out).toBe('Now and worth every bit of it')
  })

  it('returns empty string when nothing substantial survives, so callers can fall back', () => {
    expect(stripDollarAmounts('$29.99 at xdipx.')).toBe('')
    expect(stripDollarAmounts('Now just $19.99!')).toBe('')
  })
})
