/**
 * /discover.md — Markdown twin for "The Compass" product finder.
 *
 * The interactive finder can't be exercised by an LLM crawler, so this twin
 * lists the discovery catalog grouped by the same mood / audience / matters
 * taxonomy the finder filters on, with links to canonical product pages.
 *
 * Reads the KV-cached discovery index directly (getDiscoveryIndex has its own
 * L1/KV/Neon caching), so no extra cache layer is needed here.
 * Cache-Control: 1h (index rebuilds are cron-driven, tags change slowly).
 */

import { getDiscoveryIndex, getDiscoveryVocab } from '~/lib/discovery.server'
import { discoverToMarkdown, type DiscoverGroup } from '~/lib/markdown-page.server'
import type { DiscoveryProduct } from '~/types/discovery'

const BASE_URL = 'https://xdipx.com'

// Keep each tag section scannable; the totals still say how deep the shelf goes.
const MAX_PRODUCTS_PER_TAG = 8

function buildGroups(
  index: DiscoveryProduct[],
  key: 'mood' | 'audience' | 'matters',
  tags: string[],
): DiscoverGroup[] {
  return tags
    .map(tag => {
      const matches = index.filter(p => (p[key] as readonly string[]).includes(tag))
      return {
        tag,
        total: matches.length,
        products: matches.slice(0, MAX_PRODUCTS_PER_TAG).map(p => ({
          handle: p.handle,
          title: p.title,
          price: p.price,
          priceMax: p.priceMax,
        })),
      }
    })
    .filter(g => g.total > 0)
}

export async function loader() {
  const guard = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch(err => {
      console.error(`[md:discover] ${name} failed:`, err)
      return fallback
    })

  const [index, vocab] = await Promise.all([
    guard(getDiscoveryIndex(), [], 'getDiscoveryIndex'),
    guard(getDiscoveryVocab(), { moods: [], audiences: [], matters: [] }, 'getDiscoveryVocab'),
  ])

  const body = discoverToMarkdown({
    moods: buildGroups(index, 'mood', vocab.moods),
    audiences: buildGroups(index, 'audience', vocab.audiences),
    matters: buildGroups(index, 'matters', vocab.matters),
  })

  // A cold or rebuilding index yields a group-less page; keep that snapshot
  // short-lived so the CDN picks up the populated version quickly.
  const maxAge = index.length > 0 ? 3600 : 300

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Link': `<${BASE_URL}/discover>; rel="canonical"`,
      'Cache-Control': `public, max-age=${maxAge}`,
    },
  })
}
