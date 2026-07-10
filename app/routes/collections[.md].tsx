/**
 * /collections.md — Markdown twin for the collections hub: every published
 * collection grouped by type (category / brand / theme), matching the HTML
 * hub's sections, plus the hub intro and FAQs from Sanity.
 * Cache-Control: 1h (the hub changes when collections are added/removed).
 */

import { getCollectionList } from '~/lib/shopify.server'
import { getCollectionsHub, getCollectionTypeMap, type CollectionType } from '~/lib/sanity.server'
import { collectionsHubToMarkdown, htmlToMarkdown } from '~/lib/markdown-page.server'
import { cached } from '~/lib/kv.server'

const BASE_URL = 'https://xdipx.com'

// Mirrors the HTML hub's defaults and section order (_layout.collections._index.tsx).
const HUB_H1_DEFAULT = 'Browse collections'
const HUB_INTRO_DEFAULT =
  "Every category Emma covers — wands, vibrators, lubes, wear, couples picks. Pick a shelf and start browsing, or let Emma's pick guide you on the home page."

const TYPE_SECTIONS: ReadonlyArray<{ type: CollectionType; heading: string }> = [
  { type: 'category', heading: 'Shop by category' },
  { type: 'brand',    heading: 'Shop by brand'    },
  { type: 'theme',    heading: 'Shop by theme'    },
]

export async function loader() {
  const guard = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch(err => {
      console.error(`[md:collections] ${name} failed:`, err)
      return fallback
    })

  const body = await cached('md:collections-hub', 3600, async () => {
    const [collections, hub, typeMap] = await Promise.all([
      guard(getCollectionList(), [], 'getCollectionList'),
      guard(getCollectionsHub(), null, 'getCollectionsHub'),
      guard(getCollectionTypeMap(), new Map<string, CollectionType>(), 'getCollectionTypeMap'),
    ])

    // Same grouping as the HTML hub: untagged collections default to "category".
    const grouped: Record<CollectionType, typeof collections> = { category: [], brand: [], theme: [] }
    for (const c of collections) {
      const type = typeMap.get(c.handle) ?? 'category'
      grouped[type].push(c)
    }

    const introMarkdown = hub?.introHtml ? htmlToMarkdown(hub.introHtml) : HUB_INTRO_DEFAULT

    return collectionsHubToMarkdown({
      title: hub?.h1 || HUB_H1_DEFAULT,
      introMarkdown,
      groups: TYPE_SECTIONS.map(({ type, heading }) => ({
        heading,
        collections: grouped[type].map(c => ({
          handle: c.handle,
          title: c.title,
          description: c.description,
          productsCount: c.productsCount,
        })),
      })),
      faqs: hub?.faqs?.length ? hub.faqs : undefined,
    })
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/collections>; rel="canonical"`,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
