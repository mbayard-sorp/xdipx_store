/**
 * Neon compute over-burn watch: the pure half (owner direction 2026-11-27).
 *
 * The owner, verbatim: "We need to only spend what is required to keep the
 * site alive and functioning. When the team sees extra burn where there was
 * not before, we need to do something about it or we are wasting money."
 *
 * Neon bills compute by the hour the endpoint is awake. It suspends after
 * about five minutes with no queries, so the cost is driven by how often
 * something wakes it, not by how heavy each query is. On 2026-11-27 the
 * compute had been awake seven days straight. Nothing noticed, because no
 * detector looked.
 *
 * Two signals, both from one daily snapshot kept in KV (never Neon, so the
 * watch itself adds no writes):
 *
 *  1. Awake streak. `pg_postmaster_start_time()` resets every time the compute
 *     cold-starts from suspend, so "now minus postmaster start" is how long it
 *     has gone without suspending even once. Always available, no credential.
 *  2. New burn. Per-table activity from `pg_stat_user_tables` (reads + writes),
 *     diffed day over day and compared against the prior week's median, so a
 *     job that starts hammering a table shows up by name. When NEON_API_KEY and
 *     NEON_PROJECT_ID are set, the project's billed active seconds are diffed
 *     the same way and that is the primary signal: it is the bill itself.
 *
 * No I/O in this file; the cron half lives in neon-burn.server.ts.
 */

export interface TableCounters {
  /** seq_scan + idx_scan: how many times the table was read. */
  reads: number
  /** n_tup_ins + n_tup_upd + n_tup_del: rows written. */
  writes: number
}

export interface NeonUsage {
  /** Billed active seconds so far in the consumption period. */
  activeSeconds: number
  /** ISO start of the consumption period; a change means the counter reset. */
  periodStart: string
}

export interface BurnSnapshot {
  /** ISO time the snapshot was taken. */
  at: string
  /** ISO `pg_postmaster_start_time()`; a change means the compute restarted. */
  postmasterStart: string
  tables: Record<string, TableCounters>
  neon?: NeonUsage | null
}

export interface DailyDelta {
  /** ISO time of the later snapshot. */
  at: string
  hours: number
  /** Counters reset between the two snapshots, so the delta undercounts. */
  partial: boolean
  /** Total table activity (reads + writes) per hour. */
  activityPerHour: number
  tables: Record<string, TableCounters>
  /** Billed active hours per elapsed day, when the Neon API is configured. */
  activeHoursPerDay: number | null
}

export interface TableMover {
  table: string
  readsPerHour: number
  writesPerHour: number
  /** This table's prior-week median activity per hour (0 when it was idle). */
  baselinePerHour: number
}

export type BurnFindingKind = 'never-idle' | 'billed-jump' | 'activity-jump'

export interface BurnFinding {
  kind: BurnFindingKind
  summary: string
}

export interface BurnAssessment {
  awakeStreakHours: number
  latest: DailyDelta | null
  baselineActivityPerHour: number | null
  baselineActiveHoursPerDay: number | null
  topMovers: TableMover[]
  findings: BurnFinding[]
}

/** Snapshots kept in KV. Fifteen covers today, yesterday, and a 7-delta baseline with slack. */
export const HISTORY_LIMIT = 15

/** The compute has not suspended once in a full day: something wakes it at least every 5 minutes. */
export const NEVER_IDLE_HOURS = 24
/** A day's activity this many times the prior-week median is new burn. */
export const ACTIVITY_JUMP_RATIO = 1.5
/** Billed active hours this many times the prior-week median is new burn... */
export const BILLED_JUMP_RATIO = 1.3
/** ...and only when it is also at least this many hours more, so 1h -> 1.5h is not a page. */
export const BILLED_JUMP_MIN_HOURS = 3
/** Deltas needed before a baseline means anything. */
export const MIN_BASELINE_DELTAS = 3

const HOUR_MS = 3_600_000

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

function round(n: number, places = 1): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

/** Append a snapshot and keep the newest HISTORY_LIMIT, oldest first. */
export function appendSnapshot(history: BurnSnapshot[], snap: BurnSnapshot): BurnSnapshot[] {
  return [...history, snap].slice(-HISTORY_LIMIT)
}

/**
 * The delta between two consecutive snapshots. A restart between them resets
 * every pg_stat counter, so the later snapshot's raw values are the activity
 * since the restart: a floor on the real number, flagged `partial`.
 */
export function diffSnapshots(prev: BurnSnapshot, cur: BurnSnapshot): DailyDelta {
  const hours = Math.max((Date.parse(cur.at) - Date.parse(prev.at)) / HOUR_MS, 1 / 60)
  const restarted = prev.postmasterStart !== cur.postmasterStart
  const tables: Record<string, TableCounters> = {}
  let partial = restarted
  let total = 0
  for (const [name, c] of Object.entries(cur.tables)) {
    const p = restarted ? undefined : prev.tables[name]
    let reads = c.reads - (p?.reads ?? 0)
    let writes = c.writes - (p?.writes ?? 0)
    // A counter going backwards means a reset we did not see (stats reset).
    if (reads < 0 || writes < 0) {
      reads = c.reads
      writes = c.writes
      partial = true
    }
    tables[name] = { reads, writes }
    total += reads + writes
  }

  let activeHoursPerDay: number | null = null
  if (cur.neon && prev.neon) {
    const reset = cur.neon.periodStart !== prev.neon.periodStart
    const secs = reset ? cur.neon.activeSeconds : cur.neon.activeSeconds - prev.neon.activeSeconds
    if (secs >= 0) activeHoursPerDay = round((secs / 3600) * (24 / hours), 2)
  }

  return {
    at: cur.at,
    hours: round(hours, 2),
    partial,
    activityPerHour: round(total / hours),
    tables,
    activeHoursPerDay,
  }
}

/** Every consecutive delta in the history, oldest first. */
export function deltasOf(history: BurnSnapshot[]): DailyDelta[] {
  const out: DailyDelta[] = []
  for (let i = 1; i < history.length; i++) out.push(diffSnapshots(history[i - 1]!, history[i]!))
  return out
}

/**
 * The tables driving the latest day's activity, with each one's own
 * prior-week baseline so a reader can see which are new.
 */
export function topMovers(latest: DailyDelta, prior: DailyDelta[], limit = 5): TableMover[] {
  return Object.entries(latest.tables)
    .map(([table, c]) => {
      const base = median(
        prior.map(d => {
          const t = d.tables[table]
          return t ? (t.reads + t.writes) / d.hours : 0
        }),
      )
      return {
        table,
        readsPerHour: round(c.reads / latest.hours),
        writesPerHour: round(c.writes / latest.hours),
        baselinePerHour: round(base ?? 0),
      }
    })
    .filter(m => m.readsPerHour + m.writesPerHour > 0)
    .sort((a, b) => b.readsPerHour + b.writesPerHour - (a.readsPerHour + a.writesPerHour))
    .slice(0, limit)
}

export function assessBurn(history: BurnSnapshot[], now: Date): BurnAssessment {
  const last = history[history.length - 1]
  const awakeStreakHours = last
    ? round(Math.max(0, (now.getTime() - Date.parse(last.postmasterStart)) / HOUR_MS))
    : 0

  const deltas = deltasOf(history)
  const latest = deltas[deltas.length - 1] ?? null
  // Baseline from the up-to-7 deltas before the latest one. Partial deltas
  // undercount, so they stay out of the baseline (they would drag it down and
  // make normal days look like jumps).
  const prior = deltas.slice(0, -1).slice(-7)
  const fullPrior = prior.filter(d => !d.partial)

  const baselineActivityPerHour =
    fullPrior.length >= MIN_BASELINE_DELTAS ? median(fullPrior.map(d => d.activityPerHour)) : null
  const billedPrior = prior.map(d => d.activeHoursPerDay).filter((h): h is number => h !== null)
  const baselineActiveHoursPerDay =
    billedPrior.length >= MIN_BASELINE_DELTAS ? median(billedPrior) : null

  const findings: BurnFinding[] = []

  if (awakeStreakHours >= NEVER_IDLE_HOURS) {
    findings.push({
      kind: 'never-idle',
      summary:
        `The Neon compute has not suspended once in ${awakeStreakHours}h ` +
        `(pg_postmaster_start_time ${last!.postmasterStart}). Something queries it at least every ` +
        `5 minutes around the clock, so we pay for every hour of the day.`,
    })
  }

  if (latest && latest.activeHoursPerDay !== null && baselineActiveHoursPerDay !== null) {
    const h = latest.activeHoursPerDay
    if (h >= baselineActiveHoursPerDay * BILLED_JUMP_RATIO && h - baselineActiveHoursPerDay >= BILLED_JUMP_MIN_HOURS) {
      findings.push({
        kind: 'billed-jump',
        summary:
          `Billed Neon active time rose to ${h}h/day against a prior-week median of ` +
          `${round(baselineActiveHoursPerDay, 2)}h/day.`,
      })
    }
  }

  if (latest && !latest.partial && baselineActivityPerHour !== null && baselineActivityPerHour > 0) {
    if (latest.activityPerHour >= baselineActivityPerHour * ACTIVITY_JUMP_RATIO) {
      findings.push({
        kind: 'activity-jump',
        summary:
          `Database activity rose to ${latest.activityPerHour}/h (table reads + rows written) against a ` +
          `prior-week median of ${baselineActivityPerHour}/h, ${round(latest.activityPerHour / baselineActivityPerHour, 2)}x.`,
      })
    }
  }

  return {
    awakeStreakHours,
    latest,
    baselineActivityPerHour,
    baselineActiveHoursPerDay,
    topMovers: latest ? topMovers(latest, prior) : [],
    findings,
  }
}

/** The ticket body for a finding, written for whoever claims it with no other context. */
export function renderBurnTicket(finding: BurnFinding, a: BurnAssessment): string {
  const movers = a.topMovers.length
    ? a.topMovers
        .map(
          m =>
            `- ${m.table}: ${m.readsPerHour} reads/h, ${m.writesPerHour} rows written/h ` +
            `(prior-week median ${m.baselinePerHour}/h${m.baselinePerHour === 0 ? ', NEW' : ''})`,
        )
        .join('\n')
    : '- no per-table delta yet (the watch needs two daily snapshots)'
  const done =
    finding.kind === 'never-idle'
      ? `the next /cron/neon-burn-watch run reports an awake streak under ${NEVER_IDLE_HOURS}h (the compute suspended at least once)`
      : finding.kind === 'billed-jump'
        ? 'the next /cron/neon-burn-watch run reports billed active hours back within the prior-week baseline'
        : 'the next /cron/neon-burn-watch run reports daily activity back under 1.5x the prior-week baseline'
  return [
    `Neon compute over-burn (owner direction 2026-11-27: "only spend what is required to keep the site alive and functioning").`,
    '',
    finding.summary,
    '',
    `Awake streak: ${a.awakeStreakHours}h. Latest day: ${a.latest ? `${a.latest.activityPerHour} activity/h over ${a.latest.hours}h${a.latest.partial ? ' (partial, compute restarted)' : ''}` : 'n/a'}.`,
    a.latest?.activeHoursPerDay != null ? `Billed active: ${a.latest.activeHoursPerDay}h/day.` : 'Billed active hours: NEON_API_KEY / NEON_PROJECT_ID not set, so this is the in-database proxy only.',
    '',
    'Top tables by activity in the latest day:',
    movers,
    '',
    'Find what wakes the compute (a cron cadence, a loader without a cache, an unconditional write), and either fix it or cut it. ' +
      'Recipe: docs/store-team/neon-burn-runbook.md. Do not raise the Neon autoscaling cap or change suspend settings; those are owner-only.',
    '',
    `DONE WHEN: ${done}.`,
  ].join('\n')
}
