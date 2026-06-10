/**
 * /products/:slug.md — Markdown twin for the product detail page.
 *
 * Mirrors the HTML PDP's 404/410 logic exactly:
 * - Missing product  → 404
 * - Archived product → 410
 * - map_restricted   → price shown without struck/compare-at context
 */

import type { LoaderFunctionArgs } from 'react-router'
import { getDealByHandle } from '~/lib/shopify.server'
import { getProductFaqs } from '~/lib/sanity.server'
import { productToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params['slug']!

  // Each upstream is individually guarded so a Sanity failure doesn't 500 the route.
  const guard = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch(err => {
      console.error(`[md:products/${slug}] ${name} failed:`, err)
      return fallback
    })

  const cacheKey = `md:product:${slug}`
  const TTL = 900 // 15 minutes

  const body = await cached(cacheKey, TTL, async () => {
    const [deal, faqs] = await Promise.all([
      guard(getDealByHandle(slug), null, 'getDealByHandle'),
      guard(getProductFaqs(slug), [], 'getProductFaqs'),
    ])

    if (!deal) return null
    if (deal.dealStatus === 'archived') return 'archived'

    let md = productToMarkdown(deal)

    // Append FAQs if present
    if (faqs && faqs.length > 0) {
      const faqLines: string[] = ['', '## Frequently asked questions', '']
      for (const faq of faqs) {
        faqLines.push(`## ${faq.question}`)
        faqLines.push('')
        faqLines.push(faq.answer)
        faqLines.push('')
      }
      md = md + faqLines.join('\n')
    }

    return md
  })

  if (body === null) {
    return new Response('Product not found', { status: 404 })
  }
  if (body === 'archived') {
    return new Response('This product is no longer available', { status: 410 })
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/products/${slug}>; rel="canonical"`,
      'Cache-Control': 'public, max-age=900',
    },
  })
}
