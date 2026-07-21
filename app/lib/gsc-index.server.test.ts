import { describe, expect, it } from 'vitest'
import { classifyCoverage, parseSitemapUrls } from '~/lib/gsc-index.server'

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
