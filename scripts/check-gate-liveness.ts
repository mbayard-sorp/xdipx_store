/**
 * check-gate-liveness.ts
 *
 * Ticket #1302: thin CLI wrapper around app/lib/gate-liveness.ts's stall
 * decision table. A gate subagent's liveness (has it written anything to its
 * transcript recently?) is only observable from inside the driving session
 * (Task tool status), so there is no live-Sanity/live-API read this script could
 * make on its own, unlike scripts/check-hero-embed-match.ts or
 * scripts/check-slug-precheck.ts. So the routine supplies the timestamps it is
 * already tracking (when it launched the gate, when it last observed transcript
 * activity) and this script returns the mechanical decision, so "how long is
 * too long" is never re-judged by hand mid-run.
 *
 * Usage:
 *   npx tsx scripts/check-gate-liveness.ts --launched-at <iso> --last-activity-at <iso> \
 *     --attempt <1|2> [--stall-minutes 10]
 *
 * Prints the decision as JSON on stdout, one of:
 *   {"status":"live"}
 *   {"status":"stalled-relaunch"}
 *   {"status":"stalled-exhausted"}
 *
 * Exit codes:
 *   0: "live" or "stalled-relaunch" (the run continues: keep waiting, or
 *      relaunch the same gate once on the unchanged draft)
 *   1: "stalled-exhausted" (the routine records an infrastructure failure per
 *      Step 5's gate-liveness protocol, never a gate verdict) or bad usage
 */

const TAG = '[gate-liveness]'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const launchedAt = arg('launched-at')
const lastActivityAt = arg('last-activity-at')
const attemptRaw = arg('attempt')
const stallMinutesRaw = arg('stall-minutes')

if (!launchedAt || !lastActivityAt || !attemptRaw) {
  console.error(
    `${TAG} --launched-at <iso>, --last-activity-at <iso>, and --attempt <1|2> are required.`,
  )
  process.exit(1)
}

const attempt = Number(attemptRaw)
if (!Number.isInteger(attempt) || attempt < 1) {
  console.error(`${TAG} --attempt must be a positive integer (1 = first launch, 2 = the relaunch).`)
  process.exit(1)
}

async function main(): Promise<void> {
  const { evaluateGateLiveness } = await import('../app/lib/gate-liveness')
  const decision = evaluateGateLiveness({
    launchedAt,
    lastActivityAt,
    now: new Date().toISOString(),
    attempt,
    stallMinutes: stallMinutesRaw ? Number(stallMinutesRaw) : undefined,
  })
  console.log(JSON.stringify(decision))
  if (decision.status === 'stalled-exhausted') process.exit(1)
}

main().catch(err => {
  console.error(`${TAG} failed:`, err instanceof Error ? err.message : err)
  process.exit(1)
})
