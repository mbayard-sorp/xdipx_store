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
import { gate, getValve, TEAM_IDS, RUN_CLOSE_KINDS } from '~/lib/team.server'
import { VALVE_KEYS, VIDEO_EXTRA_KEYS } from '~/lib/team-keys'
import { getTrackers, latestOwnerAsks } from '~/lib/tracker.server'
import { sendOwnerEmail } from '~/lib/owner-alerts.server'
import { getProfitReconciliation } from '~/lib/profit.server'
import {
  computeTicketLoopHealth,
  describeSupersededEvidence,
  reconcileOrphanedTickets,
  reconcilePrLinkStates,
  type BlockedTicket,
  type ConflictedPr,
  type OrphanTicket,
  type RoutineLivenessFlag,
  type TicketLoopHealth,
} from '~/lib/ticket-janitor.server'
import { kvDel, kvGet, kvSetNX } from '~/lib/kv.server'
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
  /**
   * The blocked tickets themselves, not just the count by kind. A count tells
   * the owner a number; only the rows tell him whether the block is his to
   * clear (a protected path) or the agent's to retry. Sourced from the
   * ticket-janitor's note-aware `sla.blocked`, so the reason survives even when
   * it lives only in a `suggestion_links` note (the common case for R-DEV
   * blocks, which carry a note and no `last_error`).
   */
  blockedRows: BlockedTicket[]
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

/**
 * The reason a blocked row is blocked, wherever it lives. R-DEV blocks with a
 * note and no `last_error`, so `last_error` alone renders a bare id for most
 * blocked rows; fall back to the note text the janitor already resolved.
 */
function blockedReason(b: BlockedTicket): string | null {
  const r = b.lastError ?? b.noteRef
  return r && r.trim() !== '' ? r : null
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
  if (m.blockedRows.length) {
    parts.push(`<p style="margin:6px 0 2px;color:${WARN};">Blocked, with the reason:</p><ul style="margin:0 0 4px;padding-left:18px;">${m.blockedRows.slice(0, 8).map(t => {
      const reason = blockedReason(t)
      return `<li>#${t.id} (${esc(t.kind)}) ${esc(clip(t.suggestion, 110))}${reason ? `<br><span style="color:${MUTED};">${esc(clip(reason, 160))}</span>` : ` <span style="color:${BAD};">no reason</span>`}</li>`
    }).join('')}</ul>`)
  }
  parts.push(`<p style="margin:6px 0 0;color:${MUTED};">All statuses: ${m.statusCounts || 'none'}</p>`)
  return parts.join('')
}

/* ── Section 6: The owner's decision queue ─────────────────────────────────── */

export interface OwnerQueueRow {
  id: number
  kind: string
  team: string
  targetTeam: string | null
  ageDays: number
  suggestion: string
  autoApproved: boolean
}

export interface OwnerQueueFacts {
  rows: OwnerQueueRow[]
  /** Total matching rows, which may exceed what is shown. */
  totalCount: number
  /**
   * Count of process/strategy owner asks past the 21-day escalation age
   * (`countStaleUndecidedOwnerAsks`). These are escalated, never dismissed
   * (#4356). `null` means the count was not computed on this run (a forced test
   * send); null and zero mean different things and the email says which.
   */
  staleUndecided: number | null
}

/**
 * Everything sitting `approved` in a kind that ONLY the owner can execute.
 *
 * Derived, not hand-listed, so it tracks the transition map instead of drifting
 * from it. The candidate set is the non-`code`, non-`instructions` kinds (those
 * two have agent lanes: R-DEV and agent-editor). Of the candidates, any kind an
 * entry-agent daily run can close to `applied` once it has executed the ask
 * (`RUN_CLOSE_KINDS` in team.server.ts) is NOT owner-only — a routine drains it
 * — so it is excluded here. Since PR #789 (merged 2026-08-20) added
 * `campaign`/`promo` to `RUN_CLOSE_KINDS` alongside `process`/`strategy`,
 * `program` is currently the only candidate with no agent close edge.
 *
 * Listing agent-closeable rows here misrepresented them as owner work and
 * inflated the queue (#4356): a campaign row already drafted-and-gated by the
 * social run belongs in the ticket-loop/stale surfaces, not on "needs a decision
 * from you". A process/strategy row that a routine has NOT drained is surfaced
 * instead by the stale-ask escalation below, never silently dismissed.
 */
const OWNER_DECISION_CANDIDATE_KINDS: readonly string[] = [
  'process', 'strategy', 'program', 'campaign', 'promo',
]
export const OWNER_DECISION_KINDS: readonly string[] =
  OWNER_DECISION_CANDIDATE_KINDS.filter(k => !RUN_CLOSE_KINDS.includes(k))

/**
 * The kinds `gatherStaleOwnerRows` puts on the Needs Mike list once a row has
 * sat `approved` past three days. Derived the same way as `OWNER_DECISION_KINDS`
 * (#4356) so it tracks the transition map instead of drifting from it: the
 * candidate set is the owner-desk task kinds this surface has always covered
 * (`promo`/`campaign`/`program`), minus any that gained an agent close edge in
 * `RUN_CLOSE_KINDS`. Since PR #789 (merged 2026-08-20) added `campaign`/`promo`
 * there, `program` is currently the only one left. Listing an agent-closeable
 * kind here misrepresented it as owner work and inflated the queue (#4453, the
 * same over-listing #4356 fixed for the decision queue, on a different surface).
 */
const STALE_OWNER_ROW_CANDIDATE_KINDS: readonly string[] = [
  'promo', 'campaign', 'program',
]
export const STALE_OWNER_ROW_KINDS: readonly string[] =
  STALE_OWNER_ROW_CANDIDATE_KINDS.filter(k => !RUN_CLOSE_KINDS.includes(k))

/** Rows older than this are called out: nothing here should age quietly. */
const STALE_QUEUE_DAYS = 7

export function renderOwnerQueueSection(f: OwnerQueueFacts): string {
  const parts: string[] = []
  if (f.staleUndecided !== null && f.staleUndecided > 0) {
    parts.push(`<p style="margin:0 0 6px;color:${WARN};">${f.staleUndecided} process/strategy ask${f.staleUndecided === 1 ? '' : 's'} ${f.staleUndecided === 1 ? 'has' : 'have'} sat approved past 21 days with no routine draining ${f.staleUndecided === 1 ? 'it' : 'them'}. Nothing was auto-dismissed. Decide or dismiss at /admin/homepage-team.</p>`)
  }
  if (f.rows.length === 0) {
    parts.push(`<p style="margin:0;color:${GOOD};">Nothing waiting on a decision from you.</p>`)
    return parts.join('')
  }

  const stale = f.rows.filter(r => r.ageDays >= STALE_QUEUE_DAYS).length
  parts.push(`<p style="margin:0 0 6px;">${f.totalCount} row${f.totalCount === 1 ? '' : 's'} need a decision${stale > 0 ? ` &middot; <span style="color:${WARN};">${stale} older than ${STALE_QUEUE_DAYS} days</span>` : ''}.</p>`)
  parts.push(`<table style="border-collapse:collapse;">${f.rows.map(r => {
    const ageColor = r.ageDays >= STALE_QUEUE_DAYS ? WARN : MUTED
    const target = r.targetTeam && r.targetTeam !== r.team ? `${esc(r.team)}&rarr;${esc(r.targetTeam)}` : esc(r.team)
    return `<tr>
      <td style="padding:2px 8px 2px 0;">#${r.id}</td>
      <td style="padding:2px 8px;">${esc(r.kind)}</td>
      <td style="padding:2px 8px;color:${MUTED};">${target}</td>
      <td style="padding:2px 8px;color:${ageColor};">${r.ageDays}d</td>
      <td style="padding:2px 0;">${esc(clip(r.suggestion, 120))}${r.autoApproved ? ` <span style="color:${MUTED};">(auto)</span>` : ''}</td>
    </tr>`
  }).join('')}</table>`)
  if (f.totalCount > f.rows.length) {
    parts.push(`<p style="margin:6px 0 0;color:${MUTED};">and ${f.totalCount - f.rows.length} more &middot; full list at /admin/homepage-team</p>`)
  }
  return parts.join('')
}

/* ── Section: Ad campaigns awaiting launch ─────────────────────────────────── */

export interface AdCampaignQueueRow {
  id: number
  platform: string
  name: string
  objective: string
  plannedDailyCents: number
  ageDays: number
}

/** Approved proposals older than this get the warning color. */
const STALE_AD_CAMPAIGN_DAYS = 7

/**
 * Approved ad_campaigns proposals with no external campaign id yet. Launching
 * is a human action in-platform (the ads agent is propose-only), so an approved
 * row with no externalCampaignId is a task only the owner can move, and until
 * this section existed nothing ever surfaced it: three proposals sat approved
 * for a month while the Google Ads launch quietly stalled (ticket #3423). A row
 * leaves this list the moment externalCampaignId is set.
 */
export function renderAdCampaignQueueSection(rows: readonly AdCampaignQueueRow[]): string {
  if (rows.length === 0) {
    return `<p style="margin:0;color:${GOOD};">No approved ad campaign proposal is waiting on a launch.</p>`
  }
  const studio = `<a href="https://xdipx.com/admin/ad-studio" style="color:#c2410c;">/admin/ad-studio</a>`
  const items = rows
    .map(r => {
      const ageColor = r.ageDays >= STALE_AD_CAMPAIGN_DAYS ? WARN : MUTED
      const budget = r.plannedDailyCents > 0 ? ` &middot; $${(r.plannedDailyCents / 100).toFixed(2)}/day planned` : ''
      return `<li style="margin-bottom:3px;">#${r.id} <strong>${esc(clip(r.name, 60))}</strong> (${esc(r.platform)}, ${esc(r.objective)})${budget} &middot; <span style="color:${ageColor};">approved ${r.ageDays}d ago</span></li>`
    })
    .join('')
  return `<p style="margin:0 0 4px;color:${WARN};"><strong>${rows.length} approved ad campaign${rows.length === 1 ? '' : 's'} not launched.</strong> Approving is not launching: only you can create ${rows.length === 1 ? 'it' : 'them'} in-platform. Review at ${studio}.</p><ul style="margin:0;padding-left:18px;">${items}</ul>`
}

async function gatherAdCampaignQueue(): Promise<AdCampaignQueueRow[]> {
  try {
    const res = await db.execute(sql`
      SELECT id, platform, name, objective, planned_daily_cents,
             EXTRACT(epoch FROM now() - created_at)::float8 / 86400 AS age_days
        FROM ad_campaigns
       WHERE status = 'approved'
         AND (external_campaign_id IS NULL OR external_campaign_id = '')
       ORDER BY created_at ASC LIMIT 10`)
    return (res.rows ?? []).map(r => {
      const row = r as Record<string, unknown>
      return {
        id: Number(row['id'] ?? 0),
        platform: String(row['platform'] ?? ''),
        name: String(row['name'] ?? ''),
        objective: String(row['objective'] ?? ''),
        plannedDailyCents: Number(row['planned_daily_cents'] ?? 0),
        ageDays: Math.round(Number(row['age_days'] ?? 0)),
      }
    })
  } catch (err) {
    console.warn('[owner-digest] ad-campaign queue unavailable:', String(err).slice(0, 200))
    return []
  }
}

/* ── Section 7: Ops watchdogs ──────────────────────────────────────────────── */

export interface OpsWatchFacts {
  /** Draft social posts awaiting review, and how old the oldest one is. */
  socialDrafts: { count: number; oldestDays: number | null }
  /** Whether yesterday got a scheduled pricing recompute at all. */
  pricingBatchRows: number
  /** Hours since the newest enrichment row, or null when unknown. */
  enrichmentAgeHours: number | null
  /** Tickets whose merged PR the engine has not reconciled. */
  strandedVerified: number
  /** Suggestions an agent retired in the last 7 days. */
  agentRetired: Array<{ id: number; kind: string; suggestion: string }>
  /**
   * api_token_log writes that failed even after their one retry, over the
   * trailing ~24-48h. Nonzero means spend tracking undercounts by that many
   * rows and nothing else would have said so.
   */
  tokenWriteFailures: number
}

/**
 * The quiet failures. Each line exists because the thing it watches broke once
 * and nothing said so: the social lane self-throttled to zero output for ten
 * consecutive runs while 18 drafts sat unreviewed, the 07:00 pricing recompute
 * produced nothing on two of three days, and enrichment stalled for nine days.
 */
export function renderOpsWatchSection(f: OpsWatchFacts): string {
  const parts: string[] = []

  if (f.socialDrafts.count > 0) {
    const old = f.socialDrafts.oldestDays ?? 0
    const color = old >= 3 ? WARN : MUTED
    parts.push(`<p style="margin:0 0 4px;color:${color};">${f.socialDrafts.count} social draft${f.socialDrafts.count === 1 ? '' : 's'} awaiting review${old > 0 ? `, oldest ${old} day${old === 1 ? '' : 's'}` : ''} &middot; /admin/socials${old >= 3 ? ' &mdash; the social team stops drafting while this backs up' : ''}</p>`)
  } else {
    parts.push(`<p style="margin:0 0 4px;color:${MUTED};">No social drafts waiting.</p>`)
  }

  parts.push(f.pricingBatchRows > 0
    ? `<p style="margin:0 0 4px;color:${GOOD};">Pricing recompute ran yesterday (${f.pricingBatchRows} audit rows).</p>`
    : `<p style="margin:0 0 4px;color:${BAD};"><strong>No scheduled pricing recompute yesterday.</strong> The 07:00 UTC batch wrote nothing; catch-up runs do not count.</p>`)

  if (f.enrichmentAgeHours !== null) {
    const stale = f.enrichmentAgeHours > 48
    parts.push(`<p style="margin:0 0 4px;color:${stale ? WARN : MUTED};">Newest enrichment ${Math.round(f.enrichmentAgeHours)}h ago${stale ? ' &mdash; the enrich stage may be stalled' : ''}</p>`)
  }

  if (f.strandedVerified > 0) {
    parts.push(`<p style="margin:0 0 4px;color:${WARN};">${f.strandedVerified} verified ticket${f.strandedVerified === 1 ? '' : 's'} not yet reconciled to applied.</p>`)
  }

  if (f.agentRetired.length > 0) {
    parts.push(`<p style="margin:6px 0 2px;color:${MUTED};">Retired by agent-editor in the last 7 days (undo by re-approving in /admin):</p><ul style="margin:0;padding-left:18px;color:${MUTED};">${f.agentRetired.map(r => `<li>#${r.id} (${esc(r.kind)}) ${esc(clip(r.suggestion, 100))}</li>`).join('')}</ul>`)
  }

  // Only shown when nonzero: a silent spend-tracking gap the retry could not
  // recover, so the owner knows usage/spend figures undercount by this much.
  if (f.tokenWriteFailures > 0) {
    parts.push(`<p style="margin:0 0 4px;color:${WARN};">${f.tokenWriteFailures} api_token_log write${f.tokenWriteFailures === 1 ? '' : 's'} failed even after retry in the last 24h &mdash; spend tracking undercounts by that many rows.</p>`)
  }

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

/* ── Section: Ticket loop (janitor health) ─────────────────────────────────── */

function agePhrase(hours: number): string {
  return hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`
}

/** Threshold labels for the section copy, kept next to the renderer that uses
 *  them; the numeric thresholds live in ticket-janitor.server.ts. */
const SLA_LABELS = {
  prOpen: '24h',
  inReview: '12h',
  approvedCode: '7 days',
  proposed: '72h',
} as const

/**
 * Renders `computeTicketLoopHealth()`: SLA breaches, orphans, the backlog
 * trajectory, and routine liveness. A null health object (the janitor itself
 * failed) is reported as absent rather than as clean, for the same reason
 * render-truth is: silence must never read as a pass.
 */
export function renderTicketLoopSection(h: TicketLoopHealth | null): string {
  if (!h) {
    return `<p style="margin:0;color:${WARN};">The ticket-loop janitor did not report this run, so SLA, orphan, and routine-liveness state is unknown. This is not a pass.</p>`
  }
  const parts: string[] = []

  const net = h.backlog.netPerDay
  const netColor = net > 0 ? WARN : GOOD
  parts.push(`<p style="margin:0 0 4px;">Backlog, last 7 days: ${h.backlog.created7d} opened &middot; ${h.backlog.terminal7d} closed &middot; <span style="color:${netColor};">net ${net >= 0 ? '+' : ''}${net}/day</span></p>`)

  const staleList = (label: string, rows: readonly { id: number; ageHours: number; suggestion: string }[], limit = 5) =>
    rows.length
      ? `<p style="margin:6px 0 2px;color:${WARN};">${label} (${rows.length}):</p><ul style="margin:0;padding-left:18px;">${rows.slice(0, limit).map(r => `<li>#${r.id} &middot; ${agePhrase(r.ageHours)} &middot; ${esc(clip(r.suggestion, 100))}</li>`).join('')}</ul>`
      : ''

  parts.push(staleList(`pr_open older than ${SLA_LABELS.prOpen}`, h.sla.prOpen))
  parts.push(staleList(`in_review older than ${SLA_LABELS.inReview} (a crashed QA pass leaves rows here)`, h.sla.inReview))
  if (h.sla.approvedCode.count > 0) {
    const oldest = h.sla.approvedCode.oldest
    parts.push(`<p style="margin:6px 0 2px;color:${WARN};">${h.sla.approvedCode.count} approved code ticket${h.sla.approvedCode.count === 1 ? '' : 's'} older than ${SLA_LABELS.approvedCode}${oldest ? `, oldest #${oldest.id} at ${agePhrase(oldest.ageHours)}` : ''}.</p>`)
  }
  parts.push(staleList(`proposed older than ${SLA_LABELS.proposed} (triage is not looking)`, h.sla.proposed))

  if (h.supersededApproved.length) {
    parts.push(`<p style="margin:6px 0 2px;color:${WARN};">${h.supersededApproved.length} approved code ticket${h.supersededApproved.length === 1 ? '' : 's'} flagged as likely already shipped (evidence only, not auto-dismissed &mdash; verify before R-DEV claims):</p><ul style="margin:0;padding-left:18px;">${h.supersededApproved.slice(0, 8).map(s => `<li>#${s.ticketId} &middot; ${esc(s.evidence.map(describeSupersededEvidence).join('; '))} &middot; ${esc(clip(s.suggestion, 80))}</li>`).join('')}</ul>`)
  }

  if (h.sla.blocked.length) {
    const empty = h.sla.blocked.filter(b => b.emptyReason)
    parts.push(`<p style="margin:6px 0 2px;color:${BAD};">${h.sla.blocked.length} blocked ticket${h.sla.blocked.length === 1 ? '' : 's'}${empty.length ? `, <strong>${empty.length} with no recorded reason</strong> (nobody can clear a block that does not say what it is)` : ''}:</p><ul style="margin:0;padding-left:18px;">${h.sla.blocked.slice(0, 8).map(b => `<li>#${b.id} (${esc(b.kind)}, ${agePhrase(b.ageHours)})${b.emptyReason ? ` <span style="color:${BAD};">no reason</span>` : ''} ${esc(clip(b.suggestion, 90))}</li>`).join('')}</ul>`)
  }

  if (h.conflictedPrs.length) {
    parts.push(`<p style="margin:6px 0 2px;color:${BAD};">${h.conflictedPrs.length} merge-conflicted PR${h.conflictedPrs.length === 1 ? '' : 's'}: CI cannot run on a conflicted PR at all (GitHub creates zero workflow runs for it, so nothing anywhere goes red), and the release engine parks it. Merge origin/main into the branch and rebuild:</p><ul style="margin:0;padding-left:18px;">${h.conflictedPrs.slice(0, 6).map(p => `<li>PR #${p.number} (${esc(p.branch)}) ${esc(clip(p.title, 90))}</li>`).join('')}</ul>`)
  }

  if (h.orphanScanSkipped) {
    parts.push(`<p style="margin:6px 0 4px;color:${MUTED};">Orphan scan skipped (GitHub not readable this run).</p>`)
  } else if (h.orphans.length) {
    parts.push(`<p style="margin:6px 0 2px;color:${BAD};">${h.orphans.length} orphaned ticket${h.orphans.length === 1 ? '' : 's'} (still live, but the PR is already ${h.orphans.every(o => o.prOutcome === 'merged') ? 'merged' : 'merged or closed'}, so nothing will ever touch them):</p><ul style="margin:0;padding-left:18px;">${h.orphans.slice(0, 6).map(o => `<li>#${o.ticketId} (${esc(o.status)}) &middot; ${link(o.prRef, prLabel(o.prRef))} ${esc(o.prOutcome)}</li>`).join('')}</ul>`)
  } else {
    parts.push(`<p style="margin:6px 0 4px;color:${GOOD};">No orphaned tickets.</p>`)
  }

  if (h.routineFlags.length) {
    parts.push(`<p style="margin:6px 0 2px;color:${BAD};">${h.routineFlags.length} routine${h.routineFlags.length === 1 ? '' : 's'} past cadence plus grace:</p><ul style="margin:0;padding-left:18px;">${h.routineFlags.map(f => `<li>${esc(f.routine)} (${esc(f.schedule)} UTC) &middot; ${f.lastRunAt ? `last run ${esc(f.lastRunAt.slice(0, 16).replace('T', ' '))} UTC, ${f.hoursSince}h ago` : '<strong>no run row ever</strong>'}</li>`).join('')}</ul>`)
  } else {
    parts.push(`<p style="margin:6px 0 0;color:${GOOD};">Every expected routine has run inside its cadence window.</p>`)
  }

  return parts.filter(Boolean).join('')
}

/* ── Section: Needs Mike (the one consolidated owner list) ─────────────────── */

export interface StaleOwnerRow {
  id: number
  kind: string
  ageDays: number
  suggestion: string
}

export interface NeedsMikeFacts {
  /** Open needs-owner PRs, from suggestion_links state. */
  needsOwnerPrs: EscalationFacts['protectedPrs']
  blockedRows: BlockedTicket[]
  /** Approved promo/campaign/program rows older than 3 days: owner-executed kinds. */
  staleOwnerRows: StaleOwnerRow[]
  orphans: OrphanTicket[]
  /** PRs GitHub reports merge-conflicted, on which CI structurally cannot run. */
  conflictedPrs: ConflictedPr[]
  missedRoutines: RoutineLivenessFlag[]
  /** Approved ad_campaigns rows with no externalCampaignId: launch is owner-only. */
  adCampaigns?: AdCampaignQueueRow[]
  /**
   * Video jobs parked at awaiting_frame_approval while `video_frame_review` is
   * on: the owner picks the frame in /admin/video-studio, so nothing else moves
   * them. `null` when the valve is off (the pipeline auto-advances, so there is
   * nothing owner-only to surface). (#4356)
   */
  parkedVideoFrames?: { count: number; oldestDays: number | null } | null
}

/**
 * One list at the top of the email of everything only the owner can move.
 * The same facts also appear in their home sections with full detail; this is
 * the summary that stops "it was in section nine" from being a failure mode.
 */
export function renderNeedsMikeSection(f: NeedsMikeFacts): string {
  const items: string[] = []
  for (const p of f.needsOwnerPrs.slice(0, 5)) {
    items.push(`${link(p.ref, prLabel(p.ref))} waits on your merge (protected path)${p.ticketId > 0 ? ` &middot; ticket #${p.ticketId}` : ''}`)
  }
  for (const b of f.blockedRows.slice(0, 5)) {
    const reason = blockedReason(b)
    items.push(`#${b.id} is blocked (${esc(b.kind)}) ${esc(clip(b.suggestion, 80))}${reason ? `: ${esc(clip(reason, 120))}` : ` &middot; <span style="color:${BAD};">no reason recorded</span>`}`)
  }
  for (const r of f.staleOwnerRows.slice(0, 5)) {
    items.push(`#${r.id} (${esc(r.kind)}) approved ${r.ageDays}d ago and only you can execute it: ${esc(clip(r.suggestion, 80))}`)
  }
  for (const o of f.orphans.slice(0, 5)) {
    items.push(`#${o.ticketId} is orphaned: its ${link(o.prRef, prLabel(o.prRef))} is ${esc(o.prOutcome)} but the ticket sits ${esc(o.status)}`)
  }
  for (const c of f.conflictedPrs.slice(0, 5)) {
    items.push(`PR #${c.number} is merge-conflicted, CI cannot run on it at all, rebase it on main (branch ${esc(c.branch)})`)
  }
  for (const m of f.missedRoutines.slice(0, 5)) {
    items.push(`Routine ${esc(m.routine)} missed its window (${esc(m.schedule)} UTC): ${m.lastRunAt ? `last run ${m.hoursSince}h ago` : 'no run row ever'}`)
  }
  for (const c of (f.adCampaigns ?? []).slice(0, 5)) {
    items.push(`Ad campaign #${c.id} &ldquo;${esc(clip(c.name, 60))}&rdquo; (${esc(c.platform)}) approved ${c.ageDays}d ago and never launched, only you can create it in-platform: <a href="https://xdipx.com/admin/ad-studio" style="color:#c2410c;">/admin/ad-studio</a>`)
  }
  const frames = f.parkedVideoFrames
  if (frames && frames.count > 0) {
    const oldest = frames.oldestDays != null ? ` (oldest ${frames.oldestDays}d)` : ''
    items.push(`${frames.count} video ${frames.count === 1 ? 'frame is' : 'frames are'} awaiting your pick${oldest}, only you can approve ${frames.count === 1 ? 'it' : 'them'}: <a href="https://xdipx.com/admin/video-studio" style="color:#c2410c;">/admin/video-studio</a>`)
  }
  if (items.length === 0) {
    return `<p style="margin:0;color:${GOOD};">Nothing on this list today.</p>`
  }
  return `<ul style="margin:0;padding-left:18px;">${items.map(i => `<li style="margin-bottom:3px;">${i}</li>`).join('')}</ul>`
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
    opened: {}, closed: {}, blocked: {}, oldestApproved: null,
    finalAttempt: [], blockedRows: [], statusCounts,
  }
  try {
    // blockedRows is intentionally NOT queried here. The raw query selected
    // last_error with no join to suggestion_links, so it dropped the reason for
    // every note-only block (which is most of them). The composer fills
    // blockedRows from the ticket-janitor's note-aware sla.blocked instead, the
    // single source that already resolves the note fallback.
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
      blockedRows: [],
      statusCounts,
    }
  } catch (err) {
    console.warn('[owner-digest] ticket metrics unavailable (migration 070?):', String(err).slice(0, 200))
    return empty
  }
}

/**
 * Count owner asks that have sat undecided long enough to escalate.
 *
 * This used to silently auto-DISMISS these rows (status='dismissed', system).
 * That violated the standing rule that an owner ask must never exit undecided
 * (#4356): a low-priority `process`/`strategy` row three weeks old is not
 * necessarily abandoned, and closing it as a side effect of rendering the daily
 * email is exactly the kind of invisible mutation this digest exists to surface.
 * So nothing is written now — the digest escalates the count instead
 * (rule-5 style: an old item on the owner surface is surfaced, never reaped).
 *
 * Clock: keys off `created_at`, NOT `updated_at`. `updated_at` is bumped by
 * claims, QA bounces, lease expiries and dedupe hits, and migration 070
 * backfilled it across every pre-existing row, so an `updated_at` window matched
 * zero rows on a queue whose real age (created_at) reached 20 days (ticket #879).
 * `created_at` only moves when a row is genuinely new.
 *
 * Scope: `process`/`strategy` (a customer-facing defect is filed as `code`, never
 * these) at P3+ (`priority >= 3`, so P0-P2 defect/roadmap work is out of reach),
 * still `approved` past 21 days. These kinds have an agent close edge
 * (`RUN_CLOSE_KINDS`), so a row this old is one no routine has drained — worth an
 * owner nudge, never a silent dismissal.
 */
export async function countStaleUndecidedOwnerAsks(): Promise<number> {
  try {
    const res = await db.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM homepage_team_suggestions
       WHERE status = 'approved'
         AND kind IN ('process', 'strategy')
         AND priority >= 3
         AND created_at < now() - interval '21 days'`)
    return Number((res.rows ?? [])[0]?.['n'] ?? 0)
  } catch (err) {
    console.warn('[owner-digest] stale-ask count skipped:', String(err).slice(0, 200))
    return 0
  }
}

async function gatherOwnerQueue(staleUndecided: number | null): Promise<OwnerQueueFacts> {
  const out: OwnerQueueFacts = { rows: [], totalCount: 0, staleUndecided }
  try {
    const kinds = sql.join(OWNER_DECISION_KINDS.map(k => sql`${k}`), sql`, `)
    const [listRes, countRes] = await Promise.all([
      db.execute(sql`
        SELECT id, kind, team, target_team, decided_by, suggestion,
               EXTRACT(epoch FROM now() - created_at)::float8 / 86400 AS age_days
          FROM homepage_team_suggestions
         WHERE status = 'approved' AND kind IN (${kinds})
         ORDER BY created_at ASC
         LIMIT 30`),
      db.execute(sql`
        SELECT COUNT(*)::int AS n
          FROM homepage_team_suggestions
         WHERE status = 'approved' AND kind IN (${kinds})`),
    ])
    out.rows = (listRes.rows ?? []).map(r => {
      const row = r as Record<string, unknown>
      return {
        id: Number(row['id'] ?? 0),
        kind: String(row['kind'] ?? ''),
        team: String(row['team'] ?? ''),
        targetTeam: row['target_team'] == null ? null : String(row['target_team']),
        ageDays: Math.round(Number(row['age_days'] ?? 0)),
        suggestion: String(row['suggestion'] ?? ''),
        autoApproved: String(row['decided_by'] ?? '') === 'auto',
      }
    })
    out.totalCount = Number((countRes.rows ?? [])[0]?.['n'] ?? out.rows.length)
  } catch (err) {
    console.warn('[owner-digest] owner queue unavailable:', String(err).slice(0, 200))
  }
  return out
}

async function gatherOpsWatch(): Promise<OpsWatchFacts> {
  const out: OpsWatchFacts = {
    socialDrafts: { count: 0, oldestDays: null },
    pricingBatchRows: 0,
    enrichmentAgeHours: null,
    strandedVerified: 0,
    agentRetired: [],
    tokenWriteFailures: 0,
  }

  // Social review backlog. The social team stops drafting entirely once this
  // builds up, so a silent backlog reads as a silent team.
  try {
    const res = await db.execute(sql`
      SELECT COUNT(*)::int AS n,
             EXTRACT(epoch FROM now() - MIN(created_at))::float8 / 86400 AS oldest_days
        FROM social_posts
       WHERE status = 'draft' AND review_status IN ('pending_review', 'needs_changes')`)
    const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined
    if (row) {
      out.socialDrafts = {
        count: Number(row['n'] ?? 0),
        oldestDays: row['oldest_days'] == null ? null : Math.round(Number(row['oldest_days'])),
      }
    }
  } catch (err) {
    console.warn('[owner-digest] social draft sweep failed:', String(err).slice(0, 200))
  }

  // Did the 07:00 UTC recompute actually run yesterday? Catch-up runs write
  // trigger='batch_catchup' precisely so they cannot satisfy this check.
  try {
    const res = await db.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM pricing_audit_log
       WHERE trigger = 'batch'
         AND occurred_at >= (now()::date - interval '1 day')
         AND occurred_at <  now()::date`)
    out.pricingBatchRows = Number((res.rows ?? [])[0]?.['n'] ?? 0)
  } catch (err) {
    console.warn('[owner-digest] pricing batch check failed:', String(err).slice(0, 200))
  }

  try {
    const res = await db.execute(sql`
      SELECT EXTRACT(epoch FROM now() - MAX(created_at))::float8 / 3600 AS age_hours
        FROM product_enrichment_cache`)
    const raw = (res.rows ?? [])[0]?.['age_hours']
    out.enrichmentAgeHours = raw == null ? null : Number(raw)
  } catch (err) {
    console.warn('[owner-digest] enrichment age check failed:', String(err).slice(0, 200))
  }

  // Tickets QA verified but nothing ever closed. Queried here rather than
  // imported from the release engine's sweep so this line keeps reporting even
  // if the engine is off, which is precisely when the number would grow.
  try {
    const res = await db.execute(sql`
      SELECT COUNT(DISTINCT s.id)::int AS n
        FROM homepage_team_suggestions s
        JOIN suggestion_links l ON l.suggestion_id = s.id AND l.kind = 'pr'
       WHERE s.status = 'verified'
         AND s.updated_at < now() - interval '1 hour'`)
    out.strandedVerified = Number((res.rows ?? [])[0]?.['n'] ?? 0)
  } catch (err) {
    console.warn('[owner-digest] stranded-ticket count failed:', String(err).slice(0, 200))
  }

  // Agents can now retire rows with no executor. Showing what they retired is
  // what keeps that power reviewable instead of merely convenient.
  try {
    const res = await db.execute(sql`
      SELECT id, kind, suggestion
        FROM homepage_team_suggestions
       WHERE status = 'dismissed'
         AND decided_by LIKE 'agent:%'
         AND decided_at >= now() - interval '7 days'
       ORDER BY decided_at DESC LIMIT 10`)
    out.agentRetired = (res.rows ?? []).map(r => {
      const row = r as Record<string, unknown>
      return {
        id: Number(row['id'] ?? 0),
        kind: String(row['kind'] ?? ''),
        suggestion: String(row['suggestion'] ?? ''),
      }
    })
  } catch (err) {
    console.warn('[owner-digest] agent-retired sweep failed:', String(err).slice(0, 200))
  }

  // Silent spend-tracking gaps: api_token_log writes that failed even after
  // their retry. Read from KV (independent of the Neon table that was failing).
  try {
    const { getTokenWriteFailureCount } = await import('~/lib/token-log.server')
    out.tokenWriteFailures = await getTokenWriteFailureCount()
  } catch (err) {
    console.warn('[owner-digest] token-log write-failure count failed:', String(err).slice(0, 200))
  }

  return out
}

/**
 * Owner-only approved rows older than 3 days (`STALE_OWNER_ROW_KINDS`). These
 * are the owner-desk task kinds with no agent close edge: an approved row here
 * is a task on the owner's desk, and three days is long enough that it belongs
 * on the Needs Mike list rather than only in the decision-queue table further
 * down. Kinds an entry-agent run drains (`RUN_CLOSE_KINDS`, now including
 * `campaign`/`promo` per PR #789) are excluded. Surfacing them here
 * misrepresented drained-by-a-routine work as owner work (#4453).
 */
async function gatherStaleOwnerRows(): Promise<StaleOwnerRow[]> {
  // Empty derived set (every candidate gained an agent close edge) means there
  // is nothing owner-only to list; guard against `kind IN ()` invalid SQL.
  if (STALE_OWNER_ROW_KINDS.length === 0) return []
  try {
    const kinds = sql.join(STALE_OWNER_ROW_KINDS.map(k => sql`${k}`), sql`, `)
    const res = await db.execute(sql`
      SELECT id, kind, suggestion,
             EXTRACT(epoch FROM now() - created_at)::float8 / 86400 AS age_days
        FROM homepage_team_suggestions
       WHERE status = 'approved'
         AND kind IN (${kinds})
         AND created_at < now() - interval '3 days'
       ORDER BY created_at ASC LIMIT 10`)
    return (res.rows ?? []).map(r => {
      const row = r as Record<string, unknown>
      return {
        id: Number(row['id'] ?? 0),
        kind: String(row['kind'] ?? ''),
        ageDays: Math.round(Number(row['age_days'] ?? 0)),
        suggestion: String(row['suggestion'] ?? ''),
      }
    })
  } catch (err) {
    console.warn('[owner-digest] stale owner-row sweep failed:', String(err).slice(0, 200))
    return []
  }
}

/**
 * Video jobs parked awaiting the owner's frame pick (#4356).
 *
 * With `video_frame_review` ON the pipeline parks every job at
 * `awaiting_frame_approval` for the owner's pick in /admin/video-studio, and
 * nothing else advances it — so a parked job is owner-only work that appeared in
 * no digest section before this. Returns `null` when the valve is off (the
 * pipeline auto-advances, so there is nothing owner-only to surface).
 */
async function gatherParkedVideoFrames(): Promise<{ count: number; oldestDays: number | null } | null> {
  try {
    // Read the valve exactly as the pipeline does (getPipelineSetting, defaults
    // ON): a missing row means frame review is on. Read inline as raw SQL to keep
    // this file's no-heavy-imports gatherer style.
    const valveRes = await db.execute(sql`
      SELECT value FROM pipeline_settings WHERE key = ${VIDEO_EXTRA_KEYS.frameReview} LIMIT 1`)
    const valveValue = ((valveRes.rows ?? [])[0] as Record<string, unknown> | undefined)?.['value']
    if (valveValue === 'false') return null // valve off: the pipeline auto-advances
    const res = await db.execute(sql`
      SELECT COUNT(*)::int AS n,
             EXTRACT(epoch FROM now() - MIN(created_at))::float8 / 86400 AS oldest_days
        FROM video_jobs
       WHERE status = 'awaiting_frame_approval'`)
    const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined
    return {
      count: Number(row?.['n'] ?? 0),
      oldestDays: row?.['oldest_days'] == null ? null : Math.round(Number(row['oldest_days'])),
    }
  } catch (err) {
    console.warn('[owner-digest] parked video-frame sweep failed:', String(err).slice(0, 200))
    return null
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
  // The stale-ask count is read-only now (#4356): nothing is dismissed, the
  // digest escalates the number instead. It is still skipped on a forced (test)
  // send so a re-render does not imply a real escalation happened; `null` renders
  // as "not computed", distinct from a real zero.
  const staleUndecided = opts.force ? null : await countStaleUndecidedOwnerAsks()
  const [shipped, homepageNow, ticketMetrics, escalations, ownerQueue, opsWatch, reconciliation, loopHealth, staleOwnerRows, adCampaignQueue, parkedVideoFrames] =
    await Promise.all([
      gatherShipped(),
      gatherHomepageNow(),
      gatherTicketMetrics(statusCountsLine),
      gatherEscalations(),
      gatherOwnerQueue(staleUndecided),
      gatherOpsWatch(),
      // Best-effort: this one calls Shopify, and a digest that does not send is
      // worse than a digest missing one line.
      getProfitReconciliation().catch((err): null => {
        console.warn('[owner-digest] profit reconciliation failed:', String(err).slice(0, 200))
        return null
      }),
      // Best-effort for the same reason: the janitor reads GitHub. The
      // reconciles run first so pr-link states are fresh and merged-PR orphans
      // are already off the live queue when health is computed (#3582: an
      // orphan the reconcile applies vanishes from Needs-Mike in the same
      // digest, and one the protected-path check skips stays listed). Each
      // step's own failure costs nothing but freshness, never the digest and
      // never the health computation behind it.
      reconcilePrLinkStates()
        .catch(err => {
          console.warn('[owner-digest] pr-link reconcile failed:', String(err).slice(0, 200))
        })
        .then(() => reconcileOrphanedTickets())
        .catch(err => {
          console.warn('[owner-digest] orphan reconcile failed:', String(err).slice(0, 200))
        })
        .then(() => computeTicketLoopHealth())
        .catch((err): null => {
          console.warn('[owner-digest] ticket-loop health failed:', String(err).slice(0, 200))
          return null
        }),
      gatherStaleOwnerRows(),
      gatherAdCampaignQueue(),
      gatherParkedVideoFrames(),
    ])
  const needsOwner = escalations.protectedPrs.length + escalations.exhausted.length
  // One note-aware source for blocked rows, shared by the Needs Mike list and
  // the Tickets section. The janitor's sla.blocked resolves the reason from
  // last_error OR the latest suggestion_links note; the raw ticket-metrics query
  // did neither and rendered a bare id for every note-only block.
  const blockedRows = loopHealth?.sla.blocked ?? []
  ticketMetrics.blockedRows = blockedRows
  const needsMike: NeedsMikeFacts = {
    needsOwnerPrs: escalations.protectedPrs,
    blockedRows,
    staleOwnerRows,
    orphans: loopHealth?.orphans ?? [],
    conflictedPrs: loopHealth?.conflictedPrs ?? [],
    missedRoutines: loopHealth?.routineFlags ?? [],
    adCampaigns: adCampaignQueue,
    parkedVideoFrames,
  }

  // ── Compose ───────────────────────────────────────────────────────────────
  const ordersY = yesterday?.orders ?? 0
  const subject = `xdipx daily digest: ${ordersY} orders yesterday, ${failures.length} run failure${failures.length === 1 ? '' : 's'}, ${redTrackers} RED tracker${redTrackers === 1 ? '' : 's'}${needsOwner > 0 ? `, ${needsOwner} need${needsOwner === 1 ? 's' : ''} you` : ''}`

  const profitRows = profit
    .map(p => `<tr><td style="padding:2px 10px 2px 0;">${esc(p.day)}</td><td style="padding:2px 10px;">${p.orders}</td><td style="padding:2px 10px;">$${p.revenue.toFixed(2)}</td><td style="padding:2px 10px;">$${p.profit.toFixed(2)}</td><td style="padding:2px 0;">${esc(p.featured_sku ?? '')}</td></tr>`)
    .join('')

  // Reconciliation against Shopify's own count. This exists because the table
  // reported $0 on real paid orders for a month and nothing ever contradicted
  // it: no agent, no cron, and no human asked Shopify whether zero was true.
  const reconLine = (() => {
    if (!reconciliation) {
      return `<p style="margin:6px 0 0;color:${MUTED};">Could not reconcile against Shopify this run.</p>`
    }
    const r = reconciliation
    const cogsNote = r.cogsMissingUnits > 0
      ? ` <span style="color:${WARN};">Cost unknown on ${r.cogsMissingUnits} unit${r.cogsMissingUnits === 1 ? '' : 's'}, so margin is a floor, not a figure.</span>`
      : ''
    if (!r.summaryExists) {
      return `<p style="margin:6px 0 0;color:${BAD};">No summary row for ${esc(r.date)}, but Shopify reports ${r.shopifyPaidOrders} paid order${r.shopifyPaidOrders === 1 ? '' : 's'}.</p>`
    }
    if (!r.match) {
      return `<p style="margin:6px 0 0;color:${BAD};"><strong>Mismatch on ${esc(r.date)}:</strong> Shopify says ${r.shopifyPaidOrders} paid order${r.shopifyPaidOrders === 1 ? '' : 's'}, the summary says ${r.summaryOrders}.</p>${cogsNote ? `<p style="margin:2px 0 0;">${cogsNote}</p>` : ''}`
    }
    return `<p style="margin:6px 0 0;color:${GOOD};">Reconciled: Shopify and the summary agree on ${r.shopifyPaidOrders} paid order${r.shopifyPaidOrders === 1 ? '' : 's'} for ${esc(r.date)}.${cogsNote}</p>`
  })()

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
      ${section('Needs Mike', renderNeedsMikeSection(needsMike))}
      ${section(`Escalations${needsOwner > 0 ? ` (${needsOwner})` : ''}`, renderEscalationsSection(escalations))}
      ${section(`Shipped, last 24h (${shipped.length})`, renderShippedSection(shipped))}
      ${section('Homepage now', renderHomepageNowSection(homepageNow))}
      ${section(`Needs a decision from you${ownerQueue.totalCount > 0 ? ` (${ownerQueue.totalCount})` : ''}`, renderOwnerQueueSection(ownerQueue))}
      ${section(`Ad campaigns awaiting launch${adCampaignQueue.length > 0 ? ` (${adCampaignQueue.length})` : ''}`, renderAdCampaignQueueSection(adCampaignQueue))}
      ${section('Orders and profit (last 8 days)', `<table style="border-collapse:collapse;">${profitRows || '<tr><td>no rows</td></tr>'}</table>${reconLine}`)}
      ${section('Ops watch', renderOpsWatchSection(opsWatch))}
      ${section(`Team runs, last 24h (${failures.length} failed)`, `<table style="border-collapse:collapse;">${runRows || '<tr><td>no runs</td></tr>'}</table>`)}
      ${section('Team gates', `<table style="border-collapse:collapse;">${gateRows}</table>`)}
      ${section('Valves', `<table style="border-collapse:collapse;">${valveRows}</table>`)}
      ${section(`SEO and indexing${seoDay ? ` (diagnosis ${esc(seoDay)})` : ''}`, indexBody)}
      ${section(`Tickets (${proposed?.n ?? 0} awaiting triage${proposed ? `, oldest ${esc(proposed.oldest.slice(0, 10))}` : ''})`, renderTicketsSection(ticketMetrics))}
      ${section('Ticket loop', renderTicketLoopSection(loopHealth))}
      ${section('Program trackers', trackerBlocks || 'no trackers found')}
      <p style="font-family:Inter,sans-serif;font-size:11px;color:#6f645c;margin-top:18px;">
        Full detail: xdipx.com/admin/trackers and /admin/homepage-team. Sent by /cron/owner-digest.
      </p>
    </div>
  </body>`

  const res = await sendOwnerEmail(subject, html, { fromName: 'xdipx daily digest' })
  if (res.sent) return { sent: true, subject }

  // The day slot was claimed before composing, to stop a double cron
  // invocation sending twice. If the send itself failed, give the slot back and
  // throw so the cron returns 500 instead of a cheerful 200: a digest that
  // silently did not send is the same failure class as the ones it reports on.
  if (!opts.force) await kvDel(`owner-digest:sent:${day}`)
  throw new Error(`owner digest send failed: ${res.error ?? 'unknown error'}`)
}
