/**
 * /about.md — Markdown twin for the about page.
 * Canonical is the clean /about URL (the /pages/about.md twin is denylisted).
 * Cache-Control: 24h (static page, changes rarely).
 */

import { getPage } from '~/lib/sanity.server'
import { pageToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

export async function loader() {
  const body = await cached('md:about', 86400, async () => {
    let page: Awaited<ReturnType<typeof getPage>> = null
    try {
      page = await getPage('about')
    } catch (err) {
      console.error('[md:about] getPage failed:', err)
      return null
    }

    if (!page) return null

    return pageToMarkdown({
      slug: page.slug,
      title: page.title,
      sections: page.sections ?? undefined,
      description: page.seoDescription ?? undefined,
      canonicalPath: '/about',
    })
  })

  if (body === null) {
    return new Response('Page not found', { status: 404 })
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/about>; rel="canonical"`,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
