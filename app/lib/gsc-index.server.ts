/**
 * GSC index monitor — rotating URL Inspection API sweep over the sitemap.
 *
 * Google exposes no bulk index-coverage export, so we reconstruct it:
 * each run refreshes the sitemap URL set, inspects the never-inspected and
 * stalest URLs within a per-run budget, records coverage-state transitions,
 * and upserts a day-level aggregate into gsc_index_daily.
 *
 * Quota: the URL Inspection API allows 2,000 inspections/day per property
 * (600/min). A KV counter caps us at DAILY_QUOTA_CEILING across runs; the
 * cron fires 8x/day with a 200-URL budget (override: GSC_INSPECT_BUDGET),
 * so a ~4,500-URL sitemap gets a full pass roughly every 3 days. Budget and
 * concurrency are sized so a run finishes well inside the function timeout:
 * inspections average ~6.5s each, so 200 at concurrency 8 is ~165s.
 *
 * Creds/property come from getGscContext() in gsc.server.ts; missing creds
 * is a supported skipped state so the cron merges before setup.
 */
import { neon } from '@neondatabase/serverless'
import { getGscContext } from '~/lib/gsc.server'
import { kvGet, kvIncrBy } from '~/lib/kv.server'

const sql = neon(process.env['DATABASE_URL']!)

/**
 * Coverage states that mean "Google could not fetch a real page here". The
 * sitemap builder treats a subset of these as grounds for dropping a URL (see
 * isTrustworthyDeadVerdict in sitemap.server.ts — a pre-fix verdict is stale
 * evidence, not proof), and this sweep keeps re-inspecting all of them so a
 * suppression can lift itself when a URL recovers.
 */
export const DEAD_VERDICT_STATES = ['Not found (404)', 'Soft 404', 'Server error (5xx)']

const INSPECT_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'
const DAILY_QUOTA_CEILING = 1900
const DEFAULT_RUN_BUDGET = 200
const CONCURRENCY = 8

export interface SitemapEntry {
  url: string
  lastmod: string | null
}

/** Extract <loc> (+ sibling <lastmod>) pairs from a sitemap XML document. */
export function parseSitemapUrls(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = []
  const seen = new Set<string>()
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? []
  for (const block of blocks) {
    const loc = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/)?.[1]
    if (!loc || seen.has(loc)) continue
    seen.add(loc)
    entries.push({
      url: loc,
      lastmod: block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/)?.[1] ?? null,
    })
  }
  return entries
}

/** Extract child sitemap URLs from a <sitemapindex> document. */
export function parseSitemapIndex(xml: string): string[] {
  const locs: string[] = []
  const seen = new Set<string>()
  const blocks = xml.match(/<sitemap>[\s\S]*?<\/sitemap>/g) ?? []
  for (const block of blocks) {
    const loc = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/)?.[1]
    if (!loc || seen.has(loc)) continue
    seen.add(loc)
    locs.push(loc)
  }
  return locs
}

/**
 * Fetch the sitemap and, when it is an index, every segment it points at.
 * /sitemap.xml became an index when the flat urlset was split by section, so
 * the sweep has to follow one level down or it would see ~6 URLs and mark the
 * entire catalog absent.
 */
export async function fetchSitemapEntries(sitemapUrl: string | URL): Promise<SitemapEntry[]> {
  const res = await fetch(sitemapUrl)
  if (!res.ok) throw new Error(`sitemap fetch failed: ${res.status}`)
  const xml = await res.text()

  const children = parseSitemapIndex(xml)
  if (children.length === 0) return parseSitemapUrls(xml)

  const entries: SitemapEntry[] = []
  const seen = new Set<string>()
  for (const child of children) {
    const childRes = await fetch(child)
    if (!childRes.ok) throw new Error(`sitemap segment fetch failed (${child}): ${childRes.status}`)
    for (const entry of parseSitemapUrls(await childRes.text())) {
      if (seen.has(entry.url)) continue
      seen.add(entry.url)
      entries.push(entry)
    }
  }
  return entries
}

export type CoverageBucket =
  | 'indexed'
  | 'crawled_not_indexed'
  | 'discovered_not_indexed'
  | 'other_not_indexed'

/**
 * Bucket a URL Inspection result. verdict PASS means indexed regardless of
 * coverage wording; the Crawled/Discovered split is the diagnostic that
 * matters (quality judgment vs crawl-budget/discovery problem).
 */
export function classifyCoverage(verdict: string | null, coverageState: string | null): CoverageBucket {
  if (verdict === 'PASS') return 'indexed'
  const cs = coverageState ?? ''
  if (cs.startsWith('Crawled')) return 'crawled_not_indexed'
  if (cs.startsWith('Discovered')) return 'discovered_not_indexed'
  return 'other_not_indexed'
}

interface IndexStatusResult {
  verdict?: string
  coverageState?: string
  indexingState?: string
  robotsTxtState?: string
  pageFetchState?: string
  lastCrawlTime?: string
  googleCanonical?: string
  userCanonical?: string
}

class QuotaExhaustedError extends Error {}

async function inspectUrl(token: string, siteUrl: string, url: string): Promise<IndexStatusResult> {
  const res = await fetch(INSPECT_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inspectionUrl: url, siteUrl }),
  })
  if (res.status === 429) throw new QuotaExhaustedError(`429 for ${url}`)
  if (!res.ok) throw new Error(`inspect failed ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json() as { inspectionResult?: { indexStatusResult?: IndexStatusResult } }
  return json.inspectionResult?.indexStatusResult ?? {}
}

/** lastCrawlTime is epoch-0 when Google has never crawled the URL. */
function crawlTimeOrNull(t: string | undefined): string | null {
  if (!t) return null
  const ms = Date.parse(t)
  if (Number.isNaN(ms) || ms <= 0) return null
  return new Date(ms).toISOString()
}

export interface GscIndexSweepResult {
  skipped?: string
  inspected?: number
  errors?: number
  quotaUsedToday?: number
  totals?: {
    sitemapUrls: number
    inspectedUrls: number
    indexed: number
    crawledNotIndexed: number
    discoveredNotIndexed: number
    otherNotIndexed: number
    canonicalMismatches: number
    newlyIndexed: number
    newlyDropped: number
  }
}

interface BatchRow {
  url: string
  coverage_state: string | null
  verdict: string | null
}

export async function runGscIndexSweep(opts: { budget?: number } = {}): Promise<GscIndexSweepResult> {
  const ctx = await getGscContext()
  if (!ctx) return { skipped: 'no credentials' }
  const { token, siteUrl } = ctx

  // ── Quota guard (shared across the day's runs via KV) ─────────────────────
  const day = new Date().toISOString().slice(0, 10)
  const quotaKey = `gsc-inspect:quota:${day}`
  const used = Number(await kvGet<number | string>(quotaKey) ?? 0)
  const requested = opts.budget ?? Number(process.env['GSC_INSPECT_BUDGET'] ?? DEFAULT_RUN_BUDGET)
  const budget = Math.max(0, Math.min(requested, DAILY_QUOTA_CEILING - used))
  if (budget === 0) return { skipped: `daily inspection quota ceiling reached (${used}/${DAILY_QUOTA_CEILING})` }

  // ── Refresh the sitemap URL set ───────────────────────────────────────────
  const sitemapBase = siteUrl.startsWith('http') ? siteUrl : 'https://xdipx.com/'
  const entries = await fetchSitemapEntries(new URL('sitemap.xml', sitemapBase))
  if (entries.length === 0) throw new Error('sitemap parsed to zero URLs; refusing to flag everything absent')

  const urls = entries.map(e => e.url)
  const lastmods = entries.map(e => e.lastmod)
  await sql`
    INSERT INTO gsc_url_inspections (url, sitemap_lastmod)
    SELECT u, m FROM unnest(${urls}::text[], ${lastmods}::text[]) AS t(u, m)
    ON CONFLICT (url) DO UPDATE
      SET in_sitemap = TRUE, sitemap_lastmod = EXCLUDED.sitemap_lastmod`
  await sql`
    UPDATE gsc_url_inspections SET in_sitemap = FALSE
    WHERE in_sitemap AND NOT (url = ANY(${urls}::text[]))`

  // ── Pick the batch: never-inspected first, then stalest ───────────────────
  // Dead-state URLs are deliberately kept in the rotation even though the
  // sitemap builder suppresses them (see sitemap.server.ts). Without this,
  // suppression would be one-way: a suppressed URL leaves the sitemap, stops
  // being inspected, and its 404 verdict freezes forever — so a product that
  // comes back could never re-enter the sitemap.
  const batch = await sql`
    SELECT url, coverage_state, verdict FROM gsc_url_inspections
    WHERE in_sitemap OR coverage_state = ANY(${DEAD_VERDICT_STATES}::text[])
    ORDER BY last_inspected_at ASC NULLS FIRST, first_seen_at ASC
    LIMIT ${budget}` as unknown as BatchRow[]

  // ── Inspect with a small worker pool ──────────────────────────────────────
  let inspected = 0
  let errors = 0
  let newlyIndexed = 0
  let newlyDropped = 0
  let quotaHit = false
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < batch.length && !quotaHit) {
      const row = batch[cursor++]!
      let r: IndexStatusResult
      try {
        r = await inspectUrl(token, siteUrl, row.url)
      } catch (err) {
        if (err instanceof QuotaExhaustedError) {
          quotaHit = true
          return
        }
        errors++
        console.warn('[gsc-index]', String(err))
        continue
      }
      const newCoverage = r.coverageState ?? null
      const changed = row.coverage_state !== null && row.coverage_state !== newCoverage
      const wasIndexed = row.verdict === 'PASS'
      const isIndexed = r.verdict === 'PASS'
      if (row.verdict !== null && !wasIndexed && isIndexed) newlyIndexed++
      if (wasIndexed && !isIndexed) newlyDropped++
      await sql`
        UPDATE gsc_url_inspections SET
          verdict = ${r.verdict ?? null},
          coverage_state = ${newCoverage},
          indexing_state = ${r.indexingState ?? null},
          robots_txt_state = ${r.robotsTxtState ?? null},
          page_fetch_state = ${r.pageFetchState ?? null},
          last_crawl_time = ${crawlTimeOrNull(r.lastCrawlTime)},
          google_canonical = ${r.googleCanonical ?? null},
          user_canonical = ${r.userCanonical ?? null},
          last_inspected_at = now(),
          inspect_count = inspect_count + 1,
          previous_coverage_state = CASE WHEN ${changed} THEN ${row.coverage_state} ELSE previous_coverage_state END,
          coverage_changed_at     = CASE WHEN ${changed} THEN now() ELSE coverage_changed_at END
        WHERE url = ${row.url}`
      inspected++
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => worker()))

  const quotaUsedToday = inspected > 0 ? await kvIncrBy(quotaKey, inspected) : used

  // ── Day-level aggregate over the whole table ──────────────────────────────
  const aggRows = await sql`
    SELECT
      count(*) FILTER (WHERE in_sitemap)::int AS sitemap_urls,
      count(*) FILTER (WHERE in_sitemap AND last_inspected_at IS NOT NULL)::int AS inspected_urls,
      count(*) FILTER (WHERE in_sitemap AND verdict = 'PASS')::int AS indexed_count,
      count(*) FILTER (WHERE in_sitemap AND verdict <> 'PASS' AND coverage_state LIKE 'Crawled%')::int AS crawled_not_indexed,
      count(*) FILTER (WHERE in_sitemap AND verdict <> 'PASS' AND coverage_state LIKE 'Discovered%')::int AS discovered_not_indexed,
      count(*) FILTER (WHERE in_sitemap AND last_inspected_at IS NOT NULL AND verdict <> 'PASS'
                       AND coverage_state NOT LIKE 'Crawled%' AND coverage_state NOT LIKE 'Discovered%')::int AS other_not_indexed,
      count(*) FILTER (WHERE in_sitemap AND verdict = 'PASS'
                       AND google_canonical IS NOT NULL AND user_canonical IS NOT NULL
                       AND google_canonical <> user_canonical)::int AS canonical_mismatches
    FROM gsc_url_inspections`
  const agg = aggRows[0] as {
    sitemap_urls: number; inspected_urls: number; indexed_count: number
    crawled_not_indexed: number; discovered_not_indexed: number
    other_not_indexed: number; canonical_mismatches: number
  }

  await sql`
    INSERT INTO gsc_index_daily (
      day, sitemap_urls, inspected_urls, indexed_count, crawled_not_indexed,
      discovered_not_indexed, other_not_indexed, canonical_mismatches,
      newly_indexed, newly_dropped
    ) VALUES (
      ${day}, ${agg.sitemap_urls}, ${agg.inspected_urls}, ${agg.indexed_count},
      ${agg.crawled_not_indexed}, ${agg.discovered_not_indexed},
      ${agg.other_not_indexed}, ${agg.canonical_mismatches},
      ${newlyIndexed}, ${newlyDropped}
    )
    ON CONFLICT (day) DO UPDATE SET
      sitemap_urls = EXCLUDED.sitemap_urls,
      inspected_urls = EXCLUDED.inspected_urls,
      indexed_count = EXCLUDED.indexed_count,
      crawled_not_indexed = EXCLUDED.crawled_not_indexed,
      discovered_not_indexed = EXCLUDED.discovered_not_indexed,
      other_not_indexed = EXCLUDED.other_not_indexed,
      canonical_mismatches = EXCLUDED.canonical_mismatches,
      newly_indexed = gsc_index_daily.newly_indexed + ${newlyIndexed},
      newly_dropped = gsc_index_daily.newly_dropped + ${newlyDropped}`

  return {
    inspected,
    errors,
    quotaUsedToday,
    ...(quotaHit ? { skipped: 'stopped early: API returned 429' } : {}),
    totals: {
      sitemapUrls: agg.sitemap_urls,
      inspectedUrls: agg.inspected_urls,
      indexed: agg.indexed_count,
      crawledNotIndexed: agg.crawled_not_indexed,
      discoveredNotIndexed: agg.discovered_not_indexed,
      otherNotIndexed: agg.other_not_indexed,
      canonicalMismatches: agg.canonical_mismatches,
      newlyIndexed,
      newlyDropped,
    },
  }
}
