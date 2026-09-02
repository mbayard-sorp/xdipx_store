import { TEAM_IDS, type TeamId } from '~/lib/team-keys'

/**
 * The auto-expired-run folder, and the Vercel log reader the money path uses.
 *
 * ## What was deleted here, and why (Stage G3, 2026-09-02)
 *
 * This file used to pull recent Vercel runtime logs, hand them to a Haiku
 * classifier, rank the result P0/P1/P2 and open GitHub issues. Measured over 30
 * days: **433 classifier calls, 16.9M input tokens, and zero log-derived
 * tickets in its entire lifetime**, while faithfully classifying npm-install
 * lines. About $17 trailing and ~$8/month forward for output that never existed.
 *
 * Repointing it at Sentry was the first proposal and is wrong. Sentry already
 * does grouping, dedupe, rate-limiting and first-seen detection natively and for
 * free; rebuilding that against its API with a classifier costs money, a
 * maintenance surface, and a new owner-set secret, inside a program whose whole
 * point is removing owner actions. Sentry was always the thing with coverage.
 *
 * `openIssuesForP0` went with it, and not as a tidy-up: the only remaining
 * source of groups is `fetchExpiredRunGroups`, which emits `P1` by
 * construction, so a P0 path would have been unreachable code that still read
 * like a safety net.
 *
 * ## What is left, and why each piece stays
 *
 * `fetchExpiredRunGroups` -> `fileTicketsForGroups`. An auto-expired team run is
 * a `homepage_team_runs` row, not a console line, so no amount of tuning a log
 * classifier could ever have seen it. It was the one thing here that produced
 * real tickets, and it never needed the model.
 *
 * `fetchRecentLogs` stays, and the audit response was wrong to bundle it with
 * the classifier. It has a live money-path consumer:
 * `purchase-watcher.server.ts` check 4 scans recent logs for the
 * fallback-stub marker, which is one of the four signals that Purchase
 * conversion delivery is dead. Deleting it would have removed a check on the
 * path that once stayed broken for two months undetected.
 */


export interface LogLine {
  timestamp:  string
  level:      string
  message:    string
  source:     string
  deployment: string
}

export interface LogGroup {
  priority:    'P0' | 'P1' | 'P2'
  title:       string
  occurrences: number
  firstSeen:   string
  owner:       string
  excerpt:     string
  likelyCause: string
  /**
   * Overrides the default title-hash dedupe identity (ticket #6760). The
   * title embeds identifying detail (a run id, a timestamp) that legitimately
   * varies between recurrences of the SAME underlying issue, so hashing the
   * title alone gives every recurrence its own ticket. Set this to a stable
   * key when the group represents a recurring class of incident rather than a
   * one-off, so repeat occurrences collapse onto one row instead of adding a
   * new blocked ticket each time.
   */
  dedupeKey?: string
  /**
   * Team that owns the fix. `fileDetectionTicket` defaults to `homepage`, which
   * is right for a storefront runtime error and wrong for anything that already
   * knows whose lane it came from: six auto-expiry rows (#5475, #5954, #6262,
   * #6553, #6706, #6707) and two more since (#6936 social, #6950 video) were all
   * filed at homepage for runs belonging to video, strategy, content and social.
   */
  targetTeam?: TeamId
  /**
   * Ticket kind. Defaults to `code`. A liveness signal is not a code defect, and
   * `code` has no agent-reachable close edge, so filing one there guarantees an
   * owner-only row. `process` is both honest and closeable by the detector that
   * raised it (DETECTOR_SELF_CLOSE_KINDS).
   */
  kind?: string
}

export interface LogMonitorRunResult {
  windowMinutes: number
  /** Improvement-bus ticket ids filed (0 = deduped or failed). */
  ticketsFiled:  number[]
  /** Auto-expired team runs seen in this window. */
  expiredRuns:   number
}

/**
 * Fetch Vercel runtime logs for the latest production deployment.
 *
 * NOTE: Vercel does not currently publish a stable REST endpoint for streaming
 * historical runtime logs across an entire project. The most reliable approach
 * is: (1) look up the latest production deployment, (2) pull its `events`
 * stream filtered by since-timestamp. Endpoint paths can drift, so isolate the
 * URLs in this function and verify with `vercel logs --json` if classification
 * suddenly stops returning groups after a platform update.
 */
export async function fetchRecentLogs({ windowMinutes }: { windowMinutes: number }): Promise<LogLine[]> {
  const token     = process.env['VERCEL_TOKEN']
  const projectId = process.env['VERCEL_PROJECT_ID']
  const teamId    = process.env['VERCEL_TEAM_ID']
  if (!token || !projectId) {
    throw new Error('VERCEL_TOKEN and VERCEL_PROJECT_ID must be set')
  }

  const teamQs = teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''
  const since  = Date.now() - windowMinutes * 60_000

  const deploymentsUrl =
    `https://api.vercel.com/v6/deployments` +
    `?projectId=${encodeURIComponent(projectId)}` +
    `&target=production&limit=1${teamQs}`
  const depRes = await fetch(deploymentsUrl, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!depRes.ok) {
    throw new Error(`Vercel deployments fetch ${depRes.status}: ${await depRes.text()}`)
  }
  const depJson = await depRes.json() as { deployments?: Array<{ uid: string }> }
  const deployment = depJson.deployments?.[0]
  if (!deployment) return []

  const eventsUrl =
    `https://api.vercel.com/v3/deployments/${deployment.uid}/events` +
    `?since=${since}&limit=500&direction=backward${teamQs}`
  const evRes = await fetch(eventsUrl, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!evRes.ok) {
    throw new Error(`Vercel events fetch ${evRes.status}: ${await evRes.text()}`)
  }
  const events = await evRes.json() as Array<{
    created?:    number
    date?:       number
    type?:       string
    text?:       string
    payload?:    { text?: string; level?: string; source?: string }
    deploymentId?: string
  }>

  return events
    .filter((e) => typeof (e.text ?? e.payload?.text) === 'string')
    .map<LogLine>((e) => ({
      timestamp:  new Date(e.created ?? e.date ?? Date.now()).toISOString(),
      level:      e.payload?.level ?? e.type ?? 'info',
      message:    (e.text ?? e.payload?.text ?? '').slice(0, 2000),
      source:     e.payload?.source ?? 'function',
      deployment: e.deploymentId ?? deployment.uid,
    }))
}

/**
 * #5431(b): an auto-expired team run (team.server.ts `expireStaleRuns`) is a
 * DB row -- `homepage_team_runs.status='failed', error='auto-expired: ...'`
 * -- not a console line, so no amount of tuning `SIGNAL_LINE_PATTERNS` could
 * ever make it visible to `fetchRecentLogs`/`classifyLogs`. It was a silent
 * error row by construction. This reads the table directly instead, so an
 * expired run rides the same classify -> issue -> ticket pipeline as a real
 * log-derived signal.
 *
 * Evidence (2026-08): runs 423 (8,110s), 338 (18,864s), 251 (20,500s), 200
 * (21,975s), 140 (20,963s) each auto-expired with BOTH current_phase and
 * current_agent NULL -- ~25h of wall clock with no trace of what died where.
 * The companion fix (api.team.run.tsx `op:'start'`) stamps a phase marker
 * immediately at run creation, so this function's `phase` field should never
 * again read NULL for a run started after that fix ships; it is read from the
 * row as-is (not defaulted here) so a NULL phase on an OLD run, or a genuine
 * gap, still surfaces rather than being silently papered over.
 *
 * Window is deliberately wider than `windowMinutes`: the expiry sweep runs
 * opportunistically (throttled to once/5min inside `gate()`), not on a fixed
 * clock tied to this cron's own 15-min cadence, so a strict window can miss a
 * row that expired between two log-monitor runs. Safe to widen because
 * `fileTicketsForGroups` dedupes by (hashed) title, and the title embeds the
 * run id, so re-seeing the same expired run in an overlapping window is a
 * no-op, not a duplicate ticket.
 *
 * #5632: an auto-expired run is not necessarily dead. A long, quiet-but-alive
 * run -- a content `podcast-reviewer` doing one long WebFetch + Sanity write
 * with no interim `op:'update'` heartbeat -- can go silent past the 240-min
 * idle reaper, get marked `failed`, and then complete successfully minutes
 * later. Run #517 did exactly this: auto-expired ~14:14, then succeeded 14:51
 * with a full podcast brief written, yet log-monitor had already paged a false
 * P1 at 14:15. So hold off until a run has stayed auto-expired for
 * `RECOVERY_GRACE_MIN`: a run that recovers within the grace flips to
 * `status != 'failed'` (dropping out of this failed-only query on its own),
 * while a genuinely dead run still surfaces one grace window later -- these are
 * post-hoc diagnostic tickets, not real-time pages, so the delay is cheap. The
 * SQL lower bound widens by the same grace so a row that ages past the cutoff
 * is still inside the window; at the 15-min cron cadence consecutive
 * `[since, graceCutoff]` bands overlap, and title dedupe keeps that a no-op.
 * `nowMs` is injectable for deterministic tests (repo convention, e.g.
 * `attribution.server.ts` `buildFbc`).
 */
/** Narrow a free-text `homepage_team_runs.team` to a real team id. */
function isTeamId(value: string): value is TeamId {
  return (TEAM_IDS as readonly string[]).includes(value)
}

export async function fetchExpiredRunGroups(
  windowMinutes: number,
  nowMs: number = Date.now(),
): Promise<LogGroup[]> {
  const { db } = await import('~/lib/db.server')
  const { homepageTeamRuns } = await import('../../db/schema')
  const { and, eq, gte, like, count: sqlCount } = await import('drizzle-orm')
  const { makeDedupeKey } = await import('~/lib/detection-tickets.server')

  const RECOVERY_GRACE_MIN = 60
  /** How far back a recurring auto-expiry class is counted. */
  const EXPIRY_CLASS_WINDOW_DAYS = 14
  /** Occurrences of one (team, runType) class before it is worth a ticket. */
  const EXPIRY_CLASS_MIN_OCCURRENCES = 3
  const graceCutoffMs = nowMs - RECOVERY_GRACE_MIN * 60_000
  const since = new Date(nowMs - (windowMinutes + 15 + RECOVERY_GRACE_MIN) * 60_000)
  const rows = await db
    .select({
      id:           homepageTeamRuns.id,
      team:         homepageTeamRuns.team,
      runType:      homepageTeamRuns.runType,
      currentPhase: homepageTeamRuns.currentPhase,
      currentAgent: homepageTeamRuns.currentAgent,
      startedAt:    homepageTeamRuns.startedAt,
      finishedAt:   homepageTeamRuns.finishedAt,
      error:        homepageTeamRuns.error,
    })
    .from(homepageTeamRuns)
    .where(and(
      eq(homepageTeamRuns.status, 'failed'),
      like(homepageTeamRuns.error, 'auto-expired:%'),
      gte(homepageTeamRuns.finishedAt, since),
    ))

  const settled = rows
    // Skip runs auto-expired within the grace window: they may still be a slow
    // but alive run that will recover before it is genuinely dead (#5632).
    .filter((r) => r.finishedAt != null && r.finishedAt.getTime() <= graceCutoffMs)

  // One auto-expiry is an event, not a defect. Runs go quiet for reasons that
  // resolve themselves, and filing on the first occurrence produced eight
  // P1 tickets in nine days, every one of which ended up `blocked` or sitting
  // `approved` at the wrong team. A class only becomes actionable once it
  // repeats, so count how often this (team, runType) pair has expired over a
  // fortnight and stay silent below the threshold. The liveness fact is still
  // recorded either way: the run row itself carries status and error.
  const classCounts = await db
    .select({
      team:    homepageTeamRuns.team,
      runType: homepageTeamRuns.runType,
      n:       sqlCount(),
    })
    .from(homepageTeamRuns)
    .where(and(
      eq(homepageTeamRuns.status, 'failed'),
      like(homepageTeamRuns.error, 'auto-expired:%'),
      gte(homepageTeamRuns.finishedAt, new Date(nowMs - EXPIRY_CLASS_WINDOW_DAYS * 86_400_000)),
    ))
    .groupBy(homepageTeamRuns.team, homepageTeamRuns.runType)

  const countFor = (team: string, runType: string | null): number =>
    Number(classCounts.find(c => c.team === team && c.runType === runType)?.n ?? 0)

  return settled
    .filter(r => countFor(r.team, r.runType) >= EXPIRY_CLASS_MIN_OCCURRENCES)
    .map((r): LogGroup => ({
    priority:    'P1',
    // The lane that owns the run owns the fix. `team` is a free varchar on the
    // runs table, so an unrecognised value falls back to the default rather
    // than routing a ticket at a team that does not exist.
    ...(isTeamId(r.team) ? { targetTeam: r.team } : {}),
    // Liveness, not a code defect - and `process` is closeable by the detector.
    kind:        'process',
    title:       `Team run auto-expired: ${r.team} run #${r.id} (phase: ${r.currentPhase ?? 'unknown'})`,
    occurrences: 1,
    firstSeen:   r.startedAt.toISOString(),
    owner:       'rr7-engineer',
    excerpt:
      `team=${r.team} runType=${r.runType ?? 'unknown'} phase=${r.currentPhase ?? 'NULL'} ` +
      `agent=${r.currentAgent ?? 'NULL'} error=${r.error ?? ''}`,
    likelyCause: r.currentPhase
      ? `Run died during phase "${r.currentPhase}" without a further update and was auto-expired after the idle timeout.`
      : `Run auto-expired with no phase ever recorded -- died before any step reported progress (pre-#5431 run, or the phase-stamp fix did not reach this run's start call).`,
    // Ticket #6760: stable per (team, runType), NOT per run id. The title
    // above embeds the run id on purpose (so a human reading the ticket knows
    // which row triggered it), but that means every NEW recurrence of the
    // same recurring class of expiry -- the same routine going quiet the same
    // way each week -- hashed to a different key and filed a brand new ticket
    // (#5475, #5954, #6262, #6553, #6706 all trace to the same weekly
    // strategy retro). This key collapses those onto one row.
    dedupeKey: makeDedupeKey('logmon', 'run-auto-expired', r.team, r.runType ?? 'unknown'),
  }))
}

/**
 * File one improvement-bus ticket per actionable group, so a detection becomes
 * claimable work instead of another email the owner has to route by hand.
 *
 * Identity is the group's own `dedupeKey`, which for an expired run is stable
 * per (team, runType) rather than per run id. That distinction was ticket
 * #6760: the title embeds the run id on purpose, so hashing the title filed a
 * brand new row for every recurrence of the same routine going quiet the same
 * way each week (#5475, #5954, #6262, #6553 and #6706 all trace to one lane).
 *
 * Cannot throw, so a Neon hiccup can never suppress the detection itself.
 */
async function fileTicketsForGroups(
  groups: LogGroup[],
  windowMinutes: number,
): Promise<number[]> {
  const { fileDetectionTicket, makeDedupeKey, priorityFromSeverity, hashToken } =
    await import('~/lib/detection-tickets.server')

  const ids: number[] = []
  // P2 is the low-volume edge-case bucket; ticketing it would bury the queue in
  // things nobody will fix. Nothing currently emits it — expired runs are P1 by
  // construction — but the filter stays so a future group source cannot widen
  // the queue by accident.
  for (const group of groups.filter((g) => g.priority === 'P0' || g.priority === 'P1')) {
    ids.push(
      await fileDetectionTicket({
        detector: 'log-monitor',
        dedupeKey: group.dedupeKey ?? makeDedupeKey('logmon', hashToken(group.title)),
        priority: priorityFromSeverity(group.priority),
        category: 'other',
        // A group that knows its own lane routes there; the rest keep the
        // storefront default, which is right for a runtime error.
        ...(group.targetTeam ? { targetTeam: group.targetTeam } : {}),
        kind: group.kind ?? 'code',
        suggestion:
          `${group.priority} runtime error: ${group.title}\n\n`
          + `Occurrences: ${group.occurrences} in the last ${windowMinutes} min\n`
          + `First seen: ${group.firstSeen}\n`
          + `Suggested owner: ${group.owner}\n`
          + `Likely cause: ${group.likelyCause}\n\n`
          + '```\n' + group.excerpt + '\n```\n\n'
          + 'Detected by /cron/log-monitor. Reproduce from the excerpt, fix, and confirm the '
          + 'run stops expiring.',
      }),
    )
  }
  return ids
}

export async function runLogMonitor(
  { windowMinutes = 60 }: { windowMinutes?: number } = {},
): Promise<LogMonitorRunResult> {
  // The whole job now. An auto-expired team run is a `homepage_team_runs` row,
  // not a console line, so it was invisible to the classifier that used to run
  // here by construction — and it was the only thing here that ever produced a
  // ticket.
  //
  // Never allowed to break the cron: a Neon hiccup files nothing this pass and
  // the next one re-sees the same rows, because `fetchExpiredRunGroups` uses a
  // window wider than this one and dedupes by a key stable per (team, runType).
  let expiredRunGroups: LogGroup[] = []
  try {
    expiredRunGroups = await fetchExpiredRunGroups(windowMinutes)
  } catch (err) {
    console.error('[log-monitor] expired-run query failed (ignored):', err)
  }

  let ticketsFiled: number[] = []
  try {
    ticketsFiled = await fileTicketsForGroups(expiredRunGroups, windowMinutes)
  } catch (err) {
    console.error('[log-monitor] ticket filing failed (ignored):', err)
  }

  // No owner email. The first-detection alert that used to fire here was tied
  // to opening a GitHub issue for a P0 group, and there is no longer any source
  // of P0 groups. A filed ticket at the owning lane is the notification; that
  // is invariant 3 — a breach files at that lane, never in the owner's inbox.
  return { windowMinutes, ticketsFiled, expiredRuns: expiredRunGroups.length }
}
