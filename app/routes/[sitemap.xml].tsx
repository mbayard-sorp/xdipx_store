import { getBlogPostsForSitemap, getBlogCategories, getPageList, getProductHandlesForSitemap } from '~/lib/sanity.server'
import { getProductImagesForSitemap, getCollectionsForSitemap, type SitemapProductImages, type SitemapCollection } from '~/lib/shopify.server'
import { db } from '~/lib/db.server'
import { dealHistory } from '../../db/schema'
import { eq } from 'drizzle-orm'

export async function loader() {
  const [blogPosts, categories, pages, products, productImages, collections, liveDealRows] = await Promise.all([
    getBlogPostsForSitemap(),
    getBlogCategories(),
    getPageList(),
    getProductHandlesForSitemap(),
    getProductImagesForSitemap().catch((err): Map<string, SitemapProductImages> => {
      // Image enrichment failure must not break the sitemap — fall back to
      // bare URL entries so crawlers still see updated lastmods.
      console.error('[sitemap] product image fetch failed:', err)
      return new Map()
    }),
    getCollectionsForSitemap().catch((err): SitemapCollection[] => {
      console.error('[sitemap] collections fetch failed:', err)
      return []
    }),
    db.select().from(dealHistory).where(eq(dealHistory.status, 'live')).limit(1),
  ])

  const base = 'https://xdipx.com'
  const homepageLastmod = liveDealRows[0]?.dealDate
    ? new Date(liveDealRows[0]!.dealDate).toISOString().split('T')[0]
    : undefined

  type SitemapImage = { loc: string; title: string }
  type SitemapUrl = {
    loc:        string
    lastmod:    string | undefined
    changefreq: string
    priority:   string
    images?:    SitemapImage[]
  }

  const urls: SitemapUrl[] = [
    // Static pages
    { loc: `${base}/`, lastmod: homepageLastmod, changefreq: 'daily', priority: '1.0' },
    { loc: `${base}/notebook`, lastmod: undefined, changefreq: 'daily', priority: '0.8' },
    { loc: `${base}/faq`, lastmod: undefined, changefreq: 'monthly', priority: '0.3' },
    { loc: `${base}/about`, lastmod: undefined, changefreq: 'monthly', priority: '0.3' },
    { loc: `${base}/vault`, lastmod: undefined, changefreq: 'daily', priority: '0.6' },
    { loc: `${base}/for-him`, lastmod: undefined, changefreq: 'daily', priority: '0.5' },
    { loc: `${base}/for-her`, lastmod: undefined, changefreq: 'daily', priority: '0.5' },
    { loc: `${base}/collections`, lastmod: undefined, changefreq: 'weekly', priority: '0.8' },

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

    // Generic pages
    ...pages.map(p => ({
      loc: `${base}/pages/${p.slug}`,
      lastmod: undefined,
      changefreq: 'monthly',
      priority: '0.4',
    })),

    // Collection pages — /collections/$handle. Helps Google rank xdipx for
    // category queries (e.g. "wand vibrators", "couples toys").
    ...collections.map(c => {
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
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
