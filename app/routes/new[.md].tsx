/**
 * /new.md — Markdown twin for the New Arrivals browse page (tag:new-arrival).
 * Cache-Control: 10 min — new arrivals can land at any time via the import
 * queue, so this stays fresher than the 1h collection twins.
 */

import { getProductsByTagPaged } from '~/lib/shopify.server'
import { collectionToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'
const TAG = 'new-arrival'
const LIMIT = 50

export async function loader() {
  const cacheKey = 'md:new-arrivals'
  const TTL = 600 // 10 minutes

  const body = await cached(cacheKey, TTL, async () => {
    const { deals } = await getProductsByTagPaged(TAG, 1, LIMIT).catch(() => ({ deals: [], hasNextPage: false }))

    return collectionToMarkdown({
      handle: 'new-arrivals',
      path: '/new',
      title: 'New Arrivals',
      description:
        "The newest picks on xdipx.com, hand-checked the same way as everything else here. " +
        "Each one settles into its own category page eventually, this is just where it lands first.",
      productsHeading: 'New arrivals',
      products: deals.map(d => ({
        handle: d.handle,
        title: d.seoTitle,
        price: d.dealPrice,
      })),
    })
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/new>; rel="canonical"`,
      'Cache-Control': 'public, max-age=600',
    },
  })
}
