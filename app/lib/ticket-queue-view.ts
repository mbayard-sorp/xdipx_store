/**
 * Pure view-logic for the improvement-bus ticket queue at
 * /admin/homepage-team. Split out of the route module (rather than living
 * inline, or in team.server.ts, which is protected and must not change) so
 * the filtering and aggregation math is unit-testable with no database and
 * no admin session.
 *
 * Root cause this file addresses: the board fetched 60-120 of the newest
 * rows with a client-side status slice on top, which made 230 open tickets
 * render as ~49 and hid every aged row behind the cutoff. The fix is
 * server-side filtering plus true totals computed from the full facet set,
 * not a bigger fixed slice.
 */

/**
 * Kinds the executor taxonomy routes to "the owner acts directly": nothing
 * in the agent fleet ever claims or applies these. This is the owner-facing
 * "needs you" bucket. It is deliberately not the same list as
 * AGENT_RETIRE_KINDS in team.server.ts (agent-editor's own hygiene list,
 * which omits `promo` because promo/campaign rows are marketing calls, not
 * something agent-editor should ever auto-retire) — this list is every kind
 * with zero automated executor, full stop.
 */
export const NO_EXECUTOR_KINDS = ['process', 'strategy', 'program', 'promo'] as const

export interface TicketFacetRow {
  status: string
  kind: string | null
  team: string | null
  assignee: string | null
  n: number
}

export interface QueueFilterLike {
  status: string    // '' = the default/open set
  kind: string       // '' = any kind
  team: string        // '' = any filing team
  assignee: string    // '' = any assignee
}

/**
 * Total rows matching the board's active filters, computed from the
 * unbounded facet counts rather than the (possibly truncated) row list the
 * table renders. This is what lets the owner see "230 open" even when the
 * table itself can only ever show SUGGESTION_LIST_MAX rows.
 */
export function facetTotal(
  facets: readonly TicketFacetRow[],
  filter: QueueFilterLike,
  defaultStatuses: readonly string[],
): number {
  const statuses = filter.status ? [filter.status] : defaultStatuses
  return facets
    .filter(f =>
      statuses.includes(f.status)
      && (!filter.kind || f.kind === filter.kind)
      && (!filter.team || f.team === filter.team)
      && (!filter.assignee || f.assignee === filter.assignee),
    )
    .reduce((sum, f) => sum + f.n, 0)
}

/** Sum of facet counts matching an optional status and/or kind allowlist. */
export function sumFacetCount(
  facets: readonly TicketFacetRow[],
  opts: { statuses?: readonly string[]; kinds?: readonly string[] } = {},
): number {
  return facets
    .filter(f =>
      (!opts.statuses || opts.statuses.includes(f.status))
      && (!opts.kinds || (f.kind != null && opts.kinds.includes(f.kind))),
    )
    .reduce((sum, f) => sum + f.n, 0)
}

/**
 * Whole-hour/day age string. Takes `now` as a parameter (defaulting to the
 * real clock) so callers, and tests, can pin it instead of every call
 * reading Date.now() independently.
 */
export function fmtAge(from: Date | string | null, now: Date = new Date()): string {
  if (!from) return '—'
  const ms = now.getTime() - new Date(from).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return '<1h'
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/**
 * When the rendered table is smaller than the true filtered total (the
 * board caps at SUGGESTION_LIST_MAX), say so plainly instead of letting a
 * clipped table read as complete. Returns null when nothing is hidden.
 */
export function truncationNote(shown: number, total: number): string | null {
  if (shown >= total) return null
  return `Showing ${shown} of ${total} open tickets under the current sort and filters. `
    + 'Narrow status, kind, or team to bring the rest into view.'
}
