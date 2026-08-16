/**
 * gate-liveness.ts
 *
 * Pure decision logic for ticket #1302: a gate subagent (`emma-empathy-reviewer`
 * or `sex-wellness-reviewer`) that dies mid-review is a normal, loud failure. A
 * gate that STALLS is worse: run 176 launched the voice gate's cycle-2 re-run at
 * 17:17 UTC, its transcript went silent at 17:17:44, and at 19:29 (2h12m later)
 * there was still no verdict and it had vanished from the running-agent set with
 * no error and no notification, while the accuracy gate reviewing byte-identical
 * text on the same run returned in 73 seconds. Silence is indistinguishable from
 * a slow review unless something checks liveness directly.
 *
 * This module is the decision table for that check: given how long a gate has
 * gone without transcript activity, decide whether it is still live, should be
 * relaunched once on the unchanged draft, or has now stalled twice and the
 * routine must give up and record an infrastructure failure. A stall is NEVER a
 * gate verdict (not PASS, REVISE, or BLOCK): a gate that never rendered a
 * judgment returned no judgment, and treating silence as a non-PASS would wrongly
 * cost the post a rewrite cycle for a defect that was never found in its text.
 *
 * Kept pure and dependency-free (mirrors app/lib/content-slug-precheck.ts): a
 * subagent's liveness is only observable from inside the driving session (Task
 * tool status), not from application code, so there is no live-Sanity/live-API
 * script sibling here the way check-hero-embed-match.ts has one. The routine
 * supplies the timestamps it already tracks (launch time, last observed
 * transcript activity) to scripts/check-gate-liveness.ts, which is a thin CLI
 * wrapper around this function.
 */

export interface GateLivenessInput {
  /** ISO timestamp the gate subagent was (most recently) launched. */
  launchedAt: string
  /** ISO timestamp of the gate's most recent observed transcript activity (a
   *  tool call or message). Equal to `launchedAt` when nothing has happened yet. */
  lastActivityAt: string
  /** Current time, injected for testability. */
  now: string
  /** How many times this gate has been launched so far this cycle (1 = first
   *  launch, 2 = the one permitted relaunch). */
  attempt: number
  /** Minutes of silence after which a gate with no transcript activity is
   *  declared stalled. Default 10: run 176's accuracy gate returned in 73s on
   *  identical text, so 10 minutes of total silence is already far outside any
   *  observed normal review time. */
  stallMinutes?: number
}

export type GateLivenessDecision =
  | { status: 'live' }
  | { status: 'stalled-relaunch' }
  | { status: 'stalled-exhausted' }

const DEFAULT_STALL_MINUTES = 10

export function evaluateGateLiveness(input: GateLivenessInput): GateLivenessDecision {
  const stallMs = (input.stallMinutes ?? DEFAULT_STALL_MINUTES) * 60_000
  const elapsedMs = new Date(input.now).getTime() - new Date(input.lastActivityAt).getTime()

  if (elapsedMs < stallMs) return { status: 'live' }
  return input.attempt >= 2 ? { status: 'stalled-exhausted' } : { status: 'stalled-relaunch' }
}
