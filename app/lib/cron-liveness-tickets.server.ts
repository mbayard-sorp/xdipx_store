/**
 * The actuator for cron liveness. What turns a measurement into work.
 *
 * ## Why this file exists
 *
 * Between 2026-09-02 and 09-04 the self-healing program shipped a 42-route
 * liveness manifest, durable `cron_runs` records, an unwatched-lane detector
 * and a credential prober, and wired a filing path for exactly one of them.
 * `readCronLiveness()` had a single caller, `/cron/janitor-sweep`, which
 * `console.warn`ed its findings into a log stream whose only reader Stage G3
 * had deleted. Nothing anywhere queried `cron_runs` for `status = 'failed'`.
 *
 * The cost was not hypothetical. `/cron/owner-digest` and `/cron/blocker-list`
 * returned HTTP 500 on every run for two days, the six-hourly sweep ran through
 * the outage four times, and a person found it. Measured on 2026-09-04 the
 * sweep's alarm had 0/7 precision and 0/2 recall: every breach it reported was
 * structurally false, and both crons that were actually broken were invisible
 * because `breached` is computed from age and a failing cron still writes a
 * fresh row on time.
 *
 * ## Two tiers, and why the kind matters more than it looks
 *
 * Tier 1 files `kind: 'process'`. That is not a filing convenience, it is the
 * whole design. `log-monitor.server.ts` states the rule this follows: a
 * liveness signal is not a code defect, and `code` has no agent-reachable close
 * edge, so filing one there guarantees an owner-only row. `process` has the
 * fenced `system -> applied` edge in `team.server.ts`'s ALLOWED map
 * (`DETECTOR_SELF_CLOSE_KINDS`), so the detector that raised the alarm can end
 * it when the condition clears.
 *
 * Tier 2, after `ESCALATE_AFTER_SWEEPS` consecutive sweeps, files one `code`
 * row at the same team. That one deliberately does NOT self-close: it has an
 * executor, and closing it is the work.
 *
 * ## Self-close is what makes the alarm correct, not merely tidy
 *
 * `fileDetectionTicket` dedupes against a partial-unique index that excludes
 * only `applied` and `dismissed`, so an open undated row holds its key forever
 * and the NEXT real occurrence files nothing. Without a close pass this module
 * would install a liveness alarm that permanently disarms itself the first time
 * it fires. That is not a thought experiment: it is exactly how four homepage
 * freshness slots went silently mute, documented at
 * `homepage-healthcheck.server.ts:817-828`, whose `closeStaleSamenessTickets`
 * is the shape this file follows.
 *
 * The alternative, a dated dedupe scope, trades muting for a fresh ticket every
 * six hours per breached route. The undated key and the close pass are one
 * design, not two, and the close pass ships first.
 *
 * ## What is deliberately never filed
 *
 * A route whose evidence is structurally impossible to produce. If an
 * expectation has no `cron_runs` row, no heartbeat and no external reader, the
 * defect is in the manifest, not in the route, and filing a ticket every six
 * hours about it would rebuild the noise this replaces.
 */
import { fileDetectionTicket, makeDedupeKey } from '~/lib/detection-tickets.server'
import { kvDel, kvGet, kvSet } from '~/lib/kv.server'
import { listSuggestions, transitionSuggestion, type TeamId } from '~/lib/team.server'
import type { CronLiveness } from '~/lib/cron-runs.server'
import type { LaneCoverageGap } from '~/lib/ticket-janitor.server'

const LOG = '[cron-alarms]'

/** Consecutive breached sweeps before tier 2 escalates to a `code` row. At the
 *  six-hourly sweep cadence this is 24 hours of continuous silence. */
export const ESCALATE_AFTER_SWEEPS = 4

/** Counter TTL: long enough to survive a missed sweep, short enough that a
 *  route quiet for a week starts its next incident from zero. */
const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 3

const counterKey = (key: string): string => `cron:alarmcount:${key}`

export interface AlarmOutcome {
  filed: string[]
  closed: number[]
  escalated: string[]
  /** Alarms suppressed because the route cannot produce evidence at all. */
  unreadable: string[]
}

/** An alarm-worthy condition, reduced to the fields a ticket needs. */
interface Alarm {
  dedupeKey: string
  team: string | null
  priority: number
  title: string
  body: string
}

function isoOrNever(d: Date | null): string {
  return d ? d.toISOString() : 'never'
}

/**
 * The body a human reads a week later.
 *
 * Absolute timestamps, never relative age. The log line this replaces wrote
 * "last seen 43 min ago", which is true at write time and misleading forever
 * after; a reader finding it in a ticket has no way to know whether it means
 * now or last Tuesday. Every alarm also carries the command that re-checks it,
 * because the most useful thing a stale alarm can do is tell you it is stale.
 */
function recheckFooter(subject: string): string {
  return (
    `\n\nVERIFY: GET /cron/janitor-sweep (x-cron-secret) and look for ${subject}. `
    + 'If it is absent, the condition has cleared and this row should have closed itself: '
    + 'that failure to close is a bug worth reporting on its own.'
  )
}

function breachAlarm(l: CronLiveness, sweeps: number): Alarm {
  const floor = l.periodMinutes + l.graceMinutes
  return {
    dedupeKey: makeDedupeKey('cron-breach', l.route),
    team: l.ownerTeam,
    priority: l.moneyRelevant ? 1 : 2,
    title: `${l.route} has shown no evidence of life`,
    body:
      `${l.route} (${l.plane} plane) has not been seen inside its floor of `
      + `${l.periodMinutes} + ${l.graceMinutes} = ${floor} minutes.\n\n`
      + `Last seen: ${isoOrNever(l.lastSeenAt)} (source: ${l.source})\n`
      + `Age at filing: ${l.ageMinutes === null ? 'never seen' : `${l.ageMinutes} min`}\n`
      + `Money-relevant: ${l.moneyRelevant ? 'YES' : 'no'}\n`
      + `Consecutive breached sweeps: ${sweeps}\n`
      + `Owning lane: ${l.ownerTeam ?? 'unassigned'}`
      + recheckFooter(`${l.route} in breaches[]`),
  }
}

function failingAlarm(l: CronLiveness, sweeps: number): Alarm {
  return {
    dedupeKey: makeDedupeKey('cron-failing', l.route),
    team: l.ownerTeam,
    priority: l.moneyRelevant ? 1 : 2,
    title: `${l.route} is firing on schedule and failing every time`,
    body:
      `${l.route} is ALIVE and BROKEN: it is being delivered on time and the handler is `
      + `throwing. ${l.consecutiveFailures} consecutive failed run(s).\n\n`
      + `Last run: ${isoOrNever(l.lastSeenAt)} (status: ${l.lastStatus ?? 'unknown'})\n`
      + `Last error: ${(l.lastError ?? 'none recorded').slice(0, 400)}\n`
      + `Money-relevant: ${l.moneyRelevant ? 'YES' : 'no'}\n`
      + `Consecutive alarming sweeps: ${sweeps}\n`
      + `Owning lane: ${l.ownerTeam ?? 'unassigned'}\n\n`
      + 'This is a different fault from silence and has a different first question: not '
      + '"is the scheduler delivering" but "why is the handler throwing".'
      + recheckFooter(`${l.route} in failing[]`),
  }
}

function laneAlarm(u: LaneCoverageGap): Alarm {
  return {
    dedupeKey: makeDedupeKey('unwatched-lane', u.team, u.runType),
    team: u.team,
    priority: 3,
    title: `${u.team}/${u.runType} runs with no liveness entry`,
    body:
      `${u.team}/${u.runType} has produced ${u.runs} run(s) in the last 30 days and has no `
      + 'ROUTINE_CADENCES entry, so nothing would notice if it stopped.\n\n'
      + `Last run: ${u.lastRunAt ?? 'never'}\n\n`
      + 'Fix: add it to ROUTINE_CADENCES with a cadence, or add it to LANE_COVERAGE_EXEMPT '
      + 'with a stated reason. Absence from a hand-maintained list looks exactly like health.'
      + recheckFooter(`${u.team}/${u.runType} in unwatchedLanes[]`),
  }
}

/**
 * Bump a per-key sweep counter and return the new value.
 *
 * KV rather than a table: this is a counter whose only consumer is the next
 * sweep six hours later, and it is the same tier the heartbeats already use.
 * A read failure returns 1, which is the safe direction: it delays escalation
 * rather than manufacturing it.
 */
async function bump(key: string): Promise<number> {
  try {
    const raw = await kvGet<string>(counterKey(key))
    const n = (typeof raw === 'string' ? parseInt(raw, 10) : 0) || 0
    const next = n + 1
    await kvSet(counterKey(key), String(next), COUNTER_TTL_SECONDS)
    return next
  } catch {
    return 1
  }
}

async function clearCounter(key: string): Promise<void> {
  try { await kvDel(counterKey(key)) } catch { /* a stale counter costs one sweep */ }
}

/** Close every open `process` row holding one of these keys. */
async function closeResolved(keys: string[], reason: string, nowIso: string): Promise<number[]> {
  if (keys.length === 0) return []
  const closed: number[] = []
  try {
    const open = await listSuggestions({ dedupeKeys: keys, kinds: ['process'], statuses: ['proposed', 'approved'] })
    const note =
      `Resolved ${nowIso}: ${reason} Closed automatically by /cron/janitor-sweep.`
    for (const row of open) {
      try {
        // Through the ALLOWED map, never a bulk UPDATE. The first version of
        // the sameness closer did the latter and walked two edges the map
        // forbids while skipping decided_by, the note link and the status
        // guard. team.server is the single arbiter of transition authority.
        await transitionSuggestion(row.id, 'applied', 'system', { note })
        closed.push(row.id)
      } catch (err) {
        if (String(err).includes('409')) continue
        console.warn(`${LOG} could not close #${row.id} (ignored)`, err)
      }
    }
  } catch (err) {
    console.warn(`${LOG} close pass failed (ignored)`, err)
  }
  return closed
}

async function file(a: Alarm, kind: 'process' | 'code', detector: string): Promise<boolean> {
  try {
    const id = await fileDetectionTicket({
      detector,
      dedupeKey: kind === 'code' ? `${a.dedupeKey}:persistent` : a.dedupeKey,
      priority: a.priority,
      kind,
      category: 'reliability',
      ...(a.team ? { targetTeam: a.team as TeamId } : {}),
      suggestion: kind === 'code'
        ? `PERSISTENT (${ESCALATE_AFTER_SWEEPS}+ sweeps, ~24h): ${a.title}\n\n${a.body}\n\n`
          + 'This has not cleared on its own. It needs a diff, not another observation.'
        : `${a.title}\n\n${a.body}`,
    })
    // 0 means deduped against a live row OR the filing threw; the two are not
    // distinguishable at this boundary, which is why the sweep reports counts
    // from its own bookkeeping rather than inferring health from this value.
    return id > 0
  } catch (err) {
    console.warn(`${LOG} filing failed for ${a.dedupeKey} (ignored)`, err)
    return false
  }
}

/**
 * One pass: file what is wrong, close what is not.
 *
 * Order matters. The close pass runs first so a condition that cleared between
 * sweeps releases its dedupe key before the file pass could ever collide with
 * it, and so a bug in filing can never leave the estate worse than silent.
 */
export async function reconcileCronAlarms(
  liveness: readonly CronLiveness[],
  unwatched: readonly LaneCoverageGap[],
  now = new Date(),
): Promise<AlarmOutcome> {
  const nowIso = now.toISOString()
  const out: AlarmOutcome = { filed: [], closed: [], escalated: [], unreadable: [] }

  // A route with no row, no heartbeat and no external reader cannot ever
  // satisfy its own floor. That is a manifest bug and it is reported as one;
  // ticketing it every six hours would rebuild the noise this replaces.
  const readable = liveness.filter((l) => {
    if (l.breached && l.source === 'none' && !l.demandDriven) {
      // Only genuinely unreadable if nothing could ever have written evidence.
      // A recorded route with no rows yet is readable and simply silent.
      const neverWritable = l.plane === 'actions'
      if (neverWritable) { out.unreadable.push(l.route); return false }
    }
    return true
  })

  const breaching = readable.filter(l => l.breached)
  const failing = readable.filter(l => l.failing)

  // ---- close first -------------------------------------------------------
  const healthyBreachKeys = readable
    .filter(l => !l.breached)
    .map(l => makeDedupeKey('cron-breach', l.route))
  const healthyFailKeys = readable
    .filter(l => !l.failing)
    .map(l => makeDedupeKey('cron-failing', l.route))
  const watchedLaneKeys: string[] = [] // lanes resolve by disappearing from `unwatched`

  out.closed.push(...await closeResolved(healthyBreachKeys, 'the route reported evidence of life inside its floor again.', nowIso))
  out.closed.push(...await closeResolved(healthyFailKeys, 'the route completed without failing again.', nowIso))
  if (watchedLaneKeys.length) out.closed.push(...await closeResolved(watchedLaneKeys, 'the lane is watched again.', nowIso))

  for (const l of readable) {
    if (!l.breached) await clearCounter(makeDedupeKey('cron-breach', l.route))
    if (!l.failing) await clearCounter(makeDedupeKey('cron-failing', l.route))
  }

  // ---- then file ---------------------------------------------------------
  for (const l of breaching) {
    const a = breachAlarm(l, 0)
    const sweeps = await bump(a.dedupeKey)
    const withCount = breachAlarm(l, sweeps)
    if (await file(withCount, 'process', 'cron-liveness')) out.filed.push(withCount.dedupeKey)
    if (sweeps >= ESCALATE_AFTER_SWEEPS && await file(withCount, 'code', 'cron-liveness')) {
      out.escalated.push(withCount.dedupeKey)
    }
  }

  for (const l of failing) {
    const a = failingAlarm(l, 0)
    const sweeps = await bump(a.dedupeKey)
    const withCount = failingAlarm(l, sweeps)
    if (await file(withCount, 'process', 'cron-failing')) out.filed.push(withCount.dedupeKey)
    if (sweeps >= ESCALATE_AFTER_SWEEPS && await file(withCount, 'code', 'cron-failing')) {
      out.escalated.push(withCount.dedupeKey)
    }
  }

  for (const u of unwatched) {
    const a = laneAlarm(u)
    if (await file(a, 'process', 'unwatched-lane')) out.filed.push(a.dedupeKey)
  }

  return out
}
