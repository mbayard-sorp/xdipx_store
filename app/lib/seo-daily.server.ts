/**
 * Daily SEO diagnosis.
 *
 * The monitoring data already existed and nobody read it: gsc_index_daily has
 * been recording indexed / crawled-not-indexed / discovered-not-indexed counts
 * (plus newly_indexed and newly_dropped deltas) since migration 064, and
 * gsc_url_inspections has per-URL coverage transitions. Indexation could move
 * in either direction for a week and no human would see it. This module turns
 * that data into one daily read, one stored record, and an alert when the
 * numbers say something is wrong.
 *
 * Three parts:
 *
 *  1. Deltas. Latest gsc_index_daily row versus the closest row 7+ days back,
 *     plus a count of coverage-state transitions in the last 24h split into
 *     "cleared" (moved to indexed) and "regressed" (moved off indexed).
 *
 *  2. Live regression tripwire. A small sample of real pages is fetched and
 *     asserted: HTTP 200, a self-referencing canonical, NO noindex directive,
 *     parseable JSON-LD. This exists specifically to catch a repeat of the May
 *     2026 outage, where transient render errors emitted `noindex` plus a
 *     homepage canonical for two weeks and Google cached the verdict on 1,230
 *     URLs. That cost more indexation than every other cause combined, and it
 *     was invisible until the damage was already in Google's cache. The check
 *     is cheap; the failure mode it guards is not.
 *
 *  3. Anomaly tickets. Real regressions file a ticket on the improvement bus
 *     with a dedupe_key of the form `seo:{signal}:{iso-week}`, so a signal
 *     that trips every day for a week produces one ticket, not seven. A live
 *     canonical/noindex failure also emails the owner immediately.
 *
 * Runs at 12:30 UTC, 30 minutes before the 13:00 owner digest, so the digest
 * reads a fresh row. Server-only.
 */
import { sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { extractJsonLd } from '~/lib/homepage-healthcheck.server'
import { checkUrl } from '~/lib/checkout-probe.server'
import { createSuggestion } from '~/lib/team.server'
import { sendOwnerEmail, escapeHtml } from '~/lib/owner-alerts.server'

const SITE_ORIGIN = (process.env['BASE_URL'] || 'https://xdipx.com').replace(/\/+$/, '')

/** Sample sizes for the live tripwire. Small on purpose: this is a canary, not
 *  a crawl. The 3-hourly URL Inspection sweep is the exhaustive pass. */
const PDP_SAMPLE = 5
const PLP_SAMPLE = 2

/** Anomaly thresholds. */
const INDEXED_DROP_PCT = 5     // week-over-week fall that counts as a regression
const NEWLY_DROPPED_MAX = 20   // URLs falling out of the index in one day
const SERVER_ERROR_MAX = 10    // 5xx verdicts sitting in the inspection set
const REGRESSED_URLS_LIMIT = 25  // cap on rows fetched/stored for the regression list

export interface IndexDailyRow {
  day: string
  sitemap_urls: number
  inspected_urls: number
  indexed_count: number
  crawled_not_indexed: number
  discovered_not_indexed: number
  other_not_indexed: number
  canonical_mismatches: number
  newly_indexed: number
  newly_dropped: number
}

export interface ProbeCheck {
  url: string
  ok: boolean
  status: number
  problems: string[]
}

export interface SeoCoverageCounters {
  discoveryTotal: number | null
  hasTypeDial: number | null
  hasMood: number | null
  hasImage: number | null
  enrichedDistinctProducts: number | null
}

export interface RegressedUrl {
  url: string
  previousCoverageState: string | null
  coverageState: string | null
  verdict: string | null
  changedAt: string | null
}

export interface SeoDailyResult {
  day: string
  today: IndexDailyRow | null
  weekAgo: IndexDailyRow | null
  deltas: {
    indexed: number | null
    crawledNotIndexed: number | null
    discoveredNotIndexed: number | null
    newlyIndexed: number | null
    newlyDropped: number | null
  }
  transitions: { cleared: number; regressed: number; total: number }
  /**
   * URLs that moved off an indexed coverage state in the last 7 days (ticket
   * #7247): the `indexed-drop` anomaly used to fire with a bare count and no
   * way to name what changed, so "investigate what changed on the affected
   * URLs" had no data to investigate with. Same predicate as
   * `transitions.regressed`, widened from a 24h to a 7-day window to match
   * the week-over-week comparison the anomaly itself uses. Capped; see
   * REGRESSED_URLS_LIMIT.
   */
  regressedUrls: RegressedUrl[]
  verdictCounts: Record<string, number>
  serverErrors: number
  indexnowPushed24h: number
  snapshot: {
    capturedAt: string | null
    periodStart: string | null
    periodEnd: string | null
    clicks: number | null
    impressions: number | null
    position: number | null
  } | null
  coverage: SeoCoverageCounters
  probes: ProbeCheck[]
  probeFailures: number
  anomalies: string[]
  ticketsFiled: Array<{ signal: string; dedupeKey: string; id: number; priority: number }>
  ownerEmailed: boolean
  errors: string[]
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

const INDEX_DAILY_COLS = sql`
  day::text AS day, sitemap_urls, inspected_urls, indexed_count,
  crawled_not_indexed, discovered_not_indexed, other_not_indexed,
  canonical_mismatches, newly_indexed, newly_dropped`

function delta(a: number | undefined, b: number | undefined): number | null {
  return typeof a === 'number' && typeof b === 'number' ? a - b : null
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * The " Affected: ..." suffix an indexed-drop anomaly appends to name what
 * regressed, or an honest "no per-URL match" note when the drop is not
 * explained by a tracked coverage regression (ticket #7247 — the anomaly used
 * to fire with a bare percentage and no way to investigate it). Pure, so the
 * cap/truncation/empty-list behavior is directly testable without a database.
 */
export function formatRegressedUrlsSuffix(regressedUrls: readonly RegressedUrl[], max = 8): string {
  if (regressedUrls.length === 0) {
    return ' No per-URL regression matched this window in gsc_url_inspections; the drop may be sitemap churn rather than a tracked coverage regression.'
  }
  const named = regressedUrls.slice(0, max)
  const rest = regressedUrls.length - named.length
  const list = named
    .map(u => `${u.url} (${u.previousCoverageState ?? 'indexed'} -> ${u.coverageState ?? u.verdict ?? 'unknown'})`)
    .join('; ')
  return ` Affected: ${list}${rest > 0 ? `; +${rest} more` : ''}`
}

/** ISO week label, e.g. 2026-W31. The dedupe_key grain: a signal that trips
 *  daily produces one ticket per week rather than one per run. */
export function isoWeek(d: Date = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  // Thursday of the current week determines the ISO year.
  const dayNum = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const isoYear = t.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

/**
 * Assert the SEO contract on one live page: 200, self-referencing canonical,
 * no noindex, parseable JSON-LD. Pure given the HTML; the fetch is delegated
 * to checkout-probe's checkUrl so the timeout / UA discipline is shared.
 */
export function auditPageHtml(url: string, html: string): string[] {
  const problems: string[] = []

  // robots meta. `noindex` anywhere in a robots-family directive is the exact
  // signature of the May outage.
  const robotsRe = /<meta[^>]+name=["'](?:robots|googlebot)["'][^>]*content=["']([^"']*)["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = robotsRe.exec(html)) !== null) {
    if (/\bnoindex\b/i.test(m[1] ?? '')) problems.push(`noindex directive present ("${(m[1] ?? '').trim()}")`)
  }

  // Canonical must exist and be self-referencing. Compared on PATH, not on the
  // full URL: the probe may run against a different origin than the canonical
  // advertises (BASE_URL is unset in production today, and a preview
  // deployment would differ again), and an origin mismatch there is a config
  // detail, not an SEO regression. A path mismatch is the real signal, and it
  // is precisely the May outage signature (every PDP canonicalised to `/`).
  const canonical = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1]
  if (!canonical) {
    problems.push('no canonical link')
  } else {
    const path = (u: string) => {
      try {
        const p = new URL(u, SITE_ORIGIN)
        return p.pathname.replace(/\/+$/, '') || '/'
      } catch { return u }
    }
    if (path(canonical) !== path(url)) {
      problems.push(`canonical points elsewhere (${canonical})`)
    }
  }

  const { parsed, scripts } = extractJsonLd(html)
  if (scripts === 0) problems.push('no JSON-LD block')
  else if (parsed < scripts) problems.push(`malformed JSON-LD (${scripts - parsed} of ${scripts} unparseable)`)

  return problems
}

async function probe(url: string): Promise<ProbeCheck> {
  const res = await checkUrl(url)
  const problems: string[] = []
  if (!res.ok && res.detail) problems.push(res.detail)
  if (res.body) problems.push(...auditPageHtml(url, res.body))
  return { url, ok: problems.length === 0, status: res.status, problems }
}

/**
 * Sample pages to probe: the homepage, 2 PLPs, 5 PDPs drawn from the sitemap.
 * Sampling from the sitemap (rather than a hardcoded list) means the tripwire
 * follows the catalog instead of rotting the first time a handle changes.
 */
async function sampleUrls(): Promise<string[]> {
  const urls = [`${SITE_ORIGIN}/`]
  try {
    const { fetchSitemapEntries } = await import('~/lib/gsc-index.server')
    const entries = await fetchSitemapEntries(new URL('sitemap.xml', `${SITE_ORIGIN}/`))
    const pick = <T,>(list: T[], n: number): T[] => {
      if (list.length <= n) return list
      // Even stride rather than random: a fixed spread is reproducible, and a
      // reproducible sample makes a failure easy to re-run by hand.
      const stride = Math.floor(list.length / n)
      return Array.from({ length: n }, (_, i) => list[i * stride]!).filter(Boolean)
    }
    const collections = entries.map(e => e.url).filter(u => /\/collections\/[^/]+$/.test(u))
    const products = entries.map(e => e.url).filter(u => u.includes('/products/'))
    urls.push(...pick(collections, PLP_SAMPLE), ...pick(products, PDP_SAMPLE))
  } catch (err) {
    console.warn('[seo-daily] sitemap sample failed, probing homepage only:', String(err).slice(0, 200))
  }
  return urls
}

/** Coverage counters from the live discovery index + enrichment cache. */
async function coverageCounters(): Promise<SeoCoverageCounters> {
  const empty: SeoCoverageCounters = {
    discoveryTotal: null, hasTypeDial: null, hasMood: null, hasImage: null,
    enrichedDistinctProducts: null,
  }
  try {
    const res = await db.execute(sql`
      SELECT
        jsonb_array_length(index_json::jsonb)::int AS total,
        (SELECT count(*)::int FROM jsonb_array_elements(index_json::jsonb) e
          WHERE e->>'productTypeDial' IS NOT NULL AND e->>'productTypeDial' <> '') AS has_type_dial,
        (SELECT count(*)::int FROM jsonb_array_elements(index_json::jsonb) e
          WHERE jsonb_typeof(e->'mood') = 'array' AND jsonb_array_length(e->'mood') > 0) AS has_mood,
        (SELECT count(*)::int FROM jsonb_array_elements(index_json::jsonb) e
          WHERE e->>'imageUrl' IS NOT NULL AND e->>'imageUrl' <> '') AS has_image
      FROM discovery_index_payload WHERE version = 'v7' LIMIT 1`)
    const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined
    const enrichRes = await db.execute(sql`
      SELECT count(DISTINCT product_id)::int AS n FROM product_enrichment_cache`)
    const enriched = (enrichRes.rows ?? [])[0] as { n?: unknown } | undefined
    return {
      discoveryTotal: row ? num(row['total']) : null,
      hasTypeDial:    row ? num(row['has_type_dial']) : null,
      hasMood:        row ? num(row['has_mood']) : null,
      hasImage:       row ? num(row['has_image']) : null,
      enrichedDistinctProducts: enriched ? num(enriched['n']) : null,
    }
  } catch (err) {
    console.warn('[seo-daily] coverage counters failed:', String(err).slice(0, 200))
    return empty
  }
}

/* ── main ─────────────────────────────────────────────────────────────────── */

export async function runSeoDaily(): Promise<SeoDailyResult> {
  const day = new Date().toISOString().slice(0, 10)
  const errors: string[] = []

  const guard = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch (err) {
      const msg = `${label}: ${err instanceof Error ? err.message : String(err)}`
      console.warn('[seo-daily]', msg)
      errors.push(msg)
      return fallback
    }
  }

  // ── 1. Index deltas ───────────────────────────────────────────────────────
  const today = await guard('gsc_index_daily latest', async () => {
    const r = await db.execute(sql`SELECT ${INDEX_DAILY_COLS} FROM gsc_index_daily ORDER BY day DESC LIMIT 1`)
    return ((r.rows ?? [])[0] ?? null) as IndexDailyRow | null
  }, null)

  const weekAgo = await guard('gsc_index_daily week-ago', async () => {
    const r = await db.execute(sql`
      SELECT ${INDEX_DAILY_COLS} FROM gsc_index_daily
      WHERE day <= now()::date - 7 ORDER BY day DESC LIMIT 1`)
    return ((r.rows ?? [])[0] ?? null) as IndexDailyRow | null
  }, null)

  const transitions = await guard('coverage transitions', async () => {
    const r = await db.execute(sql`
      SELECT
        count(*) FILTER (
          WHERE verdict = 'PASS'
            AND previous_coverage_state IS DISTINCT FROM coverage_state)::int AS cleared,
        count(*) FILTER (
          WHERE verdict <> 'PASS'
            AND previous_coverage_state IN ('Submitted and indexed', 'Indexed, not submitted in sitemap'))::int AS regressed,
        count(*)::int AS total
      FROM gsc_url_inspections
      WHERE coverage_changed_at >= now() - interval '24 hours'`)
    const row = (r.rows ?? [])[0] as Record<string, unknown> | undefined
    return { cleared: num(row?.['cleared']), regressed: num(row?.['regressed']), total: num(row?.['total']) }
  }, { cleared: 0, regressed: 0, total: 0 })

  // Same predicate as `transitions.regressed` above, widened to a 7-day
  // window (transitions' 24h window is for the day-to-day tripwire; the
  // indexed-drop anomaly compares week over week, so its "what changed"
  // answer needs the wider window too). Named rows, not just a count, so the
  // anomaly text and the team-facing seo-status API can say which URLs.
  const regressedUrls = await guard('regressed url list', async () => {
    const r = await db.execute(sql`
      SELECT url, previous_coverage_state, coverage_state, verdict,
             coverage_changed_at::text AS changed_at
      FROM gsc_url_inspections
      WHERE coverage_changed_at >= now() - interval '7 days'
        AND verdict <> 'PASS'
        AND previous_coverage_state IN ('Submitted and indexed', 'Indexed, not submitted in sitemap')
      ORDER BY coverage_changed_at DESC
      LIMIT ${REGRESSED_URLS_LIMIT}`)
    return (r.rows ?? []).map((row): RegressedUrl => {
      const r2 = row as Record<string, unknown>
      return {
        url:                    String(r2['url']),
        previousCoverageState:  r2['previous_coverage_state'] != null ? String(r2['previous_coverage_state']) : null,
        coverageState:          r2['coverage_state'] != null ? String(r2['coverage_state']) : null,
        verdict:                r2['verdict'] != null ? String(r2['verdict']) : null,
        changedAt:              r2['changed_at'] != null ? String(r2['changed_at']) : null,
      }
    })
  }, [] as RegressedUrl[])

  const verdictCounts = await guard('verdict breakdown', async () => {
    const r = await db.execute(sql`
      SELECT COALESCE(coverage_state, 'unknown') AS state, count(*)::int AS n
      FROM gsc_url_inspections WHERE in_sitemap GROUP BY 1 ORDER BY 2 DESC`)
    const out: Record<string, number> = {}
    for (const row of (r.rows ?? []) as Array<Record<string, unknown>>) {
      out[String(row['state'])] = num(row['n'])
    }
    return out
  }, {} as Record<string, number>)

  const serverErrors = verdictCounts['Server error (5xx)'] ?? 0

  const indexnowPushed24h = await guard('indexnow ledger', async () => {
    const r = await db.execute(sql`
      SELECT count(*)::int AS n FROM indexnow_pings WHERE pinged_at >= now() - interval '24 hours'`)
    return num(((r.rows ?? [])[0] as { n?: unknown } | undefined)?.n)
  }, 0)

  const snapshot = await guard('gsc_snapshots', async () => {
    const r = await db.execute(sql`
      SELECT captured_at::text AS captured_at, period_start::text AS period_start,
             period_end::text AS period_end, totals
      FROM gsc_snapshots ORDER BY captured_at DESC LIMIT 1`)
    const row = (r.rows ?? [])[0] as Record<string, unknown> | undefined
    if (!row) return null
    const totals = (row['totals'] ?? {}) as Record<string, unknown>
    return {
      capturedAt:  row['captured_at'] ? String(row['captured_at']) : null,
      periodStart: row['period_start'] ? String(row['period_start']) : null,
      periodEnd:   row['period_end'] ? String(row['period_end']) : null,
      clicks:      totals['clicks'] != null ? num(totals['clicks']) : null,
      impressions: totals['impressions'] != null ? num(totals['impressions']) : null,
      position:    totals['position'] != null ? num(totals['position']) : null,
    }
  }, null)

  const coverage = await coverageCounters()

  // ── 2. Live regression tripwire ───────────────────────────────────────────
  const probes = await guard('live probes', async () => {
    const urls = await sampleUrls()
    return Promise.all(urls.map(probe))
  }, [] as ProbeCheck[])
  const probeFailures = probes.filter(p => !p.ok).length

  // ── 3. Anomalies ──────────────────────────────────────────────────────────
  const deltas = {
    indexed:                delta(today?.indexed_count, weekAgo?.indexed_count),
    crawledNotIndexed:      delta(today?.crawled_not_indexed, weekAgo?.crawled_not_indexed),
    discoveredNotIndexed:   delta(today?.discovered_not_indexed, weekAgo?.discovered_not_indexed),
    newlyIndexed:           today ? today.newly_indexed : null,
    newlyDropped:           today ? today.newly_dropped : null,
  }

  const anomalies: string[] = []
  const signals: Array<{ signal: string; priority: number; text: string }> = []

  if (today && weekAgo && weekAgo.indexed_count > 0) {
    const pct = ((today.indexed_count - weekAgo.indexed_count) / weekAgo.indexed_count) * 100
    if (pct < -INDEXED_DROP_PCT) {
      // Name the affected URLs when gsc_url_inspections has them (it will not
      // for every drop: a URL can also fall off by leaving the sitemap
      // entirely, which regressedUrls does not capture).
      const text = `Indexed URLs fell ${Math.abs(pct).toFixed(1)}% week over week: ${weekAgo.indexed_count} on ${weekAgo.day} to ${today.indexed_count} on ${today.day}.${formatRegressedUrlsSuffix(regressedUrls)}`
      anomalies.push(text)
      signals.push({ signal: 'indexed-drop', priority: 2, text })
    }
  }

  if (today && today.newly_dropped > NEWLY_DROPPED_MAX) {
    const text = `${today.newly_dropped} URLs dropped out of the index in the last day (threshold ${NEWLY_DROPPED_MAX}). Check gsc_url_inspections for the common cause.`
    anomalies.push(text)
    signals.push({ signal: 'newly-dropped', priority: 2, text })
  }

  if (serverErrors > SERVER_ERROR_MAX) {
    const text = `${serverErrors} sitemap URLs currently carry a 5xx verdict (threshold ${SERVER_ERROR_MAX}). Server errors cost crawl budget and erode sitemap trust.`
    anomalies.push(text)
    signals.push({ signal: 'server-errors', priority: 2, text })
  }

  if (probeFailures > 0) {
    const detail = probes.filter(p => !p.ok)
      .map(p => `${p.url}: ${p.problems.join('; ')}`)
      .join(' | ')
    const text = `Live SEO tripwire failed on ${probeFailures} of ${probes.length} sampled pages. ${detail}. This is the signature of the May 2026 outage that cost 1,230 URLs their index status, so treat it as P0 until proven otherwise.`
    anomalies.push(text)
    signals.push({ signal: 'live-probe', priority: 1, text })
  }

  const week = isoWeek()
  const ticketsFiled: SeoDailyResult['ticketsFiled'] = []
  for (const s of signals) {
    const dedupeKey = `seo:${s.signal}:${week}`
    const id = await guard(`ticket ${s.signal}`, () => createSuggestion({
      team:       'strategy',
      category:   'other',
      kind:       'code',
      suggestion: s.text,
      cxRisk:     s.priority === 1 ? 'high' : 'med',
      priority:   s.priority,
      dedupeKey,
    }), 0)
    ticketsFiled.push({ signal: s.signal, dedupeKey, id, priority: s.priority })
  }

  // A live canonical/noindex failure is the one signal that cannot wait for
  // the digest: every hour it stays broken is another slice of the catalog
  // being recrawled into a bad cached verdict.
  let ownerEmailed = false
  if (probeFailures > 0) {
    const rows = probes.filter(p => !p.ok)
      .map(p => `<li><code>${escapeHtml(p.url)}</code> (HTTP ${p.status}) &mdash; ${escapeHtml(p.problems.join('; '))}</li>`)
      .join('')
    const res = await sendOwnerEmail(
      `xdipx SEO tripwire FAILED on ${probeFailures} of ${probes.length} pages`,
      `<body style="margin:0;padding:16px;background:#faf7f2;font-family:Inter,sans-serif;font-size:13px;color:#2b2b2b;">
        <h2 style="font-size:16px;margin:0 0 8px;">SEO regression tripwire failed &middot; ${day}</h2>
        <p style="margin:0 0 8px;">The daily check asserts every sampled page returns 200, carries a self-referencing canonical, emits no noindex, and ships parseable JSON-LD. These failed:</p>
        <ul style="margin:0 0 12px;padding-left:18px;">${rows}</ul>
        <p style="margin:0;color:#6f645c;">This is the same signature as the May 2026 outage, which left 1,230 URLs on a cached noindex verdict for two months. Sent by /cron/seo-daily.</p>
      </body>`,
      { escalation: 'seo-report', fromName: 'xdipx SEO tripwire' },
    )
    ownerEmailed = res.sent
  }

  const result: SeoDailyResult = {
    day, today, weekAgo, deltas, transitions, regressedUrls, verdictCounts, serverErrors,
    indexnowPushed24h, snapshot, coverage, probes, probeFailures, anomalies,
    ticketsFiled, ownerEmailed, errors,
  }

  // ── 4. Persist ────────────────────────────────────────────────────────────
  await guard('persist seo_coverage_daily', async () => {
    await db.execute(sql`
      INSERT INTO seo_coverage_daily (
        day, discovery_total, has_type_dial, has_mood, has_image,
        enriched_distinct_products, notes
      ) VALUES (
        ${day}, ${coverage.discoveryTotal}, ${coverage.hasTypeDial}, ${coverage.hasMood},
        ${coverage.hasImage}, ${coverage.enrichedDistinctProducts},
        ${JSON.stringify(result)}::jsonb
      )
      ON CONFLICT (day) DO UPDATE SET
        discovery_total = EXCLUDED.discovery_total,
        has_type_dial = EXCLUDED.has_type_dial,
        has_mood = EXCLUDED.has_mood,
        has_image = EXCLUDED.has_image,
        enriched_distinct_products = EXCLUDED.enriched_distinct_products,
        notes = EXCLUDED.notes`)
    return true
  }, false)

  return result
}

/** Latest stored diagnosis, for the owner digest and the team status API. */
export async function getLatestSeoDaily(): Promise<{ day: string; notes: SeoDailyResult | null } | null> {
  try {
    const r = await db.execute(sql`
      SELECT day::text AS day, notes FROM seo_coverage_daily ORDER BY day DESC LIMIT 1`)
    const row = (r.rows ?? [])[0] as { day?: unknown; notes?: unknown } | undefined
    if (!row) return null
    return { day: String(row.day), notes: (row.notes ?? null) as SeoDailyResult | null }
  } catch (err) {
    console.warn('[seo-daily] getLatestSeoDaily failed:', String(err).slice(0, 200))
    return null
  }
}
