/**
 * Ticket-loop janitor: the health computation behind the owner digest's
 * "Ticket loop" section and the digest-level "Needs Mike" list.
 *
 * Why this exists: on 2026-08-05 the queue audit found 153 live tickets with a
 * net inflow of about +6 per day, two orphaned tickets whose PRs had merged
 * days earlier (120, 423), a blocked pile where 10 of 11 rows carried no
 * reason at all, and a fire on 2026-08-02 that produced no run row and was
 * therefore invisible to every coverage check for a week. None of those facts
 * lived anywhere a human would see them daily. This module computes them on
 * demand so the digest can print them.
 *
 * Split deliberately: everything that can be pure is pure (thresholds, cadence
 * table, orphan classification) so it is testable without a database, and the
 * two exported IO entry points (`computeTicketLoopHealth`,
 * `reconcilePrLinkStates`) are thin gatherers that degrade section by section
 * instead of failing whole. GitHub reads go through `app/lib/github.server.ts`
 * helpers, which already skip gracefully when the token env is absent.
 *
 * The reconcile step writes ONLY `suggestion_links` rows (pr-link `state`
 * refresh when GitHub disagrees). It never transitions a ticket: status moves
 * stay with the transition map in team.server.ts and its actors.
 */

import { and, eq, isNull, notInArray, or, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { suggestionLinks } from '../../db/schema'
import { getPullRequest, isGithubConfigured } from '~/lib/github.server'

/* ── SLA thresholds ────────────────────────────────────────────────────────── */

/**
 * How long a ticket may sit in a status before the digest calls it stale.
 * Sized against the loop's own cadences: QA passes twice a day (03:30 and
 * 15:30 UTC), so a `pr_open` row older than 24h has been skipped by two
 * passes; `in_review` is a mid-review state that a healthy pass exits within
 * the run, so 12h means the reviewer crashed; approved `code` has a dev lane
 * draining up to 10 claims/day, so 7 days old means it keeps losing the
 * priority race; `proposed` older than 72h means triage (auto-approve or the
 * owner) is not looking.
 */
export const SLA = {
  prOpenHours: 24,
  inReviewHours: 12,
  approvedCodeDays: 7,
  proposedHours: 72,
} as const

/** Statuses that mean the ticket is done and owes nobody anything. */
export const TERMINAL_STATUSES: readonly string[] = ['applied', 'dismissed']

export interface StaleTicket {
  id: number
  status: string
  kind: string
  priority: number
  /** Hours since the timestamp the breach is measured against. */
  ageHours: number
  suggestion: string
}

export interface BlockedTicket {
  id: number
  kind: string
  ageHours: number
  suggestion: string
  lastError: string | null
  /**
   * True when the row carries no reason anywhere we can find one: empty
   * `last_error` AND no note link. A block with no reason cannot be cleared by
   * anyone but an archaeologist; 10 of 11 blocked rows looked like this on
   * 2026-08-05.
   */
  emptyReason: boolean
}

export interface SlaBreaches {
  /** pr_open rows older than SLA.prOpenHours (measured on updated_at). */
  prOpen: StaleTicket[]
  /** in_review rows older than SLA.inReviewHours (measured on updated_at). */
  inReview: StaleTicket[]
  /** approved kind=code rows older than SLA.approvedCodeDays (created_at). */
  approvedCode: { count: number; oldest: StaleTicket | null; rows: StaleTicket[] }
  /** proposed rows older than SLA.proposedHours (created_at). */
  proposed: StaleTicket[]
  /** Every blocked row, whatever its age, with the empty-reason flag. */
  blocked: BlockedTicket[]
}

/** Raw ticket shape the classifier consumes; the gatherer maps SQL rows to it. */
export interface JanitorTicketRow {
  id: number
  status: string
  kind: string
  priority: number
  suggestion: string
  lastError: string | null
  /** Latest note-link ref, when one exists (blocked-reason fallback). */
  noteRef: string | null
  createdAt: Date
  updatedAt: Date
}

function hoursBetween(then: Date, now: Date): number {
  return Math.max(0, (now.getTime() - then.getTime()) / 3_600_000)
}

function toStale(r: JanitorTicketRow, since: Date, now: Date): StaleTicket {
  return {
    id: r.id,
    status: r.status,
    kind: r.kind,
    priority: r.priority,
    ageHours: Math.round(hoursBetween(since, now)),
    suggestion: r.suggestion,
  }
}

function isBlank(s: string | null | undefined): boolean {
  return s == null || s.trim() === ''
}

/**
 * Pure SLA classification. `pr_open` and `in_review` age off `updated_at`
 * (the closest thing we have to "entered this status"; a bump from a claim or
 * a note only makes the check more lenient, never noisier). `approved` and
 * `proposed` age off `created_at`, the age a human perceives, for the same
 * reason the suggestion ager does: migration 070 backfilled `updated_at`
 * everywhere, so it lies about queue age.
 */
export function classifySlaBreaches(rows: readonly JanitorTicketRow[], now: Date = new Date()): SlaBreaches {
  const prOpen: StaleTicket[] = []
  const inReview: StaleTicket[] = []
  const approvedCode: StaleTicket[] = []
  const proposed: StaleTicket[] = []
  const blocked: BlockedTicket[] = []

  for (const r of rows) {
    if (r.status === 'pr_open' && hoursBetween(r.updatedAt, now) > SLA.prOpenHours) {
      prOpen.push(toStale(r, r.updatedAt, now))
    } else if (r.status === 'in_review' && hoursBetween(r.updatedAt, now) > SLA.inReviewHours) {
      inReview.push(toStale(r, r.updatedAt, now))
    } else if (r.status === 'approved' && r.kind === 'code'
        && hoursBetween(r.createdAt, now) > SLA.approvedCodeDays * 24) {
      approvedCode.push(toStale(r, r.createdAt, now))
    } else if (r.status === 'proposed' && hoursBetween(r.createdAt, now) > SLA.proposedHours) {
      proposed.push(toStale(r, r.createdAt, now))
    }
    if (r.status === 'blocked') {
      blocked.push({
        id: r.id,
        kind: r.kind,
        ageHours: Math.round(hoursBetween(r.updatedAt, now)),
        suggestion: r.suggestion,
        lastError: r.lastError,
        emptyReason: isBlank(r.lastError) && isBlank(r.noteRef),
      })
    }
  }

  const sortOldest = (a: StaleTicket, b: StaleTicket) => b.ageHours - a.ageHours
  prOpen.sort(sortOldest)
  inReview.sort(sortOldest)
  approvedCode.sort(sortOldest)
  proposed.sort(sortOldest)
  blocked.sort((a, b) => b.ageHours - a.ageHours)

  return {
    prOpen,
    inReview,
    approvedCode: {
      count: approvedCode.length,
      oldest: approvedCode[0] ?? null,
      rows: approvedCode,
    },
    proposed,
    blocked,
  }
}

/* ── Orphans: live tickets whose PR already merged or closed ───────────────── */

export interface OrphanCandidate {
  ticketId: number
  status: string
  prRef: string
  /** null when the PR could not be read (GitHub down or unconfigured). */
  pr: { merged: boolean; state: string } | null
}

export interface OrphanTicket {
  ticketId: number
  status: string
  prRef: string
  /** 'merged' | 'closed': what GitHub says happened to the PR. */
  prOutcome: 'merged' | 'closed'
}

/** `https://github.com/o/r/pull/42` (or `.../pulls/42`) -> 42, else null. */
export function parsePrNumber(ref: string): number | null {
  const m = /\/pulls?\/(\d+)(?:$|[/?#])/.exec(ref)
  return m?.[1] ? Number(m[1]) : null
}

/**
 * Pure orphan classification. A ticket is orphaned when it is still live
 * (non-terminal status) but its PR is already merged or closed, so nothing in
 * the loop will ever touch it again: the engine only reconciles tickets it
 * merges itself, and QA only reads `pr_open`/`in_review`. Tickets whose PR
 * could not be read are NOT orphans; unknown never classifies as dead.
 */
export function classifyOrphans(candidates: readonly OrphanCandidate[]): OrphanTicket[] {
  const out: OrphanTicket[] = []
  for (const c of candidates) {
    if (TERMINAL_STATUSES.includes(c.status)) continue
    if (!c.pr) continue
    if (c.pr.merged) {
      out.push({ ticketId: c.ticketId, status: c.status, prRef: c.prRef, prOutcome: 'merged' })
    } else if (c.pr.state === 'closed') {
      out.push({ ticketId: c.ticketId, status: c.status, prRef: c.prRef, prOutcome: 'closed' })
    }
  }
  return out
}

/* ── Routine liveness ──────────────────────────────────────────────────────── */

export type CadenceKind = 'twice-daily' | 'daily' | 'twice-weekly' | 'weekly'

export interface RoutineCadence {
  routine: string
  /**
   * Team the run row is written under, or null for lanes with no team gate
   * (the pricing sweep); a null team matches on runType alone.
   */
  team: string | null
  runType: string
  kind: CadenceKind
  /** Human-readable schedule, UTC, for the digest line. */
  schedule: string
  /** Interval plus grace: 2h grace on dailies, 26h on weeklies. */
  maxGapHours: number
}

const TWICE_DAILY_GAP = 12 + 2
const DAILY_GAP = 24 + 2
const WEEKLY_GAP = 168 + 26
/** Mon and Thu: the longest interval is Thu to Mon, 96h, plus weekly grace. */
const TWICE_WEEKLY_GAP = 96 + 26

/**
 * What should be running, as data. Mirrors `docs/store-team/routine-schedule.md`
 * as of 2026-08-05 (R-QA at two passes, the trend-scout/research triggers
 * created). If the manifest and this table disagree, fix one of them in the
 * same PR that moved the other.
 *
 * The podcast lane's playbook opens its run with runType 'manual', so its
 * liveness rides the manual bucket and is approximate by construction; the
 * social trend scout (routine 20) is deliberately absent because its trigger
 * is disabled pending the social run-cap raise.
 */
export const ROUTINE_CADENCES: readonly RoutineCadence[] = [
  { routine: 'R-DEV daily dev', team: 'strategy', runType: 'dev', kind: 'twice-daily', schedule: '14:00 and 20:00 daily', maxGapHours: TWICE_DAILY_GAP },
  { routine: 'R-QA daily QA gate', team: 'strategy', runType: 'qa', kind: 'twice-daily', schedule: '03:30 and 15:30 daily', maxGapHours: TWICE_DAILY_GAP },
  { routine: 'Daily content writer', team: 'content', runType: 'content', kind: 'daily', schedule: '15:00 daily', maxGapHours: DAILY_GAP },
  { routine: 'Daily merchandiser (Routine A)', team: 'homepage', runType: 'merchandise', kind: 'daily', schedule: '10:00 daily', maxGapHours: DAILY_GAP },
  { routine: 'Daily social drafts', team: 'social', runType: 'social', kind: 'daily', schedule: '14:00 daily', maxGapHours: DAILY_GAP },
  { routine: 'Daily product manager', team: 'product', runType: 'product', kind: 'daily', schedule: '09:00 daily', maxGapHours: DAILY_GAP },
  { routine: 'Daily pricing sweep', team: null, runType: 'pricing', kind: 'daily', schedule: '14:37 daily (no team gate)', maxGapHours: DAILY_GAP },
  { routine: 'Weekly strategy', team: 'strategy', runType: 'strategy', kind: 'weekly', schedule: 'Mon 12:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Apply pass (agent-editor)', team: 'strategy', runType: 'apply', kind: 'twice-weekly', schedule: 'Mon and Thu 22:00', maxGapHours: TWICE_WEEKLY_GAP },
  { routine: 'Cost review', team: 'strategy', runType: 'cost-review', kind: 'weekly', schedule: 'Mon 21:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Weekly off-site scout', team: 'strategy', runType: 'offsite', kind: 'weekly', schedule: 'Tue 16:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Weekly SEO curation', team: 'content', runType: 'seo-curation', kind: 'weekly', schedule: 'Sun 19:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Weekly podcast review', team: 'content', runType: 'manual', kind: 'weekly', schedule: 'Wed 21:05', maxGapHours: WEEKLY_GAP },
  { routine: 'Weekly trend scout', team: 'content', runType: 'trend-scout', kind: 'weekly', schedule: 'Sat 19:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Weekly business research', team: 'social', runType: 'research', kind: 'weekly', schedule: 'Thu 16:00', maxGapHours: WEEKLY_GAP },
]

export interface RoutineLivenessFlag {
  routine: string
  team: string | null
  runType: string
  schedule: string
  /** ISO timestamp of the last run row, or null when none was ever written. */
  lastRunAt: string | null
  hoursSince: number | null
  maxGapHours: number
}

export interface LastRunInput {
  team: string
  runType: string
  startedAt: Date | string
}

/**
 * Pure liveness check: a routine is flagged when its newest run row is older
 * than its interval plus grace, or when no run row exists at all. A run row is
 * written before the gate, so a run that skipped still counts as alive here;
 * what this catches is the 2026-08-02 class of failure, where the cloud
 * session died before `POST /api/team/run` and left no trace anywhere.
 */
export function checkRoutineLiveness(
  lastRuns: readonly LastRunInput[],
  now: Date = new Date(),
  cadences: readonly RoutineCadence[] = ROUTINE_CADENCES,
): RoutineLivenessFlag[] {
  const newest = new Map<string, Date>()
  for (const r of lastRuns) {
    const at = r.startedAt instanceof Date ? r.startedAt : new Date(r.startedAt)
    if (Number.isNaN(at.getTime())) continue
    for (const key of [`${r.team}|${r.runType}`, `|${r.runType}`]) {
      const prev = newest.get(key)
      if (!prev || prev < at) newest.set(key, at)
    }
  }

  const flags: RoutineLivenessFlag[] = []
  for (const c of cadences) {
    const key = c.team === null ? `|${c.runType}` : `${c.team}|${c.runType}`
    const last = newest.get(key) ?? null
    const hoursSince = last ? hoursBetween(last, now) : null
    if (hoursSince !== null && hoursSince <= c.maxGapHours) continue
    flags.push({
      routine: c.routine,
      team: c.team,
      runType: c.runType,
      schedule: c.schedule,
      lastRunAt: last ? last.toISOString() : null,
      hoursSince: hoursSince === null ? null : Math.round(hoursSince),
      maxGapHours: c.maxGapHours,
    })
  }
  return flags
}

/* ── The health object ─────────────────────────────────────────────────────── */

export interface BacklogTrajectory {
  /** Tickets created in the last 7 days. */
  created7d: number
  /** Tickets that reached applied/dismissed in the last 7 days. */
  terminal7d: number
  /** (created - terminal) / 7, one decimal. Positive means the pile grows. */
  netPerDay: number
}

export function computeNetPerDay(created: number, terminal: number, days = 7): number {
  if (days <= 0) return 0
  return Math.round(((created - terminal) / days) * 10) / 10
}

export interface TicketLoopHealth {
  generatedAt: string
  sla: SlaBreaches
  orphans: OrphanTicket[]
  /** True when GitHub was unreachable/unconfigured, so orphans is a floor. */
  orphanScanSkipped: boolean
  backlog: BacklogTrajectory
  /** Routines whose last run row is older than cadence plus grace. */
  routineFlags: RoutineLivenessFlag[]
}

const EMPTY_SLA: SlaBreaches = {
  prOpen: [],
  inReview: [],
  approvedCode: { count: 0, oldest: null, rows: [] },
  proposed: [],
  blocked: [],
}

/** Most PRs the orphan scan and reconcile will read from GitHub per run. */
const MAX_GITHUB_READS = 20

async function gatherSlaRows(): Promise<JanitorTicketRow[]> {
  const res = await db.execute(sql`
    SELECT s.id, s.status, s.kind, s.priority, s.suggestion, s.last_error,
           s.created_at, s.updated_at,
           (SELECT l.ref FROM suggestion_links l
             WHERE l.suggestion_id = s.id AND l.kind = 'note'
             ORDER BY l.created_at DESC LIMIT 1) AS note_ref
      FROM homepage_team_suggestions s
     WHERE s.status IN ('pr_open', 'in_review', 'approved', 'proposed', 'blocked')`)
  return ((res.rows ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: Number(r['id'] ?? 0),
    status: String(r['status'] ?? ''),
    kind: String(r['kind'] ?? ''),
    priority: Number(r['priority'] ?? 3),
    suggestion: String(r['suggestion'] ?? ''),
    lastError: r['last_error'] == null ? null : String(r['last_error']),
    noteRef: r['note_ref'] == null ? null : String(r['note_ref']),
    createdAt: new Date(String(r['created_at'] ?? 0)),
    updatedAt: new Date(String(r['updated_at'] ?? 0)),
  }))
}

async function gatherOrphans(): Promise<{ orphans: OrphanTicket[]; skipped: boolean }> {
  if (!isGithubConfigured()) return { orphans: [], skipped: true }

  const res = await db.execute(sql`
    SELECT DISTINCT ON (s.id) s.id, s.status, l.ref
      FROM homepage_team_suggestions s
      JOIN suggestion_links l ON l.suggestion_id = s.id AND l.kind = 'pr'
     WHERE s.status NOT IN ('applied', 'dismissed')
     ORDER BY s.id, l.created_at DESC`)
  const rows = ((res.rows ?? []) as Array<Record<string, unknown>>).map(r => ({
    ticketId: Number(r['id'] ?? 0),
    status: String(r['status'] ?? ''),
    prRef: String(r['ref'] ?? ''),
  }))

  // One GitHub read per distinct PR, hard-capped: this runs inside the digest
  // cron and must stay cheap even if the queue is a mess.
  const byNumber = new Map<number, { merged: boolean; state: string } | null>()
  const candidates: OrphanCandidate[] = []
  for (const row of rows) {
    const num = parsePrNumber(row.prRef)
    if (num === null) continue
    if (!byNumber.has(num)) {
      if (byNumber.size >= MAX_GITHUB_READS) continue
      const pr = await getPullRequest(num, 'ticket-janitor')
      byNumber.set(num, pr.ok ? { merged: pr.data.merged, state: pr.data.state } : null)
    }
    candidates.push({ ...row, pr: byNumber.get(num) ?? null })
  }
  return { orphans: classifyOrphans(candidates), skipped: false }
}

async function gatherBacklog(): Promise<BacklogTrajectory> {
  const res = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM homepage_team_suggestions
        WHERE created_at >= now() - interval '7 days')::int AS created,
      (SELECT COUNT(*) FROM homepage_team_suggestions
        WHERE status IN ('applied', 'dismissed')
          AND updated_at >= now() - interval '7 days')::int AS terminal`)
  const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined
  const created = Number(row?.['created'] ?? 0)
  const terminal = Number(row?.['terminal'] ?? 0)
  return { created7d: created, terminal7d: terminal, netPerDay: computeNetPerDay(created, terminal) }
}

async function gatherRoutineFlags(): Promise<RoutineLivenessFlag[]> {
  const res = await db.execute(sql`
    SELECT team, run_type, MAX(started_at) AS last_started
      FROM homepage_team_runs
     GROUP BY team, run_type`)
  const lastRuns: LastRunInput[] = ((res.rows ?? []) as Array<Record<string, unknown>>).map(r => ({
    team: String(r['team'] ?? ''),
    runType: String(r['run_type'] ?? ''),
    startedAt: String(r['last_started'] ?? ''),
  }))
  return checkRoutineLiveness(lastRuns)
}

/**
 * The one entry point the digest calls. Every gatherer degrades independently:
 * a failed query yields that section's empty shape and a warning, never a
 * thrown digest.
 */
export async function computeTicketLoopHealth(): Promise<TicketLoopHealth> {
  const health: TicketLoopHealth = {
    generatedAt: new Date().toISOString(),
    sla: EMPTY_SLA,
    orphans: [],
    orphanScanSkipped: true,
    backlog: { created7d: 0, terminal7d: 0, netPerDay: 0 },
    routineFlags: [],
  }

  try {
    health.sla = classifySlaBreaches(await gatherSlaRows())
  } catch (err) {
    console.warn('[ticket-janitor] SLA sweep failed:', String(err).slice(0, 200))
  }
  try {
    const { orphans, skipped } = await gatherOrphans()
    health.orphans = orphans
    health.orphanScanSkipped = skipped
  } catch (err) {
    console.warn('[ticket-janitor] orphan scan failed:', String(err).slice(0, 200))
  }
  try {
    health.backlog = await gatherBacklog()
  } catch (err) {
    console.warn('[ticket-janitor] backlog trajectory failed:', String(err).slice(0, 200))
  }
  try {
    health.routineFlags = await gatherRoutineFlags()
  } catch (err) {
    console.warn('[ticket-janitor] routine liveness failed:', String(err).slice(0, 200))
  }

  return health
}

/* ── Reconcile: refresh stale pr-link states ───────────────────────────────── */

export interface ReconcileResult {
  /** Distinct PRs actually read from GitHub. */
  checked: number
  updated: Array<{ linkId: number; ref: string; from: string | null; to: string }>
  /** True when GitHub was unconfigured and nothing was attempted. */
  skipped: boolean
}

/**
 * Refresh `suggestion_links` pr-link `state` where GitHub disagrees (for
 * example a link still saying `open` for a PR that merged out of band). This
 * is what keeps the digest's needs-owner and shipped queries truthful without
 * waiting for the engine to happen to touch the ticket.
 *
 * Writes are plain link-table updates. No ticket status is ever transitioned
 * here; an orphan surfaced by the health object stays a human (or engine)
 * decision.
 */
export async function reconcilePrLinkStates(
  opts: { maxChecks?: number } = {},
): Promise<ReconcileResult> {
  if (!isGithubConfigured()) return { checked: 0, updated: [], skipped: true }
  const maxChecks = opts.maxChecks ?? MAX_GITHUB_READS

  const links = await db
    .select({ id: suggestionLinks.id, ref: suggestionLinks.ref, state: suggestionLinks.state })
    .from(suggestionLinks)
    .where(and(
      eq(suggestionLinks.kind, 'pr'),
      or(isNull(suggestionLinks.state), notInArray(suggestionLinks.state, ['merged', 'closed'])),
    ))
    .limit(200)

  const byNumber = new Map<number, { merged: boolean; state: string } | null>()
  const updated: ReconcileResult['updated'] = []

  for (const link of links) {
    const num = parsePrNumber(link.ref)
    if (num === null) continue
    if (!byNumber.has(num)) {
      if (byNumber.size >= maxChecks) continue
      const pr = await getPullRequest(num, 'ticket-janitor')
      byNumber.set(num, pr.ok ? { merged: pr.data.merged, state: pr.data.state } : null)
    }
    const pr = byNumber.get(num)
    if (!pr) continue
    const next = pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : null
    if (next === null || next === link.state) continue
    await db
      .update(suggestionLinks)
      .set({ state: next, updatedAt: new Date() })
      .where(eq(suggestionLinks.id, link.id))
    updated.push({ linkId: link.id, ref: link.ref, from: link.state, to: next })
  }

  return { checked: byNumber.size, updated, skipped: false }
}
