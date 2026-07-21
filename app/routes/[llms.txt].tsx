/**
 * /llms.txt — machine-readable site index following the llms.txt spec.
 *
 * H1 = site name, blockquote = curatorial summary, free-text brand facts,
 * then H2 link-list sections for every content type. Every list item is a
 * markdown hyperlink (`- [Name](url): details`) per the spec; bare URLs are
 * not recognized as links by llms.txt parsers. All sources guarded
 * individually so a single upstream failure omits its section rather than 500.
 *
 * Cache-Control: 1h (deal handle changes at midnight; other lists are stable).
 */

import { getBlogCategories, getBlogPostsForSitemap, getPageList, getProductHandlesForSitemap } from '~/lib/sanity.server'
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

// Truncates a plain-text description to ~maxLen chars on a word boundary,
// appending an ellipsis. Used for the Notebook posts summaries below.
function truncate(text: string, maxLen: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLen) return trimmed
  const cut = trimmed.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`
}

// Fallback link text when no title is available: "magic-wand-mini" -> "Magic Wand Mini".
function humanizeHandle(handle: string): string {
  return handle
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

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

  const [products, collections, blogPosts, blogCategories, pages, liveDealHandle] = await Promise.all([
    guard(getProductHandlesForSitemap(), [], 'getProductHandlesForSitemap'),
    guard(getCollectionsForSitemap(), [], 'getCollectionsForSitemap'),
    guard(getBlogPostsForSitemap(), [], 'getBlogPostsForSitemap'),
    guard(getBlogCategories(), [], 'getBlogCategories'),
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
  lines.push(`- [Homepage](${BASE_URL}/)`)
  lines.push(`- [Discover](${BASE_URL}/discover): guided product finder`)
  lines.push(`- [New arrivals](${BASE_URL}/new): newest first`)
  lines.push(`- [Collections](${BASE_URL}/collections): collections hub`)
  lines.push(`- [FAQ](${BASE_URL}/faq)`)
  lines.push(`- [About](${BASE_URL}/about)`)
  lines.push(`- [Emma](${BASE_URL}/contributors/emma): who Emma is (AI guide, human-edited)`)
  lines.push('')
  lines.push(
    `Canonical product URLs follow ${BASE_URL}/products/{handle}. ` +
    'Cite the canonical URL for any page above; do not construct alternate paths. ' +
    '/vault, /for-him, and /for-her are retired and permanently redirect into /collections ' +
    'or a product-type collection.',
  )
  lines.push('')

  // ── Discover ──────────────────────────────────────────────────────────────────
  lines.push('## Discover')
  lines.push('')
  lines.push(`- [Discover](${BASE_URL}/discover): guided product finder (filter by mood, audience, and what matters)`)
  lines.push(`- [Discover catalog](${BASE_URL}/discover.md): the finder's catalog grouped by mood, audience, and what matters`)
  lines.push(`- [New arrivals](${BASE_URL}/new.md): newest first`)
  lines.push(`- [Homepage overview](${BASE_URL}/index.md)`)
  if (liveDealHandle) {
    lines.push(`- [Emma's current pick](${BASE_URL}/products/${liveDealHandle}.md)`)
  }
  lines.push('')

  // ── Products ────────────────────────────────────────────────────────────────
  if (products.length > 0) {
    lines.push('## Products')
    lines.push('')
    for (const p of products) {
      const name = (p.title ?? humanizeHandle(p.handle)).replace(/[[\]]/g, '')
      lines.push(`- [${name}](${BASE_URL}/products/${p.handle}.md)`)
    }
    lines.push('')
  }

  // ── Collections ─────────────────────────────────────────────────────────────
  const filteredCollections = collections.filter(c => !COLLECTION_DENYLIST.has(c.handle))
  if (filteredCollections.length > 0) {
    lines.push('## Collections')
    lines.push('')
    lines.push(`- [Collections index](${BASE_URL}/collections.md): all collections, grouped by category, brand, and theme`)
    for (const c of filteredCollections) {
      lines.push(`- [${humanizeHandle(c.handle)}](${BASE_URL}/collections/${c.handle}.md)`)
    }
    lines.push('')
  }

  // ── Notebook ────────────────────────────────────────────────────────────────
  lines.push('## Notebook')
  lines.push('')
  lines.push(`- [Notebook index](${BASE_URL}/notebook.md): all notebook posts`)
  lines.push(`- [Glossary](${BASE_URL}/notebook/glossary.md): plain-language glossary of sexual-wellness shopping terms`)
  for (const c of blogCategories) {
    lines.push(`- [${c.name}](${BASE_URL}/notebook/category/${c.slug}.md): category archive`)
  }
  lines.push('')

  // Individual posts get their own H2 section (mirrors the Products loop
  // above) so every published post is enumerated as its markdown twin, not
  // just the hub and category archives. `getBlogPostsForSitemap` is the same
  // Sanity query [sitemap.xml].tsx uses, so this list can never drift from
  // what's actually indexed. It now also projects title + a coalesced
  // seoDescription/excerpt so each line carries a title and short summary
  // instead of a bare URL.
  if (blogPosts.length > 0) {
    lines.push('## Notebook posts')
    lines.push('')
    for (const p of blogPosts) {
      const url = `${BASE_URL}/notebook/${p.slug}.md`
      const name = (p.title ?? humanizeHandle(p.slug)).replace(/[[\]]/g, '')
      const desc = p.description ? truncate(p.description, 140) : undefined
      if (desc) {
        lines.push(`- [${name}](${url}): ${desc}`)
      } else {
        lines.push(`- [${name}](${url})`)
      }
    }
    lines.push('')
  }

  // ── Pages ───────────────────────────────────────────────────────────────────
  // /faq.md and /about.md are the dedicated twins for the clean-URL pages the
  // denylist excludes from the generic /pages/{slug}.md route.
  const filteredPages = pages.filter(p => !PAGE_SLUG_DENYLIST.has(p.slug))
  lines.push('## Pages')
  lines.push('')
  lines.push(`- [FAQ](${BASE_URL}/faq.md)`)
  lines.push(`- [About](${BASE_URL}/about.md)`)
  lines.push(`- [Emma](${BASE_URL}/contributors/emma.md)`)
  for (const p of filteredPages) {
    const name = (p.title || humanizeHandle(p.slug)).replace(/[[\]]/g, '')
    lines.push(`- [${name}](${BASE_URL}/pages/${p.slug}.md)`)
  }
  lines.push('')

  // ── Optional ────────────────────────────────────────────────────────────────
  lines.push('## Optional')
  lines.push('')
  lines.push(`- [Sitemap](${BASE_URL}/sitemap.xml)`)
  lines.push(`- [RSS feed](${BASE_URL}/feed.xml)`)
  lines.push('')

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
