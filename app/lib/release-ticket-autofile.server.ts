/**
 * ADR-008 step 2: give a ticket-less PR a ticket, so the release engine is
 * allowed to look at it.
 *
 * ## Why this file exists at all
 *
 * `evaluatePullRequest` refuses to merge an eligible PR without a linked ticket
 * in status `verified`. That rule is correct and is not changed here. The
 * problem it creates is upstream: work born in an owner-attended Claude Code
 * session produces a branch and a PR but never touches the bus, so the PR can
 * never acquire the ticket the engine demands, and the owner merges it by hand
 * forever. Measured on 2026-07-30, 35 of the last 60 merged PRs were on eligible
 * branches carrying no ticket reference at all.
 *
 * ## Why it is a separate file
 *
 * `release-engine.server.ts` is a protected path, so every future tuning of this
 * logic would otherwise cost the owner a hand-merge. Keeping the tunable part
 * here means it travels the normal release lane like any other change. The
 * engine holds exactly one call into this module.
 *
 * ## Where the skip list went
 *
 * ADR-008 specified a list of conditions to skip: reverts, drafts, `needs-owner`,
 * protected paths, the docs carve-out, and PRs that already resolve a ticket.
 * None of them are re-implemented here. Calling this at the single point where
 * `evaluatePullRequest` has already returned `no-ticket` gets all of them for
 * free, because each one produces a different decision code earlier in that
 * function:
 *
 * | ADR skip condition        | already handled by                       |
 * |---------------------------|------------------------------------------|
 * | revert branch             | `revert` bypasses the ticket check        |
 * | draft                     | `code: 'draft'`                          |
 * | `needs-owner` label       | `code: 'needs-owner-label'`               |
 * | protected path            | `action: 'escalate-protected'`            |
 * | docs-only on `agents/*`   | `docsCarveOut` skips the ticket check     |
 * | already has a ticket      | `code: 'ticket-not-verified'`             |
 *
 * Re-deriving them here would be a second copy of the gate order, free to drift
 * from the real one. The single caller is the enforcement point instead.
 *
 * One consequence worth stating: a PR with red CI never reaches the ticket check,
 * so it gets no ticket until CI goes green. That is intended. So is the draft
 * case: `claude/*` is not in the auto-undraft lane, so an owner draft stays
 * ticket-less until it is marked ready for review, which is the moment the work
 * stops being work-in-progress.
 */

import { and, eq, inArray, like, sql } from 'drizzle-orm'

import { db } from '~/lib/db.server'
import { homepageTeamSuggestions, suggestionLinks } from '../../db/schema'
import { getPullRequest } from '~/lib/github.server'
import { autofileDedupeKey, fileTicketForOpenPr, transitionSuggestion } from '~/lib/team.server'

const LOG = '[release-autofile]'

/** `dedupe_key` prefix that marks a row this module created. The abandoned-PR
 *  sweep matches on it so it can never retire a ticket it did not file. */
export const AUTOFILE_DEDUPE_PREFIX = 'autofile:pr-'

export interface AutofiledTicket {
  prNumber: number
  ticketId: number
  /** False when an existing live ticket already held this PR's dedupe key. */
  created: boolean
}

/**
 * In-flight autofile executions, keyed by PR number. Two release-engine cycles
 * can overlap on the same warm serverless instance (a slow cycle running into
 * the next ten-minute tick), and each would otherwise run the full pre-check (a
 * GitHub read plus a bus read) and attempt the insert for the same PR. This map
 * collapses concurrent same-process invocations for one PR onto a single
 * execution, so exactly one ticket-file attempt happens and both callers observe
 * the same result (ticket #3775).
 *
 * This is the in-process complement to the cross-process guard, not a
 * replacement for it: a duplicate ROW is already impossible across processes
 * because `fileTicketForOpenPr` inserts under the partial unique index
 * `uq_team_sugg_dedupe_key` (migration 070, `WHERE dedupe_key IS NOT NULL AND
 * status NOT IN ('applied','dismissed')`) with `onConflictDoNothing()`, so a
 * second insert of the same `autofile:pr-N` key while a live row exists is a
 * no-op that returns 0. Coalescing additionally spares the redundant pre-check
 * API calls and makes "exactly one file" deterministic and unit-testable.
 */
const inFlightAutofiles = new Map<number, Promise<AutofiledTicket | null>>()

/**
 * File a ticket for one PR the engine just declined for `no-ticket`.
 *
 * Returns the ticket, or null when nothing was written (dry run, or the insert
 * was deduped and no live row came back). Never throws: a failure here must not
 * take down the release cycle, since the cycle's real job is merging and this is
 * a convenience that can retry in ten minutes.
 *
 * Concurrent invocations for the same PR number are coalesced onto one execution
 * (see `inFlightAutofiles`) so a pair of overlapping cycles cannot both run the
 * pre-check and file; they share one result.
 */
export async function autoFileTicketForPr(
  pr: { number: number; title: string; htmlUrl: string; headRef: string },
  dryRun = false,
): Promise<AutofiledTicket | null> {
  if (dryRun) {
    console.log(`${LOG} [dry-run] would file a ticket for PR #${pr.number} (${pr.headRef})`)
    return null
  }

  // Coalesce concurrent same-process invocations for this PR onto one run. The
  // map is written synchronously before returning, so a second call that arrives
  // before the first settles observes the in-flight promise rather than starting
  // its own pre-check + insert (ticket #3775).
  const inFlight = inFlightAutofiles.get(pr.number)
  if (inFlight) return inFlight

  const run = fileTicketForPrUncoalesced(pr).finally(() => {
    inFlightAutofiles.delete(pr.number)
  })
  inFlightAutofiles.set(pr.number, run)
  return run
}

async function fileTicketForPrUncoalesced(
  pr: { number: number; title: string; htmlUrl: string; headRef: string },
): Promise<AutofiledTicket | null> {
  // Ticket #3302. Two redundant-autofile guards. Both fail toward filing: this
  // module is the safety net that keeps a ticket-less PR from stranding on the
  // owner, so a guard that cannot decide must never suppress the ticket. A
  // missed skip costs one redundant row R-DEV blocks; a missed file re-strands
  // the PR on the owner's merge button, which is the failure this file exists
  // to prevent.

  // (b) A live or applied ticket already tracks this PR number, so QA already
  // has it (or it already shipped). A second pr_open row just makes R-DEV claim
  // and block it, burning a claim against its 5-per-pass cap. Observed on
  // 2026-08-15 run 321 for PRs #654/#655, whose real tickets were already
  // applied / pr_open.
  try {
    if (await prAlreadyTracked(pr.number)) {
      console.log(
        `${LOG} not filing PR #${pr.number}: already tracked by a pr_open/in_review/verified/applied ticket`,
      )
      return null
    }
  } catch (err) {
    console.warn(`${LOG} tracked-ticket check failed for PR #${pr.number}; proceeding to file`, err)
  }

  // (a) The PR already merged. A pr_open ticket asking QA to gate an already
  // landed PR is pure noise; a merged PR belongs to sweepOutOfBandMerges and its
  // real applied ticket, not to this fallback. Protected-path PRs never reach
  // here (the engine escalates them before the ticket check), so this does not
  // change their escalation.
  try {
    const res = await getPullRequest(pr.number, 'release-engine')
    if (res.ok && res.data.merged) {
      console.log(`${LOG} not filing PR #${pr.number}: already merged, no pr_open ticket needed`)
      return null
    }
  } catch (err) {
    console.warn(`${LOG} merged-state check failed for PR #${pr.number}; proceeding to file`, err)
  }

  try {
    const ticketId = await fileTicketForOpenPr({
      prNumber: pr.number,
      prUrl:    pr.htmlUrl,
      prTitle:  pr.title,
      headRef:  pr.headRef,
    })
    if (ticketId === 0) {
      // Already filed on an earlier cycle and still live. Silent by design:
      // this is the steady state for every cycle between filing and QA.
      return null
    }
    console.log(
      `${LOG} filed ticket #${ticketId} at pr_open for PR #${pr.number} (${pr.headRef}), awaiting QA`,
    )
    return { prNumber: pr.number, ticketId, created: true }
  } catch (err) {
    console.warn(`${LOG} could not file a ticket for PR #${pr.number}`, err)
    return null
  }
}

/**
 * Retire auto-filed tickets whose PR was closed without being merged.
 *
 * The symmetric counterpart to `sweepOutOfBandMerges`. That one recognises work
 * that shipped; this one recognises work that was abandoned. Without it every
 * closed-unmerged PR leaves a ticket parked at `pr_open` forever, and QA spends
 * passes reviewing PRs that no longer exist.
 *
 * Restricted twice over. The query only selects rows whose `dedupe_key` carries
 * the autofile prefix, so a ticket an agent or the owner filed is out of scope
 * no matter what its PR did. And a row is only retired after GitHub reports the
 * PR `closed` with `merged !== true` — a merged PR is left alone for
 * `sweepOutOfBandMerges` to move to `applied`, which is the opposite verdict and
 * belongs to the other sweep.
 */
export async function dismissTicketsForClosedUnmergedPrs(
  dryRun = false,
): Promise<{ checked: number; dismissed: number; errors: string[] }> {
  const out = { checked: 0, dismissed: 0, errors: [] as string[] }

  let rows: { id: number; dedupeKey: string | null }[] = []
  try {
    rows = await db
      .select({ id: homepageTeamSuggestions.id, dedupeKey: homepageTeamSuggestions.dedupeKey })
      .from(homepageTeamSuggestions)
      .where(and(
        eq(homepageTeamSuggestions.status, 'pr_open'),
        like(homepageTeamSuggestions.dedupeKey, `${AUTOFILE_DEDUPE_PREFIX}%`),
      ))
      .orderBy(sql`${homepageTeamSuggestions.id} ASC`)
      .limit(50)
  } catch (err) {
    out.errors.push(`cannot list auto-filed tickets: ${String(err)}`)
    return out
  }

  for (const row of rows) {
    const prNumber = prNumberFromAutofileKey(row.dedupeKey)
    if (prNumber === null) continue
    out.checked += 1

    const res = await getPullRequest(prNumber, 'release-engine')
    // Fail closed: an API error is not evidence the PR was abandoned. Leave the
    // ticket where it is and try again on the next sweep.
    if (!res.ok) {
      out.errors.push(`PR #${prNumber}: ${res.error}`)
      continue
    }
    if (res.data.state !== 'closed') continue
    if (res.data.merged) continue  // sweepOutOfBandMerges owns this one

    if (dryRun) {
      console.log(`${LOG} [dry-run] would dismiss ticket #${row.id} (PR #${prNumber} closed unmerged)`)
      continue
    }
    try {
      await transitionSuggestion(row.id, 'dismissed', 'system', {
        note: `PR #${prNumber} was closed without being merged, so this auto-filed ticket has no work left to track.`,
      })
      out.dismissed += 1
      console.log(`${LOG} dismissed ticket #${row.id}, PR #${prNumber} closed unmerged`)
    } catch (err) {
      out.errors.push(`ticket #${row.id}: ${String(err)}`)
    }
  }
  return out
}

/** Recover the PR number from an autofile dedupe key. Null when the key is not
 *  one of ours or has been tampered with into an unparseable shape. */
export function prNumberFromAutofileKey(key: string | null | undefined): number | null {
  if (!key || !key.startsWith(AUTOFILE_DEDUPE_PREFIX)) return null
  const raw = key.slice(AUTOFILE_DEDUPE_PREFIX.length)
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * Ticket statuses that mean "QA already has this PR, or it already shipped".
 * An autofile for a PR one of these already links is redundant work, so it is
 * skipped (ticket #3302). `blocked` and `dismissed` are deliberately absent: a
 * PR whose only tracker was killed may still need a fresh path to QA.
 */
const TRACKED_SKIP_STATUSES: string[] = ['pr_open', 'in_review', 'verified', 'applied']

/**
 * True when a suggestion in a tracked status already links `prNumber` through a
 * pr-kind suggestion link. Mirrors `resolveTicketForPr`'s direct-link match,
 * kept local rather than imported to avoid an import cycle with the protected
 * release-engine module, which imports this file.
 */
async function prAlreadyTracked(prNumber: number): Promise<boolean> {
  const rows = await db
    .select({ ref: suggestionLinks.ref })
    .from(suggestionLinks)
    .innerJoin(homepageTeamSuggestions, eq(suggestionLinks.suggestionId, homepageTeamSuggestions.id))
    .where(
      and(
        eq(suggestionLinks.kind, 'pr'),
        inArray(homepageTeamSuggestions.status, TRACKED_SKIP_STATUSES),
        sql`${suggestionLinks.ref} LIKE ${'%/pull/' + prNumber} OR ${suggestionLinks.ref} = ${'#' + prNumber}`,
      ),
    )
    .limit(20)
  // The LIKE is end-anchored, but re-parse to be certain a ref for /pull/4940
  // is never counted as a match for PR 494.
  return rows.some((r) => prNumberFromLinkRef(r.ref) === prNumber)
}

/**
 * PR number out of a suggestion-link ref (`<url>/pull/N` or `#N`). A local pure
 * copy of the release-engine parser; see prAlreadyTracked for why it is not
 * imported.
 */
export function prNumberFromLinkRef(ref: string): number | null {
  const m = /(?:\/pull\/|#)(\d{1,9})\b/.exec(ref)
  if (!m || !m[1]) return null
  const n = Number(m[1])
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Re-exported so callers building a key do not need to reach into
 *  team.server.ts, which is a protected path and should stay a thin surface. */
export { autofileDedupeKey }
