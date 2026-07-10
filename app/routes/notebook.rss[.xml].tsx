/**
 * /notebook/rss.xml -- RSS 2.0 feed for The Notebook (xdipx's blog).
 * Lets readers and feed readers subscribe without visiting the site.
 */

import { getBlogPosts } from '~/lib/sanity.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'
const FEED_URL = `${BASE_URL}/notebook/rss.xml`

// Same ceiling used by the notebook markdown twins -- covers the whole
// archive for the foreseeable future.
const MAX_POSTS = 50

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** RFC 822 date string required by the RSS 2.0 spec for pubDate. */
function toRfc822(dateStr: string | undefined): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return d.toUTCString()
}

async function buildRssXml(): Promise<string> {
  const guard = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch(err => {
      console.error(`[notebook/rss.xml] ${name} failed:`, err)
      return fallback
    })

  const { posts } = await guard(
    getBlogPosts({ page: 1, perPage: MAX_POSTS }),
    { posts: [], total: 0 },
    'getBlogPosts',
  )

  const items = posts
    .map(p => {
      const link = `${BASE_URL}/notebook/${p.slug}`
      const pubDate = toRfc822(p.publishedAt)
      const description = p.excerpt ?? ''

      return [
        '    <item>',
        `      <title>${xmlEscape(p.title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
        pubDate ? `      <pubDate>${pubDate}</pubDate>` : '',
        p.category?.name ? `      <category>${xmlEscape(p.category.name)}</category>` : '',
        description ? `      <description><![CDATA[${description}]]></description>` : '',
        '    </item>',
      ].filter(Boolean).join('\n')
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The xdipx Notebook</title>
    <link>${BASE_URL}/notebook</link>
    <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml" />
    <description>Things worth knowing, things worth trying, from the xdipx notebook.</description>
    <language>en-us</language>
${items}
  </channel>
</rss>`
}

export async function loader() {
  // Plain XML string, safe to round-trip through cached()'s KV JSON layer
  // (no Map/Set/Date values touch the cache).
  const body = await cached('notebook:rss:xml:v1', 900, buildRssXml)

  return new Response(body, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=1800',
    },
  })
}
