/**
 * Daily owner digest (p0-6): one email a day that tells the owner what the
 * store and its agent teams actually did, without opening a dashboard.
 *
 * Five load-bearing sections (OS-2.6) sit alongside the original operational
 * ones: **Escalations** (what needs the owner, first, and explicitly empty when
 * nothing does), **Shipped** (what merged in 24h), **Homepage now** (what is
 * actually live plus the render-truth verdict), **SEO** (the seo_coverage_daily
 * diagnosis), and **Tickets** (bus throughput, the oldest approved row, and
 * anything burning its last attempt). The rest, orders/profit, team runs,
 * gates, valves, and program trackers, are unchanged.
 *
 * Sent via /cron/owner-digest (13:00 UTC). A KV once-per-day guard prevents
 * double sends from cron double-invocation; pass force=true to re-send while
 * testing. The guard is keyed on the UTC date, so a manual unforced run
 * CONSUMES the day's slot and suppresses the real 13:00 send. Test the section
 * builders below (all pure) instead of triggering the cron.
 */

import { sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { gate, getValve, TEAM_IDS } from '~/lib/team.server'
import { VALVE_KEYS } from '~/lib/team-keys'
import { getTrackers, latestOwnerAsks } from '~/lib/tracker.server'
import { sendOwnerEmail } from '~/lib/owner-alerts.server'
import { kvGet, kvSetNX } from '~/lib/kv.server'
import type { SeoDailyResult } from '~/lib/seo-daily.server'
import type { EditorialTilesBlock, EmmaCuratedRailBlock } from '~/types/cms'

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

const GOOD = '#1c7c43'
const WARN = '#b57d0a'
const BAD = '#d93a15'
const MUTED = '#6f645c'

/** Attempts spent before a ticket is escalated to the owner (release engine). */
export const MAX_TICKET_ATTEMPTS = 3

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`
}

/** `https://github.com/o/r/pull/42` -> `PR #42`. Falls back to the raw ref. */
function prLabel(ref: string): string {
  const m = /\/pull\/(\d+)/.exec(ref)
  return m ? `PR #${m[1]}` : clip(ref, 60)
}

function link(ref: string, label: string): string {
  return /^https?:\/\//.test(ref)
    ? `<a href="${esc(ref)}" style="color:#c2410c;">${esc(label)}</a>`
    : esc(label)
}

/* ── Section 1: Shipped ────────────────────────────────────────────────────── */

export interface ShippedItem {
  /** The ticket the PR closes, 0 when the merge could not be traced to one. */
  ticketId: number
  kind: string
  /**
   * What shipped. `suggestion_links` stores refs, not PR titles, and reading
   * titles would mean a GitHub round-trip from a cron that must never block on
   * one, so the ticket text is the title. It is the text the PR was written
   * from, which is what the owner is actually recognising.
   */
  title: string
  ref: string
  at: string | null
}

export function renderShippedSection(items: readonly ShippedItem[]): string {
  if (items.length === 0) {
    return `<p style="margin:0;color:${MUTED};">Nothing merged in the last 24 hours.</p>`
  }
  const rows = items
    .map(i => `<li style="margin-bottom:3px;">${i.ticketId > 0 ? `<strong>#${i.ticketId}</strong> ` : ''}<span style="color:${MUTED};">${esc(i.kind)}</span> ${esc(clip(i.title, 120))}${i.ref ? ` &middot; ${link(i.ref, prLabel(i.ref))}` : ''}</li>`)
    .join('')
  return `<ul style="margin:0;padding-left:18px;">${rows}</ul>`
}

/* ── Section 2: Homepage now ───────────────────────────────────────────────── */

export type GateVerdict = 'pass' | 'fail' | 'unknown'

export interface RenderTruthFacts {
  checkedAt: string | null
  /** Did the live HTML carry the published slate? */
  ok: boolean | null
  themeGate: GateVerdict
  freshnessGate: GateVerdict
  problems: string[]
}

export interface HomepageNowFacts {
  /** null when the precomputed storefront blob is cold (nothing to report). */
  live: {
    heroHandle: string | null
    heroHeadline: string | null
    railTitles: string[]
    tileHeadlines: string[]
    builtAt: number | null
  } | null
  renderTruth: RenderTruthFacts | null
  /** Live `render:*` tickets: render-truth's own durable failure record. */
  renderTickets: Array<{ id: number; status: string; suggestion: string }>
}

function verdictHtml(label: string, v: GateVerdict): string {
  const color = v === 'pass' ? GOOD : v === 'fail' ? BAD : WARN
  const word = v === 'unknown' ? 'not reported' : v
  return `<span style="color:${color};">${esc(label)}: ${word}</span>`
}

export function renderHomepageNowSection(f: HomepageNowFacts): string {
  const parts: string[] = []

  if (!f.live) {
    parts.push(`<p style="margin:0 0 4px;color:${WARN};">The precomputed storefront blob is cold, so this digest cannot say what is on the homepage right now. Check /admin/homepage-team.</p>`)
  } else {
    const built = f.live.builtAt ? new Date(f.live.builtAt).toISOString().replace('T', ' ').slice(0, 16) : null
    parts.push(`<p style="margin:0 0 4px;">Hero: ${f.live.heroHandle ? `<strong>${esc(f.live.heroHandle)}</strong>` : `<span style="color:${MUTED};">rotating (no pinned headliner)</span>`}${f.live.heroHeadline ? ` &middot; &ldquo;${esc(clip(f.live.heroHeadline, 90))}&rdquo;` : ''}</p>`)
    parts.push(f.live.railTitles.length
      ? `<p style="margin:0 0 4px;">Rails: ${f.live.railTitles.map(t => esc(clip(t, 60))).join(' &middot; ')}</p>`
      : `<p style="margin:0 0 4px;color:${WARN};">No curated rail is published (the storefront is showing shell defaults).</p>`)
    parts.push(f.live.tileHeadlines.length
      ? `<p style="margin:0 0 4px;">Tiles: ${f.live.tileHeadlines.map(t => esc(clip(t, 60))).join(' &middot; ')}</p>`
      : `<p style="margin:0 0 4px;color:${MUTED};">No editorial tiles published.</p>`)
    if (built) parts.push(`<p style="margin:0 0 4px;color:${MUTED};">Blob built ${esc(built)} UTC.</p>`)
  }

  // Never imply a pass we did not observe. An absent render-truth result is
  // reported as absent, because "silence" was exactly how run 85's breakage
  // stayed invisible for three days.
  if (!f.renderTruth) {
    parts.push(`<p style="margin:0 0 4px;color:${WARN};">No render-truth result available, so it is unverified whether the published slate actually rendered, and the theme and freshness gates are unreported. This is not a pass.</p>`)
  } else {
    const rt = f.renderTruth
    const head = rt.ok === true ? `<span style="color:${GOOD};">Render-truth passed</span>`
      : rt.ok === false ? `<span style="color:${BAD};">Render-truth FAILED</span>`
      : `<span style="color:${WARN};">Render-truth inconclusive</span>`
    parts.push(`<p style="margin:0 0 4px;">${head}${rt.checkedAt ? ` <span style="color:${MUTED};">(checked ${esc(clip(rt.checkedAt, 20))})</span>` : ''} &middot; ${verdictHtml('theme gate', rt.themeGate)} &middot; ${verdictHtml('freshness gate', rt.freshnessGate)}</p>`)
    if (rt.problems.length) {
      parts.push(`<ul style="margin:0 0 4px;padding-left:18px;color:${BAD};">${rt.problems.slice(0, 5).map(p => `<li>${esc(clip(p, 160))}</li>`).join('')}</ul>`)
    }
  }

  if (f.renderTickets.length) {
    parts.push(`<p style="margin:0 0 2px;color:${BAD};">${f.renderTickets.length} open render ticket${f.renderTickets.length === 1 ? '' : 's'}:</p><ul style="margin:0;padding-left:18px;">${f.renderTickets.slice(0, 5).map(t => `<li>#${t.id} (${esc(t.status)}) ${esc(clip(t.suggestion, 120))}</li>`).join('')}</ul>`)
  }

  return parts.join('')
}

/* ── Section 4: Tickets ────────────────────────────────────────────────────── */

export interface TicketAttemptRow {
  id: number
  status: string
  kind: string
  attemptCount: number
  lastError: string | null
  suggestion: string
}

export interface TicketMetrics {
  /** kind -> count, for tickets created in the last 24h. */
  opened: Record<string, number>
  /** kind -> count, for tickets that reached applied/dismissed in the last 24h. */
  closed: Record<string, number>
  /** kind -> count, currently blocked (a standing figure, not a 24h one). */
  blocked: Record<string, number>
  oldestApproved: { id: number; ageDays: number; suggestion: string } | null
  /** Tickets on their final attempt: one more failure escalates. */
  finalAttempt: TicketAttemptRow[]
  /** Legacy status counts line, preserved verbatim from the original digest. */
  statusCounts: string
}

function byKind(m: Record<string, number>): string {
  const entries = Object.entries(m).filter(([, n]) => n > 0)
  if (entries.length === 0) return 'none'
  return entries.map(([k, n]) => `${esc(k)} ${n}`).join(' &middot; ')
}

function total(m: Record<string, number>): number {
  return Object.values(m).reduce((a, b) => a + b, 0)
}

export function renderTicketsSection(m: TicketMetrics): string {
  const parts: string[] = [
    `<p style="margin:0 0 4px;">Opened ${total(m.opened)} (${byKind(m.opened)})</p>`,
    `<p style="margin:0 0 4px;">Closed ${total(m.closed)} (${byKind(m.closed)})</p>`,
    `<p style="margin:0 0 4px;color:${total(m.blocked) > 0 ? WARN : MUTED};">Blocked ${total(m.blocked)} (${byKind(m.blocked)})</p>`,
  ]
  parts.push(m.oldestApproved
    ? `<p style="margin:0 0 4px;">Oldest approved and unclaimed: <strong>#${m.oldestApproved.id}</strong>, ${m.oldestApproved.ageDays} day${m.oldestApproved.ageDays === 1 ? '' : 's'} old &middot; ${esc(clip(m.oldestApproved.suggestion, 140))}</p>`
    : `<p style="margin:0 0 4px;color:${MUTED};">Nothing sitting in approved.</p>`)
  if (m.finalAttempt.length) {
    parts.push(`<p style="margin:6px 0 2px;color:${WARN};">On the last attempt (${MAX_TICKET_ATTEMPTS} of ${MAX_TICKET_ATTEMPTS}), one more failure escalates:</p><ul style="margin:0 0 4px;padding-left:18px;">${m.finalAttempt.map(t => `<li>#${t.id} (${esc(t.status)}) ${esc(clip(t.suggestion, 110))}${t.lastError ? `<br><span style="color:${MUTED};">${esc(clip(t.lastError, 140))}</span>` : ''}</li>`).join('')}</ul>`)
  }
  parts.push(`<p style="margin:6px 0 0;color:${MUTED};">All statuses: ${m.statusCounts || 'none'}</p>`)
  return parts.join('')
}

/* ── Section 5: Escalations ────────────────────────────────────────────────── */

export interface EscalationFacts {
  /** PRs the release engine refused to auto-merge: they touch protected paths. */
  protectedPrs: Array<{ ticketId: number; ref: string; state: string | null; title: string }>
  /** Tickets that burned every attempt and stopped. */
  exhausted: TicketAttemptRow[]
}

export function renderEscalationsSection(e: EscalationFacts): string {
  if (e.protectedPrs.length === 0 && e.exhausted.length === 0) {
    // The most valuable sentence in the email. Say it plainly.
    return `<p style="margin:0;color:${GOOD};">Nothing needs you today. No protected-path PR is waiting on your merge and no ticket has run out of attempts.</p>`
  }
  const parts: string[] = []
  if (e.protectedPrs.length) {
    parts.push(`<p style="margin:0 0 2px;color:${BAD};"><strong>${e.protectedPrs.length} PR${e.protectedPrs.length === 1 ? '' : 's'} waiting on you</strong> (protected path, the engine will never merge ${e.protectedPrs.length === 1 ? 'it' : 'them'}):</p><ul style="margin:0 0 6px;padding-left:18px;">${e.protectedPrs.map(p => `<li>${link(p.ref, prLabel(p.ref))}${p.ticketId > 0 ? ` &middot; ticket #${p.ticketId}` : ''} ${esc(clip(p.title, 110))}</li>`).join('')}</ul>`)
  }
  if (e.exhausted.length) {
    parts.push(`<p style="margin:0 0 2px;color:${BAD};"><strong>${e.exhausted.length} ticket${e.exhausted.length === 1 ? '' : 's'} out of attempts</strong> (blocked until you decide):</p><ul style="margin:0;padding-left:18px;">${e.exhausted.map(t => `<li>#${t.id} (${esc(t.status)}, ${t.attemptCount} attempts) ${esc(clip(t.suggestion, 110))}${t.lastError ? `<br><span style="color:${MUTED};">${esc(clip(t.lastError, 160))}</span>` : ''}</li>`).join('')}</ul>`)
  }
  return parts.join('')
}

/* ── Gathering ─────────────────────────────────────────────────────────────── */

/**
 * Tolerant reader for whatever the render-truth check last recorded. It is a
 * separate workstream (OS-4.1) writing a snapshot this digest only reads, so
 * this parses defensively and returns null rather than inventing a verdict.
 * Pure, so the shape contract is testable without KV.
 */
export function parseRenderTruth(raw: unknown): RenderTruthFacts | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const gates = (r['gates'] && typeof r['gates'] === 'object' ? r['gates'] : {}) as Record<string, unknown>
  const verdict = (v: unknown): GateVerdict =>
    v === true || v === 'pass' || v === 'passed' ? 'pass'
    : v === false || v === 'fail' || v === 'failed' ? 'fail'
    : 'unknown'
  const at = r['checkedAt'] ?? r['ts'] ?? r['at'] ?? r['ranAt']
  const problems = Array.isArray(r['problems']) ? r['problems']
    : Array.isArray(r['missing']) ? r['missing']
    : []
  const ok = typeof r['ok'] === 'boolean' ? r['ok'] : null
  const facts: RenderTruthFacts = {
    checkedAt: typeof at === 'string' ? at : typeof at === 'number' ? new Date(at).toISOString() : null,
    ok,
    themeGate: verdict(gates['theme'] ?? r['themeGate'] ?? r['themeOk']),
    freshnessGate: verdict(gates['freshness'] ?? r['freshnessGate'] ?? r['freshnessOk']),
    problems: problems.filter((p): p is string => typeof p === 'string'),
  }
  // A blob with nothing recognisable in it is not a result.
  if (facts.ok === null && facts.themeGate === 'unknown' && facts.freshnessGate === 'unknown'
      && facts.problems.length === 0 && facts.checkedAt === null) return null
  return facts
}

/**
 * Keys the render-truth snapshot may live under. The healthcheck's own
 * convention is `homepage:healthcheck:lastgood`, so its sibling is probed
 * first; the others are cheap misses that keep the digest connected if the key
 * lands elsewhere.
 */
const RENDER_TRUTH_KEYS = [
  'homepage:render-truth:latest',
  'homepage:healthcheck:render-truth',
  'render-truth:latest',
]

async function gatherShipped(): Promise<ShippedItem[]> {
  const items: ShippedItem[] = []
  try {
    const res = await db.execute(sql`
      SELECT l.suggestion_id AS ticket_id, l.ref, l.updated_at::text AS at,
             COALESCE(s.kind, 'code') AS kind, COALESCE(s.suggestion, '') AS suggestion
      FROM suggestion_links l
      LEFT JOIN homepage_team_suggestions s ON s.id = l.suggestion_id
      WHERE l.kind IN ('pr', 'commit')
        AND l.state IN ('merged', 'applied')
        AND l.updated_at >= now() - interval '24 hours'
      ORDER BY l.updated_at DESC LIMIT 25`)
    for (const r of (res.rows ?? []) as unknown as Array<Record<string, unknown>>) {
      items.push({
        ticketId: Number(r['ticket_id'] ?? 0),
        kind: String(r['kind'] ?? ''),
        title: String(r['suggestion'] ?? ''),
        ref: String(r['ref'] ?? ''),
        at: r['at'] == null ? null : String(r['at']),
      })
    }
  } catch (err) {
    console.warn('[owner-digest] suggestion_links unavailable (migration 070?):', String(err).slice(0, 200))
  }
  // agent-editor's legacy docs path lands in `applied` with apply_ref and no
  // link row, so it would otherwise never appear as shipped.
  try {
    const res = await db.execute(sql`
      SELECT id, kind, suggestion, apply_ref, updated_at::text AS at
      FROM homepage_team_suggestions
      WHERE status = 'applied' AND updated_at >= now() - interval '24 hours'
      ORDER BY updated_at DESC LIMIT 25`)
    for (const r of (res.rows ?? []) as unknown as Array<Record<string, unknown>>) {
      const id = Number(r['id'] ?? 0)
      if (items.some(i => i.ticketId === id)) continue
      items.push({
        ticketId: id,
        kind: String(r['kind'] ?? ''),
        title: String(r['suggestion'] ?? ''),
        ref: r['apply_ref'] == null ? '' : String(r['apply_ref']),
        at: r['at'] == null ? null : String(r['at']),
      })
    }
  } catch (err) {
    console.warn('[owner-digest] applied-ticket sweep failed:', String(err).slice(0, 200))
  }
  return items
}

async function gatherHomepageNow(): Promise<HomepageNowFacts> {
  let live: HomepageNowFacts['live'] = null
  try {
    const { readHomepagePayloadB } = await import('~/lib/homepage-payload.server')
    const payload = await readHomepagePayloadB()
    if (payload) {
      const sections = payload.contentBlocks?.sections ?? []
      const rails = sections.filter((s): s is EmmaCuratedRailBlock => s._type === 'emmaCuratedRail')
      const tiles = sections.filter((s): s is EditorialTilesBlock => s._type === 'editorialTiles')
      live = {
        heroHandle: payload.emmaHero?.featuredProductHandle ?? payload.pinnedProduct?.handle ?? null,
        heroHeadline: payload.emmaHero?.headline ?? null,
        railTitles: rails.map(r => r.heading).filter(Boolean),
        tileHeadlines: tiles.flatMap(t => [t.heading, ...(t.tiles ?? []).map(x => x.label)]).filter(Boolean),
        builtAt: payload.builtAt ?? null,
      }
    }
  } catch (err) {
    console.warn('[owner-digest] storefront payload unavailable:', String(err).slice(0, 200))
  }

  let renderTruth: RenderTruthFacts | null = null
  for (const key of RENDER_TRUTH_KEYS) {
    try {
      const parsed = parseRenderTruth(await kvGet<unknown>(key))
      if (parsed) { renderTruth = parsed; break }
    } catch { /* a cold or unreachable KV is a "not reported", not a failure */ }
  }

  let renderTickets: HomepageNowFacts['renderTickets'] = []
  try {
    const res = await db.execute(sql`
      SELECT id, status, suggestion
      FROM homepage_team_suggestions
      WHERE dedupe_key LIKE 'render:%' AND status NOT IN ('applied', 'dismissed')
      ORDER BY priority ASC, created_at DESC LIMIT 5`)
    renderTickets = (res.rows ?? []).map(r => ({
      id: Number((r as Record<string, unknown>)['id'] ?? 0),
      status: String((r as Record<string, unknown>)['status'] ?? ''),
      suggestion: String((r as Record<string, unknown>)['suggestion'] ?? ''),
    }))
  } catch (err) {
    console.warn('[owner-digest] render-ticket sweep failed:', String(err).slice(0, 200))
  }

  return { live, renderTruth, renderTickets }
}

function toKindMap(rows: Array<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[String(r['kind'] ?? 'other')] = Number(r['n'] ?? 0)
  return out
}

function toAttemptRows(rows: Array<Record<string, unknown>>): TicketAttemptRow[] {
  return rows.map(r => ({
    id: Number(r['id'] ?? 0),
    status: String(r['status'] ?? ''),
    kind: String(r['kind'] ?? ''),
    attemptCount: Number(r['attempt_count'] ?? 0),
    lastError: r['last_error'] == null ? null : String(r['last_error']),
    suggestion: String(r['suggestion'] ?? ''),
  }))
}

async function gatherTicketMetrics(statusCounts: string): Promise<TicketMetrics> {
  const empty: TicketMetrics = {
    opened: {}, closed: {}, blocked: {}, oldestApproved: null, finalAttempt: [], statusCounts,
  }
  try {
    const [openedRes, closedRes, blockedRes, oldestRes, finalRes] = await Promise.all([
      db.execute(sql`SELECT kind, COUNT(*)::int AS n FROM homepage_team_suggestions
                      WHERE created_at >= now() - interval '24 hours' GROUP BY kind`),
      db.execute(sql`SELECT kind, COUNT(*)::int AS n FROM homepage_team_suggestions
                      WHERE status IN ('applied', 'dismissed')
                        AND updated_at >= now() - interval '24 hours' GROUP BY kind`),
      db.execute(sql`SELECT kind, COUNT(*)::int AS n FROM homepage_team_suggestions
                      WHERE status = 'blocked' GROUP BY kind`),
      db.execute(sql`SELECT id, suggestion,
                            EXTRACT(epoch FROM now() - created_at)::float8 / 86400 AS age_days
                       FROM homepage_team_suggestions
                      WHERE status = 'approved' ORDER BY created_at ASC LIMIT 1`),
      db.execute(sql`SELECT id, status, kind, attempt_count, last_error, suggestion
                       FROM homepage_team_suggestions
                      WHERE attempt_count = ${MAX_TICKET_ATTEMPTS - 1}
                        AND status NOT IN ('applied', 'dismissed')
                      ORDER BY priority ASC, updated_at DESC LIMIT 10`),
    ])
    const oldest = (oldestRes.rows ?? [])[0] as Record<string, unknown> | undefined
    return {
      opened:  toKindMap((openedRes.rows ?? []) as Array<Record<string, unknown>>),
      closed:  toKindMap((closedRes.rows ?? []) as Array<Record<string, unknown>>),
      blocked: toKindMap((blockedRes.rows ?? []) as Array<Record<string, unknown>>),
      oldestApproved: oldest
        ? {
            id: Number(oldest['id'] ?? 0),
            ageDays: Math.round(Number(oldest['age_days'] ?? 0)),
            suggestion: String(oldest['suggestion'] ?? ''),
          }
        : null,
      finalAttempt: toAttemptRows((finalRes.rows ?? []) as Array<Record<string, unknown>>),
      statusCounts,
    }
  } catch (err) {
    console.warn('[owner-digest] ticket metrics unavailable (migration 070?):', String(err).slice(0, 200))
    return empty
  }
}

async function gatherEscalations(): Promise<EscalationFacts> {
  const out: EscalationFacts = { protectedPrs: [], exhausted: [] }
  try {
    // The release engine marks a PR it refuses to touch with a `needs-owner`
    // link state; anything still in that state is still waiting on the owner.
    const res = await db.execute(sql`
      SELECT l.suggestion_id AS ticket_id, l.ref, l.state,
             COALESCE(s.suggestion, '') AS suggestion
      FROM suggestion_links l
      LEFT JOIN homepage_team_suggestions s ON s.id = l.suggestion_id
      WHERE l.state IN ('needs-owner', 'protected')
        AND l.updated_at >= now() - interval '14 days'
      ORDER BY l.updated_at DESC LIMIT 10`)
    out.protectedPrs = (res.rows ?? []).map(r => {
      const row = r as Record<string, unknown>
      return {
        ticketId: Number(row['ticket_id'] ?? 0),
        ref: String(row['ref'] ?? ''),
        state: row['state'] == null ? null : String(row['state']),
        title: String(row['suggestion'] ?? ''),
      }
    })
  } catch (err) {
    console.warn('[owner-digest] protected-PR sweep failed:', String(err).slice(0, 200))
  }
  try {
    const res = await db.execute(sql`
      SELECT id, status, kind, attempt_count, last_error, suggestion
        FROM homepage_team_suggestions
       WHERE attempt_count >= ${MAX_TICKET_ATTEMPTS}
         AND status NOT IN ('applied', 'dismissed')
       ORDER BY priority ASC, updated_at DESC LIMIT 10`)
    out.exhausted = toAttemptRows((res.rows ?? []) as Array<Record<string, unknown>>)
  } catch (err) {
    console.warn('[owner-digest] exhausted-ticket sweep failed:', String(err).slice(0, 200))
  }
  return out
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

  // The five OS-2.6 sections. Each gatherer swallows its own failures and
  // degrades to "not reported", because a digest that does not send is worse
  // than a digest with one thin section.
  const statusCountsLine = sugg.map(s => `${esc(s.status)}: ${s.n}`).join(' &middot; ')
  const [shipped, homepageNow, ticketMetrics, escalations] = await Promise.all([
    gatherShipped(),
    gatherHomepageNow(),
    gatherTicketMetrics(statusCountsLine),
    gatherEscalations(),
  ])
  const needsOwner = escalations.protectedPrs.length + escalations.exhausted.length

  // ── Compose ───────────────────────────────────────────────────────────────
  const ordersY = yesterday?.orders ?? 0
  const subject = `xdipx daily digest: ${ordersY} orders yesterday, ${failures.length} run failure${failures.length === 1 ? '' : 's'}, ${redTrackers} RED tracker${redTrackers === 1 ? '' : 's'}${needsOwner > 0 ? `, ${needsOwner} need${needsOwner === 1 ? 's' : ''} you` : ''}`

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
      ${section(`Escalations${needsOwner > 0 ? ` (${needsOwner})` : ''}`, renderEscalationsSection(escalations))}
      ${section(`Shipped, last 24h (${shipped.length})`, renderShippedSection(shipped))}
      ${section('Homepage now', renderHomepageNowSection(homepageNow))}
      ${section('Orders and profit (last 8 days)', `<table style="border-collapse:collapse;">${profitRows || '<tr><td>no rows</td></tr>'}</table>`)}
      ${section(`Team runs, last 24h (${failures.length} failed)`, `<table style="border-collapse:collapse;">${runRows || '<tr><td>no runs</td></tr>'}</table>`)}
      ${section('Team gates', `<table style="border-collapse:collapse;">${gateRows}</table>`)}
      ${section('Valves', `<table style="border-collapse:collapse;">${valveRows}</table>`)}
      ${section(`SEO and indexing${seoDay ? ` (diagnosis ${esc(seoDay)})` : ''}`, indexBody)}
      ${section(`Tickets (${proposed?.n ?? 0} awaiting triage${proposed ? `, oldest ${esc(proposed.oldest.slice(0, 10))}` : ''})`, renderTicketsSection(ticketMetrics))}
      ${section('Program trackers', trackerBlocks || 'no trackers found')}
      <p style="font-family:Inter,sans-serif;font-size:11px;color:#6f645c;margin-top:18px;">
        Full detail: xdipx.com/admin/trackers and /admin/homepage-team. Sent by /cron/owner-digest.
      </p>
    </div>
  </body>`

  const res = await sendOwnerEmail(subject, html, { fromName: 'xdipx daily digest' })
  return res.sent ? { sent: true, subject } : { sent: false, ...(res.error !== undefined ? { error: res.error } : {}) }
}
