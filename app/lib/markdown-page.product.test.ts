import { describe, it, expect } from 'vitest'
import { productToMarkdown } from './markdown-page.server'
import type { Deal } from '~/types'

// Minimal Deal: only the fields productToMarkdown reads. Cast because the full
// type carries dozens of PDP-only fields that are irrelevant to the twin.
function deal(over: Partial<Deal> = {}): Deal {
  return {
    handle: 'test-wand',
    sku: '12345',
    nalpacSku: 'NP-12345',
    seoTitle: 'Test Wand',
    metaDescription: 'A wand.',
    tagline: 'Warm, quiet, patient.',
    fullStory: '<p>Story.</p>',
    worksForHim: '',
    worksForHer: '',
    boxContents: [],
    images: [],
    dealPrice: 49.99,
    msrp: 59.99,
    brand: 'Acme',
    category: ['couples'],
    qty: 4,
    variants: [
      { id: 'gid://shopify/ProductVariant/1', title: 'Plum', selectedOptions: [], price: '49.99', compareAtPrice: null, availableForSale: true, quantityAvailable: 4, barcode: '012345678905' },
      { id: 'gid://shopify/ProductVariant/2', title: 'Coral', selectedOptions: [], price: '54.99', compareAtPrice: null, availableForSale: false, quantityAvailable: 0 },
    ],
    ...over,
  } as unknown as Deal
}

describe('productToMarkdown', () => {
  it('leads with the factual answer, then a Key facts block with identifiers, variants and policies', () => {
    const md = productToMarkdown(deal())
    const whatIt = md.indexOf('## What it is')
    const facts = md.indexOf('## Key facts')
    const take = md.indexOf("## Emma's take")
    expect(whatIt).toBeGreaterThan(-1)
    expect(facts).toBeGreaterThan(whatIt)
    expect(take).toBeGreaterThan(facts)

    expect(md).toContain('- Brand: Acme')
    expect(md).toContain('- SKU: 12345')
    expect(md).toContain('- GTIN: 012345678905')
    expect(md).toContain('- MPN: NP-12345')
    expect(md).toContain('- Category: couples')
    expect(md).toContain('  - Plum: $49.99, in stock')
    expect(md).toContain('  - Coral: $54.99, out of stock')
    expect(md).toContain('within 30 days')
    expect(md).toContain('Card statement reads: XDIPX')
  })

  it('omits the rating line until real reviews exist, and shows it when they do', () => {
    expect(productToMarkdown(deal())).not.toContain('Customer rating')
    const md = productToMarkdown(deal({ rating: { value: 4.6, count: 12 } }))
    expect(md).toContain('- Customer rating: 4.6 out of 5 (12 reviews)')
  })

  it('renders FAQs before the footer, never after the canonical line', () => {
    const md = productToMarkdown(deal(), {
      faqs: [{ question: 'Is it quiet?', answer: 'Yes, under a duvet it is barely audible.' }],
    })
    const faq = md.indexOf('## Frequently asked questions')
    const q = md.indexOf('## Is it quiet?')
    const canonical = md.indexOf('Canonical: https://xdipx.com/products/test-wand')
    expect(faq).toBeGreaterThan(-1)
    expect(q).toBeGreaterThan(faq)
    expect(canonical).toBeGreaterThan(q)
    expect(md.trimEnd().endsWith('Billing descriptor: XDIPX.')).toBe(true)
  })

  it('does not emit a Variants list for single-variant products', () => {
    const md = productToMarkdown(deal({ variants: [{ id: 'gid://shopify/ProductVariant/1', title: 'Default Title', selectedOptions: [], price: '49.99', compareAtPrice: null, availableForSale: true, quantityAvailable: 4 }] }))
    expect(md).not.toContain('- Variants:')
  })
})
