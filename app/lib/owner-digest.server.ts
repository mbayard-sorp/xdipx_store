/**
 * Daily owner digest (p0-6): one email a day that tells the owner what the
 * store and its agent teams actually did, without opening a dashboard.
 * Sections: orders/profit, team runs (failures called out), valve snapshot,
 * search indexing (gsc_index_daily aggregate + dropped URLs), suggestion
 * queue, and program-tracker status (overall RAG + the program-manager's
 * "Asks for the owner").
 *
 * Sent via /cron/owner-digest (13:00 UTC). A KV once-per-day guard prevents
 * double sends from cron double-invocation; pass force=true to re-send while
 * testing.
 */

import { sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { gate, getValve, TEAM_IDS } from '~/lib/team.server'
import { VALVE_KEYS } from '~/lib/team-keys'
import { getTrackers, latestOwnerAsks } from '~/lib/tracker.server'
import { sendOwnerEmail } from '~/lib/owner-alerts.server'
import { kvSetNX } from '~/lib/kv.server'
import type { SeoDailyResult } from '~/lib/seo-daily.server'

interface ProfitRow {
  day: string
  orders: number
  revenue: number
  profit: number
  featured_sku: string | null
}

interface RunRow {
  team: string
  run_type: string
  status: string
  started_at: string
  error: string | null
  summary: string | null
}

interface DroppedUrlRow {
  url: string
  previous_coverage_state: string | null
  coverage_state: string | null
}

interface SeoTicketRow {
  id: number
  priority: number
  status: string
  suggestion: string
  dedupe_key: string | null
}

export interface OwnerDigestResult {
  sent: boolean
  skipped?: string
  error?: string
  subject?: string
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function ragColor(rag: string): string {
  if (rag === 'GREEN') return '#1c7c43'
  if (rag === 'AMBER') return '#b57d0a'
  if (rag === 'RED') return '#d93a15'
  return '#6f645c'
}

export async function runOwnerDigest(opts: { force?: boolean } = {}): Promise<OwnerDigestResult> {
  const day = new Date().toISOString().slice(0, 10)
  if (!opts.force) {
    const first = await kvSetNX(`owner-digest:sent:${day}`, String(Date.now()), 26 * 3600)
    if (!first) return { sent: false, skipped: 'already sent today (pass force=1 to re-send)' }
  }

  // ── Gather ────────────────────────────────────────────────────────────────
  const profitRes = await db.execute(sql`
    SELECT summary_date::text AS day,
           COALESCE(total_orders, 0)::int AS orders,
           COALESCE(total_revenue, 0)::float8 AS revenue,
           COALESCE(total_profit, 0)::float8 AS profit,
           featured_sku
    FROM daily_profit_summary
    ORDER BY summary_date DESC
    LIMIT 8`)
  const profit = (profitRes.rows ?? []) as unknown as ProfitRow[]
  const yesterday = profit[0]

  const runsRes = await db.execute(sql`
    SELECT team, run_type, status, started_at::text AS started_at, error, summary
    FROM homepage_team_runs
    WHERE started_at >= now() - interval '24 hours'
    ORDER BY started_at DESC
    LIMIT 40`)
  const runs = (runsRes.rows ?? []) as unknown as RunRow[]
  const failures = runs.filter(r => r.status === 'failed')

  const suggRes = await db.execute(sql`
    SELECT status, COUNT(*)::int AS n, MIN(created_at)::text AS oldest
    FROM homepage_team_suggestions
    GROUP BY status`)
  const sugg = (suggRes.rows ?? []) as unknown as Array<{ status: string; n: number; oldest: string }>
  const proposed = sugg.find(s => s.status === 'proposed')

  const gates = await Promise.all(TEAM_IDS.map(t => gate(t)))
  const valveEntries = await Promise.all(
    Object.entries(VALVE_KEYS).map(async ([name, key]) => [name, await getValve(key)] as const),
  )

  const trackers = getTrackers()
  const redTrackers = trackers.filter(t => t.overall === 'RED').length

  // The SEO section reads yesterday's /cron/seo-daily result (12:30 UTC, 30
  // min before this digest) rather than re-querying and re-deriving the same
  // deltas here. One computation, one interpretation, two readers.
  // Best-effort: tables arrive with migrations 064/071 and a digest must still
  // send if neither the sweep nor the diagnosis has ever run.
  let seo: SeoDailyResult | null = null
  let seoDay: string | null = null
  let droppedUrls: DroppedUrlRow[] = []
  let seoTickets: SeoTicketRow[] = []
  try {
    const { getLatestSeoDaily } = await import('~/lib/seo-daily.server')
    const latest = await getLatestSeoDaily()
    if (latest) {
      seo = latest.notes
      seoDay = latest.day
    }
  } catch (err) {
    console.warn('[owner-digest] seo-daily unavailable:', String(err).slice(0, 200))
  }
  try {
    const droppedRes = await db.execute(sql`
      SELECT url, previous_coverage_state, coverage_state
      FROM gsc_url_inspections
      WHERE coverage_changed_at >= now() - interval '24 hours'
        AND previous_coverage_state IN ('Submitted and indexed', 'Indexed, not submitted in sitemap')
        AND verdict <> 'PASS'
      ORDER BY coverage_changed_at DESC LIMIT 5`)
    droppedUrls = (droppedRes.rows ?? []) as unknown as DroppedUrlRow[]
  } catch (err) {
    console.warn('[owner-digest] index-monitor tables unavailable (migration 064 not applied?):', String(err).slice(0, 200))
  }
  try {
    const ticketRes = await db.execute(sql`
      SELECT id, priority, status, suggestion, dedupe_key
      FROM homepage_team_suggestions
      WHERE created_at >= now() - interval '24 hours' AND dedupe_key LIKE 'seo:%'
      ORDER BY priority ASC, created_at DESC LIMIT 10`)
    seoTickets = (ticketRes.rows ?? []) as unknown as SeoTicketRow[]
  } catch (err) {
    console.warn('[owner-digest] ticket columns unavailable (migration 070 not applied?):', String(err).slice(0, 200))
  }

  // ── Compose ───────────────────────────────────────────────────────────────
  const ordersY = yesterday?.orders ?? 0
  const subject = `xdipx daily digest: ${ordersY} orders yesterday, ${failures.length} run failure${failures.length === 1 ? '' : 's'}, ${redTrackers} RED tracker${redTrackers === 1 ? '' : 's'}`

  const profitRows = profit
    .map(p => `<tr><td style="padding:2px 10px 2px 0;">${esc(p.day)}</td><td style="padding:2px 10px;">${p.orders}</td><td style="padding:2px 10px;">$${p.revenue.toFixed(2)}</td><td style="padding:2px 10px;">$${p.profit.toFixed(2)}</td><td style="padding:2px 0;">${esc(p.featured_sku ?? '')}</td></tr>`)
    .join('')

  const runRows = runs
    .map(r => `<tr><td style="padding:2px 10px 2px 0;">${esc(r.team)}</td><td style="padding:2px 10px;">${esc(r.run_type)}</td><td style="padding:2px 10px;color:${r.status === 'failed' ? '#d93a15' : r.status === 'succeeded' ? '#1c7c43' : '#6f645c'};">${esc(r.status)}</td><td style="padding:2px 0;">${esc((r.error ?? r.summary ?? '').slice(0, 140))}</td></tr>`)
    .join('')

  const gateRows = gates
    .map(g => `<tr><td style="padding:2px 10px 2px 0;">${esc(g.team)}</td><td style="padding:2px 10px;">${g.enabled ? 'on' : '<span style="color:#d93a15;">off</span>'}</td><td style="padding:2px 10px;">${g.runsToday}/${g.maxRunsPerDay} runs</td><td style="padding:2px 0;">$${(g.spentCents / 100).toFixed(2)} / $${(g.dailyCents / 100).toFixed(2)}</td></tr>`)
    .join('')

  const valveRows = valveEntries
    .map(([name, on]) => `<tr><td style="padding:2px 10px 2px 0;">${esc(name)}</td><td style="padding:2px 0;">${on ? 'on' : 'off'}</td></tr>`)
    .join('')

  const signed = (n: number | null | undefined): string =>
    typeof n === 'number' ? `${n >= 0 ? '+' : ''}${n}` : 'n/a'

  let indexBody = 'no SEO diagnosis yet (migrations 064/071 + /cron/seo-daily)'
  const idx = seo?.today ?? null
  if (seo && idx) {
    const wow = seo.deltas.indexed
    const wowStr = wow === null
      ? ''
      : ` (${signed(wow)} vs ${esc(seo.weekAgo?.day ?? 'a week ago')})`
    const droppedList = droppedUrls
      .map(d => `<li>${esc(d.url)} &mdash; now &ldquo;${esc(d.coverage_state ?? 'unknown')}&rdquo;</li>`)
      .join('')

    const probeLine = seo.probeFailures > 0
      ? `<p style="margin:0 0 4px;color:#d93a15;"><strong>Tripwire FAILED on ${seo.probeFailures} of ${seo.probes.length} sampled pages.</strong> ${esc(seo.probes.filter(p => !p.ok).map(p => `${p.url}: ${p.problems.join('; ')}`).join(' | ').slice(0, 400))}</p>`
      : `<p style="margin:0 0 4px;color:#1c7c43;">Tripwire clean on ${seo.probes.length} sampled pages (200, self-canonical, no noindex, parseable JSON-LD).</p>`

    // gsc_snapshots is refreshed by a Monday-only cron, so its numbers are a
    // weekly 28-day rollup, not yesterday. Saying so prevents reading a flat
    // line as "nothing happened today".
    const snap = seo.snapshot
    const snapLine = snap
      ? `<p style="margin:0 0 4px;">Search traffic (28-day rollup, captured ${esc((snap.capturedAt ?? '').slice(0, 10))}, refreshed weekly on Mondays): ${snap.impressions ?? 'n/a'} impressions &middot; ${snap.clicks ?? 'n/a'} clicks &middot; avg position ${snap.position != null ? snap.position.toFixed(1) : 'n/a'}</p>`
      : '<p style="margin:0 0 4px;color:#6f645c;">No gsc_snapshots row yet (weekly, Monday 06:00 UTC).</p>'

    const cov = seo.coverage
    const covLine = cov.discoveryTotal
      ? `<p style="margin:0 0 4px;">Catalog coverage: ${cov.discoveryTotal} products indexed for discovery &middot; ${cov.hasTypeDial ?? 0} with a type dial &middot; ${cov.hasMood ?? 0} with mood tags &middot; ${cov.hasImage ?? 0} with an image &middot; ${cov.enrichedDistinctProducts ?? 0} enriched</p>`
      : ''

    const ticketList = seoTickets
      .map(t => `<li>P${t.priority} &middot; ${esc(t.status)} &middot; #${t.id} ${esc(t.suggestion.slice(0, 160))}</li>`)
      .join('')

    indexBody = `<p style="margin:0 0 4px;"><strong>${idx.indexed_count}</strong> of ${idx.sitemap_urls} sitemap URLs indexed${wowStr} &middot; ${idx.inspected_urls} inspected so far</p>
      <p style="margin:0 0 4px;">Not indexed: ${idx.crawled_not_indexed} crawled-but-rejected (${signed(seo.deltas.crawledNotIndexed)} w/w) &middot; ${idx.discovered_not_indexed} discovered-not-crawled (${signed(seo.deltas.discoveredNotIndexed)} w/w) &middot; ${idx.other_not_indexed} other &middot; ${idx.canonical_mismatches} canonical mismatch${idx.canonical_mismatches === 1 ? '' : 'es'}</p>
      <p style="margin:0 0 4px;">Transitions in 24h: <span style="color:#1c7c43;">${seo.transitions.cleared} cleared</span> &middot; <span style="color:${seo.transitions.regressed > 0 ? '#d93a15' : '#6f645c'};">${seo.transitions.regressed} regressed</span> &middot; ${seo.transitions.total} total changes</p>
      ${idx.newly_dropped > 0 ? `<p style="margin:0 0 2px;color:#d93a15;">${idx.newly_dropped} dropped from the index today${droppedList ? `:</p><ul style="margin:0 0 4px;padding-left:18px;">${droppedList}</ul>` : '</p>'}` : ''}
      ${idx.newly_indexed > 0 ? `<p style="margin:0 0 4px;color:#1c7c43;">${idx.newly_indexed} newly indexed today</p>` : ''}
      ${probeLine}
      <p style="margin:0 0 4px;">IndexNow: ${seo.indexnowPushed24h} URLs pushed in the last 24h${seo.indexnowPushed24h === 0 ? ' <span style="color:#b57d0a;">(no push recorded)</span>' : ''}</p>
      ${snapLine}
      ${covLine}
      ${ticketList ? `<p style="margin:6px 0 2px;">Tickets filed overnight:</p><ul style="margin:0;padding-left:18px;">${ticketList}</ul>` : '<p style="margin:0;color:#6f645c;">No SEO tickets filed overnight.</p>'}`
  }

  const trackerBlocks = trackers
    .map(t => {
      const asks = latestOwnerAsks(t)
      const latest = t.statusLog[0]
      return `<p style="margin:8px 0 2px;"><strong style="color:${ragColor(t.overall)};">${esc(t.overall)}</strong> &middot; ${esc(t.title)}</p>
        ${latest ? `<p style="margin:0 0 2px;color:#6f645c;">Latest: ${esc(latest.heading)}</p>` : ''}
        ${asks ? `<p style="margin:0;"><em>Asks for the owner:</em> ${esc(asks)}</p>` : ''}`
    })
    .join('')

  const section = (title: string, body: string) =>
    `<h3 style="font-family:Inter,sans-serif;font-size:14px;margin:18px 0 6px;">${title}</h3>
     <div style="font-family:Inter,sans-serif;font-size:12px;color:#2b2b2b;">${body}</div>`

  const html = `<body style="margin:0;padding:16px;background:#faf7f2;">
    <div style="max-width:640px;">
      <h2 style="font-family:Inter,sans-serif;font-size:16px;margin:0 0 4px;">xdipx daily digest &middot; ${day}</h2>
      ${section('Orders and profit (last 8 days)', `<table style="border-collapse:collapse;">${profitRows || '<tr><td>no rows</td></tr>'}</table>`)}
      ${section(`Team runs, last 24h (${failures.length} failed)`, `<table style="border-collapse:collapse;">${runRows || '<tr><td>no runs</td></tr>'}</table>`)}
      ${section('Team gates', `<table style="border-collapse:collapse;">${gateRows}</table>`)}
      ${section('Valves', `<table style="border-collapse:collapse;">${valveRows}</table>`)}
      ${section(`SEO and indexing${seoDay ? ` (diagnosis ${esc(seoDay)})` : ''}`, indexBody)}
      ${section(`Suggestions (${proposed?.n ?? 0} awaiting triage${proposed ? `, oldest ${esc(proposed.oldest.slice(0, 10))}` : ''})`, sugg.map(s => `${esc(s.status)}: ${s.n}`).join(' &middot; ') || 'none')}
      ${section('Program trackers', trackerBlocks || 'no trackers found')}
      <p style="font-family:Inter,sans-serif;font-size:11px;color:#6f645c;margin-top:18px;">
        Full detail: xdipx.com/admin/trackers and /admin/homepage-team. Sent by /cron/owner-digest.
      </p>
    </div>
  </body>`

  const res = await sendOwnerEmail(subject, html, { fromName: 'xdipx daily digest' })
  return res.sent ? { sent: true, subject } : { sent: false, ...(res.error !== undefined ? { error: res.error } : {}) }
}
