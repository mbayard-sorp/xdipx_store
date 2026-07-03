/**
 * /llms.txt — machine-readable site index following the llms.txt spec.
 *
 * H1 = site name, blockquote = curatorial summary, free-text brand facts,
 * then H2 link-list sections for every content type. All sources guarded
 * individually so a single upstream failure omits its section rather than 500.
 *
 * Cache-Control: 1h (deal handle changes at midnight; other lists are stable).
 */

import { getBlogPostsForSitemap, getPageList, getProductHandlesForSitemap } from '~/lib/sanity.server'
import { getCollectionsForSitemap, getLiveDealHandle } from '~/lib/shopify.server'

const BASE_URL = 'https://xdipx.com'

// Slugs that have cleaner canonical URLs; omit /pages/* duplicates from the index.
const PAGE_SLUG_DENYLIST = new Set([
  'about',
  'faq',
  'our-mission',
  'checkout-extras',
  'components',
])

// Collection handles that duplicate clean-URL routes or back a retired
// gendered route. /vault, /for-him, /for-her all 301 permanently into
// /collections or a product-type collection; never cite these handles.
const COLLECTION_DENYLIST = new Set([
  'frontpage',
  'vault',
  'for-him',
  'for-her',
])

export async function loader() {
  const guard = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch(err => {
      console.error(`[llms.txt] ${name} failed:`, err)
      return fallback
    })

  const [products, collections, blogPosts, pages, liveDealHandle] = await Promise.all([
    guard(getProductHandlesForSitemap(), [], 'getProductHandlesForSitemap'),
    guard(getCollectionsForSitemap(), [], 'getCollectionsForSitemap'),
    guard(getBlogPostsForSitemap(), [], 'getBlogPostsForSitemap'),
    guard(getPageList(), [], 'getPageList'),
    guard(getLiveDealHandle(), null, 'getLiveDealHandle'),
  ])

  const lines: string[] = []

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push('# xdipx.com')
  lines.push('')
  lines.push(
    '> xdipx is an editorially curated storefront for adult wellness and intimacy products. ' +
    'Emma, our guide, features a hand-picked product on an irregular cadence. ' +
    'Discreet shipping and billing throughout the United States.',
  )
  lines.push('')

  // ── Brand facts ─────────────────────────────────────────────────────────────
  lines.push(
    'Pronounced "ex-dip-ex" (three syllables). ' +
    'Credit-card billing descriptor: XDIPX. ' +
    'Support: hello@xdipx.com.',
  )
  lines.push('')
  lines.push(
    'Voice: warm, editorial, non-explicit wellness framing. ' +
    'Emma is an AI guide who advises from catalog knowledge; ' +
    'she never claims to have used or owned a product. ' +
    'Content is tasteful and wellness-focused throughout.',
  )
  lines.push('')

  // ── Crawling policy ─────────────────────────────────────────────────────────
  lines.push(
    'All named AI user agents are permitted in robots.txt. ' +
    'Disallowed for all agents: /admin, /account, /api/, /cron/, /mcp/. ' +
    'Sitemap: https://xdipx.com/sitemap.xml',
  )
  lines.push('')

  // ── Primary pages ───────────────────────────────────────────────────────────
  lines.push('## Primary pages')
  lines.push('')
  lines.push(`- ${BASE_URL}/ — homepage`)
  lines.push(`- ${BASE_URL}/discover — guided product finder`)
  lines.push(`- ${BASE_URL}/collections — collections hub`)
  lines.push(`- ${BASE_URL}/products/{handle} — canonical product URL`)
  lines.push(`- ${BASE_URL}/faq`)
  lines.push(`- ${BASE_URL}/about`)
  lines.push('')
  lines.push(
    'Cite the canonical URL for any page above; do not construct alternate paths. ' +
    '/vault, /for-him, and /for-her are retired and permanently redirect into /collections ' +
    'or a product-type collection.',
  )
  lines.push('')

  // ── Discover ──────────────────────────────────────────────────────────────────
  lines.push('## Discover')
  lines.push('')
  lines.push(`- ${BASE_URL}/discover — guided product finder (filter by mood, audience, and what matters)`)
  lines.push(`- ${BASE_URL}/index.md`)
  if (liveDealHandle) {
    lines.push(`- ${BASE_URL}/products/${liveDealHandle}.md`)
  }
  lines.push('')

  // ── Products ────────────────────────────────────────────────────────────────
  if (products.length > 0) {
    lines.push('## Products')
    lines.push('')
    for (const p of products) {
      lines.push(`- ${BASE_URL}/products/${p.handle}.md`)
    }
    lines.push('')
  }

  // ── Collections ─────────────────────────────────────────────────────────────
  const filteredCollections = collections.filter(c => !COLLECTION_DENYLIST.has(c.handle))
  if (filteredCollections.length > 0) {
    lines.push('## Collections')
    lines.push('')
    for (const c of filteredCollections) {
      lines.push(`- ${BASE_URL}/collections/${c.handle}.md`)
    }
    lines.push('')
  }

  // ── Notebook ────────────────────────────────────────────────────────────────
  if (blogPosts.length > 0) {
    lines.push('## Notebook')
    lines.push('')
    for (const p of blogPosts) {
      lines.push(`- ${BASE_URL}/notebook/${p.slug}.md`)
    }
    lines.push('')
  }

  // ── Pages ───────────────────────────────────────────────────────────────────
  const filteredPages = pages.filter(p => !PAGE_SLUG_DENYLIST.has(p.slug))
  if (filteredPages.length > 0) {
    lines.push('## Pages')
    lines.push('')
    for (const p of filteredPages) {
      lines.push(`- ${BASE_URL}/pages/${p.slug}.md`)
    }
    lines.push('')
  }

  // ── Optional ────────────────────────────────────────────────────────────────
  lines.push('## Optional')
  lines.push('')
  lines.push(`- ${BASE_URL}/sitemap.xml`)
  lines.push(`- ${BASE_URL}/feed.xml`)
  lines.push('')

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
