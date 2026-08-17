/**
 * Control plane for the store-wide agent teams (homepage | social | ads |
 * email | strategy). Generalizes the original homepage-team control plane
 * (app/lib/homepage-team.server.ts, which now re-exports homepage-bound
 * wrappers from here for backward compatibility).
 *
 * Responsibilities:
 *   - Per-team kill switch + daily $ budget + run caps from pipeline_settings.
 *   - Per-team spend from api_token_log (feature '{team}-%') and a budget gate
 *     every scheduled cloud routine calls BEFORE any paid step.
 *   - Per-team concurrency guard so two runs of the same team never overlap.
 *   - Run + event recorders backing the /admin/homepage-team dashboard.
 *   - The store-wide improvement bus (suggestions: proposed -> approved|dismissed
 *     -> pr_open -> applied), the weekly strategy brief, ad campaign proposals,
 *     draft-only social posts, and marketing-calendar reads/proposals.
 *
 * Spend is NEVER stored here — it lives in api_token_log and surfaces on
 * /admin/usage. This module only reads spend to gate, and writes run/status.
 *
 * Server-only.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { timingSafeEqual } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { contentSlotForDate, type ContentSlot } from '~/lib/content-slot'
import { formatLiveFeedback, type LivePostVerdict } from '~/lib/live-post-feedback'
import { TEAM_KEYS } from '~/lib/homepage-team-keys'
import { cached, invalidateCache, kvDel, kvGet, kvSet, kvSetNX } from '~/lib/kv.server'
import {
  teamKeys,
  teamSpendKvKey,
  teamImagesKvKey,
  TEAM_IDS,
  TEAM_DEFAULTS,
  VALVE_KEYS,
  CONTENT_EXTRA_KEYS,
  CONTENT_MAX_IMAGES_DEFAULT,
  VIDEO_EXTRA_KEYS,
  VIDEO_MAX_COST_CENTS_DEFAULT,
  VIDEO_MAX_VARIANTS_PER_SET_DEFAULT,
  SOCIAL_PLATFORMS,
  SOCIAL_FREQ_DEFAULTS,
  socialFreqKey,
  type TeamId,
  type SocialPlatform,
  type SocialReviewStatus,
} from '~/lib/team-keys'
import {
  pipelineSettings,
  homepageTeamRuns,
  homepageTeamEvents,
  homepageTeamSuggestions,
  suggestionLinks,
  strategyBriefs,
  adCampaigns,
  socialPosts,
  marketingCalendar,
} from '../../db/schema'

export { TEAM_IDS, isTeamId, teamKeys, TEAM_DEFAULTS, VALVE_KEYS, type TeamId } from '~/lib/team-keys'

/**
 * Constant-time check of the team callback secret. The scheduled cloud routine
 * sends `x-team-secret: <token>` (or `Authorization: Bearer <token>`). Accepts
 * TEAM_TOKEN or HOMEPAGE_TEAM_TOKEN (the originally-deployed name), falling
 * back to CRON_SECRET. Throws a 401 Response when missing or wrong.
 */
export function assertTeamAuth(request: Request): void {
  const expected =
    process.env['TEAM_TOKEN'] ??
    process.env['HOMEPAGE_TEAM_TOKEN'] ??
    process.env['CRON_SECRET'] ??
    ''
  const auth = request.headers.get('authorization') ?? ''
  const provided = request.headers.get('x-team-secret') ?? auth.replace(/^Bearer\s+/i, '')
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  const ok = expected.length > 0 && a.length === b.length && timingSafeEqual(a, b)
  if (!ok) {
    throw new Response('Unauthorized', { status: 401 })
  }
}

/**
 * A run is presumed dead after this long with no recorded activity.
 *
 * Liveness is measured from activity, never from total elapsed time. The old
 * 20-minute start-time window reaped live runs mid-flight: run 106 (homepage,
 * 2026-07-28) was marked failed at 22 minutes and went on posting events for
 * another 82 seconds, and content runs 102/111 ran 190 and 200 minutes and
 * survived only because the reaper's 5-minute throttle happened to miss them.
 *
 * The default threshold is generous on purpose. Measured over 21 days of
 * SUCCEEDED runs, healthy routines go quiet for long stretches between steps:
 * content p95 45.6 min and max 155.6, strategy max 102.5, homepage max 36.5.
 * Anything near 20 minutes re-creates the bug. The failure modes are
 * asymmetric, since a false reap corrupts the record and masks real failures,
 * while a late reap only leaves a dead row marked 'running' a while longer.
 *
 * This also releases the concurrency lock, because isRunInProgress() only
 * counts status='running' rows: reaping a dead run is what frees its team.
 *
 * Per-team overrides (ticket #3191): one flat threshold sized for the slowest
 * team makes a hung run on a FAST team invisible for hours. Social routines
 * finish in 10-15 min, yet stuck run 251 held the social gate for 5h42m and
 * silently cost the weekly trend-scout its whole cycle (run 254 skipped on
 * run_in_progress with no retry until the next Monday). 60 min is 4-6x
 * social's normal runtime, so a healthy-but-slow social run is still safe,
 * while a silent one stops blocking the gate the moment it crosses the hour
 * (isRunInProgress filters on activity, so the unblock does not even wait for
 * the reaper sweep). Teams with measured long quiet stretches keep the 240
 * default; add a team here only with runtime data to back the number.
 */
const RUN_IDLE_TIMEOUT_MIN_DEFAULT = 240
const RUN_IDLE_TIMEOUT_MIN_BY_TEAM: Partial<Record<TeamId, number>> = {
  social: 60,
}

/** Idle minutes after which a silent run of this team is presumed dead. */
export function runIdleTimeoutMin(team: TeamId): number {
  return RUN_IDLE_TIMEOUT_MIN_BY_TEAM[team] ?? RUN_IDLE_TIMEOUT_MIN_DEFAULT
}

/**
 * Last sign of life for a run: the newest event it posted, falling back to its
 * own start for a run that has not posted anything yet. Both the concurrency
 * lock and the zombie reaper key off this, so a routine that keeps reporting
 * keeps its lock and stays out of the reaper's way however long it takes.
 */
const lastActivityAt = sql`GREATEST(
  ${homepageTeamRuns.startedAt},
  COALESCE(
    (SELECT MAX(${homepageTeamEvents.ts}) FROM ${homepageTeamEvents}
      WHERE ${homepageTeamEvents.runId} = ${homepageTeamRuns.id}),
    ${homepageTeamRuns.startedAt}
  )
)`

export interface TeamConfig {
  team: TeamId
  enabled: boolean
  dailyCents: number
  maxRunsPerDay: number
  /** When true, suggestions this team acts on auto-approve at creation (062). */
  autoApproveSuggestions: boolean
  /** Homepage-only extras (undefined for other teams). */
  buildCents?: number
  maxImagesPerDay?: number
  /** Video-only extra (065): hard per-video cost ceiling in cents. */
  maxCostCents?: number
  /** Video-only extra (078): hard cap on jobs one enqueue-set call may expand to. */
  maxVariantsPerSet?: number
}

function num(v: string | undefined, fallback: number): number {
  if (v == null) return fallback
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Config, valves, and the active-brief id are cached ~60s (L1 + KV) so gate()
 * doesn't re-read pipeline_settings from Neon before every paid agent step.
 * Admin edits call invalidateTeamSettingsCache(); worst case an un-invalidated
 * write (e.g. a direct DB edit) takes effect within the TTL. Kill-switch
 * flips therefore land within a minute, which is well inside the multi-minute
 * cadence of any team run.
 */
const SETTINGS_CACHE_TTL_SEC = 60

export async function getTeamConfig(team: TeamId): Promise<TeamConfig> {
  return cached(`team:cfg:${team}`, SETTINGS_CACHE_TTL_SEC, () => getTeamConfigUncached(team))
}

async function getTeamConfigUncached(team: TeamId): Promise<TeamConfig> {
  const keys = teamKeys(team)
  const rows = await db
    .select()
    .from(pipelineSettings)
    .where(sql`${pipelineSettings.key} LIKE ${team + '_team_%'}`)
  const map = new Map(rows.map(r => [r.key, r.value]))
  const d = TEAM_DEFAULTS[team]
  const cfg: TeamConfig = {
    team,
    enabled:                (map.get(keys.enabled) ?? 'false') === 'true',
    dailyCents:             num(map.get(keys.dailyCents), d.dailyCents),
    maxRunsPerDay:          num(map.get(keys.maxRunsPerDay), d.maxRunsPerDay),
    autoApproveSuggestions: (map.get(keys.autoApproveSuggestions) ?? 'false') === 'true',
  }
  if (team === 'homepage') {
    cfg.buildCents = num(map.get(TEAM_KEYS.buildCents), 10000)
    cfg.maxImagesPerDay = num(map.get(TEAM_KEYS.maxImagesPerDay), 12)
  } else if (team === 'content') {
    cfg.maxImagesPerDay = num(map.get(CONTENT_EXTRA_KEYS.maxImagesPerDay), CONTENT_MAX_IMAGES_DEFAULT)
  } else if (team === 'video') {
    cfg.maxCostCents = num(map.get(VIDEO_EXTRA_KEYS.maxCostCents), VIDEO_MAX_COST_CENTS_DEFAULT)
    cfg.maxVariantsPerSet = num(map.get(VIDEO_EXTRA_KEYS.maxVariantsPerSet), VIDEO_MAX_VARIANTS_PER_SET_DEFAULT)
  }
  return cfg
}

/** True when a standalone valve (social autopost, suggestion apply) is on. */
export async function getValve(key: (typeof VALVE_KEYS)[keyof typeof VALVE_KEYS]): Promise<boolean> {
  return cached(`team:valve:${key}`, SETTINGS_CACHE_TTL_SEC, async () => {
    const [row] = await db
      .select()
      .from(pipelineSettings)
      .where(eq(pipelineSettings.key, key))
      .limit(1)
    return row?.value === 'true'
  })
}

/**
 * FAIL-OPEN kill-switch read for the live conversation channels (chat_enabled,
 * sms_agent_enabled). Unlike getValve — which treats a missing row as OFF —
 * a kill switch only trips when the row is explicitly 'false': a missing row,
 * an unapplied migration, or a slow/erroring DB must never take a customer
 * channel down. Same 60s cache; admin writes bust it via
 * invalidateTeamSettingsCache().
 */
export async function getKillSwitch(key: (typeof VALVE_KEYS)[keyof typeof VALVE_KEYS]): Promise<boolean> {
  try {
    return await cached(`team:valve:${key}`, SETTINGS_CACHE_TTL_SEC, async () => {
      const [row] = await db
        .select()
        .from(pipelineSettings)
        .where(eq(pipelineSettings.key, key))
        .limit(1)
      return row?.value !== 'false'
    })
  } catch (err) {
    console.error(`[team] kill-switch read failed for ${key} — failing open`, err)
    return true
  }
}

/**
 * Bust the team config/valve caches after an admin settings write, both the
 * per-instance L1 and the shared KV L2, so toggles land immediately instead
 * of within the TTL.
 */
export async function invalidateTeamSettingsCache(): Promise<void> {
  invalidateCache('team:cfg:')
  invalidateCache('team:valve:')
  const keys = [
    ...TEAM_IDS.map(t => `team:cfg:${t}`),
    ...Object.values(VALVE_KEYS).map(k => `team:valve:${k}`),
  ]
  await Promise.all(keys.map(k => kvDel(k)))
}

// ── Daily spend/image counters (KV write-through, Neon as source of truth) ──
//
// gate() used to re-run a SUM over the ever-growing api_token_log on every
// call. Instead, today's totals live in a KV counter that token-log.server.ts
// bumps on each spend write. Neon stays the source of truth: the counter is
// seeded from a real SUM when missing and re-seeded every RESEED window, so
// any drift (a lost KV increment, per-row rounding) self-heals within minutes.

const SPEND_KV_TTL_SEC = 26 * 3600      // daily keys; TTL just prevents buildup
const SPEND_RESEED_MS = 15 * 60_000

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

async function counterRead(
  key: string,
  sumFromDb: () => Promise<number>,
): Promise<number> {
  const seedKey = `${key}:seededAt`
  const [count, seededAt] = await Promise.all([kvGet<number>(key), kvGet<number>(seedKey)])
  if (typeof count === 'number' && typeof seededAt === 'number' && Date.now() - seededAt < SPEND_RESEED_MS) {
    return count
  }
  const fresh = await sumFromDb()
  // A concurrent bump between the SUM and this SET is dropped from the
  // counter (never from the DB); the next re-seed picks it up.
  await Promise.all([
    kvSet(key, fresh, SPEND_KV_TTL_SEC),
    kvSet(seedKey, Date.now(), SPEND_KV_TTL_SEC),
  ])
  return fresh
}

/** Today's team spend (USD cents) from api_token_log feature '{team}-%'. */
export async function getTodaySpendCents(team: TeamId): Promise<number> {
  return counterRead(teamSpendKvKey(team, utcDay()), async () => {
    const res = await db.execute(
      sql`SELECT COALESCE(SUM(est_cost_usd), 0)::float8 AS dollars
          FROM api_token_log
          WHERE ts >= current_date AND feature LIKE ${team + '-%'}`,
    )
    const dollars = Number((res.rows?.[0] as { dollars?: number } | undefined)?.dollars ?? 0)
    return Math.round(dollars * 100)
  })
}

/**
 * Count of this team's runs started today. Pass the caller's own run id so a
 * routine that starts its row before gating doesn't count itself toward the cap.
 */
export async function getTodayRunCount(team: TeamId, excludeRunId?: number): Promise<number> {
  const res = await db.execute(
    excludeRunId == null
      ? sql`SELECT COUNT(*)::int AS n FROM homepage_team_runs
            WHERE started_at >= current_date AND team = ${team}`
      : sql`SELECT COUNT(*)::int AS n FROM homepage_team_runs
            WHERE started_at >= current_date AND team = ${team} AND id <> ${excludeRunId}`,
  )
  return Number((res.rows?.[0] as { n?: number } | undefined)?.n ?? 0)
}

/**
 * Count of images the homepage team generated today (feature='homepage-images').
 * Only the homepage team generates images today; other teams request imagery
 * through media-manager, which logs under the homepage feature labels.
 */
export async function getTodayImageCount(): Promise<number> {
  return counterRead(teamImagesKvKey(utcDay()), async () => {
    const res = await db.execute(
      sql`SELECT COALESCE(SUM(request_count), 0)::int AS n
          FROM api_token_log
          WHERE ts >= current_date AND feature = 'homepage-images'`,
    )
    return Number((res.rows?.[0] as { n?: number } | undefined)?.n ?? 0)
  })
}

/**
 * True if a run of THIS TEAM is currently in progress (active within the idle
 * timeout). Teams don't block each other, a social run never locks homepage.
 * Callers that already hold a run row pass excludeRunId to avoid self-blocking.
 */
export async function isRunInProgress(team: TeamId, excludeRunId?: number): Promise<boolean> {
  const since = new Date(Date.now() - runIdleTimeoutMin(team) * 60_000)
  const conditions = [
    eq(homepageTeamRuns.team, team),
    eq(homepageTeamRuns.status, 'running'),
    sql`${lastActivityAt} >= ${since}`,
  ]
  if (excludeRunId !== undefined) conditions.push(ne(homepageTeamRuns.id, excludeRunId))
  const [row] = await db
    .select({ id: homepageTeamRuns.id })
    .from(homepageTeamRuns)
    .where(and(...conditions))
    .limit(1)
  return !!row
}

/**
 * The sibling run currently holding this team's concurrency lock, with how
 * long it has been silent, or null when none is. Same predicate as
 * isRunInProgress; the extra detail exists so a gate refusal can NAME the
 * blocker (id + idle age) instead of a bare run_in_progress, which is what
 * lets a low-frequency routine decide to wait out a suspiciously quiet
 * sibling rather than silently forfeiting its weekly slot (ticket #3191).
 */
export async function getBlockingRun(
  team: TeamId,
  excludeRunId?: number,
): Promise<{ id: number; runType: string; idleMinutes: number } | null> {
  const since = new Date(Date.now() - runIdleTimeoutMin(team) * 60_000)
  const conditions = [
    eq(homepageTeamRuns.team, team),
    eq(homepageTeamRuns.status, 'running'),
    sql`${lastActivityAt} >= ${since}`,
  ]
  if (excludeRunId !== undefined) conditions.push(ne(homepageTeamRuns.id, excludeRunId))
  const [row] = await db
    .select({
      id: homepageTeamRuns.id,
      runType: homepageTeamRuns.runType,
      idleSec: sql<number>`EXTRACT(epoch FROM now() - ${lastActivityAt})::float8`,
    })
    .from(homepageTeamRuns)
    .where(and(...conditions))
    .orderBy(desc(homepageTeamRuns.startedAt))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    runType: row.runType ?? '',
    idleMinutes: Math.max(0, Math.floor(Number(row.idleSec ?? 0) / 60)),
  }
}

/**
 * Mark zombie rows failed across ALL teams: status='running' with no recorded
 * activity for the team's idle timeout, meaning the routine died without
 * posting a final update. A slow-but-reporting run is not a zombie and is left
 * alone. Teams with a shorter override sweep on their own cutoff; everything
 * else, including any unknown/legacy team value, falls under the default so a
 * zombie can never dodge the reaper by having an unrecognised team.
 */
export async function expireStaleRuns(): Promise<void> {
  const overrides = Object.entries(RUN_IDLE_TIMEOUT_MIN_BY_TEAM) as Array<[TeamId, number]>
  const expireSet = (mins: number) => ({
    status: 'failed',
    error: `auto-expired: no recorded activity for ${mins} minutes`,
    finishedAt: new Date(),
  })
  const defaultCutoff = new Date(Date.now() - RUN_IDLE_TIMEOUT_MIN_DEFAULT * 60_000)
  const defaultConds = [eq(homepageTeamRuns.status, 'running'), sql`${lastActivityAt} < ${defaultCutoff}`]
  if (overrides.length > 0) {
    defaultConds.push(sql`${homepageTeamRuns.team} NOT IN (${sql.join(overrides.map(([t]) => sql`${t}`), sql`, `)})`)
  }
  await db
    .update(homepageTeamRuns)
    .set(expireSet(RUN_IDLE_TIMEOUT_MIN_DEFAULT))
    .where(and(...defaultConds))
  for (const [team, mins] of overrides) {
    const cutoff = new Date(Date.now() - mins * 60_000)
    await db
      .update(homepageTeamRuns)
      .set(expireSet(mins))
      .where(and(
        eq(homepageTeamRuns.status, 'running'),
        eq(homepageTeamRuns.team, team),
        sql`${lastActivityAt} < ${cutoff}`,
      ))
  }
}

export interface GateResult {
  team: TeamId
  enabled: boolean
  /** Why a run is refused, when ok=false. */
  reason?: 'disabled' | 'over_budget' | 'over_run_cap' | 'run_in_progress' | 'over_image_cap'
  /**
   * Present only when reason='run_in_progress': the sibling run holding the
   * lock and how long it has been silent. A weekly-cadence routine uses this
   * to decide whether to re-check the gate later in the same session (its
   * only same-day retry path) instead of forfeiting the week (ticket #3191).
   */
  blockingRun?: { id: number; runType: string; idleMinutes: number }
  ok: boolean
  dailyCents: number
  spentCents: number
  remainingCents: number
  runsToday: number
  maxRunsPerDay: number
  /** Homepage-only; 0/0 for other teams. */
  imagesToday: number
  maxImagesPerDay: number
  /** Active strategy brief id, so routines know to fetch it (null = none yet). */
  activeBriefId: number | null
  /** Content-only: standalone valves the routine needs (absent for other teams). */
  valves?: { autopublish: boolean }
  /** Content-only: today's weekday->category slot, computed server-side in PT. */
  contentSlot?: ContentSlot
}

/**
 * The gate every scheduled routine calls before doing anything paid. Returns
 * ok=false (with a reason) when disabled, over budget, over the daily run cap,
 * over the image cap (homepage only), or a same-team run is already in progress.
 */
export async function gate(team: TeamId, excludeRunId?: number): Promise<GateResult> {
  // Zombie cleanup is time-based housekeeping, not a per-call invariant:
  // throttle it to once per 5 min store-wide (well inside the 20-min lock
  // window) instead of an UPDATE on every gate call.
  if (await kvSetNX('team:expire-stale:throttle', String(Date.now()), 300)) {
    // Same throttle, same reason: both are "a worker died holding something".
    await Promise.all([expireStaleRuns(), expireStaleClaims()])
  }
  const [cfg, spentCents, runsToday, imagesToday, blockingRun, briefId, autopublish] = await Promise.all([
    getTeamConfig(team),
    getTodaySpendCents(team),
    getTodayRunCount(team, excludeRunId),
    team === 'homepage' ? getTodayImageCount() : Promise.resolve(0),
    getBlockingRun(team, excludeRunId),
    getActiveBriefId(),
    team === 'content' ? getValve(VALVE_KEYS.contentAutopublish) : Promise.resolve(undefined),
  ])
  const remainingCents = Math.max(0, cfg.dailyCents - spentCents)
  const maxImagesPerDay = cfg.maxImagesPerDay ?? 0
  const base = {
    team,
    enabled: cfg.enabled,
    dailyCents: cfg.dailyCents,
    spentCents,
    remainingCents,
    runsToday,
    maxRunsPerDay: cfg.maxRunsPerDay,
    imagesToday,
    maxImagesPerDay,
    activeBriefId: briefId,
    ...(autopublish !== undefined ? { valves: { autopublish } } : {}),
    ...(team === 'content' ? { contentSlot: contentSlotForDate(new Date()) } : {}),
  }
  if (!cfg.enabled)                   return { ...base, ok: false, reason: 'disabled' }
  if (blockingRun)                    return { ...base, ok: false, reason: 'run_in_progress', blockingRun }
  if (remainingCents <= 0)            return { ...base, ok: false, reason: 'over_budget' }
  if (runsToday >= cfg.maxRunsPerDay) return { ...base, ok: false, reason: 'over_run_cap' }
  if (team === 'homepage' && imagesToday >= maxImagesPerDay)
    return { ...base, ok: false, reason: 'over_image_cap' }
  return { ...base, ok: true }
}

// ── Run + event recorders (back the dashboard) ──────────────────────────────

export async function startRun(team: TeamId, runType: string): Promise<number> {
  const [row] = await db
    .insert(homepageTeamRuns)
    .values({ team, runType, status: 'running' })
    .returning({ id: homepageTeamRuns.id })
  return row!.id
}

export interface RunUpdate {
  status?: 'running' | 'succeeded' | 'failed' | 'skipped' | 'rolled_back'
  currentPhase?: string
  currentAgent?: string
  summary?: string
  prUrl?: string
  error?: string
  finished?: boolean
  incrementAttempt?: boolean
}

export async function updateRun(id: number, u: RunUpdate): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (u.status) patch['status'] = u.status
  if (u.currentPhase !== undefined) patch['currentPhase'] = u.currentPhase
  if (u.currentAgent !== undefined) patch['currentAgent'] = u.currentAgent
  if (u.summary !== undefined) patch['summary'] = u.summary
  if (u.prUrl !== undefined) patch['prUrl'] = u.prUrl
  if (u.error !== undefined) patch['error'] = u.error
  if (u.finished) patch['finishedAt'] = new Date()
  if (u.incrementAttempt) patch['attemptCount'] = sql`${homepageTeamRuns.attemptCount} + 1`
  if (Object.keys(patch).length === 0) return
  await db.update(homepageTeamRuns).set(patch).where(eq(homepageTeamRuns.id, id))
}

export interface TeamEvent {
  runId: number
  eventType: 'step' | 'message' | 'tool' | 'decision' | 'error'
  summary: string
  agentRole?: string | undefined
  phase?: string | undefined
  transcriptRef?: string | undefined
}

export async function recordEvent(e: TeamEvent): Promise<void> {
  await db.insert(homepageTeamEvents).values({
    runId:         e.runId,
    eventType:     e.eventType,
    summary:       e.summary,
    agentRole:     e.agentRole ?? null,
    phase:         e.phase ?? null,
    transcriptRef: e.transcriptRef ?? null,
  })
}

/** Recent runs for the dashboard (newest first), optionally filtered by team. */
export async function listRecentRuns(team?: TeamId, limit = 25) {
  const q = db.select().from(homepageTeamRuns)
  return (team ? q.where(eq(homepageTeamRuns.team, team)) : q)
    .orderBy(desc(homepageTeamRuns.startedAt))
    .limit(limit)
}

/** Events for one run (oldest first — timeline order). */
export async function listRunEvents(runId: number) {
  return db
    .select()
    .from(homepageTeamEvents)
    .where(eq(homepageTeamEvents.runId, runId))
    .orderBy(homepageTeamEvents.ts)
}

/**
 * Recent events across runs — cross-team visibility for the store-strategist's
 * weekly retro. Optionally filter to one team; newest first.
 */
export async function listRecentEvents(team?: TeamId, sinceDays = 7, limit = 500) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60_000)
  const conditions = [gte(homepageTeamEvents.ts, since)]
  if (team) conditions.push(eq(homepageTeamRuns.team, team))
  return db
    .select({
      id:        homepageTeamEvents.id,
      runId:     homepageTeamEvents.runId,
      team:      homepageTeamRuns.team,
      ts:        homepageTeamEvents.ts,
      agentRole: homepageTeamEvents.agentRole,
      phase:     homepageTeamEvents.phase,
      eventType: homepageTeamEvents.eventType,
      summary:   homepageTeamEvents.summary,
    })
    .from(homepageTeamEvents)
    .innerJoin(homepageTeamRuns, eq(homepageTeamEvents.runId, homepageTeamRuns.id))
    .where(and(...conditions))
    .orderBy(desc(homepageTeamEvents.ts))
    .limit(limit)
}

// ── Improvement bus (suggestions) ────────────────────────────────────────────
//
// Lifecycle: proposed -> approved|dismissed (owner in the admin UI, OR
//                        auto-approved at creation when the acting team's
//                        `{team}_team_auto_approve_suggestions` valve is on)
//                     -> pr_open (agent-editor opens a PR)
//                     -> applied (owner merges the PR)
// Agents may only CREATE proposed rows and MARK approved rows pr_open/applied;
// they can never flip proposed->approved. That transition is the owner's, or
// the acting team's auto-approve valve (which the owner controls).
//
// The richer ticket lifecycle (claims, QA review, release-engine apply) is
// additive and lives further down under "Ticket lifecycle (070)". Everything
// in this section keeps its exact pre-070 behaviour.

/**
 * Every kind the executor taxonomy knows. `code` is claimed by the daily dev
 * routine, `instructions`/`agent-def`/`config` by agent-editor, and the rest
 * route to a daily run or to the owner. A kind outside this list has no
 * executor at all, so a row filed under one would sit in the queue forever
 * with nothing scheduled to ever read it.
 */
export const KNOWN_TICKET_KINDS: readonly string[] = [
  'code', 'instructions', 'agent-def', 'config',
  'campaign', 'promo', 'program', 'process', 'strategy',
]

/**
 * Coerce an unknown kind to `process` while preserving what the caller said.
 *
 * Agents invent kinds ('bug', 'improvement', 'seo') and the column is
 * write-once at insert, so before this a typo'd kind either landed in a
 * no-executor bucket nobody sweeps or, past 16 characters, failed the insert
 * outright. `process` is the safest landing: it is the kind the hygiene pass
 * and the daily runs already read, and rekindSuggestion can move it to a real
 * lane later. The original string is preserved by prefixing the suggestion
 * text, so triage can see what was meant.
 */
export function normalizeTicketKind(kind: string | undefined): { kind: string; original: string | null } {
  if (kind === undefined) return { kind: 'process', original: null }
  if (KNOWN_TICKET_KINDS.includes(kind)) return { kind, original: null }
  return { kind: 'process', original: kind }
}

export interface SuggestionInput {
  team: TeamId
  targetTeam?: TeamId | undefined
  runId?: number | undefined
  category: string   // model|turns|caching|prompt|agents|other
  kind?: string | undefined // process|strategy|instructions|agent-def|config|code|campaign|promo|program
  suggestion: string
  estSavingsUsd?: number | undefined
  cxRisk?: 'low' | 'med' | 'high' | undefined
  /** Ticket priority, 1 (highest) .. 5 (lowest). Defaults to 3 (070). */
  priority?: number | undefined
  /**
   * Stable identity for a recurring signal (070). While a ticket carrying this
   * key is still live (status not in applied|dismissed) a second insert with
   * the same key is a no-op, so a metric that trips every day reopens the
   * conversation on one ticket instead of flooding the queue.
   */
  dedupeKey?: string | undefined
  /** Soft deadline for the ticket, ISO string or Date (070). */
  dueAt?: string | Date | undefined
}

/**
 * File a suggestion. Returns the new row's id, or 0 when the insert was
 * absorbed by the dedupe_key partial-unique index (a live ticket for this
 * signal already exists). Callers that only care "is it filed" can ignore the
 * distinction; callers reporting counts should treat 0 as "already open".
 *
 * Unchanged contract: `createSuggestionDetailed` is the one that tells you
 * WHICH live ticket absorbed a duplicate.
 */
export async function createSuggestion(s: SuggestionInput): Promise<number> {
  const res = await createSuggestionDetailed(s)
  return res.deduped ? 0 : res.id
}

/**
 * As createSuggestion, but resolves the duplicate: on a dedupe collision it
 * looks up the live ticket carrying that key and returns its id, so an API
 * caller can answer "already filed, here it is" instead of a bare 0.
 */
export async function createSuggestionDetailed(
  s: SuggestionInput,
): Promise<{ id: number; deduped: boolean }> {
  // Owner triage (proposed -> approved) is automated per-team via the
  // `{team}_team_auto_approve_suggestions` valve. Key it off the team that ACTS
  // on the suggestion — its targetTeam, or the proposer when unrouted — so a
  // strategy-proposed row aimed at homepage auto-approves under homepage's
  // valve. A failed config read falls back to manual review (proposed).
  const actingTeam = s.targetTeam ?? s.team
  const autoApprove = await getTeamConfig(actingTeam)
    .then(c => c.autoApproveSuggestions)
    .catch(() => false)
  // An unknown kind is coerced to `process` (see normalizeTicketKind), and the
  // original string survives as a prefix on the suggestion text so triage and
  // a later rekind can see what the filer meant.
  const nk = normalizeTicketKind(s.kind)
  const suggestionText = nk.original === null
    ? s.suggestion
    : `[unknown kind '${nk.original.slice(0, 64)}' coerced to process] ${s.suggestion}`
  const [row] = await db
    .insert(homepageTeamSuggestions)
    .values({
      team:          s.team,
      targetTeam:    s.targetTeam ?? null,
      runId:         s.runId ?? null,
      category:      s.category,
      kind:          nk.kind,
      suggestion:    suggestionText,
      estSavingsUsd: String(s.estSavingsUsd ?? 0),
      cxRisk:        s.cxRisk ?? 'low',
      status:        autoApprove ? 'approved' : 'proposed',
      decidedBy:     autoApprove ? 'auto' : null,
      decidedAt:     autoApprove ? new Date() : null,
      priority:      s.priority ?? 3,
      dedupeKey:     s.dedupeKey ?? null,
      dueAt:         s.dueAt == null ? null : new Date(s.dueAt),
    })
    // Untargeted DO NOTHING so the dedupe_key partial-unique index (070)
    // swallows a repeat filing instead of throwing inside a cron handler.
    .onConflictDoNothing()
    .returning({ id: homepageTeamSuggestions.id })
  if (row?.id) return { id: row.id, deduped: false }
  if (!s.dedupeKey) return { id: 0, deduped: false }
  // The insert was absorbed by uq_team_sugg_dedupe_key: find the live ticket
  // that owns the key so the caller can point at the open conversation.
  const [live] = await db
    .select({ id: homepageTeamSuggestions.id, status: homepageTeamSuggestions.status })
    .from(homepageTeamSuggestions)
    .where(and(
      eq(homepageTeamSuggestions.dedupeKey, s.dedupeKey),
      sql`${homepageTeamSuggestions.status} NOT IN ('applied', 'dismissed')`,
    ))
    .limit(1)
  if (!live) return { id: 0, deduped: false }
  // A `blocked` row still owns its dedupe key, and `blocked` has no edge any
  // agent can walk, so every later observation of the same condition was
  // silently swallowed by a ticket nobody was working. That is how the browser
  // checkout probe failed five days running against one three-day-old blocked
  // row (#455), and it is the same hole the detector self-close edge already
  // documents for `proposed`. Drive the blocked -> approved `system` edge the
  // ALLOWED map already permits and attach the fresh evidence, so the SAME
  // ticket comes back onto the board instead of the alarm going mute. No new
  // row, no silence, and the reopen is bounded to the row the key already
  // pointed at.
  if (live.status === 'blocked') {
    await reopenBlockedOnRepeatObservation(live.id, s.suggestion)
  }
  return { id: live.id, deduped: true }
}

/**
 * Put a blocked ticket back on the queue because its condition was observed
 * again. Best-effort by construction: a detector filing a routine observation
 * must never fail because the reopen lost a race, so a rejected transition is
 * swallowed and the caller still gets its `deduped` answer.
 */
async function reopenBlockedOnRepeatObservation(id: number, evidence: string): Promise<void> {
  try {
    await transitionSuggestion(id, 'approved', 'system', {
      note: `Re-observed while blocked, reopened by the detector: ${evidence.slice(0, 600)}`,
    })
  } catch {
    // Raced with another writer, or the row moved off `blocked` in between.
    // Either way the ticket is no longer silently muted, which is the point.
  }
}

/**
 * ADR-008 step 2. File a ticket for a PR that already exists and carries none.
 *
 * The release engine refuses to merge an eligible PR without a linked ticket in
 * status `verified`. Work born in an owner-attended session never touches the
 * bus, so it can never acquire that ticket, and the owner merges it by hand
 * forever. This is the backstop that gives such a PR a bus row so QA can review
 * it and the engine can then merge it.
 *
 * Deliberately NOT a `transitionSuggestion` call: there is no prior status to
 * transition from. It is a raw insert at `pr_open`, which is the literal truth
 * (a PR is open, waiting on QA). Routing it through `proposed → approved →
 * in_progress` would be theatre, since the work is already done and there is no
 * claim to make.
 *
 * This writes no new capability into the merge path. The row lands at `pr_open`,
 * and every gate downstream is unchanged: QA still has to verify it, the
 * protected-path classifier still runs first, CI still has to be green. All it
 * removes is the state where a PR is structurally unreviewable.
 *
 * Idempotency comes from `dedupeKey`, not from a GitHub label: the partial-
 * unique index from migration 070 covers rows whose status is not applied or
 * dismissed, so a second call for the same PR is swallowed by
 * `onConflictDoNothing` while the first ticket is still live. That also means a
 * ticket the owner dismisses will be re-filed if the PR is still open and still
 * ticket-less, which is correct: dismissing the ticket does not close the PR.
 *
 * Returns the new ticket id, or 0 when the insert was deduped.
 */
export async function fileTicketForOpenPr(input: {
  prNumber: number
  prUrl: string
  prTitle: string
  headRef: string
}): Promise<number> {
  const [row] = await db
    .insert(homepageTeamSuggestions)
    .values({
      team:       'strategy',
      category:   'other',
      kind:       'code',
      // The PR title is opaque text here, never executed, and rendered through
      // escapeHtml downstream like every other suggestion body.
      suggestion:
        `Auto-filed for PR #${input.prNumber} (${input.headRef}), which had no linked ticket. ` +
        `Title: ${input.prTitle}\n\n` +
        `The work is already done and the PR is open. QA should review the diff and the ` +
        `rendered preview as normal, then verify or bounce. DONE WHEN: QA has recorded a ` +
        `verdict on ${input.prUrl}.`,
      status:     'pr_open',
      // `auto` matches how the auto-approve valves record a non-human decision.
      decidedBy:  'auto',
      // The owner is the only actor who can move a bounced ticket back to
      // `pr_open` after pushing a fix, and this work came from his session.
      assignee:   'owner',
      applyRef:   input.prUrl,
      priority:   3,
      dedupeKey:  autofileDedupeKey(input.prNumber),
    })
    .onConflictDoNothing()
    .returning({ id: homepageTeamSuggestions.id })

  if (!row?.id) return 0

  // The link table is what `resolveTicketForPr` reads first and trusts most, so
  // the engine finds this ticket on its next cycle without going near the title
  // parser.
  await addTicketLinks(row.id, [{ kind: 'pr', ref: input.prUrl, state: 'open' }])
  return row.id
}

/** Stable dedupe key for an auto-filed ticket. Also the marker that lets the
 *  abandoned-PR sweep restrict itself to rows it created. */
export function autofileDedupeKey(prNumber: number): string {
  return `autofile:pr-${prNumber}`
}

export interface SuggestionListFilter {
  team?: TeamId | undefined
  targetTeam?: TeamId | undefined
  status?: string | undefined
  /** Any-of status filter (070); combines with `status` as an additional AND. */
  statuses?: readonly string[] | undefined
  /** Any-of kind filter (070). */
  kinds?: readonly string[] | undefined
  assignee?: string | undefined
  /**
   * Any-of dedupe-key filter. Exists so a detector that files rows under a
   * known key can find them again to close them: before this, the only
   * key-to-id lookup in the codebase was inlined inside createSuggestionDetailed
   * and unexported, so the one caller that needed it went around the transition
   * map with a bulk UPDATE instead.
   */
  dedupeKeys?: readonly string[] | undefined
  updatedSince?: Date | undefined
  limit?: number | undefined
  /**
   * priority = work-queue order (most urgent, then oldest).
   * age      = oldest first.
   * created  = newest first (default, what the admin dashboard has always had).
   */
  orderBy?: 'priority' | 'age' | 'created' | undefined
}

export const SUGGESTION_LIST_MAX = 200

export async function listSuggestions(filter: SuggestionListFilter = {}) {
  const conditions = []
  if (filter.team) conditions.push(eq(homepageTeamSuggestions.team, filter.team))
  if (filter.targetTeam) conditions.push(eq(homepageTeamSuggestions.targetTeam, filter.targetTeam))
  if (filter.status) conditions.push(eq(homepageTeamSuggestions.status, filter.status))
  if (filter.statuses?.length) {
    conditions.push(inArray(homepageTeamSuggestions.status, [...filter.statuses]))
  }
  if (filter.kinds?.length) {
    conditions.push(inArray(homepageTeamSuggestions.kind, [...filter.kinds]))
  }
  if (filter.dedupeKeys?.length) {
    conditions.push(inArray(homepageTeamSuggestions.dedupeKey, [...filter.dedupeKeys]))
  }
  if (filter.assignee) conditions.push(eq(homepageTeamSuggestions.assignee, filter.assignee))
  if (filter.updatedSince) {
    conditions.push(gte(homepageTeamSuggestions.updatedAt, filter.updatedSince))
  }
  const order =
    filter.orderBy === 'priority'
      ? [asc(homepageTeamSuggestions.priority), asc(homepageTeamSuggestions.createdAt)]
      : filter.orderBy === 'age'
        ? [asc(homepageTeamSuggestions.createdAt)]
        : [desc(homepageTeamSuggestions.createdAt)]
  const limit = Math.min(SUGGESTION_LIST_MAX, Math.max(1, filter.limit ?? 100))
  const q = db.select().from(homepageTeamSuggestions)
  return (conditions.length ? q.where(and(...conditions)) : q)
    .orderBy(...order)
    .limit(limit)
}

/** Owner decision from the admin UI: proposed -> approved | dismissed. */
export async function decideSuggestion(id: number, status: 'approved' | 'dismissed'): Promise<void> {
  await db
    .update(homepageTeamSuggestions)
    .set({ status, decidedBy: 'owner', decidedAt: new Date() })
    .where(and(eq(homepageTeamSuggestions.id, id), eq(homepageTeamSuggestions.status, 'proposed')))
}

/**
 * Owner retires a stale already-approved row: approved -> dismissed. Needed
 * because auto-approve (and past owner approvals) can leave rows in `approved`
 * that later ship by other means, get superseded, or turn out not to be the
 * agent-editor's to apply. Guarded on status='approved' so it is idempotent and
 * cannot touch pr_open/applied rows (a PR in flight is closed on GitHub, not
 * here). Reversible: re-approving is a status flip back to 'approved'.
 */
export async function retireSuggestion(id: number): Promise<void> {
  await db
    .update(homepageTeamSuggestions)
    .set({ status: 'dismissed', decidedBy: 'owner', decidedAt: new Date() })
    .where(and(eq(homepageTeamSuggestions.id, id), eq(homepageTeamSuggestions.status, 'approved')))
}

/**
 * Re-file a suggestion under the kind that actually has an executor.
 *
 * A lot of what agents file as `process` ("the playbook should compute the
 * weekday differently") is really instruction work, and some is a code change.
 * `kind` was previously write-once at insert, so a misfiled row could never
 * reach the lane that would have done it — the 52-row `process` pile was
 * mostly this.
 *
 * Deliberately one-way: `process` is the only source, and the targets are
 * lanes with real executors. Rekinding *into* a retirable kind would compose
 * with the hygiene pass into an unaudited kill switch (rekind an inconvenient
 * `instructions` row to `process`, then retire it), so that direction stays
 * closed. Every rekind leaves a note link naming the actor.
 */
export const REKIND_FROM_KINDS: readonly string[] = ['process']
export const REKIND_TO_KINDS: readonly string[] = ['instructions', 'code']
export const REKIND_ACTORS: readonly TicketActor[] = ['owner', 'agent:agent-editor']

export async function rekindSuggestion(
  id: number,
  toKind: string,
  actor: TicketActor,
  note?: string,
): Promise<TicketRow> {
  if (!isTicketActor(actor) || !REKIND_ACTORS.includes(actor)) {
    throw new Response(`Forbidden: actor '${String(actor)}' may not rekind`, { status: 403 })
  }
  if (!REKIND_TO_KINDS.includes(toKind)) {
    throw new Response(
      `Bad Request: cannot rekind to '${toKind}' (allowed: ${REKIND_TO_KINDS.join(', ')})`,
      { status: 400 },
    )
  }

  const [row] = await db
    .select()
    .from(homepageTeamSuggestions)
    .where(eq(homepageTeamSuggestions.id, id))
    .limit(1)
  if (!row) throw new Response(`Not Found: suggestion ${id}`, { status: 404 })

  if (!REKIND_FROM_KINDS.includes(row.kind ?? '')) {
    throw new Response(
      `Conflict: only ${REKIND_FROM_KINDS.join('/')} rows may be rekinded, suggestion ${id} is '${row.kind}'`,
      { status: 409 },
    )
  }
  if ((TERMINAL_TICKET_STATUSES as readonly string[]).includes(row.status ?? '')) {
    throw new Response(`Conflict: suggestion ${id} is ${row.status}`, { status: 409 })
  }

  const fromKind = row.kind
  const updated = await db
    .update(homepageTeamSuggestions)
    .set({ kind: toKind, updatedAt: new Date() })
    .where(and(eq(homepageTeamSuggestions.id, id), eq(homepageTeamSuggestions.kind, fromKind)))
    .returning()
  if (updated.length === 0) {
    throw new Response(`Conflict: suggestion ${id} changed underneath the rekind`, { status: 409 })
  }

  await addTicketLinks(id, [{
    kind: 'note',
    ref: `rekind ${fromKind} -> ${toKind} by ${actor}${note ? `: ${note}` : ''}`,
    state: updated[0]!.status ?? undefined,
  }])

  return updated[0]!
}

/**
 * agent-editor retiring an approved row with no executor, during its hygiene
 * pass. Thin wrapper over the transition map so ALLOWED stays the only source
 * of transition authority (the kind fence lives in the map, not here).
 */
export async function agentRetireSuggestion(
  id: number,
  actor: TicketActor,
  note: string,
): Promise<TicketRow> {
  return transitionSuggestion(id, 'dismissed', actor, { note })
}

/**
 * Append a free-text note to a ticket without changing its status. Lets a run
 * record what it did to a row it could not close (refused, partially handled)
 * so the next reader sees the history instead of re-deriving it.
 */
export async function addSuggestionNote(id: number, ref: string): Promise<void> {
  const [row] = await db
    .select({ id: homepageTeamSuggestions.id, status: homepageTeamSuggestions.status })
    .from(homepageTeamSuggestions)
    .where(eq(homepageTeamSuggestions.id, id))
    .limit(1)
  if (!row) throw new Response(`Not Found: suggestion ${id}`, { status: 404 })
  await addTicketLinks(id, [{ kind: 'note', ref, state: row.status ?? undefined }])
}

/**
 * Agent-side transition (agent-editor): approved -> pr_open -> applied, with
 * the PR URL in applyRef. Throws 409 on any other transition — agents can
 * never move a row out of `proposed`; that decision is the owner's.
 *
 * LEGACY COMPATIBILITY PATH, deliberately untouched by the ticket lifecycle
 * below. agent-editor's docs-only loop (approved -> pr_open -> applied) runs
 * through here and through the `mark` op on /api/team/suggestion; the richer
 * `transitionSuggestion` is additive and every existing call site keeps its
 * exact semantics. New callers should prefer `transitionSuggestion`.
 */
export async function markSuggestion(
  id: number,
  status: 'pr_open' | 'applied',
  applyRef: string,
): Promise<void> {
  const allowedFrom = status === 'pr_open' ? 'approved' : 'pr_open'
  const res = await db
    .update(homepageTeamSuggestions)
    .set({ status, applyRef, updatedAt: new Date() })
    .where(and(eq(homepageTeamSuggestions.id, id), eq(homepageTeamSuggestions.status, allowedFrom)))
    .returning({ id: homepageTeamSuggestions.id })
  if (res.length === 0) {
    throw new Response(
      `Conflict: suggestion ${id} is not in '${allowedFrom}' (agents cannot move rows out of 'proposed')`,
      { status: 409 },
    )
  }
}

// ── Ticket lifecycle (070) ───────────────────────────────────────────────────
//
// The improvement bus doubles as the ticket board for the self-healing loop:
// a detector files a ticket, the owner (or an auto-approve valve) approves it,
// a dev agent CLAIMS it, opens a PR, QA reviews and verifies, and the release
// engine applies it after a merge and a green smoke run.
//
//   proposed ─owner|auto→ approved ─claim→ in_progress ─assignee→ pr_open
//     ─qa→ in_review ─qa→ verified ─system→ applied
//
// Every edge is declared once, in ALLOWED, with the actors permitted to walk
// it. A pair that is not in the map is a 409. Three structural properties fall
// out of the map rather than out of prose:
//   - QA cannot reach `applied`. It has no edge to it from anywhere.
//   - Only the release engine (`system`) applies code tickets, and only from
//     `verified`, which only QA can produce.
//   - The out-of-band merged-PR reconcile edges (approved/blocked/pr_open/
//     in_review -> applied) are `outOfBandReconcileOnly`: a plain `system`
//     transition cannot walk them, only a caller that has declared itself the
//     reconcile path can, and that declaration is an in-process signal the
//     team HTTP API cannot express.

export const TICKET_STATUSES = [
  'proposed', 'approved', 'in_progress', 'pr_open', 'in_review',
  'verified', 'applied', 'blocked', 'dismissed',
] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

/** Nothing transitions out of these. */
export const TERMINAL_TICKET_STATUSES: readonly TicketStatus[] = ['applied', 'dismissed']

export function isTicketStatus(v: unknown): v is TicketStatus {
  return typeof v === 'string' && (TICKET_STATUSES as readonly string[]).includes(v)
}

/**
 * Who is asking. `owner` is a human in /admin, `auto` is an auto-approve valve,
 * `system` is server-side machinery (lease expiry, the release engine), and
 * `agent:<slug>` is one of the roster agents calling the team API.
 */
export type TicketActor = 'owner' | 'auto' | 'system' | `agent:${string}`

const AGENT_ACTOR_RE = /^agent:[a-z0-9][a-z0-9-]{0,24}$/

export function isTicketActor(v: unknown): v is TicketActor {
  return typeof v === 'string'
    && (v === 'owner' || v === 'auto' || v === 'system' || AGENT_ACTOR_RE.test(v))
}

/**
 * The only kinds agent-editor may carry all the way to `applied` on its own.
 * These are the docs/config rows it has always owned end to end; anything else
 * (notably `code`) has to go through QA and the release engine.
 */
export const AGENT_EDITOR_APPLY_KINDS: readonly string[] = ['instructions', 'agent-def', 'config']

/** Agents permitted to claim an approved ticket. */
export const CLAIMANT_ACTORS: readonly TicketActor[] = ['agent:rr7-engineer', 'agent:agent-editor']

/**
 * Kinds agent-editor may retire on its own during its weekly hygiene pass.
 *
 * These are the kinds with no automated executor: the taxonomy routes them to
 * "the owner acts directly", and with auto-approve on they never pass through
 * a triage click, so nothing ever closed one. 52 `process` rows accumulated
 * this way, including run-observations that were only ever notes to nobody.
 * Deliberately excludes `code` (the ticket lane owns those) and
 * `instructions`/`agent-def`/`config` (agent-editor's own work queue — letting
 * it retire those would let it dismiss the suggestions that constrain it).
 */
export const AGENT_RETIRE_KINDS: readonly string[] = ['process', 'strategy', 'program']

/**
 * Entry agents for the daily routines, permitted to close an inbound
 * operational row they acted on.
 *
 * Routed findings (inventory-sentinel's out-of-stock carousel swaps, say) used
 * to be filed at a team and then read by nobody, because the daily playbooks
 * only ever *wrote* suggestions. Now each routine reads its inbound approved
 * rows, and a row it actually acts on has to be closable in the same run or
 * tomorrow's run re-reads it forever.
 */
export const RUN_CLOSE_ACTORS: readonly TicketActor[] = [
  'agent:homepage-orchestrator',
  'agent:content-writer',
  'agent:social-media-manager',
  'agent:product-manager',
  'agent:store-strategist',
]

/** Operational kinds a daily run may close once it has executed the ask. */
export const RUN_CLOSE_KINDS: readonly string[] = ['process', 'strategy']

/**
 * Kinds a detector may close on its own evidence, as actor `system`.
 *
 * Narrower than RUN_CLOSE_KINDS on purpose. This edge is not "a human-equivalent
 * judged the work done", it is "the machine that raised the alarm observed the
 * condition clear", so it is fenced to the one kind detectors actually file.
 * Nothing here can close an instruction, a code ticket, or a strategy row.
 */
export const DETECTOR_SELF_CLOSE_KINDS: readonly string[] = ['process']

export interface TransitionRule {
  to: TicketStatus
  /**
   * Literal actors permitted on this edge. The pseudo-actor `assignee` matches
   * whoever currently holds the claim, so "only the agent that claimed it may
   * open its PR" is one entry rather than a special case in the code.
   */
  actors: readonly (TicketActor | 'assignee')[]
  /** When present, the ticket's `kind` must be one of these. */
  kinds?: readonly string[]
  /** Edges that always burn a fix attempt (QA bounce, smoke-failure bounce). */
  incrementAttempt?: boolean
  /**
   * The fence on the merged-PR reconcile edges. A rule carrying this flag is
   * matched only when the transition arrives through the out-of-band reconcile
   * path (see `viaOutOfBandReconcile` on TransitionOpts and
   * `runWithOutOfBandReconcile`). Without the fence the actor check alone
   * guarded these edges, so ANY present or future `system` call site could
   * close an approved/blocked/pr_open/in_review ticket of any kind at the map
   * level; the "only on a merged PR" precondition lived solely in the sweeps'
   * own code. With it, the map itself rejects every caller that has not
   * declared itself a reconciler, and the declaration is an in-process signal
   * the team HTTP API cannot express, so no agent posting to
   * /api/team/suggestion can reach these edges at all.
   */
  outOfBandReconcileOnly?: boolean
}

/** Every non-terminal status can be retired by the owner. */
const OWNER_DISMISS: TransitionRule = { to: 'dismissed', actors: ['owner'] }

export const ALLOWED: Readonly<Record<TicketStatus, readonly TransitionRule[]>> = {
  proposed: [
    { to: 'approved', actors: ['owner', 'auto'] },
    // A detector closing its own alarm because the condition it reported has
    // demonstrably cleared. Reachable only by `system` and only for `process`,
    // and it has to exist at `proposed` as well as `approved`: a detector row
    // on a team without auto-approve never reaches `approved`, and while it
    // sits open it holds the undated dedupe key, so the detector can never file
    // for that slot again. That is how four homepage freshness slots went mute.
    { to: 'applied', actors: ['system'], kinds: DETECTOR_SELF_CLOSE_KINDS },
    OWNER_DISMISS,
  ],
  approved: [
    { to: 'in_progress', actors: CLAIMANT_ACTORS },
    // A daily routine executed the ask in this run: close it so it is not
    // re-read tomorrow. Operational kinds only.
    { to: 'applied', actors: RUN_CLOSE_ACTORS, kinds: RUN_CLOSE_KINDS },
    // Same detector self-close, from the status auto-approve actually puts
    // these rows in. Kept as its own rule rather than adding `system` to
    // RUN_CLOSE_ACTORS, which would also hand the release engine the ability to
    // close `strategy` rows it has no business touching.
    { to: 'applied', actors: ['system'], kinds: DETECTOR_SELF_CLOSE_KINDS },
    // Out-of-band merged-PR reconcile only, mirroring the `pr_open -> applied`
    // system edge below. `applied` means "the fix is live on xdipx.com", and the
    // sweep earns that claim the same way it does on the pr_open edge: it asks
    // GitHub whether the PR this ticket links is already merged, and only a
    // `merged: true` from GitHub itself lets it write this edge. Nothing here
    // can mark unmerged work as shipped.
    //
    // Why `approved` can be stranded at all: a bounced ticket whose lease
    // expires returns to `approved` with its PR link intact, and if the owner
    // then merges that PR by hand the ticket sits on the unassigned queue
    // forever while its fix is live in production. Tickets #120 and #423 sat
    // exactly this way with PRs #436 and #429 merged. Unlike the detector
    // self-close above this edge is deliberately not fenced by kind: a
    // hand-merged PR strands a ticket of any kind, exactly as on `pr_open`.
    // What fences it instead of a kind list is `outOfBandReconcileOnly`: a
    // plain system transition cannot walk it, only the reconcile sweeps can.
    { to: 'applied', actors: ['system'], outOfBandReconcileOnly: true },
    // agent-editor's hygiene pass retiring a row with no executor. Kinds are
    // fenced so it can never dismiss the instruction rows aimed at itself.
    { to: 'dismissed', actors: ['agent:agent-editor'], kinds: AGENT_RETIRE_KINDS },
    OWNER_DISMISS,
  ],
  in_progress: [
    { to: 'pr_open', actors: ['assignee'] },
    { to: 'blocked',  actors: ['assignee', 'system'] },
    // Lease expiry releases the ticket back onto the unassigned queue.
    { to: 'approved', actors: ['system'] },
    OWNER_DISMISS,
  ],
  pr_open: [
    { to: 'in_review', actors: ['agent:qa-reviewer'] },
    // The legacy agent-editor docs path, preserved verbatim.
    { to: 'applied', actors: ['agent:agent-editor'], kinds: AGENT_EDITOR_APPLY_KINDS },
    // Out-of-band reconciliation. See the note on the `in_review` edge below.
    // Fenced: the merged-PR precondition used to live only in the sweep, so
    // any plain system call could walk this edge. Now the map itself demands
    // the reconcile declaration.
    { to: 'applied', actors: ['system'], outOfBandReconcileOnly: true },
    // Abandoned-PR cleanup for ADR-008 step 2 (`dismissTicketsForClosedUnmergedPrs`).
    // Without it an auto-filed ticket whose PR is closed unmerged sits at
    // `pr_open` forever, and the autofile backstop turns into a litter machine.
    //
    // Two things bound this edge. It fires only when GitHub itself reports the
    // PR closed with `merged !== true`, so it follows reality rather than
    // deciding it. And its sole caller restricts the update to rows whose
    // `dedupe_key` starts with `autofile:pr-`, so it can only ever retire
    // tickets the autofile pass created, never one an agent or the owner filed.
    //
    // This is not a gate weakening: `dismissed` is terminal and ships nothing.
    // The worst case is a closed work item, not a bad deploy, and the PR being
    // closed unmerged is what makes that the right outcome.
    { to: 'dismissed', actors: ['system'] },
    OWNER_DISMISS,
  ],
  in_review: [
    { to: 'verified', actors: ['agent:qa-reviewer'] },
    // FAIL bounce: back to the assignee with a reason, one attempt spent.
    { to: 'in_progress', actors: ['agent:qa-reviewer'], incrementAttempt: true },
    // Out-of-band reconciliation, same edge as `pr_open` above.
    //
    // `applied` means "the fix is live on xdipx.com". The engine earns that
    // claim by merging, deploying, and smoking. The sweep earns it a different
    // way: it asks GitHub whether the linked PR is already merged, and only a
    // `merged: true` from GitHub itself lets it write this edge. Nothing here
    // can mark unmerged work as shipped.
    //
    // Without these two edges a PR the owner merges by hand strands its ticket
    // forever, because the only exits from `pr_open`/`in_review` were QA and an
    // owner dismissal. Tickets #291, #323 and #441 sat exactly this way while
    // their PRs (#413, #414, #420) were live in production, and R-DEV then
    // spent later passes re-diagnosing incidents that had already shipped.
    // The sweep only ever moves a ticket in the direction reality already went.
    // Fenced like the `pr_open` edge above: reconcile callers only.
    { to: 'applied', actors: ['system'], outOfBandReconcileOnly: true },
    OWNER_DISMISS,
  ],
  verified: [
    // Release engine only, post-merge and post-smoke.
    { to: 'applied', actors: ['system'] },
    // Merge, deploy, or smoke failed: bounce and spend an attempt.
    { to: 'in_progress', actors: ['system'], incrementAttempt: true },
    OWNER_DISMISS,
  ],
  blocked: [
    { to: 'approved', actors: ['owner', 'system'] },
    // Out-of-band merged-PR reconcile only, mirroring the `pr_open -> applied`
    // system edge above. Only a `merged: true` from GitHub itself lets the
    // sweep write this edge, so nothing here can mark unmerged work as shipped.
    //
    // A blocked ticket whose PR the owner then merges by hand is otherwise
    // stranded forever: `blocked` used to have no exit but the owner, so the
    // fix went live while the ticket kept holding its dedupe key and kept
    // showing in the blocked count. Ticket #455 sat exactly this way with
    // PR #508 merged. Fenced by `outOfBandReconcileOnly` like the `approved`
    // edge above: a plain system transition is rejected at the map.
    { to: 'applied', actors: ['system'], outOfBandReconcileOnly: true },
    OWNER_DISMISS,
  ],
  applied: [],
  dismissed: [],
}

export interface TransitionContext {
  assignee?: string | null | undefined
  kind?: string | null | undefined
  /** True only when the call arrives through the out-of-band reconcile path.
   *  Rules flagged `outOfBandReconcileOnly` match on no other condition. */
  viaOutOfBandReconcile?: boolean | undefined
}

/**
 * Ambient reconcile scope for sweep code whose transition calls live outside
 * this module and outside the release engine's file (today that is
 * ticket-out-of-band-sweep.server.ts, kept out of the protected engine file on
 * purpose so its cadence can be tuned through the normal PR lane). The engine
 * wraps its invocation of that sweep in `runWithOutOfBandReconcile`, and every
 * transitionSuggestion call inside the wrapped promise chain carries the
 * reconcile declaration without the sweep having to thread an option through.
 *
 * This is an in-process signal only. Nothing arriving over HTTP can set it,
 * and the /api/team/suggestion transition op does not forward any equivalent
 * field, so the fenced edges are structurally unreachable from the team API.
 */
const outOfBandReconcileScope = new AsyncLocalStorage<boolean>()

export function runWithOutOfBandReconcile<T>(fn: () => Promise<T>): Promise<T> {
  return outOfBandReconcileScope.run(true, fn)
}

/**
 * The single arbiter of "may this actor walk this edge". Pure: no DB, no time,
 * no env. `ctx` carries the row facts the map needs (current assignee for the
 * `assignee` pseudo-actor, kind for the agent-editor apply carve-out).
 */
export function findTransitionRule(
  from: TicketStatus,
  to: TicketStatus,
  actor: TicketActor,
  ctx: TransitionContext = {},
): TransitionRule | null {
  for (const rule of ALLOWED[from] ?? []) {
    if (rule.to !== to) continue
    const actorOk = rule.actors.some(a =>
      a === 'assignee' ? !!ctx.assignee && ctx.assignee === actor : a === actor,
    )
    if (!actorOk) continue
    if (rule.kinds && !rule.kinds.includes(ctx.kind ?? '')) continue
    // The reconcile fence: these rules are invisible to any caller that has
    // not declared itself the out-of-band reconcile path.
    if (rule.outOfBandReconcileOnly && ctx.viaOutOfBandReconcile !== true) continue
    return rule
  }
  return null
}

export function isTransitionAllowed(
  from: TicketStatus,
  to: TicketStatus,
  actor: TicketActor,
  ctx: TransitionContext = {},
): boolean {
  return findTransitionRule(from, to, actor, ctx) !== null
}

export interface TicketLinkInput {
  kind: string           // pr|issue|run|url|doc|commit|deploy|note
  ref: string
  state?: string | undefined  // open|merged|closed|passed|failed|ready
}

export interface TransitionOpts {
  /** Free-text reason, stored as a `note` link so it survives on the ticket. */
  note?: string | undefined
  links?: readonly TicketLinkInput[] | undefined
  lastError?: string | undefined
  /** Force an attempt increment on an edge that does not always spend one. */
  incrementAttempt?: boolean | undefined
  /**
   * Declares this call the out-of-band merged-PR reconcile, unlocking the
   * `outOfBandReconcileOnly` edges. Passed only by the release engine's sweep
   * call sites, which have already asked GitHub and received `merged: true`
   * for the ticket's linked PR. Deliberately NOT forwarded by the
   * /api/team/suggestion transition op, so the fence cannot be crossed from
   * the HTTP surface. Sweep code that cannot pass options gets the same
   * declaration ambiently via `runWithOutOfBandReconcile`.
   */
  viaOutOfBandReconcile?: boolean | undefined
}

export type TicketRow = typeof homepageTeamSuggestions.$inferSelect

async function addTicketLinks(id: number, links: readonly TicketLinkInput[]): Promise<void> {
  if (links.length === 0) return
  await db.insert(suggestionLinks).values(
    links.map(l => ({
      suggestionId: id,
      kind:         l.kind.slice(0, 12),
      ref:          l.ref,
      state:        l.state ? l.state.slice(0, 16) : null,
    })),
  )
}

/**
 * Lease granted to the assignee when a ticket is bounced back to `in_progress`.
 *
 * Long enough to survive until the next dev pass (a QA bounce at ~15:40 has to
 * still be held at 20:00), short enough that a dead agent releases the row the
 * same day. See the renewal in transitionSuggestion for why this exists at all.
 */
export const BOUNCE_LEASE_SEC = 6 * 3600

/**
 * Guarded ticket transition. Throws a 404 Response when the ticket is gone and
 * a 409 when the (from, to, actor) triple is not in ALLOWED — including the
 * case where the row moved underneath us between the read and the write, since
 * the UPDATE is guarded on the status we validated against.
 */
export async function transitionSuggestion(
  id: number,
  to: TicketStatus,
  actor: TicketActor,
  opts: TransitionOpts = {},
): Promise<TicketRow> {
  if (!isTicketStatus(to)) {
    throw new Response(`Bad Request: unknown status '${String(to)}'`, { status: 400 })
  }
  if (!isTicketActor(actor)) {
    throw new Response(`Bad Request: unknown actor '${String(actor)}'`, { status: 400 })
  }
  const [row] = await db
    .select()
    .from(homepageTeamSuggestions)
    .where(eq(homepageTeamSuggestions.id, id))
    .limit(1)
  if (!row) throw new Response(`Not Found: suggestion ${id}`, { status: 404 })

  const from = row.status as TicketStatus
  // The reconcile declaration travels either explicitly in opts (the engine's
  // own orphan sweep) or ambiently through runWithOutOfBandReconcile (the
  // out-of-band sweep module, whose transition calls live outside the engine).
  const viaOutOfBandReconcile =
    opts.viaOutOfBandReconcile === true || outOfBandReconcileScope.getStore() === true
  const rule = findTransitionRule(from, to, actor, {
    assignee: row.assignee,
    kind: row.kind,
    viaOutOfBandReconcile,
  })
  if (!rule) {
    throw new Response(
      `Conflict: '${from}' -> '${to}' is not permitted for actor '${actor}' on suggestion ${id}`,
      { status: 409 },
    )
  }

  const now = new Date()
  const patch: Record<string, unknown> = { status: to, updatedAt: now }
  if (rule.incrementAttempt || opts.incrementAttempt) {
    patch['attemptCount'] = sql`${homepageTeamSuggestions.attemptCount} + 1`
  }
  if (opts.lastError !== undefined) patch['lastError'] = opts.lastError
  // A transition into `blocked` with no stated reason gets a stamped one. Ten
  // of the eleven blocked rows on 2026-08-05 had an empty last_error, which
  // left the owner digest nothing to flag and the owner nothing to act on. The
  // transition itself is never rejected, since refusing it would strand the
  // ticket in a worse state; the stamp just makes the silence attributable.
  if (to === 'blocked' && !opts.lastError?.trim() && !opts.note?.trim()) {
    patch['lastError'] = `blocked without stated reason by ${actor}`
  }
  // Returning to `approved` puts the ticket back on the unassigned queue,
  // whether that came from a lease expiry or from an unblock.
  if (to === 'approved') {
    patch['assignee'] = null
    patch['claimedAt'] = null
    patch['claimExpiresAt'] = null
  }
  if (to === 'verified') {
    patch['verifiedBy'] = actor
    patch['verifiedAt'] = now
  }
  // A bounce (`in_review` or `verified` -> `in_progress`) hands the ticket back
  // to the agent that still holds it, but under a lease that expired hours ago:
  // nothing on this edge used to touch claim_expires_at, so the row landed in
  // `in_progress` already stale. The next expireStaleClaims() sweep then reaped
  // it to `approved` and cleared the assignee, and since that sweep runs inside
  // gate(), the 20:00 dev pass's OWN gate call was what emptied the bounced
  // queue it then went looking for. Renew the lease so the bounce survives to
  // the pass that has to act on it. Only when a claim exists: an unassigned row
  // has no holder to grant time to, and `-> approved` above still clears it.
  if (to === 'in_progress' && row.assignee) {
    patch['claimedAt'] = now
    patch['claimExpiresAt'] = new Date(now.getTime() + BOUNCE_LEASE_SEC * 1000)
  }
  // decided_by/decided_at record the triage decision and the retirement. A
  // later system move (lease release, unblock) must not overwrite who triaged.
  if (from === 'proposed' || to === 'dismissed') {
    patch['decidedBy'] = actor
    patch['decidedAt'] = now
  }
  // Backward compat for readers of apply_ref (admin UI, agent-editor history):
  // the first PR link on the applying transition fills it if it is still empty.
  if (to === 'applied' && !row.applyRef) {
    const pr = opts.links?.find(l => l.kind === 'pr')
    if (pr) patch['applyRef'] = pr.ref
  }

  const guards = [eq(homepageTeamSuggestions.id, id), eq(homepageTeamSuggestions.status, from)]
  if (rule.actors.includes('assignee')) {
    guards.push(eq(homepageTeamSuggestions.assignee, actor))
  }
  const updated = await db
    .update(homepageTeamSuggestions)
    .set(patch)
    .where(and(...guards))
    .returning()
  if (updated.length === 0) {
    throw new Response(
      `Conflict: suggestion ${id} changed underneath the '${from}' -> '${to}' transition`,
      { status: 409 },
    )
  }

  const links: TicketLinkInput[] = [...(opts.links ?? [])]
  if (opts.note) links.push({ kind: 'note', ref: opts.note, state: to })
  await addTicketLinks(id, links)

  return updated[0]!
}

/**
 * Release zombie claims: rows still `in_progress` past their lease go back to
 * `approved` with the assignee cleared so another agent can pick them up. The
 * attempt count is deliberately untouched — a dead sandbox is not a failed fix
 * attempt, and burning attempts on infrastructure noise would escalate healthy
 * tickets to the owner. Sibling of expireStaleRuns(), same 5-minute throttle.
 *
 * A NULL lease counts as already expired. SQL NULL never satisfies `<`, so a
 * row that reached `in_progress` without a lease used to be skipped by every
 * sweep, forever. That is reachable in normal operation: the QA bounce edge
 * only renews the lease `if (row.assignee)`, so bouncing a row whose assignee a
 * previous reap had already cleared lands it in `in_progress` with no lease and
 * no holder — invisible to this sweep, and invisible to both executors, which
 * claim from `approved` only. Tickets #120, #423 and #471 sat exactly that way
 * for six days (#878).
 */
export async function expireStaleClaims(): Promise<number> {
  const res = await db
    .update(homepageTeamSuggestions)
    .set({
      status:         'approved',
      assignee:       null,
      claimedAt:      null,
      claimExpiresAt: null,
      updatedAt:      new Date(),
    })
    .where(and(
      eq(homepageTeamSuggestions.status, 'in_progress'),
      or(
        lt(homepageTeamSuggestions.claimExpiresAt, new Date()),
        isNull(homepageTeamSuggestions.claimExpiresAt),
      ),
    ))
    .returning({ id: homepageTeamSuggestions.id })
  return res.length
}

// ── Claims ───────────────────────────────────────────────────────────────────

export const CLAIM_LEASE_DEFAULT_SEC = 1200
export const CLAIM_LEASE_MAX_SEC = 6 * 3600

export interface ClaimFilter {
  kind?: string | undefined
  status?: TicketStatus | undefined
  team?: TeamId | undefined
  targetTeam?: TeamId | undefined
}

export interface ClaimInput {
  assignee: TicketActor
  leaseSeconds?: number | undefined
  /** Claim one specific ticket instead of the head of the queue. */
  id?: number | undefined
  filter?: ClaimFilter | undefined
}

export type ClaimResult = { empty: true } | { empty: false; id: number }

interface ResolvedClaim {
  assignee: TicketActor
  leaseSeconds: number
  from: TicketStatus
  id?: number | undefined
  filter: ClaimFilter
}

/**
 * One statement, no read-then-write. The inner SELECT takes a row lock and
 * SKIP LOCKED steps over rows another claimer is already taking, so two
 * concurrent claims of the same filter can never come back with the same
 * ticket. Splitting this into a SELECT and a later UPDATE is exactly the race
 * this exists to avoid; keep it a single statement.
 */
export function buildClaimQuery(c: ResolvedClaim): SQL {
  const conds: SQL[] = [sql`c.status = ${c.from}`]
  if (c.id != null) conds.push(sql`c.id = ${c.id}`)
  if (c.filter.kind) conds.push(sql`c.kind = ${c.filter.kind}`)
  if (c.filter.team) conds.push(sql`c.team = ${c.filter.team}`)
  if (c.filter.targetTeam) conds.push(sql`c.target_team = ${c.filter.targetTeam}`)
  // A live claim on the row blocks it; an expired one does not (expireStaleClaims
  // is throttled, so the queue must not wait on it to reclaim).
  conds.push(sql`(c.claim_expires_at IS NULL OR c.claim_expires_at < now())`)
  return sql`
    UPDATE homepage_team_suggestions AS s
       SET status           = 'in_progress',
           assignee         = ${c.assignee},
           claimed_at       = now(),
           claim_expires_at = now() + make_interval(secs => ${c.leaseSeconds}),
           updated_at       = now()
     WHERE s.id = (
       SELECT c.id
         FROM homepage_team_suggestions AS c
        WHERE ${sql.join(conds, sql` AND `)}
        ORDER BY c.priority ASC, c.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING s.id AS id`
}

export type SqlExecutor = (query: SQL) => Promise<{ rows: Record<string, unknown>[] }>

const defaultExecutor: SqlExecutor = async query =>
  (await db.execute(query)) as unknown as { rows: Record<string, unknown>[] }

/**
 * Atomically take the head of a work queue. Returns `{empty:true}` when there
 * is nothing claimable, which is the normal case for an idle routine and is
 * not an error. The claim IS the `-> in_progress` transition, so it is refused
 * (409) for any actor the transition map would not let claim from that status.
 *
 * `exec` is injectable so the atomicity contract can be exercised in tests
 * without a database; production always uses the single-statement default.
 */
export async function claimSuggestion(
  input: ClaimInput,
  exec: SqlExecutor = defaultExecutor,
): Promise<ClaimResult> {
  if (!isTicketActor(input.assignee)) {
    throw new Response(`Bad Request: unknown actor '${String(input.assignee)}'`, { status: 400 })
  }
  const from = input.filter?.status ?? 'approved'
  if (!isTicketStatus(from)) {
    throw new Response(`Bad Request: unknown status '${String(from)}'`, { status: 400 })
  }
  // The claim edge is the transition map's, not the claim endpoint's: an actor
  // with no `-> in_progress` edge out of `from` cannot claim, full stop.
  if (!isTransitionAllowed(from, 'in_progress', input.assignee)) {
    throw new Response(
      `Conflict: actor '${input.assignee}' may not claim a '${from}' ticket`,
      { status: 409 },
    )
  }
  const leaseSeconds = Math.min(
    CLAIM_LEASE_MAX_SEC,
    Math.max(60, Math.floor(input.leaseSeconds ?? CLAIM_LEASE_DEFAULT_SEC)),
  )
  const res = await exec(buildClaimQuery({
    assignee: input.assignee,
    leaseSeconds,
    from,
    id: input.id,
    filter: input.filter ?? {},
  }))
  const id = Number((res.rows?.[0] as { id?: number } | undefined)?.id ?? 0)
  return id > 0 ? { empty: false, id } : { empty: true }
}

/** One ticket with its links and the last 20 events of the run that filed it. */
export async function getTicket(id: number) {
  const [suggestion] = await db
    .select()
    .from(homepageTeamSuggestions)
    .where(eq(homepageTeamSuggestions.id, id))
    .limit(1)
  if (!suggestion) return null
  const links = await db
    .select()
    .from(suggestionLinks)
    .where(eq(suggestionLinks.suggestionId, id))
    .orderBy(desc(suggestionLinks.createdAt))
    .limit(50)
  const events = suggestion.runId == null ? [] : await db
    .select()
    .from(homepageTeamEvents)
    .where(eq(homepageTeamEvents.runId, suggestion.runId))
    .orderBy(desc(homepageTeamEvents.ts))
    .limit(20)
  return { suggestion, links, events }
}

// ── Strategy brief ───────────────────────────────────────────────────────────

export async function getActiveBrief() {
  const [row] = await db
    .select()
    .from(strategyBriefs)
    .where(eq(strategyBriefs.status, 'active'))
    .orderBy(desc(strategyBriefs.createdAt))
    .limit(1)
  return row ?? null
}

/**
 * Cached id-only variant for gate(). Deliberately NOT a cached getActiveBrief:
 * the full row carries Date columns, which don't survive the KV JSON
 * round-trip inside cached() (see the sitemap incident).
 */
async function getActiveBriefId(): Promise<number | null> {
  return cached('team:brief:active-id', SETTINGS_CACHE_TTL_SEC, async () =>
    (await getActiveBrief())?.id ?? null,
  )
}

/** Publish a new active brief, superseding the previous active one. */
export async function publishBrief(input: {
  weekStart: string
  brief: string
  metricsJson?: unknown
  createdBy?: string | undefined
}): Promise<number> {
  await db
    .update(strategyBriefs)
    .set({ status: 'superseded' })
    .where(eq(strategyBriefs.status, 'active'))
  const [row] = await db
    .insert(strategyBriefs)
    .values({
      weekStart:   input.weekStart,
      brief:       input.brief,
      metricsJson: input.metricsJson ?? null,
      status:      'active',
      createdBy:   input.createdBy ?? 'store-strategist',
    })
    .returning({ id: strategyBriefs.id })
  invalidateCache('team:brief:')
  await kvDel('team:brief:active-id')
  return row!.id
}

export async function listBriefs(limit = 12) {
  return db.select().from(strategyBriefs).orderBy(desc(strategyBriefs.createdAt)).limit(limit)
}

// ── Ad campaign proposals (propose-only stub) ───────────────────────────────

export interface AdCampaignInput {
  platform: string          // meta|x|google|reddit|other
  name: string
  objective: string
  plannedDailyCents?: number | undefined
  plannedTotalCents?: number | undefined
  audienceJson?: unknown
  creativeJson?: unknown
  policyCheck: string       // REQUIRED — docs/ads-policy.md compliance note
  runId?: number | undefined
}

export async function createAdCampaign(c: AdCampaignInput): Promise<number> {
  const [row] = await db
    .insert(adCampaigns)
    .values({
      platform:          c.platform,
      name:              c.name,
      objective:         c.objective,
      plannedDailyCents: c.plannedDailyCents ?? 0,
      plannedTotalCents: c.plannedTotalCents ?? null,
      audienceJson:      c.audienceJson ?? null,
      creativeJson:      c.creativeJson ?? null,
      policyCheck:       c.policyCheck,
      runId:             c.runId ?? null,
      status:            'proposed',
    })
    .returning({ id: adCampaigns.id })
  return row!.id
}

export async function listAdCampaigns(status?: string, limit = 50) {
  const q = db.select().from(adCampaigns)
  return (status ? q.where(eq(adCampaigns.status, status)) : q)
    .orderBy(desc(adCampaigns.createdAt))
    .limit(limit)
}

/** Owner decision from the admin UI: proposed -> approved | rejected. */
export async function decideAdCampaign(id: number, status: 'approved' | 'rejected'): Promise<void> {
  await db
    .update(adCampaigns)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(adCampaigns.id, id), eq(adCampaigns.status, 'proposed')))
}

// ── Draft-only social posts ──────────────────────────────────────────────────

export interface DraftSocialPostInput {
  platform: string          // x|instagram|tiktok|facebook|youtube — only x has live plumbing
  postType: string          // auto_deal|thread_reply|manual|campaign|video_reel|video_short
  tweetText: string         // the post body (column name is historical)
  mediaUrls?: string[] | undefined
  dealHistoryId?: number | undefined
  scheduledFor?: string | undefined  // ISO date the agent proposes for the calendar
  reworkedFrom?: number | undefined  // id of the needs_changes draft this replaces
  videoJobId?: number | undefined    // video pipeline linkage (065)
  posterUrl?: string | undefined
}

/**
 * Insert a DRAFT social post for human review in /admin/socials. This is the
 * only write path the social-media-manager stub has — there is intentionally
 * no code path from here to postTweet()/live posting. Every draft enters the
 * review queue as pending_review; only the owner (admin action) moves it.
 */
export async function createDraftSocialPost(p: DraftSocialPostInput): Promise<number> {
  const [row] = await db
    .insert(socialPosts)
    .values({
      platform:      p.platform,
      postType:      p.postType,
      tweetText:     p.tweetText,
      mediaUrls:     p.mediaUrls ?? null,
      dealHistoryId: p.dealHistoryId ?? null,
      status:        'draft',
      createdBy:     'agent',
      reviewStatus:  'pending_review',
      scheduledFor:  p.scheduledFor ?? null,
      reworkedFrom:  p.reworkedFrom ?? null,
      videoJobId:    p.videoJobId ?? null,
      posterUrl:     p.posterUrl ?? null,
    })
    .returning({ id: socialPosts.id })
  return row!.id
}

export async function listSocialPosts(status?: string, limit = 50, reviewStatus?: string) {
  const conditions = []
  if (status) conditions.push(eq(socialPosts.status, status))
  if (reviewStatus) conditions.push(eq(socialPosts.reviewStatus, reviewStatus))
  const q = db.select().from(socialPosts)
  return (conditions.length ? q.where(and(...conditions)) : q)
    .orderBy(desc(socialPosts.createdAt))
    .limit(limit)
}

/** Per-platform posting frequency (posts/day, 0 = off) from pipeline_settings. */
export async function getSocialFrequencies(): Promise<Record<SocialPlatform, number>> {
  const rows = await db
    .select()
    .from(pipelineSettings)
    .where(sql`${pipelineSettings.key} LIKE 'social_freq_%'`)
  const map = new Map(rows.map(r => [r.key, r.value]))
  const out = {} as Record<SocialPlatform, number>
  for (const p of SOCIAL_PLATFORMS) {
    out[p] = num(map.get(socialFreqKey(p)), SOCIAL_FREQ_DEFAULTS[p])
  }
  return out
}

export interface ReviewSocialPostInput {
  reviewStatus: SocialReviewStatus
  feedback?: string | undefined
  editedText?: string | undefined
  reviewedBy: string
}

/**
 * Owner-only review transition for a social draft (admin action; agents have
 * no write path to review state). Refuses to review already-posted rows —
 * review is an editorial gate on drafts, not a way to relabel history.
 */
export async function reviewSocialPost(id: number, input: ReviewSocialPostInput): Promise<boolean> {
  const result = await db
    .update(socialPosts)
    .set({
      reviewStatus: input.reviewStatus,
      feedback:     input.feedback ?? null,
      editedText:   input.editedText ?? null,
      reviewedBy:   input.reviewedBy,
      reviewedAt:   new Date(),
    })
    .where(and(eq(socialPosts.id, id), ne(socialPosts.status, 'posted')))
    .returning({ id: socialPosts.id })
  return result.length > 0
}

/**
 * Retrospective verdicts on a post that is already live (ticket #2738).
 *
 * The encoding lives in `./live-post-feedback` (no `.server` suffix) because
 * the Social Studio renders a stored verdict in component code, and a component
 * that imports a `.server` module drags the whole module into the client build.
 * Re-exported here so callers that already have this module keep working.
 */
export {
  LIVE_POST_VERDICTS,
  isLivePostVerdict,
  formatLiveFeedback,
  parseLiveFeedback,
  type LivePostVerdict,
} from './live-post-feedback'

export interface LivePostFeedbackInput {
  verdict: LivePostVerdict
  note?: string | undefined
  reviewedBy: string
}

/**
 * Record the owner's feedback on an already-published post.
 *
 * This exists because the owner said on 2026-08-11 that he would stop approving
 * posts before they ship and would instead review them once live and feed that
 * back to the team. Every write path to the review fields refused a posted row,
 * so that loop had nowhere to land and was not buildable. This is the writer
 * that closes it.
 *
 * Only touches posted rows, and only writes `feedback` plus the reviewer stamp.
 * `review_status` is left exactly as it was.
 */
export async function recordLivePostFeedback(
  id: number,
  input: LivePostFeedbackInput,
): Promise<boolean> {
  const result = await db
    .update(socialPosts)
    .set({
      feedback:   formatLiveFeedback(input.verdict, input.note ?? ''),
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
    })
    .where(and(eq(socialPosts.id, id), eq(socialPosts.status, 'posted')))
    .returning({ id: socialPosts.id })
  return result.length > 0
}

/** Move a draft's proposed calendar slot. */
export async function rescheduleSocialPost(id: number, scheduledFor: string | null): Promise<void> {
  await db
    .update(socialPosts)
    .set({ scheduledFor })
    .where(eq(socialPosts.id, id))
}

// ── Marketing calendar (read + propose) ─────────────────────────────────────

export async function listCalendar(from?: string, to?: string) {
  const conditions = []
  if (from) conditions.push(gte(marketingCalendar.eventDate, from))
  if (to) conditions.push(lte(marketingCalendar.eventDate, to))
  const q = db.select().from(marketingCalendar)
  return (conditions.length ? q.where(and(...conditions)) : q)
    .orderBy(marketingCalendar.eventDate)
    .limit(200)
}

export async function proposeCalendarEvent(input: {
  eventDate: string
  name: string
  type?: string | undefined   // holiday|promo|campaign
  theme?: string | undefined
}): Promise<number> {
  const [row] = await db
    .insert(marketingCalendar)
    .values({
      eventDate: input.eventDate,
      name:      input.name,
      type:      input.type ?? 'promo',
      theme:     input.theme ?? null,
      status:    'planned',
    })
    .returning({ id: marketingCalendar.id })
  return row!.id
}
