/**
 * /collections/:handle.md — Markdown twin for collection pages.
 * Cache-Control: 1h (collection product lists change infrequently).
 */

import { redirect, type LoaderFunctionArgs } from 'react-router'
import { getCollection, getCollectionProducts } from '~/lib/shopify.server'
import { getCollectionPage } from '~/lib/sanity.server'
import { getCategoryPage } from '~/lib/category-page.server'
import { collectionToMarkdown, htmlToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'
import { collectionRedirect, markdownRedirectTarget } from '~/lib/collection-taxonomy'

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

  // Set when getCollection threw rather than returned nothing, so a Shopify
  // blip never turns into a permanent redirect below.
  let lookupFailed = false

  const body = await cached(cacheKey, TTL, async () => {
    const [col, products, sanity, categoryPage] = await Promise.all([
      getCollection(handle).catch(err => {
        lookupFailed = true
        console.error(`[md:collections/${handle}] getCollection failed:`, err)
        return null
      }),
      guard(getCollectionProducts(handle, 50), [], 'getCollectionProducts'),
      guard(getCollectionPage(handle), null, 'getCollectionPage'),
      guard(getCategoryPage(handle), null, 'getCategoryPage'),
    ])

    if (!col) return null

    // Same priority as the HTML route: the merchandised masthead standfirst
    // wins, then the Sanity Emma-voice intro, then the Shopify description.
    const masthead = categoryPage?.blocks.find(b => b._type === 'categoryMasthead')
    const standfirst = masthead && masthead._type === 'categoryMasthead' ? masthead.standfirst : null
    const introMarkdown =
      standfirst ?? (sanity?.introHtml ? htmlToMarkdown(sanity.introHtml) : undefined)

    return collectionToMarkdown({
      handle: col.handle,
      title: sanity?.h1 ?? col.seoTitle ?? col.title,
      description: col.description || undefined,
      introMarkdown,
      faqs: (() => {
        const block = categoryPage?.blocks.find(b => b._type === 'faqBlock')
        if (block && block._type === 'faqBlock') return block.items
        return sanity?.faqs?.length ? sanity.faqs : undefined
      })(),
      products: products.map(p => ({
        handle: p.handle,
        title: p.title,
        price: p.price,
      })),
    })
  })

  if (body === null) {
    const moved = lookupFailed ? null : collectionRedirect(handle)
    if (moved?.kind === 'redirect') throw redirect(markdownRedirectTarget(moved.to), 301)
    if (moved?.kind === 'gone') return new Response('Collection removed', { status: 410 })
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
