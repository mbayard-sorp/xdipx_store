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

// Static FAQ about the Compass finder itself. Emma voice, no lived experience,
// no em-dashes. Reviewed alongside site copy.
const DISCOVER_FAQS: Array<{ question: string; answer: string }> = [
  {
    question: 'How does the Compass work?',
    answer:
      'You answer a few short questions: the mood you\'re in, who the product is for, and what matters most to you, like quiet or easy cleanup. The shelf narrows to match, no account or sign-in needed.',
  },
  {
    question: 'What do mood, audience, and matters mean?',
    answer:
      'Mood is the occasion or feeling a product suits, like unwinding solo or something to share. Audience is who it\'s designed around. Matters covers practical priorities, size, noise level, or how simple it is to clean. Together they narrow a big catalog to a short one.',
  },
  {
    question: 'Are my answers stored or shared?',
    answer:
      'The Compass keeps your picks in your browser session so the shelf can reshape as you go. Nothing is tied to your name or emailed anywhere. Standard site analytics still apply, the same as any page you visit.',
  },
  {
    question: 'Can I browse without using the finder?',
    answer:
      'Yes. Every product on this page links straight to its own page, and the full catalog is browsable through collections. The Compass is a shortcut, not a requirement.',
  },
  {
    question: 'Does the Compass replace asking a question directly?',
    answer:
      'No. If you\'d rather describe what you\'re looking for in your own words, Emma\'s chat is on the same page and reads from the same catalog knowledge, specs, materials, and review patterns, not personal opinion.',
  },
  {
    question: 'What if nothing matches my answers?',
    answer:
      'The finder shows the closest matches even when a combination is rare, and it never hides the rest of the catalog. Adjust any answer and the shelf updates right away.',
  },
]

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
    faqs: DISCOVER_FAQS,
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
