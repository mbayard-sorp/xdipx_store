import { getBlogPostsForSitemap, getBlogCategories, getPageList, getProductHandlesForSitemap } from '~/lib/sanity.server'

export async function loader() {
  const [blogPosts, categories, pages, products] = await Promise.all([
    getBlogPostsForSitemap(),
    getBlogCategories(),
    getPageList(),
    getProductHandlesForSitemap(),
  ])

  const base = 'https://xdipx.com'

  type SitemapUrl = { loc: string; lastmod: string | undefined; changefreq: string; priority: string }

  const urls: SitemapUrl[] = [
    // Static pages
    { loc: `${base}/`, lastmod: undefined, changefreq: 'daily', priority: '1.0' },
    { loc: `${base}/notebook`, lastmod: undefined, changefreq: 'daily', priority: '0.8' },
    { loc: `${base}/faq`, lastmod: undefined, changefreq: 'monthly', priority: '0.3' },
    { loc: `${base}/about`, lastmod: undefined, changefreq: 'monthly', priority: '0.3' },
    { loc: `${base}/vault`, lastmod: undefined, changefreq: 'daily', priority: '0.6' },
    { loc: `${base}/for-him`, lastmod: undefined, changefreq: 'daily', priority: '0.5' },
    { loc: `${base}/for-her`, lastmod: undefined, changefreq: 'daily', priority: '0.5' },

    // Products
    ...products.map(p => ({
      loc: `${base}/products/${p.handle}`,
      lastmod: p._updatedAt?.split('T')[0],
      changefreq: 'daily',
      priority: '0.9',
    })),

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
  ]

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(u => [
      '  <url>',
      `    <loc>${escapeXml(u.loc)}</loc>`,
      u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>` : '',
      `    <changefreq>${u.changefreq}</changefreq>`,
      `    <priority>${u.priority}</priority>`,
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
