/**
 * /shop/:tag/:type.md — Markdown twin for the programmatic SEO pilot pages.
 * Cache-Control: 1h, matching the discovery index's own read TTL rather than
 * the 24h the comparison twin uses, since the discovery index can change
 * same-day as the catalog does.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { getPseoCombo, buildPseoFaqs, PSEO_MIN_PRODUCTS } from '~/lib/pseo-combos.server'
import { pseoComboToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

export async function loader({ params }: LoaderFunctionArgs) {
  const tagSlug = params['tag']!
  const typeSlug = params['type']!
  const cacheKey = `md:shop:${tagSlug}:${typeSlug}`
  const TTL = 3600 // 1 hour

  const body = await cached(cacheKey, TTL, async () => {
    const combo = await getPseoCombo(tagSlug, typeSlug)
    if (!combo || combo.products.length < PSEO_MIN_PRODUCTS) return null

    const faqs = buildPseoFaqs(combo.tag.label, combo.typeLabel)
    return pseoComboToMarkdown({
      tagSlug: combo.tag.slug,
      typeSlug: combo.type,
      tagLabel: combo.tag.label,
      typeLabel: combo.typeLabel,
      products: combo.products,
      faqs,
    })
  })

  if (body === null) {
    return new Response('Not found', { status: 404 })
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/shop/${tagSlug}/${typeSlug}>; rel="canonical"`,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
