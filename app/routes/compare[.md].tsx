/**
 * /compare.md — Markdown twin for the comparison hub.
 * Cache-Control: 1h (the list changes when a comparison is published).
 */

import { getComparisonList } from '~/lib/sanity.server'
import { comparisonHubToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

export async function loader() {
  const body = await cached('md:compare-hub', 3600, async () => {
    let entries: Awaited<ReturnType<typeof getComparisonList>> = []
    try {
      entries = await getComparisonList()
    } catch (err) {
      console.error('[md:compare] getComparisonList failed:', err)
      entries = []
    }
    return comparisonHubToMarkdown(entries.map(c => ({ slug: c.slug, title: c.title, excerpt: c.excerpt })))
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/compare>; rel="canonical"`,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
