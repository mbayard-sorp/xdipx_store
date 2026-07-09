/**
 * /pages/:slug.md — Markdown twin for generic Sanity pages.
 * Cache-Control: 24h (static pages change rarely).
 *
 * Excludes the same slug denylist as the sitemap so we don't serve
 * duplicate content for pages with cleaner canonical URLs (/about, /faq, etc.).
 */

import type { LoaderFunctionArgs } from 'react-router'
import { getPage } from '~/lib/sanity.server'
import { pageToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

// Slugs with cleaner canonical URLs 404 here; dedicated twins live at /about.md and /faq.md.
const PAGE_SLUG_DENYLIST = new Set([
  'about',
  'faq',
  'our-mission',
  'checkout-extras',
  'components',
])

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params['slug']!

  if (PAGE_SLUG_DENYLIST.has(slug)) {
    return new Response('Not found', { status: 404 })
  }

  const cacheKey = `md:page:${slug}`
  const TTL = 86400 // 24 hours

  const body = await cached(cacheKey, TTL, async () => {
    let page: Awaited<ReturnType<typeof getPage>> = null
    try {
      page = await getPage(slug)
    } catch (err) {
      console.error(`[md:pages/${slug}] getPage failed:`, err)
      return null
    }

    if (!page) return null

    return pageToMarkdown({
      slug: page.slug,
      title: page.title,
      sections: page.sections ?? undefined,
    })
  })

  if (body === null) {
    return new Response('Page not found', { status: 404 })
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/pages/${slug}>; rel="canonical"`,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
