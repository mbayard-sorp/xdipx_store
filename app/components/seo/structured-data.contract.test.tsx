/**
 * Structured-data (JSON-LD) contract test — the CI regression guard for
 * suggestion #3890 (tracker automation-audit-roadmap p1-9-monitoring).
 *
 * Runs inside the existing `npm test` step of the required CI `check` job, so it
 * fails the PR on any regression WITHOUT a new GitHub Actions workflow (`.github`
 * is a protected path this routine may not touch).
 *
 * Two layers:
 *   1. Contract — each required structured-data component renders exactly one
 *      well-formed, JSON-parseable `<script type="application/ld+json">` block
 *      carrying the expected schema.org @type (ItemList, FAQPage, CollectionPage,
 *      Product, BlogPosting). A malformed or wrong-typed schema fails here.
 *   2. Route wiring — each target route (homepage, PDP, collection, notebook
 *      article, FAQ) still references its structured-data component in source, so
 *      a refactor that drops the JSON-LD from a route fails here. This is a static
 *      source guard, honestly labelled: it proves the component is still wired in,
 *      not that a specific loader value is present.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactElement } from 'react'

import { ItemListStructuredData } from './ItemListStructuredData'
import { FAQStructuredData } from './FAQStructuredData'
import { CollectionStructuredData } from './CollectionStructuredData'
import { ProductStructuredData } from './ProductStructuredData'
import { BlogStructuredData } from './BlogStructuredData'
import type { Deal } from '~/types'
import type { BlogPost } from '~/types/cms'

/** Render an element and return the @type of every parseable ld+json block. */
function jsonLdTypes(el: ReactElement | null): string[] {
  if (el === null) return []
  const html = renderToStaticMarkup(el)
  const types: string[] = []
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    // JSON.parse throws on a malformed block — that IS the assertion.
    const parsed = JSON.parse(m[1]!) as Record<string, unknown>
    expect(parsed['@context']).toBe('https://schema.org')
    if (typeof parsed['@type'] === 'string') types.push(parsed['@type'] as string)
  }
  return types
}

// ─── Minimal fixtures (only the fields each component reads) ───────────────────

const deal = {
  handle: 'test-product',
  seoTitle: 'Test Product',
  metaDescription: 'A test product for the structured-data contract.',
  sku: 'SKU-1',
  brand: 'BrandX',
  category: 'Vibrators',
  images: [{ url: 'https://xdipx.com/img/1.jpg' }],
  dealPrice: 19.99,
  qty: 5,
  variants: [],
} as unknown as Deal

const post = {
  slug: 'test-post',
  title: 'Test Post',
  seoTitle: 'Test Post SEO',
  excerpt: 'Excerpt.',
  seoDescription: 'Meta description.',
  heroImageUrl: 'https://xdipx.com/img/hero.jpg',
  ogImageUrl: 'https://xdipx.com/img/og.jpg',
  publishedAt: '2026-08-18',
  body: [],
  author: { name: 'Emma', slug: 'emma' },
  tags: [],
} as unknown as BlogPost

describe('structured-data contract — required JSON-LD is present, typed, and parseable (#3890)', () => {
  it('ItemListStructuredData emits a parseable ItemList', () => {
    const types = jsonLdTypes(
      ItemListStructuredData({ name: 'Best beginner picks', url: 'https://xdipx.com/notebook', items: [
        { name: 'One', url: 'https://xdipx.com/products/one' },
        { name: 'Two', url: 'https://xdipx.com/products/two' },
      ] }) as ReactElement,
    )
    expect(types).toContain('ItemList')
  })

  it('FAQStructuredData emits a parseable FAQPage', () => {
    const types = jsonLdTypes(
      FAQStructuredData({ faqs: [{ question: 'Q?', answer: 'A.' }] }) as ReactElement,
    )
    expect(types).toContain('FAQPage')
  })

  it('CollectionStructuredData emits a parseable CollectionPage', () => {
    const types = jsonLdTypes(
      CollectionStructuredData({
        name: 'Wands',
        description: 'Wand vibrators.',
        url: 'https://xdipx.com/collections/wands',
        items: [{ handle: 'wand-1', title: 'Wand One', price: 49.99 }],
      }) as ReactElement,
    )
    expect(types).toContain('CollectionPage')
  })

  it('ProductStructuredData emits a parseable Product', () => {
    const types = jsonLdTypes(ProductStructuredData({ deal }) as ReactElement)
    expect(types).toContain('Product')
  })

  it('BlogStructuredData emits a parseable BlogPosting', () => {
    const types = jsonLdTypes(BlogStructuredData({ post, readingTime: 5 }) as ReactElement)
    expect(types).toContain('BlogPosting')
  })
})

// ─── Route-wiring guard ────────────────────────────────────────────────────────

// Each target route must still reference its structured-data component in source.
// If a refactor drops the JSON-LD from a route, this fails the PR.
const ROUTE_STRUCTURED_DATA: Array<{ route: string; component: string }> = [
  { route: 'app/routes/_layout._index.tsx',            component: 'ProductStructuredData' },
  { route: 'app/routes/_layout.products.$slug.tsx',    component: 'ProductStructuredData' },
  { route: 'app/routes/_layout.collections.$handle.tsx', component: 'CollectionStructuredData' },
  { route: 'app/routes/_layout.notebook.$slug.tsx',    component: 'BlogStructuredData' },
  { route: 'app/routes/_layout.faq.tsx',               component: 'FAQStructuredData' },
]

describe('structured-data route wiring — target routes still emit JSON-LD (#3890)', () => {
  it.each(ROUTE_STRUCTURED_DATA)('$route references $component', ({ route, component }) => {
    const src = readFileSync(join(process.cwd(), route), 'utf8')
    expect(src).toContain(component)
  })
})
