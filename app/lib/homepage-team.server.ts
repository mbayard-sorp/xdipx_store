/**
 * Control plane for the autonomous homepage merchandising team.
 *
 * Responsibilities:
 *   - Read the kill switch + daily $ budget + cascade caps from pipeline_settings.
 *   - Compute today's spend from api_token_log (feature 'homepage-%') and expose
 *     a budget gate the scheduled cloud routine calls BEFORE any paid step.
 *   - Concurrency guard so two runs never overlap (cascade risk #4).
 *   - Run + event recorders that back the /admin/homepage-team dashboard.
 *
 * Spend is NEVER stored here — it lives in api_token_log and surfaces on
 * /admin/usage. This module only reads spend to gate, and writes run/status.
 *
 * Server-only.
 */

import { timingSafeEqual } from 'node:crypto'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import {
  pipelineSettings,
  homepageTeamRuns,
  homepageTeamEvents,
} from '../../db/schema'

/**
 * Constant-time check of the team callback secret. The scheduled cloud routine
 * sends `x-team-secret: <token>` (or `Authorization: Bearer <token>`). Accepts
 * HOMEPAGE_TEAM_TOKEN, falling back to CRON_SECRET. Throws a 401 Response when
 * the secret is missing or wrong. Mirrors the cron guard in server/cron.ts.
 */
export function assertTeamAuth(request: Request): void {
  const expected = process.env['HOMEPAGE_TEAM_TOKEN'] ?? process.env['CRON_SECRET'] ?? ''
  const auth = request.headers.get('authorization') ?? ''
  const provided = request.headers.get('x-team-secret') ?? auth.replace(/^Bearer\s+/i, '')
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  const ok = expected.length > 0 && a.length === b.length && timingSafeEqual(a, b)
  if (!ok) {
    throw new Response('Unauthorized', { status: 401 })
  }
}

// pipeline_settings keys (all <= varchar(50)).
export const TEAM_KEYS = {
  enabled:          'homepage_team_enabled',
  dailyCents:       'homepage_team_daily_cents',
  buildCents:       'homepage_team_build_cents',
  maxImagesPerDay:  'homepage_team_max_images',
  maxRunsPerDay:    'homepage_team_max_runs',
} as const

const DEFAULTS = {
  enabled:         false, // OFF by default — owner flips it on from /admin/homepage-team
  dailyCents:      1500,  // $15/day
  buildCents:      10000, // $100 initial-build allowance
  maxImagesPerDay: 12,
  maxRunsPerDay:   4,
}

/** A run is considered to be holding the lock if it started within this window. */
const RUN_LOCK_WINDOW_MIN = 20

export interface TeamConfig {
  enabled: boolean
  dailyCents: number
  buildCents: number
  maxImagesPerDay: number
  maxRunsPerDay: number
}

function num(v: string | undefined, fallback: number): number {
  if (v == null) return fallback
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

export async function getTeamConfig(): Promise<TeamConfig> {
  const rows = await db
    .select()
    .from(pipelineSettings)
    .where(sql`${pipelineSettings.key} LIKE 'homepage_team_%'`)
  const map = new Map(rows.map(r => [r.key, r.value]))
  return {
    enabled:         (map.get(TEAM_KEYS.enabled) ?? String(DEFAULTS.enabled)) === 'true',
    dailyCents:      num(map.get(TEAM_KEYS.dailyCents), DEFAULTS.dailyCents),
    buildCents:      num(map.get(TEAM_KEYS.buildCents), DEFAULTS.buildCents),
    maxImagesPerDay: num(map.get(TEAM_KEYS.maxImagesPerDay), DEFAULTS.maxImagesPerDay),
    maxRunsPerDay:   num(map.get(TEAM_KEYS.maxRunsPerDay), DEFAULTS.maxRunsPerDay),
  }
}

/** Today's homepage-team spend (USD cents) from api_token_log feature 'homepage-%'. */
export async function getTodaySpendCents(): Promise<number> {
  const res = await db.execute(
    sql`SELECT COALESCE(SUM(est_cost_usd), 0)::float8 AS dollars
        FROM api_token_log
        WHERE ts >= current_date AND feature LIKE 'homepage-%'`,
  )
  const dollars = Number((res.rows?.[0] as { dollars?: number } | undefined)?.dollars ?? 0)
  return Math.round(dollars * 100)
}

/** Count of team runs started today. */
export async function getTodayRunCount(): Promise<number> {
  const res = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM homepage_team_runs WHERE started_at >= current_date`,
  )
  return Number((res.rows?.[0] as { n?: number } | undefined)?.n ?? 0)
}

/** True if a run is currently in progress (started within the lock window). */
export async function isRunInProgress(): Promise<boolean> {
  const since = new Date(Date.now() - RUN_LOCK_WINDOW_MIN * 60_000)
  const [row] = await db
    .select({ id: homepageTeamRuns.id })
    .from(homepageTeamRuns)
    .where(and(eq(homepageTeamRuns.status, 'running'), gte(homepageTeamRuns.startedAt, since)))
    .limit(1)
  return !!row
}

export interface GateResult {
  enabled: boolean
  /** Why a run is refused, when ok=false. */
  reason?: 'disabled' | 'over_budget' | 'over_run_cap' | 'run_in_progress'
  ok: boolean
  dailyCents: number
  spentCents: number
  remainingCents: number
  runsToday: number
  maxRunsPerDay: number
}

/**
 * The gate the scheduled routine calls before doing anything paid. Returns
 * ok=false (with a reason) when disabled, over budget, over the daily run cap,
 * or a run is already in progress.
 */
export async function gate(): Promise<GateResult> {
  const [cfg, spentCents, runsToday, inProgress] = await Promise.all([
    getTeamConfig(),
    getTodaySpendCents(),
    getTodayRunCount(),
    isRunInProgress(),
  ])
  const remainingCents = Math.max(0, cfg.dailyCents - spentCents)
  const base = {
    enabled: cfg.enabled,
    dailyCents: cfg.dailyCents,
    spentCents,
    remainingCents,
    runsToday,
    maxRunsPerDay: cfg.maxRunsPerDay,
  }
  if (!cfg.enabled)               return { ...base, ok: false, reason: 'disabled' }
  if (inProgress)                 return { ...base, ok: false, reason: 'run_in_progress' }
  if (remainingCents <= 0)        return { ...base, ok: false, reason: 'over_budget' }
  if (runsToday >= cfg.maxRunsPerDay) return { ...base, ok: false, reason: 'over_run_cap' }
  return { ...base, ok: true }
}

// ── Run + event recorders (back the dashboard) ──────────────────────────────

export async function startRun(runType: 'merchandise' | 'design' | 'manual'): Promise<number> {
  const [row] = await db
    .insert(homepageTeamRuns)
    .values({ runType, status: 'running' })
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
  agentRole?: string
  phase?: string
  transcriptRef?: string
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

/** Recent runs for the dashboard (newest first). */
export async function listRecentRuns(limit = 25) {
  return db
    .select()
    .from(homepageTeamRuns)
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
