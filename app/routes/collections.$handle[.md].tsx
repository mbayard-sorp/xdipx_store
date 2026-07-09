/**
 * /collections/:handle.md — Markdown twin for collection pages.
 * Cache-Control: 1h (collection product lists change infrequently).
 */

import type { LoaderFunctionArgs } from 'react-router'
import { getCollection, getCollectionProducts } from '~/lib/shopify.server'
import { getCollectionPage } from '~/lib/sanity.server'
import { collectionToMarkdown, htmlToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

export async function loader({ params }: LoaderFunctionArgs) {
  const handle = params['handle']!
  const cacheKey = `md:collection:${handle}`
  const TTL = 3600 // 1 hour

  const guard = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch(err => {
      console.error(`[md:collections/${handle}] ${name} failed:`, err)
      return fallback
    })

  const body = await cached(cacheKey, TTL, async () => {
    const [col, products, sanity] = await Promise.all([
      guard(getCollection(handle), null, 'getCollection'),
      guard(getCollectionProducts(handle, 50), [], 'getCollectionProducts'),
      guard(getCollectionPage(handle), null, 'getCollectionPage'),
    ])

    if (!col) return null

    // Same priority as the HTML route: Sanity Emma-voice intro, then Shopify description.
    const introMarkdown = sanity?.introHtml ? htmlToMarkdown(sanity.introHtml) : undefined

    return collectionToMarkdown({
      handle: col.handle,
      title: sanity?.h1 ?? col.seoTitle ?? col.title,
      description: col.description || undefined,
      introMarkdown,
      faqs: sanity?.faqs?.length ? sanity.faqs : undefined,
      products: products.map(p => ({
        handle: p.handle,
        title: p.title,
        price: p.price,
      })),
    })
  })

  if (body === null) {
    return new Response('Collection not found', { status: 404 })
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/collections/${handle}>; rel="canonical"`,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
