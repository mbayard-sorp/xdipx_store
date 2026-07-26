/**
 * Sitemap assembly — segment builder + XML renderers.
 *
 * `/sitemap.xml` is a sitemap *index*; the segments it points at live at
 * `/sitemaps/{name}.xml`. Splitting buys three things a single flat 4,500-URL
 * urlset could not: per-segment coverage reporting in Search Console, a
 * per-segment `lastmod` on the index so Google can skip untouched segments,
 * and headroom before the 50,000-URL / 50MB per-file protocol limits.
 *
 * Two corrections are applied to the raw URL set here, both driven by the
 * gsc_url_inspections table the index monitor maintains:
 *
 *  1. Stale-verdict lastmod floor. Between roughly 2026-05-09 and 2026-05-25
 *     transient render errors made pages emit `noindex` plus a canonical
 *     pointing at the homepage; Google crawled ~1,500 URLs during that window
 *     and cached the verdict. The bug was fixed 2026-06-13 (#173), but these
 *     URLs carry a Shopify/Sanity `_updatedAt` from May, so the sitemap kept
 *     telling Google nothing had changed since the bad crawl and no recrawl
 *     was ever triggered. Any URL still sitting in one of those cached
 *     verdicts gets its lastmod floored at the fix date — an honest signal,
 *     since that is genuinely when the page's indexability changed.
 *
 *  2. Dead-URL suppression. URLs Google last saw as 404 / soft 404 / 5xx are
 *     dropped from the sitemap; submitting known-dead URLs costs crawl budget
 *     and erodes sitemap trust. Suppression stays self-healing because the
 *     sweep keeps re-inspecting suppressed URLs (see gsc-index.server.ts), so
 *     a URL that comes back to life re-enters the sitemap on its own.
 */
import { neon } from '@neondatabase/serverless'
import { getBlogPostsForSitemap, getBlogCategories, getAllBlogSeries, getPageList, getProductHandlesForSitemap } from '~/lib/sanity.server'
import { getProductImagesForSitemap, getCollectionsForSitemap, getMainMenu, type SitemapProductImages, type SitemapCollection } from '~/lib/shopify.server'
import { db } from '~/lib/db.server'
import { DEAD_VERDICT_STATES } from '~/lib/gsc-index.server'
import {
  BASE, applyHealth, chunkSegments, isTrustworthyDeadVerdict, newestLastmod,
  type SitemapImage, type SitemapSegment, type SitemapUrl, type UrlHealth,
} from '~/lib/sitemap-xml'
import { dealHistory } from '../../db/schema'
import { eq } from 'drizzle-orm'

const sql = neon(process.env['DATABASE_URL']!)

/**
 * Every coverage state that means "Google's cached verdict is bad news".
 * Whether a given row is *dead* or merely *stale* depends on when Google last
 * crawled it — see isTrustworthyDeadVerdict.
 */
const BAD_VERDICT_STATES = [
  'Excluded by ‘noindex’ tag',
  'Duplicate without user-selected canonical',
  ...DEAD_VERDICT_STATES,
]

/** Products per segment file. Well under the 50,000-URL protocol cap; sized
 *  so each segment stays a few hundred KB with image entries attached. */
const PRODUCTS_PER_SEGMENT = 1000

/**
 * Read the index monitor's per-URL verdicts. Guarded: if the table is missing
 * or the query fails, we return empty sets and emit the uncorrected sitemap
 * rather than 500 at a crawler.
 */
export async function getUrlHealth(): Promise<UrlHealth> {
  try {
    const rows = await sql`
      SELECT url, coverage_state, last_crawl_time FROM gsc_url_inspections
      WHERE coverage_state = ANY(${BAD_VERDICT_STATES}::text[])
    ` as unknown as Array<{ url: string; coverage_state: string; last_crawl_time: Date | string | null }>
    const dead  = new Set<string>()
    const stale = new Set<string>()
    for (const row of rows) {
      if (isTrustworthyDeadVerdict(row.coverage_state, row.last_crawl_time)) dead.add(row.url)
      else stale.add(row.url)
    }
    return { dead, stale }
  } catch (err) {
    console.error('[sitemap] getUrlHealth failed:', err)
    return { dead: new Set(), stale: new Set() }
  }
}

/** Relativize Shopify admin URLs (https://xdipx.com/collections/x → /collections/x). */
function relativize(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    return u.host === 'xdipx.com' ? u.pathname : rawUrl
  } catch { return rawUrl }
}

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

// Collections that duplicate clean-URL routes, are Shopify defaults, or back a
// retired gendered route (/vault, /for-him, /for-her all 301 into /collections
// or a product-type collection now — never index these handles).
const COLLECTION_DENYLIST = new Set([
  'frontpage', // Shopify default auto-collection
  'vault',     // /vault is retired (301 → /collections)
  'for-him',   // /for-him is retired (301 → a product-type collection)
  'for-her',   // /for-her is retired (301 → a product-type collection)
])

/**
 * Build every sitemap segment.
 *
 * Memoized in-process (not through KV — the assembled set is ~1.5MB and would
 * be a poor KV citizen; the underlying Sanity/Shopify reads have their own
 * caches). The index and each segment route share one build per TTL window.
 */
let memo: { segments: SitemapSegment[]; ts: number } | null = null
const MEMO_TTL_MS = 600_000 // 10 min, matches the served Cache-Control

export async function buildSitemapSegments(): Promise<SitemapSegment[]> {
  if (memo && Date.now() - memo.ts < MEMO_TTL_MS) return memo.segments
  const segments = await assembleSegments()
  memo = { segments, ts: Date.now() }
  return segments
}

/** Test seam: drop the in-process memo. */
export function clearSitemapMemo(): void {
  memo = null
}

async function assembleSegments(): Promise<SitemapSegment[]> {
  // Every source is individually guarded: a sitemap that degrades to fewer
  // entries is always better for crawlers than a 500. Each failure logs with
  // a [sitemap] prefix so the broken source is identifiable in runtime logs.
  const guard = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch(err => {
      console.error(`[sitemap] ${name} failed:`, err)
      return fallback
    })

  const [blogPosts, categories, blogSeries, pages, products, productImages, collections, liveDealRows, mainMenu, health] = await Promise.all([
    guard(getBlogPostsForSitemap(), [], 'getBlogPostsForSitemap'),
    guard(getBlogCategories(), [], 'getBlogCategories'),
    guard(getAllBlogSeries(), [], 'getAllBlogSeries'),
    guard(getPageList(), [], 'getPageList'),
    guard(getProductHandlesForSitemap(), [], 'getProductHandlesForSitemap'),
    guard(getProductImagesForSitemap(), new Map<string, SitemapProductImages>(), 'getProductImagesForSitemap'),
    guard(getCollectionsForSitemap(), [] as SitemapCollection[], 'getCollectionsForSitemap'),
    guard(db.select().from(dealHistory).where(eq(dealHistory.status, 'live')).limit(1), [], 'liveDeal query'),
    guard(getMainMenu(), [], 'getMainMenu'),
    getUrlHealth(),
  ])

  const liveDealDate = liveDealRows[0]?.dealDate ? new Date(liveDealRows[0]!.dealDate) : null
  const homepageLastmod = liveDealDate && !Number.isNaN(liveDealDate.getTime())
    ? liveDealDate.toISOString().split('T')[0]
    : undefined
  const today = new Date().toISOString().split('T')[0]!

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

  // Top-level nav destinations (skip the homepage `/` — it's listed separately).
  const navItems = mainMenu
    .map(item => (typeof item.url === 'string' ? relativize(item.url) : ''))
    .filter(path => path.startsWith('/') && path !== '/')

  // Track which collection handles are nav-promoted so the general collections
  // loop below doesn't double-list them.
  const navCollectionHandles = new Set(
    navItems
      .filter(p => p.startsWith('/collections/'))
      .map(p => p.replace(/^\/collections\//, '').split(/[/?#]/)[0]!)
  )

  // ── pages: homepage, nav, evergreen routes, generic pages ────────────────
  const pageUrls: SitemapUrl[] = [
    // Homepage — always first, highest priority
    { loc: `${BASE}/`, lastmod: homepageLastmod ?? today, changefreq: 'daily', priority: '1.0' },
    // Top-level nav destinations — Google's sitelink candidates.
    // Priority 0.9, just below the homepage and above generic PLPs.
    ...navItems.map(path => {
      const handle = path.startsWith('/collections/')
        ? path.replace(/^\/collections\//, '').split(/[/?#]/)[0]
        : null
      const c = handle ? collections.find(x => x.handle === handle) : null
      return {
        loc: `${BASE}${path}`,
        lastmod: c?.updatedAt?.split('T')[0] ?? today,
        changefreq: 'daily',
        priority: '0.9',
      }
    }),
    { loc: `${BASE}/discover`,    lastmod: today, changefreq: 'weekly', priority: '0.7' },
    // /new is deliberately noindex (churning daily inventory); listing it in
    // the sitemap contradicts that and shows up in GSC as "Excluded by
    // 'noindex' tag" on a submitted URL.
    { loc: `${BASE}/collections`, lastmod: collectionsHubLastmod ?? today, changefreq: 'weekly', priority: '0.7' },
    { loc: `${BASE}/notebook`,    lastmod: today, changefreq: 'weekly', priority: '0.5' },
    { loc: `${BASE}/notebook/glossary`, lastmod: today, changefreq: 'weekly', priority: '0.5' },
    { loc: `${BASE}/faq`,         lastmod: today, changefreq: 'monthly', priority: '0.5' },
    { loc: `${BASE}/about`,       lastmod: today, changefreq: 'monthly', priority: '0.5' },
    { loc: `${BASE}/contributors/emma`, lastmod: today, changefreq: 'monthly', priority: '0.4' },
    // Social bio-link landing, arrival surface for IG/TikTok/YT traffic.
    { loc: `${BASE}/social`,      lastmod: today, changefreq: 'monthly', priority: '0.4' },
    // /vault, /for-him, /for-her are retired (301 → /collections or a
    // product-type collection) — intentionally not listed as sitemap entries.

    // Generic pages — drop slugs that already have a cleaner canonical URL
    // (e.g. /about lives at /about, not /pages/about) to prevent duplicate
    // canonical entries in the sitemap.
    ...pages
      .filter(p => !PAGE_SLUG_DENYLIST.has(p.slug))
      .map(p => ({
        loc: `${BASE}/pages/${p.slug}`,
        lastmod: undefined,
        changefreq: 'monthly',
        priority: '0.4',
      })),
  ]

  // ── notebook: posts, categories, series ──────────────────────────────────
  const notebookUrls: SitemapUrl[] = [
    ...blogPosts.map(p => ({
      loc: `${BASE}/notebook/${p.slug}`,
      lastmod: (p._updatedAt ?? p.publishedAt)?.split('T')[0],
      changefreq: 'weekly',
      priority: '0.7',
    })),
    ...categories.map(c => ({
      loc: `${BASE}/notebook/category/${c.slug}`,
      lastmod: undefined,
      changefreq: 'weekly',
      priority: '0.5',
    })),
    // Only series with published posts are returned.
    ...blogSeries.map(s => ({
      loc: `${BASE}/notebook/series/${s.slug}`,
      lastmod: undefined,
      changefreq: 'weekly',
      priority: '0.5',
    })),
  ]

  // ── collections: /collections/$handle ────────────────────────────────────
  // Helps xdipx rank for category queries (e.g. "wand vibrators"). Skip the
  // Shopify `frontpage` default, any handle that duplicates a clean URL, and
  // any handle already promoted at priority 0.9 via the nav block.
  const collectionUrls: SitemapUrl[] = collections
    .filter(c => !COLLECTION_DENYLIST.has(c.handle) && !navCollectionHandles.has(c.handle))
    .map(c => {
      const images: SitemapImage[] = c.image?.url
        ? [{ loc: c.image.url, title: c.image.altText?.trim() || c.handle.replace(/-/g, ' ') }]
        : []
      return {
        loc: `${BASE}/collections/${c.handle}`,
        lastmod: c.updatedAt?.split('T')[0],
        changefreq: 'weekly',
        priority: '0.7',
        ...(images.length > 0 ? { images } : {}),
      }
    })

  // ── products ─────────────────────────────────────────────────────────────
  const productUrls: SitemapUrl[] = products.map(p => {
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
      loc: `${BASE}/products/${p.handle}`,
      lastmod: p._updatedAt?.split('T')[0],
      changefreq: 'daily',
      priority: '0.9',
      ...(images.length > 0 ? { images } : {}),
    }
  })

  // Dedupe across every segment, first occurrence wins. A URL can be reached
  // from more than one source (e.g. /notebook is both a nav destination and a
  // hardcoded entry), and listing one URL twice is a defect in a single file
  // and a worse one split across two.
  const seen = new Set<string>()
  const clean = (urls: SitemapUrl[]): SitemapUrl[] => {
    const out: SitemapUrl[] = []
    for (const u of applyHealth(urls, health)) {
      if (seen.has(u.loc)) continue
      seen.add(u.loc)
      out.push(u)
    }
    return out
  }

  const segments: SitemapSegment[] = []
  const push = (name: string, urls: SitemapUrl[]) => {
    const corrected = clean(urls)
    // A segment with no surviving URLs is omitted from the index rather than
    // published empty — an empty urlset reads to Google as "these are gone".
    if (corrected.length === 0) return
    segments.push({ name, urls: corrected, lastmod: newestLastmod(corrected) })
  }

  push('pages', pageUrls)
  push('collections', collectionUrls)
  push('notebook', notebookUrls)

  segments.push(...chunkSegments('products', clean(productUrls), PRODUCTS_PER_SEGMENT))

  return segments
}
