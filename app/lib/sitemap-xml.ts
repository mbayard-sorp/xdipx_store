/**
 * Pure sitemap types + XML rendering. Kept free of server-only imports so it
 * is directly testable; all data assembly lives in sitemap.server.ts.
 */

export const BASE = 'https://xdipx.com'

/**
 * Date the de-indexing bug was fixed (#173, 3977b3c). Between roughly
 * 2026-05-09 and 2026-05-25, transient render errors made pages emit
 * `noindex` plus a canonical pointing at the homepage, and Google cached that
 * verdict for ~1,500 URLs. Those URLs carry a Shopify/Sanity `_updatedAt`
 * from May, so the sitemap kept telling Google nothing had changed since the
 * bad crawl and no recrawl was ever triggered. Flooring their lastmod here is
 * an honest signal: this is genuinely when the page's indexability changed.
 */
export const RECRAWL_EPOCH = '2026-06-13'

export type SitemapImage = { loc: string; title: string }

export type SitemapUrl = {
  loc:        string
  lastmod:    string | undefined
  changefreq: string
  priority:   string
  images?:    SitemapImage[]
}

export type SitemapSegment = {
  /** File name without extension, e.g. `products-1`. */
  name:    string
  urls:    SitemapUrl[]
  /** Newest lastmod across the segment's URLs, for the index entry. */
  lastmod: string | undefined
}

export type UrlHealth = {
  /** URLs to drop from the sitemap entirely. */
  dead:  Set<string>
  /** URLs whose lastmod must be floored at RECRAWL_EPOCH. */
  stale: Set<string>
}

/** ISO dates sort lexically, so a string compare is the whole comparison. */
export function floorLastmod(lastmod: string | undefined, floor: string): string {
  return !lastmod || lastmod < floor ? floor : lastmod
}

/** Drop dead URLs and floor the lastmod of URLs holding a stale verdict. */
export function applyHealth(urls: SitemapUrl[], health: UrlHealth): SitemapUrl[] {
  const out: SitemapUrl[] = []
  for (const u of urls) {
    if (health.dead.has(u.loc)) continue
    out.push(health.stale.has(u.loc) ? { ...u, lastmod: floorLastmod(u.lastmod, RECRAWL_EPOCH) } : u)
  }
  return out
}

export function newestLastmod(urls: SitemapUrl[]): string | undefined {
  let newest: string | undefined
  for (const u of urls) if (u.lastmod && (!newest || u.lastmod > newest)) newest = u.lastmod
  return newest
}

/** Split a URL list into numbered segments of at most `size` entries. */
export function chunkSegments(prefix: string, urls: SitemapUrl[], size: number): SitemapSegment[] {
  const segments: SitemapSegment[] = []
  for (let i = 0; i < urls.length; i += size) {
    const chunk = urls.slice(i, i + size)
    segments.push({
      name: `${prefix}-${Math.floor(i / size) + 1}`,
      urls: chunk,
      lastmod: newestLastmod(chunk),
    })
  }
  return segments
}

export function escapeXml(s: string | null | undefined): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function renderUrlset(urls: SitemapUrl[]): string {
  return [
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
}

export function renderSitemapIndex(segments: SitemapSegment[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...segments.map(s => [
      '  <sitemap>',
      `    <loc>${escapeXml(`${BASE}/sitemaps/${s.name}.xml`)}</loc>`,
      s.lastmod ? `    <lastmod>${s.lastmod}</lastmod>` : '',
      '  </sitemap>',
    ].filter(Boolean).join('\n')),
    '</sitemapindex>',
  ].join('\n')
}
