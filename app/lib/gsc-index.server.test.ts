import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyCoverage, fetchSitemapEntries, parseSitemapIndex, parseSitemapUrls } from '~/lib/gsc-index.server'

describe('parseSitemapUrls', () => {
  it('extracts url + lastmod pairs and dedupes', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://xdipx.com/</loc>
    <lastmod>2026-07-20</lastmod>
    <changefreq>daily</changefreq>
  </url>
  <url>
    <loc>https://xdipx.com/products/example</loc>
  </url>
  <url>
    <loc>https://xdipx.com/products/example</loc>
    <lastmod>2026-07-21</lastmod>
  </url>
</urlset>`
    expect(parseSitemapUrls(xml)).toEqual([
      { url: 'https://xdipx.com/', lastmod: '2026-07-20' },
      { url: 'https://xdipx.com/products/example', lastmod: null },
    ])
  })

  it('returns empty for non-sitemap content', () => {
    expect(parseSitemapUrls('<html><body>error page</body></html>')).toEqual([])
  })
})

describe('parseSitemapIndex', () => {
  it('extracts child sitemap locs', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://xdipx.com/sitemaps/pages.xml</loc><lastmod>2026-07-26</lastmod></sitemap>
  <sitemap><loc>https://xdipx.com/sitemaps/products-1.xml</loc></sitemap>
</sitemapindex>`
    expect(parseSitemapIndex(xml)).toEqual([
      'https://xdipx.com/sitemaps/pages.xml',
      'https://xdipx.com/sitemaps/products-1.xml',
    ])
  })

  it('returns empty for a plain urlset', () => {
    const xml = '<urlset><url><loc>https://xdipx.com/</loc></url></urlset>'
    expect(parseSitemapIndex(xml)).toEqual([])
  })
})

describe('fetchSitemapEntries', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const ok = (body: string) => ({ ok: true, status: 200, text: async () => body })

  it('follows a sitemap index one level down and dedupes across segments', async () => {
    const index = `<sitemapindex>
      <sitemap><loc>https://xdipx.com/sitemaps/pages.xml</loc></sitemap>
      <sitemap><loc>https://xdipx.com/sitemaps/products-1.xml</loc></sitemap>
    </sitemapindex>`
    const pages = '<urlset><url><loc>https://xdipx.com/</loc><lastmod>2026-07-26</lastmod></url></urlset>'
    const products = `<urlset>
      <url><loc>https://xdipx.com/products/a</loc><lastmod>2026-06-13</lastmod></url>
      <url><loc>https://xdipx.com/</loc></url>
    </urlset>`
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (u.endsWith('/sitemap.xml')) return ok(index)
      if (u.endsWith('/pages.xml')) return ok(pages)
      return ok(products)
    }))

    expect(await fetchSitemapEntries('https://xdipx.com/sitemap.xml')).toEqual([
      { url: 'https://xdipx.com/', lastmod: '2026-07-26' },
      { url: 'https://xdipx.com/products/a', lastmod: '2026-06-13' },
    ])
  })

  it('still handles a flat urlset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      ok('<urlset><url><loc>https://xdipx.com/</loc></url></urlset>')))
    expect(await fetchSitemapEntries('https://xdipx.com/sitemap.xml')).toEqual([
      { url: 'https://xdipx.com/', lastmod: null },
    ])
  })

  it('throws when a segment fetch fails rather than reporting a short URL set', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) =>
      String(url).endsWith('/sitemap.xml')
        ? ok('<sitemapindex><sitemap><loc>https://xdipx.com/sitemaps/products-1.xml</loc></sitemap></sitemapindex>')
        : { ok: false, status: 503, text: async () => '' }))
    await expect(fetchSitemapEntries('https://xdipx.com/sitemap.xml')).rejects.toThrow(/segment fetch failed/)
  })
})

describe('classifyCoverage', () => {
  it('treats verdict PASS as indexed regardless of coverage wording', () => {
    expect(classifyCoverage('PASS', 'Submitted and indexed')).toBe('indexed')
    expect(classifyCoverage('PASS', 'Indexed, not submitted in sitemap')).toBe('indexed')
  })

  it('splits the two diagnostic non-indexed states', () => {
    expect(classifyCoverage('NEUTRAL', 'Crawled - currently not indexed')).toBe('crawled_not_indexed')
    expect(classifyCoverage('NEUTRAL', 'Discovered - currently not indexed')).toBe('discovered_not_indexed')
  })

  it('buckets everything else as other_not_indexed', () => {
    expect(classifyCoverage('NEUTRAL', 'URL is unknown to Google')).toBe('other_not_indexed')
    expect(classifyCoverage('FAIL', "Excluded by 'noindex' tag")).toBe('other_not_indexed')
    expect(classifyCoverage(null, null)).toBe('other_not_indexed')
  })
})
