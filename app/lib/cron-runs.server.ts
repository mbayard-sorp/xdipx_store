/**
 * Durable liveness for scheduled work (Stage C of the 2026-09-01 audit response).
 *
 * ## The invariant
 *
 * Nothing is healed that is not first recorded, and **scheduler status is never
 * a health signal**. A scheduler reports "fired". It cannot report "worked", and
 * the difference is the whole problem: the pricing batch was SIGKILLed at the
 * 300s ceiling every morning for at least four days, wrote no error (a SIGKILL
 * is not a throw), and the owner digest printed GOOD on every one of those days
 * because its test was `COUNT(*) > 0`.
 *
 * ## Two tiers, because instrumentation has a bill
 *
 * `recordCronRun` writes one `cron_runs` row for the ~12 routes whose failure
 * has a next actor. `heartbeatCron` writes one KV key for everything else.
 *
 * The split is not fastidiousness, it is the single most expensive line the
 * first draft of this stage contained. `server/cron.ts` gives the two
 * every-2-minute pollers a KV negative cache with an explicit comment: when the
 * last pass found zero in-flight jobs, skip the Neon query entirely so the cron
 * does not keep DB compute awake. Someone deliberately engineered 1,440 daily
 * invocations to touch Neon zero times. A wrapper-level INSERT fires *before*
 * that check and reinstates 2,880 writes a day whose entire content is
 * `skipped: idle`, pinning Neon compute awake around the clock on a platform
 * billed by compute-hour.
 *
 * ## Every write here is best-effort, and that is a hard rule
 *
 * Bookkeeping must never turn a successful cron into a reported failure, and
 * must never mask a real one. Every function below swallows its own errors and
 * returns; the caller's result is untouched either way. A cron that ran fine but
 * could not write its row is a gap in the record, not an incident, and the sweep
 * reads it as one missing datapoint rather than as a breach.
 *
 * ## Why "killed" is inferred and not observed
 *
 * A process SIGKILLed at `maxDuration` cannot write its own epitaph. So there is
 * no `started` row waiting to be closed: one row is written in a `finally`,
 * carrying both timestamps at once. A killed run therefore leaves *no row at
 * all*, and is detected by absence against `cron_expectations` at read time.
 * That needs no third table, no reaper, and no Vercel API call on the hot path.
 */

import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'

import { db } from '~/lib/db.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { kvGet, kvSet } from '~/lib/kv.server'
import { checkoutProbeRuns, cronExpectations, cronRuns } from '../../db/schema'
import { CRON_EXPECTATIONS, isRecordedCronRoute } from '~/lib/cron-expectations'

const LOG = '[cron-runs]'

/** Kill switch. Absent means OFF: recording is new machinery, and silence must
 *  mean "not yet enabled", the same convention as `release_engine_enabled`. */
export const CRON_RECORDING_SETTING = 'cron_recording_enabled'

/** KV key for a route's last successful completion. */
export function heartbeatKey(route: string): string {
  return `cron:lastok:${route}`
}

/** A heartbeat outlives the longest period in the manifest (monthly) with room
 *  to spare, so a stale key is always readable rather than silently absent —
 *  "last seen 40 days ago" is a fact; a missing key is ambiguous. */
const HEARTBEAT_TTL_SECONDS = 60 * 60 * 24 * 60

export type CronRunStatus = 'succeeded' | 'skipped' | 'failed'

/** Consecutive failed runs before `failing` trips. One failure is noise. */
export const CONSECUTIVE_FAILURES_BEFORE_ALARM = 2

/**
 * Classify one completed invocation from what the handler actually did.
 *
 * Pure, and extracted from the Express wrapper on purpose: this is the only
 * judgement the wrapper makes, and a judgement worth making is worth testing
 * without standing up a router.
 *
 * `skipped` is a real outcome, not a failure. An idle poller and a gate-closed
 * routine both did their job, and both answer HTTP 200 with
 * `{ ok: true, skipped: '...' }` — so the body has to be read; the status code
 * cannot tell them apart from a plain success. Collapsing them would make the
 * two pollers, which are idle most of the day by design, look like the healthiest
 * routes in the estate while telling you nothing.
 */
export function classifyCronOutcome(input: {
  thrown?: unknown
  statusCode: number
  payload?: unknown
}): { status: CronRunStatus; error: string | null } {
  const failed = input.thrown != null || input.statusCode >= 400
  if (failed) {
    const error = input.thrown != null
      ? (input.thrown instanceof Error ? input.thrown.message : String(input.thrown))
      : `HTTP ${input.statusCode}`
    return { status: 'failed', error }
  }
  const p = input.payload
  const skipped =
    p !== null && typeof p === 'object'
    && typeof (p as Record<string, unknown>)['skipped'] === 'string'
  return { status: skipped ? 'skipped' : 'succeeded', error: null }
}

export interface CronRunRecord {
  route: string
  startedAt: Date
  finishedAt: Date
  status: CronRunStatus
  error?: string | null
  result?: unknown
  triggerKind: 'schedule' | 'manual'
}

let recordingEnabledCache: { value: boolean; at: number } | null = null
/** One settings read per minute at most. The wrapper runs on every cron
 *  invocation and a per-invocation settings read would be its own Neon wake,
 *  which is the exact cost this module is careful about. */
const RECORDING_CACHE_MS = 60_000

async function recordingEnabled(now = Date.now()): Promise<boolean> {
  if (recordingEnabledCache && now - recordingEnabledCache.at < RECORDING_CACHE_MS) {
    return recordingEnabledCache.value
  }
  try {
    const value = (await getPipelineSetting(CRON_RECORDING_SETTING)) === 'true'
    recordingEnabledCache = { value, at: now }
    return value
  } catch {
    // A settings read that fails must not enable writes it could not confirm.
    return false
  }
}

/** Test seam: drop the memoised valve read. */
export function resetCronRecordingCache(): void {
  recordingEnabledCache = null
}

/**
 * Write one row for a completed invocation of a recorded route.
 *
 * Returns true when a row was written, false for every other outcome (valve
 * off, route not recorded, write failed). Never throws.
 */
export async function recordCronRun(run: CronRunRecord): Promise<boolean> {
  if (!isRecordedCronRoute(run.route)) return false
  if (!(await recordingEnabled())) return false

  try {
    await db.insert(cronRuns).values({
      route: run.route,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      status: run.status,
      error: run.error ?? null,
      result: (run.result ?? null) as never,
      triggerKind: run.triggerKind,
    })
    return true
  } catch (err) {
    console.warn(`${LOG} could not record ${run.route}`, err)
    return false
  }
}

/**
 * Mark a route alive without touching Neon.
 *
 * Called for every non-failed completion, recorded routes included: a recorded
 * route whose INSERT failed still has the heartbeat, so a database blip degrades
 * the record's resolution rather than reading as a dead cron.
 */
export async function heartbeatCron(route: string, at = new Date()): Promise<void> {
  try {
    await kvSet(heartbeatKey(route), at.toISOString(), HEARTBEAT_TTL_SECONDS)
  } catch (err) {
    console.warn(`${LOG} heartbeat failed for ${route}`, err)
  }
}

/**
 * Push the code manifest into `cron_expectations`.
 *
 * Upsert, never delete: a route removed from the manifest keeps its row, so the
 * sweep can still say "this used to be expected and has now vanished" instead of
 * forgetting it ever existed. Deleting rows here would make removing a cron and
 * removing its expectation indistinguishable, and only one of those is a change
 * anyone reviewed.
 */
export async function syncCronExpectations(): Promise<number> {
  let written = 0
  for (const e of CRON_EXPECTATIONS) {
    try {
      await db
        .insert(cronExpectations)
        .values({
          route: e.route,
          plane: e.plane,
          schedule: e.schedule,
          periodMinutes: e.periodMinutes,
          graceMinutes: e.graceMinutes,
          recorded: e.recorded,
          moneyRelevant: e.moneyRelevant,
          ownerTeam: e.ownerTeam,
          notes: e.notes,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: cronExpectations.route,
          set: {
            plane: e.plane,
            schedule: e.schedule,
            periodMinutes: e.periodMinutes,
            graceMinutes: e.graceMinutes,
            recorded: e.recorded,
            moneyRelevant: e.moneyRelevant,
            ownerTeam: e.ownerTeam,
            notes: e.notes,
            updatedAt: new Date(),
          },
        })
      written += 1
    } catch (err) {
      console.warn(`${LOG} could not sync expectation for ${e.route}`, err)
    }
  }
  return written
}

export interface CronLiveness {
  route: string
  plane: string
  periodMinutes: number
  graceMinutes: number
  moneyRelevant: boolean
  ownerTeam: string | null
  /** Most recent evidence of life from either tier, or null when there is none. */
  lastSeenAt: Date | null
  /** Where that evidence came from. `none` means no tier has anything. */
  source: 'row' | 'heartbeat' | 'external' | 'none'
  /** Minutes since `lastSeenAt`, or null when nothing has ever been seen. */
  ageMinutes: number | null
  /**
   * True when age exceeds `periodMinutes + graceMinutes`, or nothing was ever
   * seen. Always false for a demand-driven route, which has no schedule to
   * miss: silence there is the absence of demand, not the absence of health.
   */
  breached: boolean
  /** Mirrored onto the row so a reader can tell "healthy" from "not applicable". */
  demandDriven: boolean
  /** The most recent terminal status, for recorded routes only. */
  lastStatus: CronRunStatus | null
  lastError: string | null
  /** Consecutive failed runs, newest first. Zero for heartbeat-only routes. */
  consecutiveFailures: number
  /**
   * Alive and broken: it fired on time and threw, twice or more in a row.
   *
   * Deliberately separate from `breached`. Silence and failure are two
   * different faults with two different first questions ("is the scheduler
   * delivering?" versus "why is the handler throwing?"), so they get two
   * signals and, downstream, two dedupe keys.
   */
  failing: boolean
}

/**
 * Liveness for surfaces that do not execute inside this app.
 *
 * A route on the `actions` plane runs on a GitHub runner: it cannot write a
 * `cron_runs` row and it cannot beat the KV heartbeat, so both tiers are
 * structurally empty and `lastSeenAt` is null forever. That is not a dead
 * cron, it is an unreadable one, and the two must not render the same way —
 * the browser checkout probe, the closest thing this estate has to "can a
 * customer reach checkout", reported breached on every sweep while succeeding
 * 12 times out of 12.
 *
 * The manifest already promised this read. `cron-expectations.ts` says of the
 * probe row that "liveness is read from its `checkout_probe_runs` rows
 * instead"; the reader was never written. This is it.
 *
 * Keyed by route rather than by plane so the mapping is explicit and a new
 * external surface has to declare where its evidence lives. `EXTERNAL_LIVENESS`
 * plus `recorded` is also what lets a test assert the real invariant: no
 * expectation may be permanently unreadable.
 */
export const EXTERNAL_LIVENESS: Record<string, () => Promise<Date | null>> = {
  '.github/workflows/checkout-probe.yml': lastBrowserCheckoutProbeAt,
}

/** Most recent browser-tier checkout probe, the workflow's own side effect.
 *
 *  `tier` is the discriminator that matters: the 6-hourly Vercel probe writes
 *  `http` rows to the same table, and reading those would report the Actions
 *  workflow as alive off a completely different scheduler. */
async function lastBrowserCheckoutProbeAt(): Promise<Date | null> {
  try {
    const rows = await db
      .select({ ranAt: checkoutProbeRuns.ranAt })
      .from(checkoutProbeRuns)
      .where(eq(checkoutProbeRuns.tier, 'browser'))
      .orderBy(desc(checkoutProbeRuns.ranAt))
      .limit(1)
    return rows[0]?.ranAt ?? null
  } catch (err) {
    console.warn(`${LOG} browser-probe liveness read failed`, err)
    return null
  }
}

/**
 * Read liveness for every expectation.
 *
 * The classification deliberately answers "has this surface shown evidence of
 * life inside its own period", not "did it succeed". A cron that ran and
 * reported `skipped` is alive; a cron that ran and failed is alive AND broken,
 * and those are two different tickets at two different desks.
 *
 * A route whose `lastSeenAt` is null is breached, not unknown. Silence must
 * never read as a pass — that is the same render-truth rule the digest's
 * ticket-loop section already states, and the reason the pricing failure ran for
 * four days unnoticed.
 */
export async function readCronLiveness(now = new Date()): Promise<CronLiveness[]> {
  const expectations = await loadExpectations()
  const recorded = expectations.filter((e) => e.recorded).map((e) => e.route)
  const latest = await latestRunByRoute(recorded, now)

  const out: CronLiveness[] = []
  for (const e of expectations) {
    const row = latest.get(e.route) ?? null
    let lastSeenAt: Date | null = row?.startedAt ?? null
    let source: CronLiveness['source'] = row ? 'row' : 'none'

    // The heartbeat is consulted for every route, not only unrecorded ones: a
    // recorded route whose INSERT failed still beat, and reading it as dead
    // would turn a database blip into a false breach.
    const beat = await readHeartbeat(e.route)
    if (beat && (!lastSeenAt || beat > lastSeenAt)) {
      lastSeenAt = beat
      source = 'heartbeat'
    }

    // Third tier, for surfaces that run outside this app entirely.
    const external = EXTERNAL_LIVENESS[e.route]
    if (external) {
      const at = await external()
      if (at && (!lastSeenAt || at > lastSeenAt)) {
        lastSeenAt = at
        source = 'external'
      }
    }

    const ageMinutes = lastSeenAt
      ? Math.max(0, Math.round((now.getTime() - lastSeenAt.getTime()) / 60_000))
      : null

    out.push({
      route: e.route,
      plane: e.plane,
      periodMinutes: e.periodMinutes,
      graceMinutes: e.graceMinutes,
      moneyRelevant: e.moneyRelevant,
      ownerTeam: e.ownerTeam,
      lastSeenAt,
      source,
      ageMinutes,
      breached: e.demandDriven
        ? false
        : ageMinutes === null || ageMinutes > e.periodMinutes + e.graceMinutes,
      demandDriven: e.demandDriven,
      lastStatus: (row?.status as CronRunStatus | undefined) ?? null,
      lastError: row?.error ?? null,
      consecutiveFailures: row?.consecutiveFailures ?? 0,
      failing: (row?.consecutiveFailures ?? 0) >= CONSECUTIVE_FAILURES_BEFORE_ALARM,
    })
  }
  return out
}

/**
 * Rows that landed terminal with no `finished_at`.
 *
 * Should always be zero by construction, since the single INSERT carries both
 * timestamps. It is asserted anyway: the class existed on `homepage_team_runs`
 * (18 `succeeded` runs with a NULL finish in one 14-day window) precisely
 * because nothing ever checked, and "should be impossible" is not a measurement.
 */
export async function countUnfinishedTerminalRuns(): Promise<number> {
  try {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(cronRuns)
      .where(and(
        inArray(cronRuns.status, ['succeeded', 'skipped', 'failed']),
        sql`${cronRuns.finishedAt} IS NULL`,
      ))
    return rows[0]?.n ?? 0
  } catch (err) {
    console.warn(`${LOG} unfinished-run count failed`, err)
    return 0
  }
}

/** Retention: 14 days for succeeded/skipped, 90 for failed. Steady state ~2 MB. */
export const CRON_RUN_RETENTION_DAYS = { ok: 14, failed: 90 } as const

export async function pruneCronRuns(now = new Date()): Promise<{ ok: number; failed: number }> {
  const cut = (days: number) => new Date(now.getTime() - days * 86_400_000)
  let okDeleted = 0
  let failedDeleted = 0
  try {
    const a = await db
      .delete(cronRuns)
      .where(and(
        inArray(cronRuns.status, ['succeeded', 'skipped']),
        lt(cronRuns.startedAt, cut(CRON_RUN_RETENTION_DAYS.ok)),
      ))
      .returning({ id: cronRuns.id })
    okDeleted = a.length
    const b = await db
      .delete(cronRuns)
      .where(and(
        eq(cronRuns.status, 'failed'),
        lt(cronRuns.startedAt, cut(CRON_RUN_RETENTION_DAYS.failed)),
      ))
      .returning({ id: cronRuns.id })
    failedDeleted = b.length
  } catch (err) {
    console.warn(`${LOG} prune failed`, err)
  }
  return { ok: okDeleted, failed: failedDeleted }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

interface LoadedExpectation {
  route: string
  plane: string
  periodMinutes: number
  graceMinutes: number
  recorded: boolean
  moneyRelevant: boolean
  ownerTeam: string | null
  /** Merged from the code manifest, never from the row: whether a route has a
   *  scheduler at all is a structural fact about the code, not a tunable. */
  demandDriven: boolean
}

/**
 * Read expectations from the database, falling back to the code manifest.
 *
 * The fallback is the point rather than a nicety: if the sweep has never run, or
 * the table read fails, the manifest in code is still the truth and the liveness
 * check must not silently report "nothing is expected", which reads as healthy.
 */
async function loadExpectations(): Promise<LoadedExpectation[]> {
  try {
    const rows = await db
      .select({
        route: cronExpectations.route,
        plane: cronExpectations.plane,
        periodMinutes: cronExpectations.periodMinutes,
        graceMinutes: cronExpectations.graceMinutes,
        recorded: cronExpectations.recorded,
        moneyRelevant: cronExpectations.moneyRelevant,
        ownerTeam: cronExpectations.ownerTeam,
      })
      .from(cronExpectations)
    if (rows.length > 0) return rows.map((r) => ({ ...r, demandDriven: isDemandDriven(r.route) }))
  } catch (err) {
    console.warn(`${LOG} expectation read failed, using the code manifest`, err)
  }
  return CRON_EXPECTATIONS.map((e) => ({
    route: e.route,
    plane: e.plane,
    periodMinutes: e.periodMinutes,
    graceMinutes: e.graceMinutes,
    recorded: e.recorded,
    moneyRelevant: e.moneyRelevant,
    ownerTeam: e.ownerTeam,
    demandDriven: e.demandDriven === true,
  }))
}

/** Whether the code manifest marks this route as having no scheduler. */
function isDemandDriven(route: string): boolean {
  return CRON_EXPECTATIONS.some((e) => e.route === route && e.demandDriven === true)
}

interface LatestRun {
  startedAt: Date
  status: string
  error: string | null
  /**
   * How many of the most recent consecutive runs failed, newest first.
   *
   * The whole point of the second desk. `breached` answers "did it fire", and a
   * route that fires exactly on schedule and throws every single time is
   * perfectly alive by that measure. Both of the owner's own delivery crons
   * were in precisely that state for two days in September 2026, recorded as
   * `failed` in this table on every run, while the sweep that reads this file
   * ran through the outage four times and reported nothing, because nothing
   * looked at status.
   *
   * Counted rather than flagged so a single blip is not an alarm: one failure
   * is noise, two in a row is a fault.
   */
  consecutiveFailures: number
}

/**
 * The most recent run per recorded route, in one query.
 *
 * Scoped to a lookback window rather than scanning the table: a route that has
 * not run inside the longest period plus its grace is breached whether its last
 * row was 40 days ago or 400, so reading further back buys nothing and costs a
 * wider scan on every sweep.
 */
async function latestRunByRoute(routes: string[], now: Date): Promise<Map<string, LatestRun>> {
  const out = new Map<string, LatestRun>()
  if (routes.length === 0) return out
  try {
    const since = new Date(now.getTime() - 62 * 86_400_000)
    const rows = await db
      .select({
        route: cronRuns.route,
        startedAt: cronRuns.startedAt,
        status: cronRuns.status,
        error: cronRuns.error,
      })
      .from(cronRuns)
      .where(and(inArray(cronRuns.route, routes), gte(cronRuns.startedAt, since)))
      .orderBy(desc(cronRuns.startedAt))
      .limit(2000)
    // Rows arrive newest-first, so the first row per route is the latest and
    // the leading run of `failed` is the consecutive-failure streak.
    const streak = new Map<string, number>()
    const closed = new Set<string>()
    for (const r of rows) {
      if (!out.has(r.route)) {
        out.set(r.route, { startedAt: r.startedAt, status: r.status, error: r.error, consecutiveFailures: 0 })
      }
      if (closed.has(r.route)) continue
      if (r.status === 'failed') streak.set(r.route, (streak.get(r.route) ?? 0) + 1)
      else closed.add(r.route)
    }
    for (const [route, n] of streak) {
      const row = out.get(route)
      if (row) row.consecutiveFailures = n
    }
  } catch (err) {
    console.warn(`${LOG} latest-run read failed`, err)
  }
  return out
}

async function readHeartbeat(route: string): Promise<Date | null> {
  try {
    const raw = await kvGet<string>(heartbeatKey(route))
    if (typeof raw !== 'string') return null
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}
