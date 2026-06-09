import { getBlogPostsForSitemap, getBlogCategories, getPageList, getProductHandlesForSitemap } from '~/lib/sanity.server'
import { getProductImagesForSitemap, getCollectionsForSitemap, getMainMenu, type SitemapProductImages, type SitemapCollection } from '~/lib/shopify.server'
import { db } from '~/lib/db.server'
import { dealHistory } from '../../db/schema'
import { eq } from 'drizzle-orm'

export async function loader() {
  // Every source is individually guarded: a sitemap that degrades to fewer
  // entries is always better for crawlers than a 500. Each failure logs with
  // a [sitemap] prefix so the broken source is identifiable in runtime logs.
  const guard = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch(err => {
      console.error(`[sitemap] ${name} failed:`, err)
      return fallback
    })

  const [blogPosts, categories, pages, products, productImages, collections, liveDealRows, mainMenu] = await Promise.all([
    guard(getBlogPostsForSitemap(), [], 'getBlogPostsForSitemap'),
    guard(getBlogCategories(), [], 'getBlogCategories'),
    guard(getPageList(), [], 'getPageList'),
    guard(getProductHandlesForSitemap(), [], 'getProductHandlesForSitemap'),
    guard(getProductImagesForSitemap(), new Map<string, SitemapProductImages>(), 'getProductImagesForSitemap'),
    guard(getCollectionsForSitemap(), [] as SitemapCollection[], 'getCollectionsForSitemap'),
    guard(db.select().from(dealHistory).where(eq(dealHistory.status, 'live')).limit(1), [], 'liveDeal query'),
    guard(getMainMenu(), [], 'getMainMenu'),
  ])

  const base = 'https://xdipx.com'
  const liveDealDate = liveDealRows[0]?.dealDate ? new Date(liveDealRows[0]!.dealDate) : null
  const homepageLastmod = liveDealDate && !Number.isNaN(liveDealDate.getTime())
    ? liveDealDate.toISOString().split('T')[0]
    : undefined
  const today = new Date().toISOString().split('T')[0]

  // Slugs that have a cleaner canonical URL (e.g. /about instead of /pages/about).
  // We include the clean URL above and exclude the /pages/* duplicate here so
  // Google never sees two URLs serving the same content.
  const PAGE_SLUG_DENYLIST = new Set([
    'about',
    'faq',
    'our-mission',     // duplicates /about messaging
    'checkout-extras', // canonical is /checkout-extras
    'components',      // internal style guide, should not be indexed
  ])

  // Collections that duplicate clean-URL routes or are Shopify defaults.
  const COLLECTION_DENYLIST = new Set([
    'frontpage', // Shopify default auto-collection
    'vault',     // canonical is /vault
    'for-him',   // canonical is /for-him
    'for-her',   // canonical is /for-her
  ])

  // /collections hub lastmod — pick the most recent collection updatedAt so
  // Google sees the hub as fresh whenever any underlying collection changes.
  const collectionsHubLastmod = collections.length > 0
    ? collections
        .map(c => c.updatedAt)
        .filter((d): d is string => !!d)
        .sort()
        .pop()
        ?.split('T')[0]
    : undefined

  type SitemapImage = { loc: string; title: string }
  type SitemapUrl = {
    loc:        string
    lastmod:    string | undefined
    changefreq: string
    priority:   string
    images?:    SitemapImage[]
  }

  // Relativize Shopify admin URLs (e.g. https://xdipx.com/collections/pleasure → /collections/pleasure)
  function relativize(rawUrl: string): string {
    try {
      const u = new URL(rawUrl)
      return u.host === 'xdipx.com' ? u.pathname : rawUrl
    } catch { return rawUrl }
  }

  // Top-level nav destinations (skip the homepage `/` — it's listed separately).
  const navItems = mainMenu
    .map(item => (typeof item.url === 'string' ? relativize(item.url) : ''))
    .filter(path => path.startsWith('/') && path !== '/')

  // Track which collection handles are nav-promoted so the general
  // collections loop below doesn't double-list them.
  const navCollectionHandles = new Set(
    navItems
      .filter(p => p.startsWith('/collections/'))
      .map(p => p.replace(/^\/collections\//, '').split(/[/?#]/)[0]!)
  )

  const urls: SitemapUrl[] = [
    // Homepage — always first, highest priority
    { loc: `${base}/`, lastmod: homepageLastmod ?? today, changefreq: 'daily', priority: '1.0' },
    // Top-level nav destinations — Google's sitelink candidates.
    // Priority 0.9, just below the homepage and above generic PLPs.
    ...navItems.map(path => {
      const handle = path.startsWith('/collections/')
        ? path.replace(/^\/collections\//, '').split(/[/?#]/)[0]
        : null
      const c = handle ? collections.find(x => x.handle === handle) : null
      return {
        loc: `${base}${path}`,
        lastmod: c?.updatedAt?.split('T')[0] ?? today,
        changefreq: 'daily',
        priority: '0.9',
      }
    }),
    { loc: `${base}/collections`, lastmod: collectionsHubLastmod ?? today, changefreq: 'weekly', priority: '0.7' },
    { loc: `${base}/notebook`,    lastmod: today, changefreq: 'weekly', priority: '0.5' },

    // Products
    ...products.map(p => {
      const imageData = productImages.get(p.handle)
      const images: SitemapImage[] = imageData
        ? imageData.images.map(img => ({
            loc:   img.url,
            // <image:title> is the contextual caption Google indexes alongside
            // the image. Prefer the variant-specific altText; fall back to the
            // product title so every image has a meaningful title.
            title: img.altText?.trim() || imageData.title,
          }))
        : []
      return {
        loc: `${base}/products/${p.handle}`,
        lastmod: p._updatedAt?.split('T')[0],
        changefreq: 'daily',
        priority: '0.9',
        ...(images.length > 0 ? { images } : {}),
      }
    }),

    // Blog posts
    ...blogPosts.map(p => ({
      loc: `${base}/notebook/${p.slug}`,
      lastmod: (p._updatedAt ?? p.publishedAt)?.split('T')[0],
      changefreq: 'weekly',
      priority: '0.7',
    })),

    // Blog categories
    ...categories.map(c => ({
      loc: `${base}/notebook/category/${c.slug}`,
      lastmod: undefined,
      changefreq: 'weekly',
      priority: '0.5',
    })),

    // Generic pages — drop slugs that already have a cleaner canonical URL
    // (e.g. /about lives at /about, not /pages/about) to prevent duplicate
    // canonical entries in the sitemap.
    ...pages
      .filter(p => !PAGE_SLUG_DENYLIST.has(p.slug))
      .map(p => ({
        loc: `${base}/pages/${p.slug}`,
        lastmod: undefined,
        changefreq: 'monthly',
        priority: '0.4',
      })),

    // Collection pages — /collections/$handle. Helps Google rank xdipx for
    // category queries (e.g. "wand vibrators", "couples toys"). Skip the
    // Shopify `frontpage` default, any handle that duplicates a clean URL,
    // and any handle already promoted at priority 0.9 via the nav block.
    ...collections.filter(c => !COLLECTION_DENYLIST.has(c.handle) && !navCollectionHandles.has(c.handle)).map(c => {
      const images: SitemapImage[] = c.image?.url
        ? [{ loc: c.image.url, title: c.image.altText?.trim() || c.handle.replace(/-/g, ' ') }]
        : []
      return {
        loc: `${base}/collections/${c.handle}`,
        lastmod: c.updatedAt?.split('T')[0],
        changefreq: 'weekly',
        priority: '0.7',
        ...(images.length > 0 ? { images } : {}),
      }
    }),
  ]

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...urls.map(u => [
      '  <url>',
      `    <loc>${escapeXml(u.loc)}</loc>`,
      u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>` : '',
      `    <changefreq>${u.changefreq}</changefreq>`,
      `    <priority>${u.priority}</priority>`,
      ...(u.images ?? []).flatMap(img => [
        '    <image:image>',
        `      <image:loc>${escapeXml(img.loc)}</image:loc>`,
        `      <image:title>${escapeXml(img.title)}</image:title>`,
        '    </image:image>',
      ]),
      '  </url>',
    ].filter(Boolean).join('\n')),
    '</urlset>',
  ].join('\n')

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      // 10 min so a midnight deal rotation's new `lastmod` surfaces to crawlers
      // promptly (was 1h, which could delay discovery of the rotated deal).
      'Cache-Control': 'public, max-age=600',
    },
  })
}

function escapeXml(s: string | null | undefined): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
