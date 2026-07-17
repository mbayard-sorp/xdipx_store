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

import { timingSafeEqual } from 'node:crypto'
import { and, desc, eq, gte, lt, lte, ne, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { contentSlotForDate, type ContentSlot } from '~/lib/content-slot'
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

/** A run is considered to be holding the lock if it started within this window. */
const RUN_LOCK_WINDOW_MIN = 20

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
 * True if a run of THIS TEAM is currently in progress (started within the lock
 * window). Teams don't block each other — a social run never locks homepage.
 * Callers that already hold a run row pass excludeRunId to avoid self-blocking.
 */
export async function isRunInProgress(team: TeamId, excludeRunId?: number): Promise<boolean> {
  const since = new Date(Date.now() - RUN_LOCK_WINDOW_MIN * 60_000)
  const conditions = [
    eq(homepageTeamRuns.team, team),
    eq(homepageTeamRuns.status, 'running'),
    gte(homepageTeamRuns.startedAt, since),
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
 * Mark zombie rows failed across ALL teams: status='running' but started before
 * the lock window, meaning the routine died without posting a final update.
 */
export async function expireStaleRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - RUN_LOCK_WINDOW_MIN * 60_000)
  await db
    .update(homepageTeamRuns)
    .set({
      status: 'failed',
      error: `auto-expired: still 'running' past the ${RUN_LOCK_WINDOW_MIN}-minute lock window`,
      finishedAt: new Date(),
    })
    .where(and(eq(homepageTeamRuns.status, 'running'), lt(homepageTeamRuns.startedAt, cutoff)))
}

export interface GateResult {
  team: TeamId
  enabled: boolean
  /** Why a run is refused, when ok=false. */
  reason?: 'disabled' | 'over_budget' | 'over_run_cap' | 'run_in_progress' | 'over_image_cap'
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
    await expireStaleRuns()
  }
  const [cfg, spentCents, runsToday, imagesToday, inProgress, briefId, autopublish] = await Promise.all([
    getTeamConfig(team),
    getTodaySpendCents(team),
    getTodayRunCount(team, excludeRunId),
    team === 'homepage' ? getTodayImageCount() : Promise.resolve(0),
    isRunInProgress(team, excludeRunId),
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
  if (inProgress)                     return { ...base, ok: false, reason: 'run_in_progress' }
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

export interface SuggestionInput {
  team: TeamId
  targetTeam?: TeamId | undefined
  runId?: number | undefined
  category: string   // model|turns|caching|prompt|agents|other
  kind?: string | undefined // process|strategy|instructions|agent-def|config|code|campaign|promo|program
  suggestion: string
  estSavingsUsd?: number | undefined
  cxRisk?: 'low' | 'med' | 'high' | undefined
}

export async function createSuggestion(s: SuggestionInput): Promise<number> {
  // Owner triage (proposed -> approved) is automated per-team via the
  // `{team}_team_auto_approve_suggestions` valve. Key it off the team that ACTS
  // on the suggestion — its targetTeam, or the proposer when unrouted — so a
  // strategy-proposed row aimed at homepage auto-approves under homepage's
  // valve. A failed config read falls back to manual review (proposed).
  const actingTeam = s.targetTeam ?? s.team
  const autoApprove = await getTeamConfig(actingTeam)
    .then(c => c.autoApproveSuggestions)
    .catch(() => false)
  const [row] = await db
    .insert(homepageTeamSuggestions)
    .values({
      team:          s.team,
      targetTeam:    s.targetTeam ?? null,
      runId:         s.runId ?? null,
      category:      s.category,
      kind:          s.kind ?? 'process',
      suggestion:    s.suggestion,
      estSavingsUsd: String(s.estSavingsUsd ?? 0),
      cxRisk:        s.cxRisk ?? 'low',
      status:        autoApprove ? 'approved' : 'proposed',
      decidedBy:     autoApprove ? 'auto' : null,
      decidedAt:     autoApprove ? new Date() : null,
    })
    .returning({ id: homepageTeamSuggestions.id })
  return row!.id
}

export async function listSuggestions(filter: {
  team?: TeamId | undefined
  targetTeam?: TeamId | undefined
  status?: string | undefined
  limit?: number | undefined
} = {}) {
  const conditions = []
  if (filter.team) conditions.push(eq(homepageTeamSuggestions.team, filter.team))
  if (filter.targetTeam) conditions.push(eq(homepageTeamSuggestions.targetTeam, filter.targetTeam))
  if (filter.status) conditions.push(eq(homepageTeamSuggestions.status, filter.status))
  const q = db.select().from(homepageTeamSuggestions)
  return (conditions.length ? q.where(and(...conditions)) : q)
    .orderBy(desc(homepageTeamSuggestions.createdAt))
    .limit(filter.limit ?? 100)
}

/** Owner decision from the admin UI: proposed -> approved | dismissed. */
export async function decideSuggestion(id: number, status: 'approved' | 'dismissed'): Promise<void> {
  await db
    .update(homepageTeamSuggestions)
    .set({ status, decidedBy: 'owner', decidedAt: new Date() })
    .where(and(eq(homepageTeamSuggestions.id, id), eq(homepageTeamSuggestions.status, 'proposed')))
}

/**
 * Agent-side transition (agent-editor): approved -> pr_open -> applied, with
 * the PR URL in applyRef. Throws 409 on any other transition — agents can
 * never move a row out of `proposed`; that decision is the owner's.
 */
export async function markSuggestion(
  id: number,
  status: 'pr_open' | 'applied',
  applyRef: string,
): Promise<void> {
  const allowedFrom = status === 'pr_open' ? 'approved' : 'pr_open'
  const res = await db
    .update(homepageTeamSuggestions)
    .set({ status, applyRef })
    .where(and(eq(homepageTeamSuggestions.id, id), eq(homepageTeamSuggestions.status, allowedFrom)))
    .returning({ id: homepageTeamSuggestions.id })
  if (res.length === 0) {
    throw new Response(
      `Conflict: suggestion ${id} is not in '${allowedFrom}' (agents cannot move rows out of 'proposed')`,
      { status: 409 },
    )
  }
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
  platform: string          // x|instagram|tiktok|facebook — only x has live plumbing
  postType: string          // auto_deal|thread_reply|manual|campaign
  tweetText: string         // the post body (column name is historical)
  mediaUrls?: string[] | undefined
  dealHistoryId?: number | undefined
  scheduledFor?: string | undefined  // ISO date the agent proposes for the calendar
  reworkedFrom?: number | undefined  // id of the needs_changes draft this replaces
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
