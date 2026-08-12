/**
 * Bulk IndexNow pusher.
 *
 * The problem it solves: ~1,565 URLs sit on Google-cached bad verdicts from
 * the May 2026 render outage (1,230 "Excluded by 'noindex'" + 335 "Duplicate
 * without user-selected canonical"). The bug was fixed 2026-06-13, but a
 * cached verdict only clears when the URL is recrawled, and passive `lastmod`
 * has produced literally zero newly-indexed URLs per day. IndexNow is the one
 * lever that actively asks an engine to come back and look again.
 *
 * ── Design constraints, all deliberate ────────────────────────────────────
 *
 *  1. READ-ONLY with respect to the sitemap and gsc_url_inspections. This
 *     module never writes `lastmod`, never touches gsc_url_inspections, and
 *     never influences the sweep's re-inspection ordering. Bumping lastmod
 *     without a real content change is dishonest signalling: it teaches the
 *     crawler that our dates mean nothing, which is worse than the problem we
 *     are trying to fix. The recrawl request goes out of band, via IndexNow.
 *
 *  2. Suppression window. A URL pushed in the last PING_SUPPRESSION_DAYS is
 *     skipped. Without this the daily cron would re-submit the same ~1.5k
 *     URLs every morning, which is exactly the abuse pattern IndexNow
 *     penalises, and it would tell the engine nothing new.
 *
 *  3. Record only on success. A 429 or 5xx stops the run and writes nothing,
 *     so tomorrow's pass retries the same URLs rather than marking them
 *     pushed on the strength of a failed request.
 *
 *  4. Never throws. This runs on a cron next to revenue-critical jobs.
 *
 * Server-only.
 */
import {
  SITE_ORIGIN, INDEXNOW_MAX_URLS_PER_REQUEST,
  chunkUrls, normalizeUrls, submitIndexNowChunk, isRetryableStatus,
} from '~/lib/search-ping.server'

// db.server, sitemap.server, and gsc-index.server all open a Neon client (and
// pull the Shopify/Sanity clients) at module load. They are imported lazily
// inside the functions below so this module's pure helpers stay importable in
// a unit test with no DATABASE_URL and no network.

/** How long a pushed URL stays suppressed from re-pushing. */
export const PING_SUPPRESSION_DAYS = 14

/** Safety ceiling per run, well above the ~1,565-URL stale set. */
const DEFAULT_LIMIT = 20_000

export type IndexNowScope = 'stale' | 'all'

export interface IndexNowBulkResult {
  scope: IndexNowScope
  skipped?: string
  /** Size of the candidate set before the suppression window was applied. */
  candidates: number
  /** Dropped because they were pushed inside the suppression window. */
  suppressed: number
  /** Actually POSTed and confirmed 2xx. */
  pushed: number
  chunks: number
  batchId: string
  /** Status of the first non-2xx chunk, when the run stopped early. */
  stoppedAtStatus?: number
  error?: string
}

/**
 * Pure: drop URLs that were pushed inside the suppression window, then cap.
 * Extracted so the exclusion rule is unit-testable without a database.
 */
export function selectPushableUrls(
  candidates: string[],
  recentlyPinged: Set<string>,
  limit: number,
): { pushable: string[]; suppressed: number } {
  const pushable: string[] = []
  let suppressed = 0
  for (const url of candidates) {
    if (recentlyPinged.has(url)) { suppressed++; continue }
    if (pushable.length >= limit) continue
    pushable.push(url)
  }
  return { pushable, suppressed }
}

/** Batch id shape: one per calendar day, so a day's pushes group in the ledger. */
export function batchIdForDay(d: Date = new Date()): string {
  return `bulk-${d.toISOString().slice(0, 10)}`
}

/**
 * The stale set: exactly the cached-bad-verdict URLs that need a recrawl
 * signal. `getUrlHealth().stale` is already "bad verdict, minus the dead ones
 * we trust", which is the set the sitemap floors the lastmod on. Reusing it
 * (rather than re-deriving a parallel definition) keeps one source of truth
 * for what "stale verdict" means. This is a read; nothing is mutated.
 */
async function staleUrls(): Promise<string[]> {
  const { getUrlHealth } = await import('~/lib/sitemap.server')
  const health = await getUrlHealth()
  return Array.from(health.stale.keys())
}

/** Every URL currently in the sitemap, via the existing index-aware fetcher. */
async function allSitemapUrls(): Promise<string[]> {
  const { fetchSitemapEntries } = await import('~/lib/gsc-index.server')
  const entries = await fetchSitemapEntries(new URL('sitemap.xml', `${SITE_ORIGIN}/`))
  return entries.map(e => e.url)
}

/** URLs from `urls` that were pinged inside the suppression window. */
async function recentlyPinged(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set()
  try {
    // The raw Neon client, not drizzle's `sql` template: drizzle expands an
    // interpolated JS array into a record tuple, so `::text[]` fails at runtime
    // with "cannot cast type record to text[]". This mirrors getUrlHealth() in
    // sitemap.server.ts, which runs the same shape of query in production.
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(process.env['DATABASE_URL']!)
    const rows = await sql`
      SELECT url FROM indexnow_pings
      WHERE url = ANY(${urls}::text[])
        AND pinged_at >= now() - (${PING_SUPPRESSION_DAYS} * interval '1 day')
    ` as unknown as Array<{ url: string }>
    return new Set(rows.map(r => String(r.url)))
  } catch (err) {
    // A missing ledger table must not turn into "push everything, twice".
    // Treat the read failure as "everything is suppressed" and skip the run.
    console.error('[indexnow-bulk] ledger read failed, refusing to push:', err)
    throw err
  }
}

/** Record a confirmed-pushed chunk. Upsert so a re-push refreshes the window. */
async function recordPushed(urls: string[], batchId: string, statusCode: number): Promise<void> {
  if (urls.length === 0) return
  // Raw Neon client, for the same array-binding reason as recentlyPinged above.
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(process.env['DATABASE_URL']!)
  await sql`
    INSERT INTO indexnow_pings (url, pinged_at, batch_id, engine, status_code)
    SELECT u, now(), ${batchId}, 'indexnow', ${statusCode}
    FROM unnest(${urls}::text[]) AS t(u)
    ON CONFLICT (url) DO UPDATE SET
      pinged_at   = EXCLUDED.pinged_at,
      batch_id    = EXCLUDED.batch_id,
      status_code = EXCLUDED.status_code`
}

export async function runIndexNowBulkPush(
  opts: { scope?: IndexNowScope; limit?: number } = {},
): Promise<IndexNowBulkResult> {
  const scope: IndexNowScope = opts.scope === 'all' ? 'all' : 'stale'
  const limit = opts.limit && opts.limit > 0 ? opts.limit : DEFAULT_LIMIT
  const batchId = batchIdForDay()
  const base: IndexNowBulkResult = {
    scope, candidates: 0, suppressed: 0, pushed: 0, chunks: 0, batchId,
  }

  if (process.env['SEARCH_PING_ENABLED'] !== 'true') {
    return { ...base, skipped: 'SEARCH_PING_ENABLED is not true' }
  }
  const key = process.env['INDEXNOW_API_KEY']
  if (!key) return { ...base, skipped: 'INDEXNOW_API_KEY missing' }

  try {
    const raw = scope === 'all' ? await allSitemapUrls() : await staleUrls()
    const candidates = normalizeUrls(raw)
    if (candidates.length === 0) return { ...base, skipped: 'no candidate URLs' }

    const seen = await recentlyPinged(candidates)
    const { pushable, suppressed } = selectPushableUrls(candidates, seen, limit)
    if (pushable.length === 0) {
      return { ...base, candidates: candidates.length, suppressed, skipped: 'all candidates suppressed' }
    }

    let pushed = 0
    let chunks = 0
    let stoppedAtStatus: number | undefined
    for (const chunk of chunkUrls(pushable, INDEXNOW_MAX_URLS_PER_REQUEST)) {
      const result = await submitIndexNowChunk(chunk, { key })
      chunks++
      if (result.ok) {
        await recordPushed(chunk, batchId, result.status)
        pushed += chunk.length
        console.log(`[indexnow-bulk] ${result.status} for ${chunk.length} url(s) (${scope})`)
        continue
      }
      // Record nothing. Stopping without a ledger write is what makes the
      // next run a clean retry rather than a silent gap.
      stoppedAtStatus = result.status
      console.warn(`[indexnow-bulk] stopping: status ${result.status} (${result.error ?? 'no body'})`)
      if (result.status === 429 || isRetryableStatus(result.status)) break
      break
    }

    return {
      ...base,
      candidates: candidates.length,
      suppressed,
      pushed,
      chunks,
      ...(stoppedAtStatus !== undefined ? { stoppedAtStatus } : {}),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[indexnow-bulk] run failed (non-blocking):', message)
    return { ...base, error: message }
  }
}
