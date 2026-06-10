/**
 * /index.md — Markdown twin for the homepage.
 * Shows today's pick plus navigation links to .md twins.
 * Cache-Control: 15 min (deal rotates at midnight).
 */

import { getDailyDeal } from '~/lib/shopify.server'
import { homepageToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

export async function loader() {
  const cacheKey = 'md:homepage'
  const TTL = 900 // 15 minutes

  const body = await cached(cacheKey, TTL, async () => {
    let deal: Awaited<ReturnType<typeof getDailyDeal>> = null
    try {
      deal = await getDailyDeal()
    } catch (err) {
      console.error('[md:index] getDailyDeal failed:', err)
    }
    return homepageToMarkdown(deal)
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/>; rel="canonical"`,
      'Cache-Control': 'public, max-age=900',
    },
  })
}
