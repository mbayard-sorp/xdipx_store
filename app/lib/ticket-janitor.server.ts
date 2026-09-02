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
 * The pr-link reconcile step (`reconcilePrLinkStates`) writes ONLY
 * `suggestion_links` rows (pr-link `state` refresh when GitHub disagrees) and
 * never transitions a ticket.
 *
 * `reconcileOrphanedTickets` (#3582) is the one exception to "detect only",
 * and it goes THROUGH the transition map, never around it: an orphaned ticket
 * whose linked PR GitHub itself reports merged, in a status the map's
 * `outOfBandReconcileOnly` edges cover (approved/blocked/pr_open/in_review),
 * and whose changed files are all non-protected, is transitioned to `applied`
 * inside `runWithOutOfBandReconcile` — the same fenced machinery the engine's
 * out-of-band sweep uses, unreachable from the team HTTP API. A protected-path
 * PR is never auto-applied (the owner merged it deliberately; its ticket stays
 * surfaced in the digest's Needs-Mike list), and a closed-unmerged PR's ticket
 * is never touched (also surfaced, owner's call). Everything else in this
 * module stays flag-only.
 *
 * Two later additions live here for the same non-protected-path reason:
 *
 * `supersededApproved` (tickets #3349, #3432, #253) flags an approved `code`
 * ticket whose ask already shipped, so R-DEV stops burning a claim to
 * re-diagnose it. It only ever FLAGS: `app/lib/team.server.ts` owns the
 * transition map, and neither `approved -> blocked` nor a plain
 * `system`-actor `approved -> dismissed` edge exists for kind `code`, so this
 * module cannot close one of these rows without a protected-path change. The
 * flag is surfaced in `computeTicketLoopHealth` (and the owner digest) for a
 * human, or a future claim-time check, to act on; nothing here transitions a
 * ticket status. Evidence is one of: (a) another row shares this ticket's
 * `dedupe_key` and has already reached a tracked-or-shipped status, or (b) the
 * ticket's own text cites a PR number that GitHub reports merged.
 *
 * `buildBlockedDigest` / `runBlockedTicketDigest` (#2863) is the weekly
 * blocked-ticket parking-lot digest. It is NOT wired to a cron schedule:
 * `vercel.json` and `server/cron*.ts` are protected paths this module cannot
 * touch. `runBlockedTicketDigest` is ready to call from either once the owner
 * adds the one-line schedule and route; see the PR description for the exact
 * remainder.
 */

import { and, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { suggestionLinks } from '../../db/schema'
import {
  classifyChangedFiles,
  getPullRequest,
  isGithubConfigured,
  listOpenPullRequests,
  listPullRequestFiles,
  type PullRequestSummary,
} from '~/lib/github.server'
import { runWithOutOfBandReconcile, transitionSuggestion } from '~/lib/team.server'
import { sendOwnerEmail } from '~/lib/owner-alerts.server'
import { kvSetNX } from '~/lib/kv.server'

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
  /** Optional so existing fixtures/callers built before #2863 still typecheck;
   *  the gatherer always sets it. Defaults to 3 (the same default the rest of
   *  this module uses) when absent. */
  priority?: number
  ageHours: number
  suggestion: string
  lastError: string | null
  /**
   * The latest `note` link's text, when one exists. R-DEV blocks a ticket with
   * a note and no `last_error` (transitionSuggestion leaves `last_error` null
   * when a note is present), so for most blocked rows this is the only place the
   * reason lives. Callers that render a reason should prefer `lastError`, then
   * fall back to this.
   */
  noteRef: string | null
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
        priority: r.priority,
        ageHours: Math.round(hoursBetween(r.updatedAt, now)),
        suggestion: r.suggestion,
        lastError: r.lastError,
        noteRef: r.noteRef,
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

/* ── Orphan reconcile (#3582): merged-PR orphans off the live queue ────────── */

/**
 * Statuses the orphan reconcile may move to `applied`. Exactly the statuses
 * the transition map's `outOfBandReconcileOnly` edges cover — this module adds
 * no edge of its own. `in_progress` is excluded (an active lease means an
 * agent is mid-work; a PR link on it may be a superseded earlier attempt),
 * `proposed` is excluded (never triaged, so "its fix shipped" is not a claim
 * anyone made), and `verified` is the engine's own reconcile lane already.
 */
export const RECONCILABLE_ORPHAN_STATUSES: readonly string[] = [
  'approved', 'blocked', 'pr_open', 'in_review',
]

export type OrphanReconcileAction =
  | 'apply'            // merged, reconcilable status, no protected files
  | 'skip-protected'   // merged but the PR touched a protected path: owner's
  | 'skip-closed'      // PR closed unmerged: never auto-applied, stays surfaced
  | 'skip-status'      // status outside the fenced reconcile edges
  | 'skip-unknown'     // changed files unreadable: unknown never classifies

/**
 * Pure decision for one orphan. Only a `merged` verdict from GitHub plus a
 * clean (non-protected, successfully read) file list yields `apply`;
 * everything else stays a flag for the digest, which is where these tickets
 * were already surfaced before #3582.
 */
export function classifyOrphanReconcile(
  orphan: Pick<OrphanTicket, 'status' | 'prOutcome'>,
  files: { ok: boolean; protected: boolean },
): OrphanReconcileAction {
  if (orphan.prOutcome === 'closed') return 'skip-closed'
  if (!RECONCILABLE_ORPHAN_STATUSES.includes(orphan.status)) return 'skip-status'
  if (!files.ok) return 'skip-unknown'
  if (files.protected) return 'skip-protected'
  return 'apply'
}

/** Most tickets the orphan reconcile will transition per run. Same bound the
 *  out-of-band sweep uses, for the same reason: one digest cycle stays cheap. */
export const ORPHAN_RECONCILE_MAX = 5

export interface OrphanReconcileResult {
  /** Orphans considered (post-classification input count). */
  checked: number
  /** Ticket ids transitioned to `applied`. */
  applied: number[]
  /** Merged orphans left alone because their PR touched a protected path. */
  skippedProtected: number[]
  errors: string[]
  /** True when GitHub was unconfigured and nothing was attempted. */
  skipped: boolean
}

/**
 * Move merged-PR orphans off the live queue (#3582).
 *
 * Cost of not doing this, measured in the 2026-08-16 08:00 R-DEV pass: #1258
 * (PR #671 merged) and #3215 (PR #657 merged) both cycled approved/blocked ->
 * claim -> block -> owner re-approve, burning a claim per cycle, because the
 * janitor detected the orphan but nothing was allowed to act on it.
 *
 * Safety model, in order:
 *  - Only a `merged: true` from GitHub itself makes a candidate (the orphan
 *    classification upstream), so unmerged work can never be marked shipped.
 *  - Only the four statuses the map's fenced reconcile edges cover.
 *  - The PR's changed files are read from GitHub and classified against
 *    PROTECTED_GLOBS; any protected match (or an unreadable file list) skips
 *    the ticket — a protected-path merge was the owner's deliberate act and
 *    its ticket stays in the digest's Needs-Mike list for the owner.
 *  - The transition itself runs inside `runWithOutOfBandReconcile`, so it
 *    walks the map's `outOfBandReconcileOnly` edges as actor `system` exactly
 *    like the engine's sweep. No new edge, no bypass; a 409 (something else
 *    moved the row first) is swallowed as normal.
 */
export async function reconcileOrphanedTickets(
  opts: { maxApplied?: number } = {},
): Promise<OrphanReconcileResult> {
  const result: OrphanReconcileResult = {
    checked: 0, applied: [], skippedProtected: [], errors: [], skipped: false,
  }
  if (!isGithubConfigured()) return { ...result, skipped: true }
  const maxApplied = opts.maxApplied ?? ORPHAN_RECONCILE_MAX

  const readPr = createPrReadCache()
  let orphans: OrphanTicket[] = []
  try {
    orphans = (await gatherOrphans(readPr)).orphans
  } catch (err) {
    result.errors.push(`orphan gather failed: ${String(err).slice(0, 200)}`)
    return result
  }

  for (const orphan of orphans) {
    if (result.applied.length >= maxApplied) break
    result.checked += 1

    const prNumber = parsePrNumber(orphan.prRef)
    if (prNumber === null) continue

    let files: { ok: boolean; protected: boolean } = { ok: false, protected: true }
    if (orphan.prOutcome === 'merged' && RECONCILABLE_ORPHAN_STATUSES.includes(orphan.status)) {
      try {
        const res = await listPullRequestFiles(prNumber, 'ticket-janitor')
        files = res.ok
          ? { ok: true, protected: classifyChangedFiles(res.data).protected }
          : { ok: false, protected: true }
      } catch (err) {
        result.errors.push(`ticket #${orphan.ticketId}: file read failed: ${String(err).slice(0, 200)}`)
      }
    }

    const action = classifyOrphanReconcile(orphan, files)
    if (action === 'skip-protected') {
      result.skippedProtected.push(orphan.ticketId)
      continue
    }
    if (action !== 'apply') continue

    try {
      await runWithOutOfBandReconcile(() =>
        transitionSuggestion(orphan.ticketId, 'applied', 'system', {
          note:
            `orphan reconcile (#3582): PR #${prNumber} is merged per GitHub and touches no protected path, `
            + `so the fix is live while this ticket sat ${orphan.status}.`,
          links: [{ kind: 'pr', ref: orphan.prRef, state: 'merged' }],
        }),
      )
      result.applied.push(orphan.ticketId)
      console.log(`[ticket-janitor] orphan #${orphan.ticketId} applied: PR #${prNumber} merged`)
    } catch (err) {
      // 409 = the row moved underneath us (engine, sweep, or owner got there
      // first) — the normal race, not an error.
      const msg = String(err)
      if (!msg.includes('409')) {
        result.errors.push(`ticket #${orphan.ticketId}: ${msg.slice(0, 200)}`)
      }
    }
  }

  return result
}

/* ── Conflicted PRs: CI structurally cannot run ────────────────────────────── */

/**
 * Head-branch prefixes the release engine evaluates. Mirrors
 * `AGENT_BRANCH_PREFIXES` plus `REVERT_BRANCH_PREFIX` in
 * `release-engine.server.ts`, which is a protected file with a heavy module
 * graph (healthcheck, checkout probe, KV, email), so the janitor mirrors the
 * list rather than importing it. If the engine's list changes, change this in
 * the same PR.
 */
export const ELIGIBLE_BRANCH_PREFIXES: readonly string[] = [
  'agents/', 'ticket/', 'claude/', 'phase1/', 'tonight/', 'fix/', 'pm/', 'revert/pr-',
]

/**
 * The fixed explanation every conflicted-PR entry carries. Why it exists: a
 * merge-conflicted PR gets ZERO pull_request workflow runs on GitHub
 * (documented behavior, confirmed on PR #494), and the release engine already
 * classifies these as skip 'conflict' but parks them silently, so without this
 * line the next incident gets re-investigated as "Actions declined my
 * triggers".
 */
export const CONFLICTED_PR_EXPLANATION =
  'CI cannot run on a merge-conflicted PR: GitHub creates zero pull_request workflow runs for it, '
  + 'and the release engine parks it as a conflict skip. '
  + 'The fix is merging origin/main into the branch and rebuilding.'

export interface ConflictedPr {
  number: number
  title: string
  branch: string
  explanation: string
}

/** What the conflict classifier consumes; the gatherer maps PR reads to it. */
export interface ConflictCandidate {
  number: number
  title: string
  branch: string
  /** GitHub's computed mergeability; null while it is still computing. */
  mergeable: boolean | null
  /** 'dirty' is the conflict signal; the engine skips on exactly this. */
  mergeableState: string
}

/**
 * Pure conflict classification. A PR is conflicted when GitHub reports its
 * mergeable state as `dirty` (what the engine skips on) or `mergeable` as
 * explicitly false. A null/unknown mergeability never classifies: GitHub
 * computes it lazily, and unknown must never read as broken.
 */
export function classifyConflictedPrs(candidates: readonly ConflictCandidate[]): ConflictedPr[] {
  const out: ConflictedPr[] = []
  for (const c of candidates) {
    if (c.mergeableState === 'dirty' || c.mergeable === false) {
      out.push({ number: c.number, title: c.title, branch: c.branch, explanation: CONFLICTED_PR_EXPLANATION })
    }
  }
  return out
}

/* ── Routine liveness ──────────────────────────────────────────────────────── */

export type CadenceKind =
  | 'four-times-daily'
  | 'thrice-daily'
  | 'twice-daily'
  | 'daily'
  | 'twice-weekly'
  | 'weekly'

export interface RoutineCadence {
  routine: string
  /**
   * Team the run row is written under, or null to match on runType alone.
   * No entry uses null today: the one lane that did (the pricing sweep) never
   * wrote a run row, so it could only ever false-flag. See the NOTE below.
   */
  team: string | null
  runType: string
  kind: CadenceKind
  /** Human-readable schedule, UTC, for the digest line. */
  schedule: string
  /** Interval plus grace: 2h grace on dailies, 26h on weeklies. */
  maxGapHours: number
}

/**
 * R-DEV's passes are NOT evenly spaced: 10:00, 15:00 and 20:00 UTC give two 5h
 * daytime intervals and a 14h overnight one (20:00 to the next 10:00). The
 * symmetric twice-daily gap would false-flag it in the early digests. 14h plus
 * the 2h daily grace.
 *
 * Corrected 2026-08-24 (was 18+2, describing the retired 14:00/20:00 pair).
 */
const RDEV_GAP = 14 + 2
/**
 * R-QA runs 03:30, 11:30, 16:30 and 21:30 UTC. Longest interval is 21:30 to the
 * next 03:30, 6h, plus the 2h daily grace.
 */
const RQA_GAP = 6 + 2
const DAILY_GAP = 24 + 2
const WEEKLY_GAP = 168 + 26
/** Mon and Thu: the longest interval is Thu to Mon, 96h, plus weekly grace. */
const TWICE_WEEKLY_GAP = 96 + 26

/**
 * What should be running, as data. Mirrors `docs/store-team/routine-schedule.md`
 * as of 2026-08-07 (R-QA at two passes, the trend-scout/research triggers
 * created, the social trend scout trigger now enabled). If the manifest and
 * this table disagree, fix one of them in the same PR that moved the other.
 *
 * The podcast lane's playbook opens its run with runType 'manual', so its
 * liveness rides the manual bucket and is approximate by construction.
 */
export const ROUTINE_CADENCES: readonly RoutineCadence[] = [
  { routine: 'R-DEV daily dev', team: 'strategy', runType: 'dev', kind: 'thrice-daily', schedule: '10:00, 15:00 and 20:00 daily', maxGapHours: RDEV_GAP },
  { routine: 'R-QA daily QA gate', team: 'strategy', runType: 'qa', kind: 'four-times-daily', schedule: '03:30, 11:30, 16:30 and 21:30 daily', maxGapHours: RQA_GAP },
  { routine: 'Daily content writer', team: 'content', runType: 'content', kind: 'daily', schedule: '15:00 daily', maxGapHours: DAILY_GAP },
  { routine: 'Daily merchandiser (Routine A)', team: 'homepage', runType: 'merchandise', kind: 'daily', schedule: '10:00 daily', maxGapHours: DAILY_GAP },
  { routine: 'Daily social drafts', team: 'social', runType: 'social', kind: 'daily', schedule: '14:00 daily', maxGapHours: DAILY_GAP },
  { routine: 'Daily product manager', team: 'product', runType: 'product', kind: 'daily', schedule: '09:00 daily', maxGapHours: DAILY_GAP },
  // R-ENRICH (routine 24). Added 2026-08-24: it had no entry, so its total
  // failure on 08-23 and 08-24 (permission classifier blocked the run-start
  // call, leaving no run row at all) was invisible to every liveness check
  // while 136 products sat unenriched.
  { routine: 'Daily product enricher (R-ENRICH)', team: 'product', runType: 'enrich', kind: 'daily', schedule: '12:00 daily', maxGapHours: DAILY_GAP },
  // Support review (routine 21). routine-schedule.md says outright that a
  // missing run here is a fault, not expected-missing, but nothing watched it.
  { routine: 'Daily support review', team: 'support', runType: 'support', kind: 'daily', schedule: '16:30 daily', maxGapHours: DAILY_GAP },
  // NOTE: the daily pricing sweep is deliberately absent. It runs without a
  // team gate and has never written a run row of any runType, so an entry for
  // it flagged on every single sweep from the day it was added. A permanent
  // false positive is worse than no check: it teaches everyone to skim past
  // this list. Re-add it only once the routine actually opens a run row.
  { routine: 'Weekly strategy', team: 'strategy', runType: 'strategy', kind: 'weekly', schedule: 'Mon 12:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Apply pass (agent-editor)', team: 'strategy', runType: 'apply', kind: 'twice-weekly', schedule: 'Mon and Thu 22:00', maxGapHours: TWICE_WEEKLY_GAP },
  { routine: 'Cost review', team: 'strategy', runType: 'cost-review', kind: 'weekly', schedule: 'Mon 21:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Weekly off-site scout', team: 'strategy', runType: 'offsite', kind: 'weekly', schedule: 'Tue 16:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Ads Proposals', team: 'ads', runType: 'ads', kind: 'weekly', schedule: 'Tue 13:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Email Briefs', team: 'email', runType: 'email', kind: 'weekly', schedule: 'Tue 15:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Design Cycle (Routine B)', team: 'homepage', runType: 'design', kind: 'weekly', schedule: 'Wed 14:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Weekly SEO curation', team: 'content', runType: 'seo-curation', kind: 'weekly', schedule: 'Sun 19:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Weekly podcast review', team: 'content', runType: 'manual', kind: 'weekly', schedule: 'Wed 21:05', maxGapHours: WEEKLY_GAP },
  { routine: 'Weekly trend scout', team: 'content', runType: 'trend-scout', kind: 'weekly', schedule: 'Sat 19:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Weekly business research', team: 'social', runType: 'research', kind: 'weekly', schedule: 'Thu 16:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Weekly social trend scout', team: 'social', runType: 'social-trend-scout', kind: 'weekly', schedule: 'Mon 17:00', maxGapHours: WEEKLY_GAP },
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

/* ── Superseded approved code (tickets #3349, #3432, #253) ─────────────────── */

/**
 * Ticket statuses meaning "QA already has this, or it already shipped". A row
 * sharing an approved ticket's dedupe_key in one of these statuses is positive
 * evidence the approved row's work is already tracked or done. Deliberately a
 * separate literal from `TRACKED_SKIP_STATUSES` in
 * release-ticket-autofile.server.ts rather than an import: the two hygiene
 * checks are independently tunable and happen to agree today.
 */
export const ALREADY_COVERED_STATUSES: readonly string[] = ['pr_open', 'in_review', 'verified', 'applied']

/**
 * PR numbers a ticket's own body cites as already shipping its fix, e.g.
 * "already shipped and merged in PR #654", "PR #324 + #349", "PRs #319".
 * Requires the literal word PR/PRs immediately before the first `#`, so a bare
 * `#654` elsewhere in the ticket (most often a different ticket id, like
 * "ticket #3196") is never picked up on its own. A `+`/`,`/`&`-joined list of
 * further `#N` immediately after the first is also captured, for the "PR #324
 * + #349" convention ticket #253 itself uses.
 *
 * Purely a candidate extractor: the caller still confirms each number against
 * GitHub before treating it as evidence, and this is FLAG-only evidence even
 * then (see the module docstring). A wrong extraction here costs one spare
 * GitHub read, never a wrong close.
 */
export function extractCitedPrNumbers(text: string): number[] {
  const out = new Set<number>()
  const re = /\bPRs?\s*#(\d{1,6})((?:\s*[+,&]\s*#\d{1,6})*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[1]) out.add(Number(m[1]))
    const rest = m[2] ?? ''
    const numRe = /#(\d{1,6})/g
    let n: RegExpExecArray | null
    while ((n = numRe.exec(rest)) !== null) {
      if (n[1]) out.add(Number(n[1]))
    }
  }
  return [...out].sort((a, b) => a - b)
}

export type SupersededEvidence =
  | { kind: 'dedupe-key'; matchedTicketId: number; matchedStatus: string }
  | { kind: 'cited-pr-merged'; prNumber: number }

export interface SupersededTicket {
  ticketId: number
  suggestion: string
  evidence: SupersededEvidence[]
}

/** Human-readable evidence line for the digest. */
export function describeSupersededEvidence(e: SupersededEvidence): string {
  return e.kind === 'dedupe-key'
    ? `shares a dedupe key with #${e.matchedTicketId} (${e.matchedStatus})`
    : `cites PR #${e.prNumber}, which GitHub reports merged`
}

/** What the pure classifier consumes; the gatherer resolves both evidence
 *  sources (DB dedupe-key lookup, GitHub merged checks) before calling it. */
export interface SupersededCandidate {
  ticketId: number
  suggestion: string
  /** Another tracked-or-shipped row sharing this ticket's dedupe_key, if any. */
  dedupeMatch: { ticketId: number; status: string } | null
  /** PR numbers this ticket's text cites, each resolved against GitHub by the
   *  caller. `merged: null` means unread/unknown, never evidence. */
  citedPrs: ReadonlyArray<{ prNumber: number; merged: boolean | null }>
}

/**
 * Pure classification: an approved code ticket is flagged superseded when it
 * carries at least one piece of positive evidence. Never dismisses or blocks
 * anything itself — see the module docstring for why a status transition is
 * not available here, and the hard rule this exists to honor: FLAG a
 * suspected duplicate, never silently drop it.
 */
export function classifySupersededApprovedCode(
  candidates: readonly SupersededCandidate[],
): SupersededTicket[] {
  const out: SupersededTicket[] = []
  for (const c of candidates) {
    const evidence: SupersededEvidence[] = []
    if (c.dedupeMatch) {
      evidence.push({ kind: 'dedupe-key', matchedTicketId: c.dedupeMatch.ticketId, matchedStatus: c.dedupeMatch.status })
    }
    for (const cited of c.citedPrs) {
      if (cited.merged === true) evidence.push({ kind: 'cited-pr-merged', prNumber: cited.prNumber })
    }
    if (evidence.length > 0) out.push({ ticketId: c.ticketId, suggestion: c.suggestion, evidence })
  }
  return out
}

export interface TicketLoopHealth {
  generatedAt: string
  sla: SlaBreaches
  orphans: OrphanTicket[]
  /** True when GitHub was unreachable/unconfigured, so orphans is a floor. */
  orphanScanSkipped: boolean
  /** Open eligible-branch PRs GitHub reports merge-conflicted: CI cannot run
   *  on them at all. Empty when GitHub is unconfigured, so also a floor. */
  conflictedPrs: ConflictedPr[]
  backlog: BacklogTrajectory
  /** Routines whose last run row is older than cadence plus grace. */
  routineFlags: RoutineLivenessFlag[]
  /** Approved code tickets flagged as likely already shipped. FLAG only: see
   *  the module docstring for why this list is never auto-dismissed. */
  supersededApproved: SupersededTicket[]
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

/**
 * One capped, memoised PR reader shared by the orphan and conflict scans, so a
 * PR appearing in both costs one API call and the shared 20-read cap holds for
 * the whole health computation. This runs inside the digest cron and must stay
 * cheap even when the queue is a mess.
 */
function createPrReadCache(maxReads = MAX_GITHUB_READS) {
  const byNumber = new Map<number, PullRequestSummary | null>()
  return async function read(num: number): Promise<PullRequestSummary | null> {
    if (!byNumber.has(num)) {
      if (byNumber.size >= maxReads) return null
      const pr = await getPullRequest(num, 'ticket-janitor')
      byNumber.set(num, pr.ok ? pr.data : null)
    }
    return byNumber.get(num) ?? null
  }
}

type PrReader = ReturnType<typeof createPrReadCache>

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

async function gatherOrphans(readPr: PrReader): Promise<{ orphans: OrphanTicket[]; skipped: boolean }> {
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

  // One GitHub read per distinct PR through the shared capped cache: a PR the
  // cap excluded reads as null, which classifies as unknown, never as dead.
  const candidates: OrphanCandidate[] = []
  for (const row of rows) {
    const num = parsePrNumber(row.prRef)
    if (num === null) continue
    const pr = await readPr(num)
    candidates.push({ ...row, pr: pr ? { merged: pr.merged, state: pr.state } : null })
  }
  return { orphans: classifyOrphans(candidates), skipped: false }
}

async function gatherConflictedPrs(readPr: PrReader): Promise<ConflictedPr[]> {
  if (!isGithubConfigured()) return []

  const list = await listOpenPullRequests({
    headPrefixes: [...ELIGIBLE_BRANCH_PREFIXES],
    context: 'ticket-janitor',
  })
  if (!list.ok) return []

  // The list endpoint omits mergeable_state (GitHub computes it only on the
  // individual PR read), so each open eligible PR costs one read through the
  // same capped cache the orphan scan uses; overlapping PRs are free.
  const candidates: ConflictCandidate[] = []
  for (const pr of list.data) {
    const full = await readPr(pr.number)
    if (!full) continue
    candidates.push({
      number: full.number,
      title: full.title,
      branch: full.headRef,
      mergeable: full.mergeable,
      mergeableState: full.mergeableState,
    })
  }
  return classifyConflictedPrs(candidates)
}

/** Approved code tickets scanned per superseded sweep. Bounds the DB read; the
 *  GitHub reads it triggers are bounded separately by the shared PrReader cap. */
const SUPERSEDE_SCAN_LIMIT = 100

/**
 * Gathers evidence and classifies approved `code` tickets as likely
 * superseded. Two independent, additive evidence sources:
 *
 *   (a) dedupe-key match: a single extra query against the distinct dedupe
 *       keys the scanned rows carry, matched against ALREADY_COVERED_STATUSES.
 *       DB-only, no GitHub read.
 *   (b) cited-PR match: PR numbers extracted from each ticket's own text
 *       (extractCitedPrNumbers), resolved through the shared capped PrReader
 *       so a number cited by several tickets costs one GitHub read.
 *
 * Never touches ticket status. See the module docstring and
 * classifySupersededApprovedCode for why.
 */
async function gatherSupersededApprovedCode(readPr: PrReader): Promise<SupersededTicket[]> {
  const res = await db.execute(sql`
    SELECT id, suggestion, dedupe_key
      FROM homepage_team_suggestions
     WHERE status = 'approved' AND kind = 'code'
     ORDER BY id ASC
     LIMIT ${SUPERSEDE_SCAN_LIMIT}`)
  const approvedCode = ((res.rows ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: Number(r['id'] ?? 0),
    suggestion: String(r['suggestion'] ?? ''),
    dedupeKey: r['dedupe_key'] == null ? null : String(r['dedupe_key']),
  }))
  if (approvedCode.length === 0) return []

  // (a) dedupe-key evidence.
  const keys = [...new Set(approvedCode.map(r => r.dedupeKey).filter((k): k is string => !!k))]
  const dedupeMatchByKey = new Map<string, { ticketId: number; status: string }>()
  if (keys.length > 0) {
    const keyList = sql.join(keys.map(k => sql`${k}`), sql`, `)
    const statusList = sql.join(ALREADY_COVERED_STATUSES.map(s => sql`${s}`), sql`, `)
    const matchRes = await db.execute(sql`
      SELECT id, status, dedupe_key
        FROM homepage_team_suggestions
       WHERE dedupe_key IN (${keyList}) AND status IN (${statusList})`)
    for (const row of (matchRes.rows ?? []) as Array<Record<string, unknown>>) {
      const dedupeKey = row['dedupe_key'] == null ? null : String(row['dedupe_key'])
      if (!dedupeKey || dedupeMatchByKey.has(dedupeKey)) continue
      dedupeMatchByKey.set(dedupeKey, { ticketId: Number(row['id'] ?? 0), status: String(row['status'] ?? '') })
    }
  }

  // (b) cited-PR evidence, through the shared capped reader.
  const citedByTicket = new Map<number, number[]>()
  const allCited = new Set<number>()
  for (const r of approvedCode) {
    const nums = extractCitedPrNumbers(r.suggestion)
    if (nums.length > 0) {
      citedByTicket.set(r.id, nums)
      for (const n of nums) allCited.add(n)
    }
  }
  const mergedByNumber = new Map<number, boolean | null>()
  for (const num of allCited) {
    const pr = await readPr(num)
    mergedByNumber.set(num, pr ? pr.merged : null)
  }

  const candidates: SupersededCandidate[] = approvedCode.map(r => ({
    ticketId: r.id,
    suggestion: r.suggestion,
    dedupeMatch: r.dedupeKey ? dedupeMatchByKey.get(r.dedupeKey) ?? null : null,
    citedPrs: (citedByTicket.get(r.id) ?? []).map(n => ({ prNumber: n, merged: mergedByNumber.get(n) ?? null })),
  }))

  return classifySupersededApprovedCode(candidates)
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
    conflictedPrs: [],
    backlog: { created7d: 0, terminal7d: 0, netPerDay: 0 },
    routineFlags: [],
    supersededApproved: [],
  }

  const readPr = createPrReadCache()

  try {
    health.sla = classifySlaBreaches(await gatherSlaRows())
  } catch (err) {
    console.warn('[ticket-janitor] SLA sweep failed:', String(err).slice(0, 200))
  }
  try {
    const { orphans, skipped } = await gatherOrphans(readPr)
    health.orphans = orphans
    health.orphanScanSkipped = skipped
  } catch (err) {
    console.warn('[ticket-janitor] orphan scan failed:', String(err).slice(0, 200))
  }
  try {
    health.conflictedPrs = await gatherConflictedPrs(readPr)
  } catch (err) {
    console.warn('[ticket-janitor] conflicted-PR scan failed:', String(err).slice(0, 200))
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
  try {
    health.supersededApproved = await gatherSupersededApprovedCode(readPr)
  } catch (err) {
    console.warn('[ticket-janitor] superseded-approved scan failed:', String(err).slice(0, 200))
  }

  return health
}

/* ── Reconcile: refresh stale pr-link states ───────────────────────────────── */

export interface ReconcileResult {
  /** Distinct PRs actually read from GitHub. */
  checked: number
  updated: Array<{ linkId: number; ref: string; from: string | null; to: string }>
  /** New 'pr' links added for a just-closed link whose ticket has an open
   *  replacement PR on its own `ticket/<id>` branch (the agents/->ticket/
   *  re-file pattern). */
  adopted: Array<{ suggestionId: number; number: number; ref: string }>
  /** True when GitHub was unconfigured and nothing was attempted. */
  skipped: boolean
}

/**
 * Pure decision for `adoptReplacementPrLinks`: of the links just marked closed
 * unmerged, which have a live replacement PR on their own `ticket/<suggestionId>`
 * branch worth linking. A pick is made only when the open PR on that branch is a
 * DIFFERENT PR from the closed one and the ticket does not already link it.
 * Deduped within one pass. No I/O, so it is unit-tested directly.
 */
export function pickReplacementAdoptions(
  closed: ReadonlyArray<{ suggestionId: number; closedNumber: number }>,
  openTicketPrs: ReadonlyArray<{ number: number; headRef: string; htmlUrl: string }>,
  existingPrNumbersBySuggestion: ReadonlyMap<number, ReadonlySet<number>>,
): Array<{ suggestionId: number; number: number; ref: string }> {
  const byBranch = new Map<string, { number: number; htmlUrl: string }>()
  for (const pr of openTicketPrs) {
    // First open PR wins for a branch; a branch maps to one ticket by convention.
    if (!byBranch.has(pr.headRef)) byBranch.set(pr.headRef, { number: pr.number, htmlUrl: pr.htmlUrl })
  }
  const out: Array<{ suggestionId: number; number: number; ref: string }> = []
  const seen = new Set<string>()
  for (const { suggestionId, closedNumber } of closed) {
    const pr = byBranch.get(`ticket/${suggestionId}`)
    if (!pr || pr.number === closedNumber) continue
    if (existingPrNumbersBySuggestion.get(suggestionId)?.has(pr.number)) continue
    const key = `${suggestionId}:${pr.number}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ suggestionId, number: pr.number, ref: pr.htmlUrl })
  }
  return out
}

/**
 * When an autofiled ticket's PR is closed unmerged and the same work re-lands on
 * the ticket's own `ticket/<id>` branch (the agents/->ticket/ re-file that dodges
 * the agent-allowlist check: PR #844 -> #848 on branch `ticket/4878`, 2026-08-22),
 * the stored link is left pointing at the dead PR and QA has to rediscover the
 * live one, risking a false "PR closed, ticket stuck" bounce (#4890). This adopts
 * the OPEN replacement: for each just-closed link whose ticket has an open PR on
 * branch `ticket/<suggestionId>`, add a fresh 'open' pr link to it. Only open
 * replacements are adopted -- the sanctioned `listOpenPullRequests` helper cannot
 * see a merged/closed replacement by branch, and a merged replacement's ticket
 * STATUS is already reconciled by the out-of-band sweep's cited-PR fallback.
 * Writes only the link table, never a ticket status, preserving this module's
 * documented write boundary.
 */
async function adoptReplacementPrLinks(
  closed: Array<{ suggestionId: number; closedNumber: number }>,
): Promise<ReconcileResult['adopted']> {
  if (closed.length === 0) return []
  const open = await listOpenPullRequests({ headPrefixes: ['ticket/'], context: 'ticket-janitor' })
  if (!open.ok) return []

  // Existing pr-link numbers per affected ticket, so a replay never double-links.
  const suggestionIds = [...new Set(closed.map(c => c.suggestionId))]
  const existing = await db
    .select({ suggestionId: suggestionLinks.suggestionId, ref: suggestionLinks.ref })
    .from(suggestionLinks)
    .where(and(eq(suggestionLinks.kind, 'pr'), inArray(suggestionLinks.suggestionId, suggestionIds)))
  const existingBySugg = new Map<number, Set<number>>()
  for (const row of existing) {
    const n = parsePrNumber(row.ref)
    if (n === null) continue
    const set = existingBySugg.get(row.suggestionId) ?? new Set<number>()
    set.add(n)
    existingBySugg.set(row.suggestionId, set)
  }

  const picks = pickReplacementAdoptions(closed, open.data, existingBySugg)
  for (const pick of picks) {
    await db.insert(suggestionLinks).values({
      suggestionId: pick.suggestionId,
      kind: 'pr',
      ref: pick.ref,
      state: 'open',
    })
  }
  return picks
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
  if (!isGithubConfigured()) return { checked: 0, updated: [], adopted: [], skipped: true }
  const maxChecks = opts.maxChecks ?? MAX_GITHUB_READS

  const links = await db
    .select({
      id: suggestionLinks.id,
      ref: suggestionLinks.ref,
      state: suggestionLinks.state,
      suggestionId: suggestionLinks.suggestionId,
    })
    .from(suggestionLinks)
    .where(and(
      eq(suggestionLinks.kind, 'pr'),
      or(isNull(suggestionLinks.state), notInArray(suggestionLinks.state, ['merged', 'closed'])),
    ))
    .limit(200)

  const byNumber = new Map<number, { merged: boolean; state: string } | null>()
  const updated: ReconcileResult['updated'] = []
  const closed: Array<{ suggestionId: number; closedNumber: number }> = []

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
    if (next === 'closed') closed.push({ suggestionId: link.suggestionId, closedNumber: num })
  }

  const adopted = await adoptReplacementPrLinks(closed)

  return { checked: byNumber.size, updated, adopted, skipped: false }
}

/* ── Weekly blocked-ticket digest (#2863) ──────────────────────────────────── */

function digestEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function digestClip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`
}

export interface BlockedDigestRow {
  id: number
  kind: string
  priority: number
  ageHours: number
  suggestion: string
  /** The single question or action that would clear this block, derived from
   *  `lastError`/the note text, or the literal string below when neither
   *  carries a reason. */
  unblockQuestion: string
}

export interface BlockedDigestGroup {
  priority: number
  rows: BlockedDigestRow[]
}

export interface BlockedDigest {
  generatedAt: string
  totalCount: number
  /** Rows with no `lastError` and no note: parked without a reason. */
  reasonUnknownCount: number
  /** Ascending by priority (1 = highest). Each group's rows are oldest first. */
  byPriority: BlockedDigestGroup[]
}

/** The literal marker for a block that carries no reason anywhere (mirrors
 *  `BlockedTicket.emptyReason`), so a silent park is visible as exactly that
 *  rather than smoothed into a vague summary. */
export const REASON_UNKNOWN = 'REASON UNKNOWN: no last_error and no note recorded on this row.'

/**
 * Turn a blocked ticket's reason text into the one question or action that
 * would clear it. Heuristic only, never authoritative — it recognizes the
 * phrasing R-DEV's own blocks already use (protected-path escalations,
 * migration asks, explicit owner asks) and otherwise echoes the reason
 * verbatim, clipped. `REASON_UNKNOWN` covers the emptyReason case.
 */
export function deriveUnblockQuestion(b: BlockedTicket): string {
  const reason = (b.lastError?.trim() || b.noteRef?.trim() || '')
  if (!reason) return REASON_UNKNOWN
  if (/protected path/i.test(reason)) {
    return `Owner-authored change needed (protected path): ${digestClip(reason, 160)}`
  }
  if (/\bmigration\b/i.test(reason)) {
    return `Owner needs to apply a migration: ${digestClip(reason, 160)}`
  }
  if (/\bowner\b/i.test(reason)) {
    return `Needs an owner decision: ${digestClip(reason, 160)}`
  }
  return digestClip(reason, 160)
}

/**
 * Pure digest builder: group blocked rows by priority (ascending, 1 highest),
 * oldest-first within each group, with a derived unblock question per row.
 * Every row that comes in is represented in exactly one output row — nothing
 * here may drop a blocked ticket, since a dropped row is the exact silent
 * parking-lot failure #2863 exists to fix.
 */
export function buildBlockedDigest(rows: readonly BlockedTicket[], now: Date = new Date()): BlockedDigest {
  const byPriority = new Map<number, BlockedDigestRow[]>()
  let reasonUnknownCount = 0
  for (const b of rows) {
    if (b.emptyReason) reasonUnknownCount += 1
    const priority = b.priority ?? 3
    const row: BlockedDigestRow = {
      id: b.id,
      kind: b.kind,
      priority,
      ageHours: b.ageHours,
      suggestion: b.suggestion,
      unblockQuestion: deriveUnblockQuestion(b),
    }
    const list = byPriority.get(priority) ?? []
    list.push(row)
    byPriority.set(priority, list)
  }
  const byPriorityGroups: BlockedDigestGroup[] = [...byPriority.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([priority, groupRows]) => ({
      priority,
      rows: [...groupRows].sort((a, b) => b.ageHours - a.ageHours),
    }))
  return {
    generatedAt: now.toISOString(),
    totalCount: rows.length,
    reasonUnknownCount,
    byPriority: byPriorityGroups,
  }
}

/**
 * Approximate weekly bucket key for the send-once KV guard: `${year}-W${n}`,
 * n = days since Jan 1 of that year divided by 7. Not calendar-precise ISO
 * week numbering (no need — this only has to be stable within one calendar
 * week and roll over once a week), kept simple and pure so it is testable
 * without a clock library.
 */
export function weekBucketKey(date: Date): string {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  const diffDays = Math.floor((date.getTime() - start) / 86_400_000)
  const week = Math.floor(diffDays / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function blockedDigestSubject(digest: BlockedDigest): string {
  const reasonSuffix = digest.reasonUnknownCount > 0 ? `, ${digest.reasonUnknownCount} REASON UNKNOWN` : ''
  return `xdipx blocked-ticket digest: ${digest.totalCount} row${digest.totalCount === 1 ? '' : 's'}${reasonSuffix}`
}

/** Renders the weekly blocked-ticket email. Pure HTML string, no send side
 *  effect, so it is testable without mocking the mail transport. */
export function renderBlockedDigestEmail(digest: BlockedDigest): string {
  if (digest.totalCount === 0) {
    return '<p>No blocked tickets this week. The parking lot is empty.</p>'
  }
  const summary = `<p>${digest.totalCount} blocked ticket${digest.totalCount === 1 ? '' : 's'}`
    + `${digest.reasonUnknownCount > 0 ? `, <strong>${digest.reasonUnknownCount} with REASON UNKNOWN</strong>` : ''}.</p>`
  const groups = digest.byPriority.map(g => {
    const rows = g.rows.map(r => (
      `<li><strong>#${r.id}</strong> (${digestEsc(r.kind)}, ${r.ageHours}h old) `
      + `${digestEsc(digestClip(r.suggestion, 90))}<br>`
      + `<span style="color:#6f645c;">${digestEsc(digestClip(r.unblockQuestion, 200))}</span></li>`
    )).join('')
    return `<h3>Priority ${g.priority} (${g.rows.length})</h3><ul style="margin:0 0 10px;padding-left:18px;">${rows}</ul>`
  }).join('')
  return summary + groups
}

/** Every blocked ticket, whatever its age or kind. Reuses `gatherSlaRows` and
 *  `classifySlaBreaches` rather than a second query, so the priority field and
 *  the age/reason computation can never drift from the daily digest's. */
async function gatherBlockedTickets(now: Date = new Date()): Promise<BlockedTicket[]> {
  const rows = await gatherSlaRows()
  return classifySlaBreaches(rows, now).blocked
}

/** KV key prefix for the weekly send-once guard. */
export const BLOCKED_DIGEST_KV_PREFIX = 'blocked-digest:sent:'

export interface BlockedDigestRunResult {
  sent: boolean
  skipped?: string
  totalCount: number
  reasonUnknownCount: number
}

/**
 * Build and send the weekly blocked-ticket digest (#2863). NOT wired to a
 * cron schedule: `vercel.json` and `server/cron*.ts` are protected paths this
 * module cannot touch. Call this manually to verify (see the PR description
 * for the exact one-line remainder needed to register `0 13 * * 1`), or from
 * the owner-digest cron's Monday branch once that lands.
 *
 * KV-guarded once per calendar week (see `weekBucketKey`), the same
 * once-per-period pattern `runOwnerDigest` uses daily. `force: true` bypasses
 * the guard for manual testing. Sends nothing when there are zero blocked
 * rows, same as a clean bill of health needs no email.
 */
export async function runBlockedTicketDigest(
  opts: { force?: boolean; now?: Date } = {},
): Promise<BlockedDigestRunResult> {
  const now = opts.now ?? new Date()

  if (!opts.force) {
    const key = `${BLOCKED_DIGEST_KV_PREFIX}${weekBucketKey(now)}`
    const first = await kvSetNX(key, String(Date.now()), 8 * 24 * 3600)
    if (!first) {
      return { sent: false, skipped: 'already sent this week (pass force=true to re-send)', totalCount: 0, reasonUnknownCount: 0 }
    }
  }

  const rows = await gatherBlockedTickets(now)
  const digest = buildBlockedDigest(rows, now)

  if (digest.totalCount === 0) {
    return { sent: false, skipped: 'no blocked tickets', totalCount: 0, reasonUnknownCount: 0 }
  }

  const result = await sendOwnerEmail(
    blockedDigestSubject(digest),
    renderBlockedDigestEmail(digest),
    { escalation: 'blocker-list' },
  )
  return { sent: result.sent, totalCount: digest.totalCount, reasonUnknownCount: digest.reasonUnknownCount }
}
