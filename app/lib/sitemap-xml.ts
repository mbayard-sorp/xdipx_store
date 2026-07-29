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

/**
 * Sitemap hierarchy.
 *
 * `priority` is only meaningful *relative to other URLs in the same sitemap*.
 * Every product previously claimed 0.9 with changefreq daily, which is two
 * lies at once on a 4,400-SKU catalog: it flattens the hierarchy so nothing
 * stands out, and it promises daily churn a crawler can verify is false the
 * second time it fetches an unchanged PDP. A sitemap that overstates gets its
 * hints discounted wholesale.
 *
 * The honest shape: the homepage is the front door, nav destinations are the
 * pages we most want ranked (Google's sitelink candidates), /new is a real
 * freshness surface, and individual products sit below all of them.
 */
export const HOMEPAGE_PRIORITY   = '1.0'
export const NAV_PRIORITY        = '0.9'
export const NEW_ARRIVALS_PRIORITY = '0.8'
export const PRODUCT_PRIORITY    = '0.6'
/** Products change when merchandising or price changes, not every day. */
export const PRODUCT_CHANGEFREQ  = 'weekly'

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

/**
 * Whether a "this URL is dead" verdict is solid enough to drop the URL from
 * the sitemap. Only if Google saw it *after* RECRAWL_EPOCH.
 *
 * Checked against the live site: of the URLs holding a pre-fix dead verdict,
 * every Soft 404 (11/11) and every Server error (6/6) returns 200 today. They
 * are artifacts of the same May outage that produced the bogus noindex
 * verdicts, not dead pages. Only hard 404s crawled after the fix were
 * uniformly dead (12/12), so that is the one combination we trust; everything
 * else is stale evidence and gets the recrawl lastmod floor instead.
 *
 * Erring this way is deliberate. Submitting a handful of stale 404s costs a
 * little crawl budget; dropping a live category page from the sitemap costs it
 * its only submission path. Pre-fix verdicts self-correct — the next sweep
 * re-inspects them, and a genuinely dead URL earns a post-fix verdict and is
 * suppressed on the following build.
 */
export function isTrustworthyDeadVerdict(coverageState: string, lastCrawl: Date | string | null): boolean {
  if (coverageState !== 'Not found (404)' || !lastCrawl) return false
  const crawled = lastCrawl instanceof Date
    ? lastCrawl.toISOString().slice(0, 10)
    : String(lastCrawl).slice(0, 10)
  return crawled >= RECRAWL_EPOCH
}

/**
 * Largest share of the product list the Shopify liveness filter may drop
 * before we stop trusting it and publish unfiltered.
 *
 * The filter exists to remove the handful of products Sanity still has a page
 * for but Shopify no longer serves (4% on 2026-07-29). A partial Storefront
 * failure looks exactly like a genuinely shrunken catalog, and quietly
 * suppressing a third of the catalog from the sitemap is far worse than
 * shipping a few dead URLs, so past this ratio we keep every URL and log.
 */
export const MAX_INDEXABLE_DROP_RATIO = 0.25

/**
 * Keep only products whose handle the PDP route will serve.
 *
 * `indexable` is null when the Storefront lookup failed; that and an
 * implausibly large drop both fall through to the unfiltered list, because
 * every product missing its only submission path is a worse outcome than a
 * few dead URLs costing crawl budget.
 */
export function keepIndexable<T extends { handle: string }>(
  products: T[],
  indexable: Set<string> | null,
): T[] {
  if (!indexable) return products
  const kept = products.filter(p => indexable.has(p.handle))
  const dropped = products.length - kept.length
  if (products.length > 0 && dropped / products.length > MAX_INDEXABLE_DROP_RATIO) {
    console.warn(
      `[sitemap] liveness filter would drop ${dropped}/${products.length} products ` +
      `(> ${MAX_INDEXABLE_DROP_RATIO * 100}%); publishing unfiltered`,
    )
    return products
  }
  if (dropped > 0) console.log(`[sitemap] dropped ${dropped} product URLs the PDP route would 404/410`)
  return kept
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

/**
 * Cache policy for /sitemap.xml and every /sitemaps/*.xml segment.
 *
 * `stale-while-revalidate` is the important part. Assembling the sitemap is
 * expensive (a full catalog read), and under the old `max-age=600` the edge
 * entry simply expired, so every 10 minutes a crawler fetch went to a
 * possibly-cold function and waited out the whole assembly. With SWR the CDN
 * answers instantly from the stale copy and refreshes in the background, so a
 * crawler never blocks on an assembly after the first successful fetch.
 *
 * s-maxage is an hour rather than a day so a newly published Notebook post
 * still reaches the sitemap the same morning.
 */
export const SITEMAP_CACHE_CONTROL =
  'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400'

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
