/**
 * Closes tickets whose fix shipped without the release engine merging it.
 *
 * The ticket bus can only reach `applied` through the engine: the transition
 * map gives that edge to actor `system` alone, because `applied` is supposed to
 * mean "merged, deployed, and smoke-checked". When the owner merges an agent PR
 * by hand — which is every merge made while `release_engine_enabled` was off,
 * and any merge the engine skips — the fix is live in production but the ticket
 * stays `verified` forever. Tickets #43 and #70 shipped on 2026-07-29 and were
 * stranded exactly this way, and zero code tickets had ever reached `applied`.
 *
 * This sweep is the reconciliation step: for a stranded ticket, ask GitHub
 * whether the linked PR is already merged, and if so record the truth. It can
 * only ever close a ticket whose PR GitHub itself reports as merged, so there is
 * no path here to mark unmerged work as shipped.
 *
 * `verified` was originally the only status swept, which assumed every ticket
 * reaches the engine through QA. Most do not: a hand-merged PR leaves its ticket
 * wherever it stood at merge time, and for R-DEV's work that is usually
 * `pr_open`. Tickets #291, #323 and #441 sat in `pr_open` with their PRs live in
 * production, invisible to both this sweep and the digest's stranded count.
 * See SWEEPABLE_STATUSES.
 *
 * A second stranding mode has the same cause but no link to follow. The
 * candidate query used to join through `suggestion_links`, so a ticket moved to
 * `pr_open` without a PR link produced no candidate and could never be closed,
 * even after its fix shipped. Tickets #432, #433 and #434 shipped in PR #417 and
 * sat stranded exactly this way. For those the sweep falls back to searching
 * merged PRs for one whose title or body references the ticket id (the R-DEV
 * convention is `agents: ticket #<id>: ...`). A single confident match is
 * treated identically to a linked candidate; zero or more than one match does
 * nothing, so the fallback can never guess. See findStrandedLinklessTickets and
 * findMergedPrForTicket.
 *
 * A third stranding mode has a link, just not the one the first query reads.
 * `markSuggestion` (the legacy `op:'mark'` path agent-editor's docs/instructions
 * loop uses) writes the PR URL straight into the `apply_ref` column and never
 * writes a `suggestion_links` 'pr' row. A ticket marked this way at
 * `approved -> pr_open` and then carried the rest of the way by the ordinary QA
 * lifecycle (`pr_open -> in_review -> verified`) ends up `verified` with a
 * populated `apply_ref` and zero `suggestion_links` rows: invisible to the first
 * query (no link to inner-join on) and only reachable by the second query's
 * fuzzy text search (and only if the merged PR happens to say "ticket #<id>" in
 * its title or body, which agent-editor's PRs do not reliably do). Ticket #2619
 * sat exactly this way for 3 days after its PR #635 merged. `apply_ref` is
 * stronger evidence than a text search — it was written deliberately, by the
 * transition that opened the PR — so findStrandedApplyRefTickets reads it
 * directly and is tried before the fuzzy fallback. See
 * findStrandedApplyRefTickets.
 *
 * Lives outside release-engine.server.ts on purpose. The engine's own file
 * documents a fixed safety model at the top and is a protected path; keeping
 * the query, the cap, and the transition here means the cadence and matching
 * rules can be tuned through the normal reviewed-PR lane instead of needing an
 * owner-merged change every time.
 */

import { and, desc, eq, inArray, isNotNull, lt, notExists, sql } from 'drizzle-orm'
import { db } from './db.server'
import { homepageTeamSuggestions, suggestionLinks } from '../../db/schema'
import { getGithubConfig, getPullRequest, githubRequest, type PullRequestSummary } from './github.server'
import { prNumberFromRef } from './release-engine.server'
import { transitionSuggestion } from './team.server'

const LOG = '[out-of-band-sweep]'

/** Tickets closed per sweep. Bounds the GitHub calls one cycle can make. */
export const SWEEP_MAX_TICKETS = 5

/**
 * Grace period before a verified ticket is considered stranded. The engine
 * normally merges within a cycle or two; sweeping immediately would race it
 * and re-query PRs that are about to be handled properly.
 */
export const SWEEP_MIN_AGE_MINUTES = 60

/**
 * Statuses a ticket can be stranded in when its PR merges without the engine.
 *
 * `verified` was the original and only case, on the assumption that everything
 * reaches `applied` through QA. It does not. When the owner merges a PR by hand
 * the ticket never leaves the status it was in at merge time, and for R-DEV's
 * work that is `pr_open` (QA has not looked yet) or `in_review` (QA is midway).
 * Both are terminal in practice: the only other exits are a QA verdict on a PR
 * that no longer exists, or an owner dismissal.
 *
 * `in_progress` is deliberately excluded. A ticket there has an active lease and
 * an assignee mid-edit; a PR link on it may be a superseded earlier attempt, and
 * closing it out from under the agent would race real work. Lease expiry already
 * returns those to `approved`.
 */
export const SWEEPABLE_STATUSES = ['verified', 'in_review', 'pr_open'] as const

export interface SweepResult {
  checked: number
  applied: number[]
  errors: string[]
}

interface Candidate {
  ticketId: number
  prNumber: number
  /** The `suggestion_links` ref this candidate came from. Absent for a link-less
   *  candidate resolved by searching merged PRs, which has no link row to flip. */
  prRef?: string
}

/**
 * Stranded tickets older than the grace period, paired with the most recent PR
 * they link. Oldest first: the longest-stranded ticket is the one most likely
 * to be genuinely merged.
 */
export async function findStrandedVerifiedTickets(limit = SWEEP_MAX_TICKETS): Promise<Candidate[]> {
  const cutoff = new Date(Date.now() - SWEEP_MIN_AGE_MINUTES * 60_000)

  const rows = await db
    .select({
      ticketId: homepageTeamSuggestions.id,
      ref: suggestionLinks.ref,
      linkedAt: suggestionLinks.createdAt,
    })
    .from(homepageTeamSuggestions)
    .innerJoin(suggestionLinks, eq(suggestionLinks.suggestionId, homepageTeamSuggestions.id))
    .where(and(
      inArray(homepageTeamSuggestions.status, [...SWEEPABLE_STATUSES]),
      eq(suggestionLinks.kind, 'pr'),
      lt(homepageTeamSuggestions.updatedAt, cutoff),
    ))
    .orderBy(homepageTeamSuggestions.updatedAt, desc(suggestionLinks.createdAt))

  const seen = new Set<number>()
  const out: Candidate[] = []
  for (const row of rows) {
    if (seen.has(row.ticketId)) continue
    const prNumber = prNumberFromRef(row.ref)
    if (prNumber === null) continue
    seen.add(row.ticketId)
    out.push({ ticketId: row.ticketId, prNumber, prRef: row.ref })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Stranded tickets older than the grace period that carry no `pr` link at all.
 * These are invisible to findStrandedVerifiedTickets, whose inner join drops any
 * row without a link. Returns bare ticket ids, oldest first; the caller resolves
 * each to a PR by searching merged PRs.
 */
export async function findStrandedLinklessTickets(limit = SWEEP_MAX_TICKETS): Promise<number[]> {
  const cutoff = new Date(Date.now() - SWEEP_MIN_AGE_MINUTES * 60_000)

  const rows = await db
    .select({ ticketId: homepageTeamSuggestions.id })
    .from(homepageTeamSuggestions)
    .where(and(
      inArray(homepageTeamSuggestions.status, [...SWEEPABLE_STATUSES]),
      lt(homepageTeamSuggestions.updatedAt, cutoff),
      notExists(
        db
          .select({ one: sql`1` })
          .from(suggestionLinks)
          .where(and(
            eq(suggestionLinks.suggestionId, homepageTeamSuggestions.id),
            eq(suggestionLinks.kind, 'pr'),
          )),
      ),
    ))
    .orderBy(homepageTeamSuggestions.updatedAt)
    .limit(limit)

  return rows.map((r) => r.ticketId)
}

/**
 * Stranded tickets tracked only through the legacy `apply_ref` column (the
 * `op:'mark'` path), older than the grace period, with no `suggestion_links`
 * 'pr' row at all. Distinct from findStrandedLinklessTickets: that function
 * also selects link-less rows, but resolves them by a fuzzy PR-body text
 * search; this one reads the PR the ticket itself already names, which is
 * strictly stronger evidence. Returns bare candidates with no `prRef`, same
 * as the link-less path, since there is no link row to reconcile.
 */
export async function findStrandedApplyRefTickets(limit = SWEEP_MAX_TICKETS): Promise<Candidate[]> {
  const cutoff = new Date(Date.now() - SWEEP_MIN_AGE_MINUTES * 60_000)

  const rows = await db
    .select({ ticketId: homepageTeamSuggestions.id, applyRef: homepageTeamSuggestions.applyRef })
    .from(homepageTeamSuggestions)
    .where(and(
      inArray(homepageTeamSuggestions.status, [...SWEEPABLE_STATUSES]),
      isNotNull(homepageTeamSuggestions.applyRef),
      lt(homepageTeamSuggestions.updatedAt, cutoff),
      notExists(
        db
          .select({ one: sql`1` })
          .from(suggestionLinks)
          .where(and(
            eq(suggestionLinks.suggestionId, homepageTeamSuggestions.id),
            eq(suggestionLinks.kind, 'pr'),
          )),
      ),
    ))
    .orderBy(homepageTeamSuggestions.updatedAt)
    .limit(limit)

  const out: Candidate[] = []
  for (const row of rows) {
    if (!row.applyRef) continue
    const prNumber = prNumberFromRef(row.applyRef)
    if (prNumber === null) continue
    out.push({ ticketId: row.ticketId, prNumber })
  }
  return out
}

/**
 * Decide from a PR summary whether its ticket shipped out of band. Pure, so
 * the rule is testable without GitHub: merged means shipped, anything else
 * (open, closed-unmerged) leaves the ticket alone.
 */
export function isMergedOutOfBand(pr: Pick<PullRequestSummary, 'merged'>): boolean {
  return pr.merged === true
}

/**
 * True when `text` references ticket `<id>` by the R-DEV convention `ticket #<id>`.
 * The negative lookahead is the whole point: `ticket #43` must not match inside
 * `ticket #431`, or a link-less ticket could be closed against the wrong PR.
 */
export function referencesTicketId(text: string, ticketId: number): boolean {
  return new RegExp(`ticket #${ticketId}(?!\\d)`, 'i').test(text)
}

/** A merged PR as returned by the GitHub issue-search API, reduced to what the
 *  match decision needs. `isPullRequest` filters out issues, which the same
 *  endpoint also returns. */
export interface SearchedPr {
  number: number
  title: string
  body: string
  isPullRequest: boolean
}

/** The result of looking for the one merged PR that closed a link-less ticket. */
export type TicketPrLookup =
  | { kind: 'match'; prNumber: number }
  | { kind: 'none' }
  | { kind: 'ambiguous'; prNumbers: number[] }
  | { kind: 'error'; error: string }

/**
 * Pure classifier: given the merged PRs a search surfaced, decide whether
 * exactly one confidently references this ticket. Kept separate from the GitHub
 * call so the match rule is testable without a network (the DB here is
 * production and off-limits to tests). Distinct PR numbers only, so the same PR
 * appearing twice is not mistaken for ambiguity.
 */
export function classifyTicketPrMatches(prs: readonly SearchedPr[], ticketId: number): TicketPrLookup {
  const matched = new Set<number>()
  for (const pr of prs) {
    if (!pr.isPullRequest) continue
    if (referencesTicketId(`${pr.title}\n${pr.body}`, ticketId)) matched.add(pr.number)
  }
  const numbers = [...matched].sort((a, b) => a - b)
  if (numbers.length === 0) return { kind: 'none' }
  if (numbers.length > 1) return { kind: 'ambiguous', prNumbers: numbers }
  return { kind: 'match', prNumber: numbers[0]! }
}

/** Cap on search results fetched per link-less ticket. Bounds one GitHub call. */
const SEARCH_PER_PAGE = 20

interface RawSearchResponse {
  items?: Array<{ number: number; title?: string; body?: string | null; pull_request?: unknown }>
}

/**
 * Find the single merged PR that references a link-less ticket, if there is
 * exactly one. Narrows to merged PRs in the search query, then applies the
 * strict in-code matcher so a fuzzy full-text hit cannot close a ticket on its
 * own. Zero or more than one match returns `none` / `ambiguous`; the caller
 * still runs the same GitHub merged check before transitioning.
 */
export async function findMergedPrForTicket(ticketId: number, context = 'out-of-band-sweep'): Promise<TicketPrLookup> {
  const cfg = getGithubConfig(context)
  if (!cfg) return { kind: 'error', error: 'GITHUB_TOKEN/OWNER/REPO not set' }

  const q = `repo:${cfg.owner}/${cfg.repo} type:pr is:merged "ticket #${ticketId}"`
  const res = await githubRequest<RawSearchResponse>(
    `/search/issues?per_page=${SEARCH_PER_PAGE}&q=${encodeURIComponent(q)}`,
    { context },
  )
  if (!res.ok) return { kind: 'error', error: res.error }

  const prs: SearchedPr[] = (res.data.items ?? []).map((it) => ({
    number: it.number,
    title: it.title ?? '',
    body: it.body ?? '',
    isPullRequest: Boolean(it.pull_request),
  }))
  return classifyTicketPrMatches(prs, ticketId)
}

/** Flip any `pr` link rows for this ticket to `merged` so the digest agrees. */
async function markPrLinkMerged(ticketId: number, prRef: string): Promise<void> {
  await db
    .update(suggestionLinks)
    .set({ state: 'merged', updatedAt: new Date() })
    .where(and(
      eq(suggestionLinks.suggestionId, ticketId),
      eq(suggestionLinks.kind, 'pr'),
      eq(suggestionLinks.ref, prRef),
    ))
}

/**
 * Confirm a candidate's PR is merged and, if so, transition the ticket to
 * `applied`. Shared by the linked and link-less paths so both run the identical
 * GitHub merged check and transition. Never throws: a 409 means the ticket
 * already moved and is ignored; anything else is collected.
 */
async function applyCandidateIfMerged(c: Candidate, result: SweepResult): Promise<void> {
  try {
    const pr = await getPullRequest(c.prNumber, 'out-of-band-sweep')
    if (!pr.ok || !pr.data) {
      result.errors.push(`PR #${c.prNumber}: ${pr.ok ? 'no data' : pr.error}`)
      return
    }
    if (!isMergedOutOfBand(pr.data)) return

    await transitionSuggestion(c.ticketId, 'applied', 'system', {
      note: `merged out-of-band (PR #${c.prNumber} was already merged when the engine reconciled it)`,
      links: [{ kind: 'pr', ref: pr.data.htmlUrl, state: 'merged' }],
    })
    // Only linked candidates have an existing link row to reconcile; the
    // transition above records the link for a link-less candidate.
    if (c.prRef) await markPrLinkMerged(c.ticketId, c.prRef)
    result.applied.push(c.ticketId)
    console.log(`${LOG} ticket #${c.ticketId} applied: PR #${c.prNumber} merged out of band`)
  } catch (err) {
    // A 409 here is normal and not worth alarming on: it means the ticket
    // moved (the engine got there first, or the owner dismissed it).
    const msg = String(err)
    if (msg.includes('409')) return
    result.errors.push(`ticket #${c.ticketId}: ${msg}`)
  }
}

/**
 * One sweep. Safe to call on every engine cycle; the caller throttles it.
 * Never throws: a GitHub hiccup must not take down the release cycle, so
 * failures are collected and reported.
 *
 * Three tiers, strongest evidence first, sharing one `limit` budget: linked
 * candidates (a `suggestion_links` 'pr' row) cost one GitHub call each;
 * apply_ref-only candidates (the legacy `op:'mark'` path, see the module
 * docstring's third stranding mode) also cost one GitHub call each; link-less
 * candidates resolved by PR-body text search are tried last since they are the
 * weakest signal. `considered` prevents a ticket the apply_ref tier already
 * decided (merged, or not) from being re-searched by the link-less tier in the
 * same sweep; both tiers select on the identical "no pr link row" condition,
 * so without it they would overlap. The total tickets touched stays bounded by
 * `limit`, so the GitHub calls one cycle can make stay bounded too.
 */
export async function sweepOutOfBandMerges(limit = SWEEP_MAX_TICKETS): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, applied: [], errors: [] }
  const considered = new Set<number>()

  let linked: Candidate[] = []
  try {
    linked = await findStrandedVerifiedTickets(limit)
  } catch (err) {
    result.errors.push(`candidate query failed: ${String(err)}`)
  }

  for (const c of linked) {
    if (result.checked >= limit) break
    considered.add(c.ticketId)
    result.checked += 1
    await applyCandidateIfMerged(c, result)
  }

  let remaining = limit - result.checked
  if (remaining > 0) {
    let applyRefOnly: Candidate[] = []
    try {
      applyRefOnly = await findStrandedApplyRefTickets(remaining)
    } catch (err) {
      result.errors.push(`apply_ref candidate query failed: ${String(err)}`)
    }

    for (const c of applyRefOnly) {
      if (result.checked >= limit) break
      considered.add(c.ticketId)
      result.checked += 1
      await applyCandidateIfMerged(c, result)
    }
  }

  remaining = limit - result.checked
  if (remaining > 0) {
    let linkless: number[] = []
    try {
      linkless = (await findStrandedLinklessTickets(remaining)).filter((id) => !considered.has(id))
    } catch (err) {
      result.errors.push(`link-less candidate query failed: ${String(err)}`)
    }

    for (const ticketId of linkless) {
      if (result.checked >= limit) break
      result.checked += 1
      const lookup = await findMergedPrForTicket(ticketId)
      switch (lookup.kind) {
        case 'error':
          result.errors.push(`ticket #${ticketId}: PR search failed: ${lookup.error}`)
          break
        case 'none':
          console.log(`${LOG} ticket #${ticketId}: no merged PR references it, leaving as-is`)
          break
        case 'ambiguous':
          console.log(
            `${LOG} ticket #${ticketId}: ambiguous, ${lookup.prNumbers.length} merged PRs reference it ` +
              `(${lookup.prNumbers.map((n) => `#${n}`).join(', ')}), leaving as-is`,
          )
          break
        case 'match':
          await applyCandidateIfMerged({ ticketId, prNumber: lookup.prNumber }, result)
          break
      }
    }
  }

  return result
}

/**
 * How many tickets are currently stranded, ignoring the cap. Used by the owner
 * digest so a systemic reconciliation failure is visible rather than silently
 * capped at five a cycle. Counts the same statuses the sweep acts on, so the
 * reported number and the work queue cannot drift apart.
 */
export async function countStrandedVerifiedTickets(): Promise<number> {
  const cutoff = new Date(Date.now() - SWEEP_MIN_AGE_MINUTES * 60_000)
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${homepageTeamSuggestions.id})::int` })
    .from(homepageTeamSuggestions)
    .innerJoin(suggestionLinks, eq(suggestionLinks.suggestionId, homepageTeamSuggestions.id))
    .where(and(
      inArray(homepageTeamSuggestions.status, [...SWEEPABLE_STATUSES]),
      eq(suggestionLinks.kind, 'pr'),
      lt(homepageTeamSuggestions.updatedAt, cutoff),
    ))
  return row?.n ?? 0
}
