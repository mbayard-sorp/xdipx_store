/**
 * Episode ledger operations for the serialized video program (ticket #5712).
 *
 * The ledger is the money gate's substrate: the writers room PROPOSES rows
 * here at zero cost, the owner DECIDES them in /admin/video-studio, and only
 * an approved row can be claimed and rendered. decideEpisode is deliberately
 * NOT exposed on the team API: agents hold the team token, agents never
 * approve spend, so the decide path exists only for the admin session.
 *
 * Derived, never stored twice (so it cannot drift):
 *   - a character's current beat = the most recent aired episode's record
 *   - the open-loop ledger      = opened loops no later episode closed
 */
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from './db.server'
import { videoEpisodes, videoSeries, videoJobs } from '../../db/schema'
import type { VideoEpisodeReviewNote, VideoScriptJson } from '../../db/schema'
import { HOOK_PATTERNS, VIDEO_FORMULAS } from './team-keys'
import { ARC_POSITIONS, validatePlacements, scriptsSpeakIdentically, spokenTextOf } from './video-episodes'
import { dryRunEpisodeScript, getMaxCostCents } from './video-pipeline.server'
import { isVideoModelId, tierIneligibility } from './fal-video.server'
import type { VideoModelId } from './fal-video.server'

export type VideoEpisodeRow = typeof videoEpisodes.$inferSelect
export type VideoSeriesRow = typeof videoSeries.$inferSelect

export const PROPOSE_MAX_PER_CALL = 10

export interface ProposeEpisodeInput {
  concept?: string
  logline: string
  formula: string
  arcPosition?: string
  opensLoopKey?: string
  paysOffLoopKey?: string
  callbackToEpisode?: number
  part2Hook?: string
  storyboardJson?: unknown
  hookText?: string
  hookPattern?: string
  castSlugs?: string[]
  productPlacements?: unknown
  scriptJson?: VideoScriptJson
  siteCutJson?: { title?: string; dek?: string; copy?: string }
  modelTier?: string
  plannedSlotAt?: string
  isReserve?: boolean
  gateVerdicts?: { doctor?: string; voice?: string }
  seasonNumber?: number
}

export interface ProposedEpisode {
  id: number
  episodeUid: string
  seasonNumber: number
  episodeNumber: number
  logline: string
  estCostUsd: number | null
}

/** Resolve a series by slug, creating it on first use (additive data). */
async function resolveSeries(slug: string, title?: string): Promise<VideoSeriesRow> {
  const clean = slug.trim().toLowerCase()
  if (!/^[a-z0-9-]{2,48}$/.test(clean)) throw new Error(`seriesSlug must be kebab-case, got ${JSON.stringify(slug)}`)
  const existing = await db.select().from(videoSeries).where(eq(videoSeries.slug, clean)).limit(1)
  if (existing[0]) return existing[0]
  const inserted = await db.insert(videoSeries)
    .values({ slug: clean, title: title?.trim() || clean })
    .onConflictDoNothing()
    .returning()
  if (inserted[0]) return inserted[0]
  const raced = await db.select().from(videoSeries).where(eq(videoSeries.slug, clean)).limit(1)
  if (!raced[0]) throw new Error(`could not resolve series ${clean}`)
  return raced[0]
}

/**
 * File a batch of proposed episodes at production_status 'pending_approval',
 * sharing one batch id, numbering each max+1 inside a transaction. Validates
 * everything the render would later choke on (formula, hook pattern,
 * placement vocabulary, and a dry-run of the script on its tier) so nothing
 * unrenderable ever reaches the owner's sitting.
 */
export async function proposeEpisodes(args: {
  seriesSlug: string
  seriesTitle?: string
  episodes: ProposeEpisodeInput[]
  createdBy?: string
}): Promise<{ batchId: string; seriesId: number; episodes: ProposedEpisode[] }> {
  if (!Array.isArray(args.episodes) || args.episodes.length === 0) throw new Error('episodes must be a non-empty array')
  if (args.episodes.length > PROPOSE_MAX_PER_CALL) throw new Error(`at most ${PROPOSE_MAX_PER_CALL} episodes per call`)
  const series = await resolveSeries(args.seriesSlug, args.seriesTitle)
  const batchId = randomUUID()

  // Per-video ceiling read once, so an over-ceiling episode is refused while
  // refusing is still free — the same getMaxCostCents() the enqueue enforces.
  const maxCostCents = await getMaxCostCents()

  // Validate every episode fully BEFORE writing any row: a batch is one owner
  // sitting, and a half-written batch is worse than a refused one.
  const prepared = args.episodes.map((e, i) => {
    const where = `episodes[${i}]`
    if (typeof e.logline !== 'string' || !e.logline.trim()) throw new Error(`${where}.logline is required`)
    if (e.logline.length > 240) throw new Error(`${where}.logline over 240 chars`)
    if (!(VIDEO_FORMULAS as readonly string[]).includes(e.formula)) {
      throw new Error(`${where}.formula must be one of ${VIDEO_FORMULAS.join('|')}`)
    }
    const arcPosition = e.arcPosition ?? 'standalone'
    if (!(ARC_POSITIONS as readonly string[]).includes(arcPosition)) {
      throw new Error(`${where}.arcPosition must be one of ${ARC_POSITIONS.join('|')}`)
    }
    if (e.hookPattern != null && !(HOOK_PATTERNS as readonly string[]).includes(e.hookPattern)) {
      throw new Error(`${where}.hookPattern must be one of ${HOOK_PATTERNS.join('|')}`)
    }
    const placements = validatePlacements(e.productPlacements)
    let modelTier: VideoModelId | null = null
    if (e.modelTier != null) {
      if (!isVideoModelId(e.modelTier)) throw new Error(`${where}.modelTier is not a known tier`)
      // Refuse a retired fal tier or an undeployed worker mode at propose time,
      // while refusing is free, rather than letting it reach the render lane.
      const ineligible = tierIneligibility(e.modelTier)
      if (ineligible) throw new Error(`${where}.modelTier ${ineligible}`)
      modelTier = e.modelTier
    }
    let estCostUsd: number | null = null
    if (e.scriptJson) {
      if (typeof e.scriptJson !== 'object' || Array.isArray(e.scriptJson)) throw new Error(`${where}.scriptJson must be an object`)
      if (modelTier) {
        // Dry-run the exact validation the render runs, at propose time.
        estCostUsd = dryRunEpisodeScript(e.scriptJson, modelTier).estCostUsd
        if (estCostUsd != null && estCostUsd * 100 > maxCostCents) {
          throw new Error(`${where} est $${estCostUsd.toFixed(2)} exceeds the $${(maxCostCents / 100).toFixed(2)} per-video ceiling`)
        }
      }
    }
    const plannedSlotAt = e.plannedSlotAt ? new Date(e.plannedSlotAt) : null
    if (plannedSlotAt && Number.isNaN(plannedSlotAt.getTime())) throw new Error(`${where}.plannedSlotAt is not a valid date`)
    const castSlugs = Array.isArray(e.castSlugs) ? e.castSlugs.filter((s): s is string => typeof s === 'string' && !!s.trim()) : []
    return { e, arcPosition, placements, modelTier, estCostUsd, plannedSlotAt, castSlugs }
  })

  const seasonNumber = prepared[0]?.e.seasonNumber ?? 1

  const rows = await db.transaction(async tx => {
    const maxRow = await tx
      .select({ max: sql<number>`coalesce(max(${videoEpisodes.episodeNumber}), 0)` })
      .from(videoEpisodes)
      .where(and(eq(videoEpisodes.seriesId, series.id), eq(videoEpisodes.seasonNumber, seasonNumber)))
    let next = Number(maxRow[0]?.max ?? 0)
    const out: ProposedEpisode[] = []
    for (const p of prepared) {
      next += 1
      const inserted = await tx.insert(videoEpisodes).values({
        episodeUid: randomUUID(),
        seriesId: series.id,
        seasonNumber,
        episodeNumber: next,
        concept: p.e.concept ?? null,
        logline: p.e.logline.trim(),
        formula: p.e.formula,
        arcPosition: p.arcPosition,
        opensLoopKey: p.e.opensLoopKey ?? null,
        paysOffLoopKey: p.e.paysOffLoopKey ?? null,
        callbackToEpisode: p.e.callbackToEpisode ?? null,
        part2Hook: p.e.part2Hook ?? null,
        storyboardJson: (p.e.storyboardJson as never) ?? null,
        hookText: p.e.hookText ?? null,
        hookPattern: p.e.hookPattern ?? null,
        castSlugs: p.castSlugs,
        productPlacements: p.placements,
        scriptJson: p.e.scriptJson ?? null,
        siteCutJson: p.e.siteCutJson ?? null,
        modelTier: p.modelTier,
        estCostUsd: p.estCostUsd != null ? String(p.estCostUsd) : null,
        gateVerdictsJson: p.e.gateVerdicts ?? null,
        productionStatus: 'pending_approval',
        batchId,
        isReserve: p.e.isReserve ?? false,
        plannedSlotAt: p.plannedSlotAt,
        createdBy: args.createdBy ?? 'agent',
      }).returning({ id: videoEpisodes.id, episodeUid: videoEpisodes.episodeUid, episodeNumber: videoEpisodes.episodeNumber })
      out.push({
        id: inserted[0]!.id,
        episodeUid: inserted[0]!.episodeUid,
        seasonNumber,
        episodeNumber: inserted[0]!.episodeNumber,
        logline: p.e.logline.trim(),
        estCostUsd: p.estCostUsd,
      })
    }
    return out
  })

  return { batchId, seriesId: series.id, episodes: rows }
}

/** Aired = the episode's render completed (rendered or beyond). */
const AIRED_STATUSES = ['rendered', 'scheduled', 'posted', 'measured'] as const

export interface OpenLoop { loopKey: string; openedByEpisode: number; question: string | null }

/**
 * List the ledger for a series (or all), newest first, plus the derived
 * open-loop ledger: every opens_loop_key on a rendering-or-beyond episode that
 * no later episode's pays_off_loop_key closes.
 */
export async function listEpisodes(opts: { seriesSlug?: string; status?: string; limit?: number } = {}): Promise<{
  series: VideoSeriesRow[]
  episodes: VideoEpisodeRow[]
  openLoops: OpenLoop[]
}> {
  const limit = Math.min(Math.max(1, opts.limit ?? 100), 200)
  const series = opts.seriesSlug
    ? await db.select().from(videoSeries).where(eq(videoSeries.slug, opts.seriesSlug.toLowerCase()))
    : await db.select().from(videoSeries)
  const seriesIds = series.map(s => s.id)
  if (opts.seriesSlug && seriesIds.length === 0) return { series: [], episodes: [], openLoops: [] }

  const conds = [
    seriesIds.length ? inArray(videoEpisodes.seriesId, seriesIds) : undefined,
    opts.status ? eq(videoEpisodes.productionStatus, opts.status) : undefined,
  ].filter((c): c is NonNullable<typeof c> => !!c)
  const episodes = await db.select().from(videoEpisodes)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(videoEpisodes.seasonNumber), desc(videoEpisodes.episodeNumber))
    .limit(limit)

  // Open loops derive over the FULL series history, not the page above.
  const history = await db.select({
    episodeNumber: videoEpisodes.episodeNumber,
    opensLoopKey: videoEpisodes.opensLoopKey,
    paysOffLoopKey: videoEpisodes.paysOffLoopKey,
    part2Hook: videoEpisodes.part2Hook,
    productionStatus: videoEpisodes.productionStatus,
  }).from(videoEpisodes)
    .where(seriesIds.length ? inArray(videoEpisodes.seriesId, seriesIds) : undefined)
    .orderBy(asc(videoEpisodes.episodeNumber))
  const closed = new Set(history.filter(h => h.paysOffLoopKey && (AIRED_STATUSES as readonly string[]).includes(h.productionStatus)).map(h => h.paysOffLoopKey))
  const openLoops: OpenLoop[] = history
    .filter(h => h.opensLoopKey && (AIRED_STATUSES as readonly string[]).includes(h.productionStatus) && !closed.has(h.opensLoopKey))
    .map(h => ({ loopKey: h.opensLoopKey!, openedByEpisode: h.episodeNumber, question: h.part2Hook }))

  return { series, episodes, openLoops }
}

/**
 * Owner decision on one episode. ADMIN-SESSION ONLY by design: this function
 * is called from the /admin/video-studio action, never exposed on the
 * team-token API, because agents must never approve spend. needs_changes
 * REQUIRES a note (a silent rejection teaches the room nothing); notes append
 * to review_notes_json, never overwrite.
 */
export async function decideEpisode(args: {
  episodeId: number
  decision: 'approved' | 'needs_changes' | 'rejected'
  decidedBy: string
  note?: string
  tags?: string[]
  plannedSlotAt?: string
}): Promise<void> {
  const rows = await db.select().from(videoEpisodes).where(eq(videoEpisodes.id, args.episodeId)).limit(1)
  const ep = rows[0]
  if (!ep) throw new Error(`episode ${args.episodeId} not found`)
  // 'failed' and 'rendering' are decidable too (ticket #5726): a render that
  // died is the owner's to retry (-> approved), hand back to the room
  // (-> needs_changes), or drop (-> rejected), and without that this row would
  // be a permanent dead end. A 'rendering' row is only decidable while NO job
  // is attached — a claim that never enqueued. Once a job exists, re-approving
  // would arm a second render of a video already being paid for.
  const DECIDABLE_FROM = ['pending_approval', 'needs_changes', 'approved', 'failed', 'rendering']
  if (!DECIDABLE_FROM.includes(ep.productionStatus)) {
    throw new Error(`episode ${args.episodeId} is ${ep.productionStatus}; only ${DECIDABLE_FROM.join('/')} rows can be decided`)
  }
  if (ep.productionStatus === 'rendering' && ep.videoJobId != null) {
    throw new Error(`episode ${args.episodeId} is rendering as job ${ep.videoJobId}; wait for that render to finish or fail before deciding it again`)
  }
  if (args.decision === 'needs_changes' && !(args.note && args.note.trim())) {
    throw new Error('needs_changes requires a note: a silent rejection teaches the writers room nothing')
  }
  const note: VideoEpisodeReviewNote = {
    at: new Date().toISOString(),
    decision: args.decision,
    ...(args.tags?.length ? { tags: args.tags } : {}),
    ...(args.note?.trim() ? { note: args.note.trim() } : {}),
    by: args.decidedBy,
  }
  const notes = Array.isArray(ep.reviewNotesJson) ? [...ep.reviewNotesJson, note] : [note]
  const statusMap = { approved: 'approved', needs_changes: 'needs_changes', rejected: 'rejected' } as const
  const plannedSlotAt = args.plannedSlotAt ? new Date(args.plannedSlotAt) : undefined
  if (plannedSlotAt && Number.isNaN(plannedSlotAt.getTime())) throw new Error('plannedSlotAt is not a valid date')
  // Re-arming a failed render is a RETAKE, not a resume: retire the dead job
  // onto prior_job_ids_json and clear the link, so claimNextEpisode hands the
  // row over clean and linkEpisodeToJob has an empty slot to write the new job
  // into. Without this the second retry trips the rendering-with-a-job guard
  // above and the row is stuck again.
  const retaking = args.decision === 'approved' && ep.videoJobId != null
  const priorJobIds = retaking
    ? [...(Array.isArray(ep.priorJobIdsJson) ? ep.priorJobIdsJson : []), ep.videoJobId!]
    : null

  await db.update(videoEpisodes).set({
    productionStatus: statusMap[args.decision],
    reviewNotesJson: notes,
    updatedAt: new Date(),
    ...(args.decision === 'approved' ? { approvedBy: args.decidedBy, approvedAt: new Date() } : {}),
    ...(args.decision === 'rejected' && args.note?.trim() ? { rejectReason: args.note.trim() } : {}),
    ...(plannedSlotAt ? { plannedSlotAt } : {}),
    ...(retaking ? { videoJobId: null, priorJobIdsJson: priorJobIds, renderStartedAt: null } : {}),
  }).where(eq(videoEpisodes.id, args.episodeId))
}

/**
 * Render-lane claim: the oldest approved episode at or past its planned slot
 * (a null slot counts as ready), else the approved evergreen reserve, else
 * null. Stamps render_started_at + production_status 'rendering' so a second
 * claim in the same window cannot double-render.
 */
export async function claimNextEpisode(): Promise<VideoEpisodeRow | null> {
  const now = new Date()
  const pick = async (reserve: boolean) => {
    const conds = [
      eq(videoEpisodes.productionStatus, 'approved'),
      eq(videoEpisodes.isReserve, reserve),
      ...(reserve ? [] : [or(lte(videoEpisodes.plannedSlotAt, now), sql`${videoEpisodes.plannedSlotAt} IS NULL`)!]),
    ]
    return db.select().from(videoEpisodes)
      .where(and(...conds))
      .orderBy(asc(videoEpisodes.seasonNumber), asc(videoEpisodes.episodeNumber))
      .limit(1)
  }
  const main = await pick(false)
  const target = main[0] ?? (await pick(true))[0]
  if (!target) return null
  const updated = await db.update(videoEpisodes)
    .set({ productionStatus: 'rendering', renderStartedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(videoEpisodes.id, target.id), inArray(videoEpisodes.productionStatus, ['approved'])))
    .returning()
  return updated[0] ?? null
}

/**
 * How long a `rendering` episode may sit with no job attached before the
 * reaper treats the claim as abandoned. Comfortably longer than a render
 * routine's whole run, short enough that a crashed run does not cost the
 * episode its next scheduled slot.
 */
export const STALE_CLAIM_MS = 2 * 60 * 60 * 1000

/**
 * Hand a claimed episode back, unrendered (ticket #5726).
 *
 * claimNextEpisode stamps 'rendering' BEFORE the render lane knows whether it
 * can actually enqueue, and only `approved` rows are claimable — so a run that
 * claims and then refuses (closed budget gate, per-video ceiling, spoken-text
 * mismatch, an empty payload it will not invent around) used to strand the row
 * in 'rendering' forever: unclaimable, undecidable, its episode number spent
 * and its open loop never closing. This restores exactly the pre-claim state.
 *
 * Restoring `approved` is NOT an agent approving spend: the owner's approval
 * is what the row already carries and is what this puts back. Refuses to touch
 * a row that reached a provider (video_job_id set) — that one's outcome is the
 * job's to report, via markEpisodeRenderFailed.
 */
export async function releaseEpisodeClaim(episodeId: number, reason: string): Promise<boolean> {
  const note: VideoEpisodeReviewNote = {
    at: new Date().toISOString(),
    decision: 'released',
    note: `claim released without rendering: ${reason}`.slice(0, 2000),
    by: 'agent',
  }
  const rows = await db.select().from(videoEpisodes).where(eq(videoEpisodes.id, episodeId)).limit(1)
  const ep = rows[0]
  if (!ep || ep.productionStatus !== 'rendering' || ep.videoJobId != null) return false
  const notes = Array.isArray(ep.reviewNotesJson) ? [...ep.reviewNotesJson, note] : [note]
  const updated = await db.update(videoEpisodes)
    .set({ productionStatus: 'approved', renderStartedAt: null, reviewNotesJson: notes, updatedAt: new Date() })
    .where(and(eq(videoEpisodes.id, episodeId), eq(videoEpisodes.productionStatus, 'rendering')))
    .returning({ id: videoEpisodes.id })
  return updated.length > 0
}

/**
 * The render did reach a provider and died there. 'failed' is a real stored
 * status (videoStatusOf already renders it, turn: 'owner') and is deliberately
 * NOT auto-returned to 'approved': a deterministic failure — a tier the worker
 * image does not implement, a script the pipeline cannot build — would
 * otherwise re-render and re-burn GPU every Monday and Thursday forever.
 * Retrying is an owner click in /admin/video-studio, which is where a decision
 * to spend again belongs.
 */
export async function markEpisodeRenderFailed(episodeId: number, error: string): Promise<boolean> {
  const rows = await db.select().from(videoEpisodes).where(eq(videoEpisodes.id, episodeId)).limit(1)
  const ep = rows[0]
  if (!ep || !['rendering', 'approved'].includes(ep.productionStatus)) return false
  const note: VideoEpisodeReviewNote = {
    at: new Date().toISOString(),
    decision: 'render_failed',
    note: error.slice(0, 2000),
    by: 'pipeline',
  }
  const notes = Array.isArray(ep.reviewNotesJson) ? [...ep.reviewNotesJson, note] : [note]
  const updated = await db.update(videoEpisodes)
    .set({ productionStatus: 'failed', reviewNotesJson: notes, updatedAt: new Date() })
    .where(and(eq(videoEpisodes.id, episodeId), inArray(videoEpisodes.productionStatus, ['rendering', 'approved'])))
    .returning({ id: videoEpisodes.id })
  return updated.length > 0
}

/**
 * Backstop for a run that died between claiming and enqueueing without ever
 * calling releaseEpisodeClaim — the crashed-worker case releaseEpisodeClaim
 * cannot cover, mirroring team.server's expireStaleRuns/expireStaleClaims.
 * Only rows with NO job attached are reaped: a row whose job is genuinely
 * still rendering keeps its status however long the render takes.
 */
export async function reapStaleEpisodeClaims(maxAgeMs: number = STALE_CLAIM_MS): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const reaped = await db.update(videoEpisodes)
    .set({ productionStatus: 'approved', renderStartedAt: null, updatedAt: new Date() })
    .where(and(
      eq(videoEpisodes.productionStatus, 'rendering'),
      isNull(videoEpisodes.videoJobId),
      lte(videoEpisodes.renderStartedAt, cutoff),
    ))
    .returning({ id: videoEpisodes.id })
  if (reaped.length) {
    console.warn(`[video-episodes] reaped ${reaped.length} stale episode claim(s) back to approved: ${reaped.map(r => r.id).join(', ')}`)
  }
  return reaped.length
}

/**
 * The enqueue guard (the spine of the program): load the episode, require an
 * owner-approved state, and refuse a payload whose SPOKEN TEXT differs from
 * the approved script. Returns the episode row on success; throws a Response
 * (409) naming both strings on drift, and (403) when unapproved, so the route
 * can pass it straight through.
 */
export async function assertEpisodeMatchesScript(episodeId: number, script: VideoScriptJson): Promise<VideoEpisodeRow> {
  const rows = await db.select().from(videoEpisodes).where(eq(videoEpisodes.id, episodeId)).limit(1)
  const ep = rows[0]
  if (!ep) throw new Response(`episode ${episodeId} not found`, { status: 404 })
  if (!['approved', 'rendering'].includes(ep.productionStatus)) {
    throw new Response(
      JSON.stringify({ error: 'episode_not_approved', productionStatus: ep.productionStatus }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )
  }
  if (!ep.scriptJson) {
    throw new Response(JSON.stringify({ error: 'episode_has_no_script' }), { status: 409, headers: { 'content-type': 'application/json' } })
  }
  if (!scriptsSpeakIdentically(ep.scriptJson, script)) {
    throw new Response(
      JSON.stringify({
        error: 'episode_script_mismatch',
        detail: 'the payload speaks different words than the owner approved; fix the payload, never the approved row',
        approved: spokenTextOf(ep.scriptJson),
        submitted: spokenTextOf(script),
      }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )
  }
  return ep
}

/** After a successful enqueue, link the job row back onto the episode. */
export async function linkEpisodeToJob(episodeId: number, jobId: string): Promise<void> {
  const job = await db.select({ id: videoJobs.id }).from(videoJobs).where(eq(videoJobs.jobId, jobId)).limit(1)
  if (!job[0]) return
  await db.update(videoEpisodes).set({
    videoJobId: job[0].id,
    productionStatus: 'rendering',
    renderStartedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(videoEpisodes.id, episodeId))
}

/** Studio helper: the episode row a job renders, if any. */
export async function episodeForJob(jobRowId: number): Promise<VideoEpisodeRow | null> {
  const rows = await db.select().from(videoEpisodes).where(eq(videoEpisodes.videoJobId, jobRowId)).limit(1)
  return rows[0] ?? null
}
