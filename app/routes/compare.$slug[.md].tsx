/**
 * /compare/:slug.md — Markdown twin for comparison pages.
 * Cache-Control: 24h (comparisons change rarely after publish).
 */

import type { LoaderFunctionArgs } from 'react-router'
import { getComparison } from '~/lib/sanity.server'
import { comparisonToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params['slug']!
  const cacheKey = `md:compare:${slug}`
  const TTL = 86400 // 24 hours

  const body = await cached(cacheKey, TTL, async () => {
    let comparison: Awaited<ReturnType<typeof getComparison>> = null
    try {
      comparison = await getComparison(slug)
    } catch (err) {
      console.error(`[md:compare/${slug}] getComparison failed:`, err)
      return null
    }

    if (!comparison) return null

    return comparisonToMarkdown(comparison)
  })

  if (body === null) {
    return new Response('Comparison not found', { status: 404 })
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/compare/${slug}>; rel="canonical"`,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
