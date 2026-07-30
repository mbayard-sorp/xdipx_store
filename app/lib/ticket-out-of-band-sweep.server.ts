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
 * This sweep is the reconciliation step: for tickets sitting in `verified`, ask
 * GitHub whether the linked PR is already merged, and if so record the truth.
 * It can only ever close a ticket whose PR GitHub itself reports as merged, so
 * there is no path here to mark unmerged work as shipped.
 *
 * Lives outside release-engine.server.ts on purpose. The engine's own file
 * documents a fixed safety model at the top and is a protected path; keeping
 * the query, the cap, and the transition here means the cadence and matching
 * rules can be tuned through the normal reviewed-PR lane instead of needing an
 * owner-merged change every time.
 */

import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { db } from './db.server'
import { homepageTeamSuggestions, suggestionLinks } from '../../db/schema'
import { getPullRequest, type PullRequestSummary } from './github.server'
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

export interface SweepResult {
  checked: number
  applied: number[]
  errors: string[]
}

interface Candidate {
  ticketId: number
  prNumber: number
  prRef: string
}

/**
 * Verified tickets older than the grace period, paired with the most recent PR
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
      eq(homepageTeamSuggestions.status, 'verified'),
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
 * Decide from a PR summary whether its ticket shipped out of band. Pure, so
 * the rule is testable without GitHub: merged means shipped, anything else
 * (open, closed-unmerged) leaves the ticket alone.
 */
export function isMergedOutOfBand(pr: Pick<PullRequestSummary, 'merged'>): boolean {
  return pr.merged === true
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
 * One sweep. Safe to call on every engine cycle; the caller throttles it.
 * Never throws: a GitHub hiccup must not take down the release cycle, so
 * failures are collected and reported.
 */
export async function sweepOutOfBandMerges(limit = SWEEP_MAX_TICKETS): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, applied: [], errors: [] }

  let candidates: Candidate[]
  try {
    candidates = await findStrandedVerifiedTickets(limit)
  } catch (err) {
    result.errors.push(`candidate query failed: ${String(err)}`)
    return result
  }
  if (candidates.length === 0) return result

  for (const c of candidates) {
    result.checked += 1
    try {
      const pr = await getPullRequest(c.prNumber, 'out-of-band-sweep')
      if (!pr.ok || !pr.data) {
        result.errors.push(`PR #${c.prNumber}: ${pr.ok ? 'no data' : pr.error}`)
        continue
      }
      if (!isMergedOutOfBand(pr.data)) continue

      await transitionSuggestion(c.ticketId, 'applied', 'system', {
        note: `merged out-of-band (PR #${c.prNumber} was already merged when the engine reconciled it)`,
        links: [{ kind: 'pr', ref: pr.data.htmlUrl, state: 'merged' }],
      })
      await markPrLinkMerged(c.ticketId, c.prRef)
      result.applied.push(c.ticketId)
      console.log(`${LOG} ticket #${c.ticketId} applied: PR #${c.prNumber} merged out of band`)
    } catch (err) {
      // A 409 here is normal and not worth alarming on: it means the ticket
      // moved (the engine got there first, or the owner dismissed it).
      const msg = String(err)
      if (msg.includes('409')) continue
      result.errors.push(`ticket #${c.ticketId}: ${msg}`)
    }
  }

  return result
}

/**
 * How many verified tickets are currently stranded, ignoring the cap. Used by
 * the owner digest so a systemic reconciliation failure is visible rather than
 * silently capped at five a cycle.
 */
export async function countStrandedVerifiedTickets(): Promise<number> {
  const cutoff = new Date(Date.now() - SWEEP_MIN_AGE_MINUTES * 60_000)
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${homepageTeamSuggestions.id})::int` })
    .from(homepageTeamSuggestions)
    .innerJoin(suggestionLinks, eq(suggestionLinks.suggestionId, homepageTeamSuggestions.id))
    .where(and(
      eq(homepageTeamSuggestions.status, 'verified'),
      eq(suggestionLinks.kind, 'pr'),
      lt(homepageTeamSuggestions.updatedAt, cutoff),
    ))
  return row?.n ?? 0
}
