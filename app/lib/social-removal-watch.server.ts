/**
 * The removal watcher (ticket #2741).
 *
 * `routine-social-daily.md` Step 2b already says what to do when Instagram
 * removes a post: stop drafting, step volume down one tier, end the campaign,
 * file the incident. It reads the last three days of posted rows to decide. But
 * nothing ever marks a row as removed, so that check has always read a column
 * that cannot change, and the throttle it guards could never fire.
 *
 * That was survivable while every post went out by an owner's click, because he
 * would notice. It stops being survivable the moment `instagram_autopublish_enabled`
 * is on: the routine's own docs say the trigger moves from "the queue is getting
 * long" to "something already live looks wrong", and this is the only thing that
 * can see the second one. Enforcement on Meta is account-level and retroactive,
 * so the cost of missing a strike is not one post.
 *
 * ## Why this rides the publish tick
 *
 * It could be its own cron. It is not, for one reason: `server/cron.ts` is a
 * protected path, so a new route is an owner-merged PR, and this needs to run on
 * the same hourly beat as the job it guards anyway. Running it at the START of
 * the tick means a removal detected at 14:00 stops the 14:00 publish, not the
 * 15:00 one.
 *
 * ## What it does NOT do
 *
 * It does not turn the autopublish valve off on the first removal. One removal
 * is a signal to slow down, which is what the ads-policy ladder actually says,
 * and killing the channel on a single strike would hand the owner back the
 * bottleneck he asked to be rid of. Two removals inside the window is a pattern
 * rather than an incident, and that does flip the valve off: at that point the
 * cheapest correct action is to stop and get a human, and the valve is the thing
 * that stops it.
 *
 * Stepping a valve OFF and a quota DOWN are the only writes here. Nothing in
 * this module can loosen anything.
 */

import { and, desc, eq, gte, isNotNull, ne, sql } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import { getInstagramMediaState } from './social-publish/instagram.server'
import { setPipelineSettingAudited } from './settings.server'
import { fileBlocker } from './owner-blockers.server'
import { getPipelineSetting } from './feed-processor.server'
import { VALVE_KEYS } from './team-keys'

/** How far back a removal still counts as part of the current pattern. */
export const WATCH_WINDOW_DAYS = 14

/**
 * Most recent posts to check per tick.
 *
 * One Graph call each, hourly, so this is a real cost worth bounding. Recent is
 * where removals happen: Meta's review lands within hours to days of publishing,
 * and a post that has been up for two weeks is not the one about to be pulled.
 */
export const WATCH_SAMPLE = 8

/** Two removals in the window is a pattern, and a pattern stops the channel. */
export const VALVE_OFF_AT_REMOVALS = 2

export interface RemovalWatchResult {
  checked: number
  /** Rows newly found removed by this sweep. */
  removed: number[]
  /** Removals inside the window, including ones found by earlier sweeps. */
  removalsInWindow: number
  /** Lookups that failed for a reason that is not "removed". */
  unknown: number
  /** Set when the sweep declined to conclude anything (see `abstained`). */
  abstained?: 'token_unhealthy' | 'nothing_posted'
  frequencySteppedTo?: number
  /** Set when a clean stretch earned one step of volume back. */
  frequencyRestoredTo?: number
  valveTurnedOff?: boolean
}

export interface RemovalWatchDeps {
  mediaState?: (id: string) => Promise<{ state: 'live' | 'gone' | 'unknown'; detail?: string }>
  /** Reads a pipeline setting. Injected so tests never touch settings. */
  readSetting?: (key: string) => Promise<string | null>
  writeSetting?: (key: string, value: string) => Promise<void>
  fileBlocker?: (input: Parameters<typeof fileBlocker>[0]) => Promise<unknown>
  repo?: RemovalWatchRepo
  now?: () => Date
}

export interface PostedRow {
  id: number
  externalPostId: string
  postedAt: Date | null
  caption: string
}

export interface RemovalWatchRepo {
  /** Newest posted Instagram rows that still believe they are live. */
  recentLive: (limit: number) => Promise<PostedRow[]>
  markRemoved: (id: number, detail: string) => Promise<void>
  countRemovedSince: (since: Date) => Promise<number>
}

export const dbRemovalWatchRepo: RemovalWatchRepo = {
  recentLive: async (limit) => {
    const rows = await db
      .select({
        id: socialPosts.id,
        externalPostId: socialPosts.externalPostId,
        postedAt: socialPosts.postedAt,
        t: socialPosts.tweetText,
        e: socialPosts.editedText,
      })
      .from(socialPosts)
      .where(and(
        eq(socialPosts.platform, 'instagram'),
        eq(socialPosts.status, 'posted'),
        isNotNull(socialPosts.externalPostId),
        // Postgres sorts NULLs FIRST under DESC, so a row that somehow reached
        // `posted` without a timestamp would take a slot at the top of the
        // sample and push a real post out of it.
        isNotNull(socialPosts.postedAt),
      ))
      .orderBy(desc(socialPosts.postedAt))
      .limit(limit)
    return rows.map(r => ({
      id: r.id,
      externalPostId: r.externalPostId ?? '',
      postedAt: r.postedAt,
      caption: r.e?.trim() || r.t,
    }))
  },
  markRemoved: async (id, detail) => {
    // `deleted` is the status the 2026-08-09 hand-deleted post already carries,
    // so the vocabulary is not new; what is new is something writing it.
    // removalSource: 'unknown' (ticket #6758) — a watcher-detected removal
    // cannot tell a platform takedown from the owner deleting the post
    // directly on Instagram, so it never claims 'platform'. An owner who
    // removes a post through OUR admin "I removed this" action instead sets
    // status='deleted' + removalSource='owner' directly, which takes the row
    // out of `recentLive`'s candidate pool before this ever runs on it.
    await db.update(socialPosts)
      .set({ status: 'deleted', errorMessage: detail, removalSource: 'unknown' })
      .where(eq(socialPosts.id, id))
  },
  /**
   * Removals in the window, counted by `posted_at` because there is no
   * `removed_at` and adding one is a migration.
   *
   * The approximation this makes: a post published long ago and removed today
   * falls outside the window and is not counted toward the pattern. It is a
   * near-non-issue in practice rather than a hidden one, because the sweep only
   * ever looks at the WATCH_SAMPLE most recent posts, which at this cadence is
   * roughly the same span as the window itself. If Instagram ever starts
   * removing months-old posts, this under-counts and the valve-off threshold is
   * reached later than it should be.
   *
   * Excludes removalSource='owner' (ticket #6758): a post the owner removed
   * himself is not a takedown signal and must never count toward the
   * pattern that turns instagram_autopublish_enabled off.
   */
  countRemovedSince: async (since) => {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(socialPosts)
      .where(and(
        eq(socialPosts.platform, 'instagram'),
        eq(socialPosts.status, 'deleted'),
        gte(socialPosts.postedAt, since),
        ne(socialPosts.removalSource, 'owner'),
      ))
    return rows[0]?.n ?? 0
  },
}

/** Halve, never below one. Volume is earned back by a clean stretch. */
export function steppedDown(current: number): number {
  return Math.max(1, Math.floor(current / 2))
}

/**
 * Days of clean, OBSERVED posting before volume climbs back one step.
 *
 * Longer than WATCH_WINDOW_DAYS on purpose. The window is "is this still the
 * same incident"; this is "has the channel proved it is fine", and those should
 * not be the same number, or the first quiet fortnight after a strike would
 * read as vindication.
 */
export const RECOVERY_CLEAN_DAYS = 21

/** `social_freq_<platform>_ceiling` — the value volume climbs back toward. */
export function ceilingKey(platform: 'instagram' | 'x'): string {
  return `social_freq_${platform}_ceiling`
}

/** `social_freq_<platform>_changed_at` — when volume last moved, either way. */
export function changedAtKey(platform: 'instagram' | 'x'): string {
  return `social_freq_${platform}_changed_at`
}

export interface RecoveryInput {
  /** Current drafting frequency. */
  current: number
  /** The pre-cut value recorded at step-down, or null if none was ever recorded. */
  ceiling: number | null
  /** Platform-attributed removals inside WATCH_WINDOW_DAYS. */
  removalsInWindow: number
  /** When frequency last moved, either direction. */
  lastChangeAt: Date | null
  now: Date
  /**
   * Whether this sweep actually observed the account. False when it abstained.
   * See below — this is the load-bearing argument.
   */
  observed: boolean
}

/**
 * The half of the ratchet that was written down and never built.
 *
 * `steppedDown` halves and nothing restores, while the blocker email the owner
 * receives says in as many words that "volume is earned back by a clean
 * stretch". So a single removal has been a permanent cut since the watcher
 * shipped, and an expired Instagram token — which is indistinguishable from a
 * takedown to the media-state lookup — could halve the channel forever.
 *
 * Returns the new frequency, or null to leave it alone. Four ways it declines,
 * and each one is a way this could have gone wrong:
 *
 * 1. **Nothing to restore.** No recorded ceiling, or already at it. Volume never
 *    climbs above where it was before the cut: this reverses a penalty, it does
 *    not set policy.
 * 2. **Not clean.** Any platform-attributed removal in the window. Owner-removed
 *    posts are already excluded upstream by `removalSource != 'owner'`, which is
 *    why "platform-attributed" is the right word here and not "any removal".
 * 3. **Not long enough**, or never stamped. An absent `changed_at` declines
 *    rather than defaulting to "long ago" — the safe default for a missing
 *    timestamp on a channel under a strike is to stay throttled.
 * 4. **Not observed.** The sweep abstained: the token looked unhealthy, or
 *    nothing was posted at all. This is the #4702 lesson applied here — a
 *    could-not-ask is not a no. Zero removals because we could not look, and
 *    zero removals because nothing was taken down, must never mean the same
 *    thing, and only one of them is a clean stretch. "Nothing posted" is the
 *    subtler of the two: a channel that published nothing has proved nothing.
 *
 * It climbs by ONE and falls by HALF, deliberately. Trust that took a strike to
 * lose should not come back in a single tick.
 */
export function recoveredFrequency(i: RecoveryInput): number | null {
  if (!i.observed) return null
  if (i.ceiling === null || i.ceiling <= i.current) return null
  if (i.removalsInWindow > 0) return null
  if (i.lastChangeAt === null) return null
  const days = (i.now.getTime() - i.lastChangeAt.getTime()) / 86_400_000
  if (days < RECOVERY_CLEAN_DAYS) return null
  return Math.min(i.current + 1, i.ceiling)
}

/**
 * One sweep. Safe to call every tick; it makes at most WATCH_SAMPLE API calls
 * and writes nothing unless something is actually gone.
 */
export async function runRemovalWatch(deps: RemovalWatchDeps = {}): Promise<RemovalWatchResult> {
  const repo = deps.repo ?? dbRemovalWatchRepo
  const mediaState = deps.mediaState ?? getInstagramMediaState
  const readSetting = deps.readSetting ?? getPipelineSetting
  const writeSetting = deps.writeSetting
    ?? ((key: string, value: string) => setPipelineSettingAudited(key, value, 'system', 'social-removal-watch').then(() => undefined))
  const file = deps.fileBlocker ?? fileBlocker
  const now = deps.now?.() ?? new Date()

  const rows = await repo.recentLive(WATCH_SAMPLE)
  if (rows.length === 0) {
    return { checked: 0, removed: [], removalsInWindow: 0, unknown: 0, abstained: 'nothing_posted' }
  }

  const gone: PostedRow[] = []
  let live = 0
  let unknown = 0
  const details = new Map<number, string>()

  for (const row of rows) {
    const state = await mediaState(row.externalPostId)
    if (state.state === 'live') { live++; continue }
    if (state.state === 'unknown') { unknown++; continue }
    gone.push(row)
    details.set(row.id, state.detail ?? 'Instagram reports this media no longer exists')
  }

  // The guard that keeps an expired token from reading as a purge. "Object does
  // not exist" is also what permission loss returns, so a sweep only believes it
  // when at least one other post answered normally in the same pass. All-gone
  // with nothing live is far likelier to be the credential than the account.
  if (gone.length > 0 && live === 0) {
    await file({
      dedupeKey: 'ig-removal-watch-token-unhealthy',
      title: 'Instagram removal watch cannot tell removals from an expired token',
      detail:
        `Every one of the ${rows.length} most recent Instagram posts answered "does not exist" and none ` +
        'answered normally. That pattern is far more likely to be an expired or scope-reduced ' +
        'IG_GRAPH_ACCESS_TOKEN than an account purge, so the watcher concluded nothing and stepped ' +
        'nothing down. Until this is resolved, removals are NOT being detected.',
      unblocks: 'Removal detection, which is the safety net under Instagram autopublish.',
      whereToGo: 'Meta App Dashboard > Instagram > API setup with Instagram business login, then update IG_GRAPH_ACCESS_TOKEN in Vercel.',
      category: 'credential',
      priority: 1,
      source: 'agent',
    })
    return { checked: rows.length, removed: [], removalsInWindow: 0, unknown, abstained: 'token_unhealthy' }
  }

  for (const row of gone) {
    await repo.markRemoved(row.id, details.get(row.id) ?? 'Removed from Instagram')
  }

  const since = new Date(now.getTime() - WATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const removalsInWindow = await repo.countRemovedSince(since)

  const result: RemovalWatchResult = {
    checked: rows.length,
    removed: gone.map(r => r.id),
    removalsInWindow,
    unknown,
  }
  const raw = await readSetting('social_freq_instagram')
  const current = Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : 1

  // ── Nothing gone. This is the only place volume can climb back. ──────────
  //
  // The blocker email the owner receives says "volume is earned back by a clean
  // stretch", and until now nothing implemented that sentence: steppedDown
  // halved and nothing ever restored, so one removal was a permanent cut, and
  // an expired token — indistinguishable from a takedown to the media lookup —
  // could halve the channel forever.
  //
  // Reaching here means the sweep looked, saw posts, and found none removed, so
  // `observed` is true by construction; the abstain paths above have already
  // returned. It is passed explicitly anyway so the rule states its own
  // precondition rather than inheriting it from control flow.
  if (gone.length === 0) {
    const ceilingRaw = await readSetting(ceilingKey('instagram'))
    const changedRaw = await readSetting(changedAtKey('instagram'))
    const changedAt = changedRaw ? new Date(changedRaw) : null
    const restored = recoveredFrequency({
      current,
      ceiling: Number.isFinite(Number(ceilingRaw)) && Number(ceilingRaw) > 0 ? Number(ceilingRaw) : null,
      removalsInWindow,
      lastChangeAt: changedAt && !Number.isNaN(changedAt.getTime()) ? changedAt : null,
      now,
      observed: true,
    })
    if (restored !== null) {
      await writeSetting('social_freq_instagram', String(restored))
      await writeSetting(changedAtKey('instagram'), now.toISOString())
      result.frequencyRestoredTo = restored
      // Deliberately no valve write. instagram_autopublish_enabled is turned OFF
      // by a pattern of removals and turned back ON only by the owner. Volume is
      // a throttle and can be earned back; permission to publish unattended is a
      // judgement call, and nothing here is entitled to make it.
    }
    return result
  }

  // ── A removal happened. Step down. ───────────────────────────────────────
  const next = steppedDown(current)
  if (next !== current) {
    await writeSetting('social_freq_instagram', String(next))
    // Record what to climb back to, and when the clock started. `max` so that a
    // second cut before any recovery does not lower the ceiling to the already
    // reduced value, which would make the first cut permanent after all.
    const priorCeiling = Number(await readSetting(ceilingKey('instagram')))
    const ceiling = Math.max(current, Number.isFinite(priorCeiling) ? priorCeiling : 0)
    await writeSetting(ceilingKey('instagram'), String(ceiling))
    await writeSetting(changedAtKey('instagram'), now.toISOString())
    result.frequencySteppedTo = next
  }

  const pattern = removalsInWindow >= VALVE_OFF_AT_REMOVALS
  if (pattern) {
    await writeSetting(VALVE_KEYS.instagramAutopublish, 'false')
    result.valveTurnedOff = true
  }

  await file({
    dedupeKey: pattern ? 'ig-removals-pattern' : `ig-removal-${gone.map(r => r.id).join('-')}`,
    title: pattern
      ? `Instagram removed ${removalsInWindow} posts in ${WATCH_WINDOW_DAYS} days; autopublish turned OFF`
      : `Instagram removed a post (social_posts #${gone.map(r => r.id).join(', #')})`,
    detail:
      `${gone.map(r => `#${r.id}: "${r.caption.slice(0, 120)}"`).join('\n')}\n\n` +
      `Instagram drafting frequency stepped ${current} -> ${next}/day. ` +
      (pattern
        ? `instagram_autopublish_enabled was turned OFF: ${removalsInWindow} removals inside ` +
          `${WATCH_WINDOW_DAYS} days is a pattern, not an incident, and the next correct action ` +
          'needs a person. Nothing publishes unattended until you turn it back on.'
        : 'Autopublish is still ON. One removal steps volume down; it does not stop the channel.') +
      '\n\nPer docs/ads-policy.md the active campaign also ends, and volume is earned back by a ' +
      'clean stretch rather than by waiting.',
    unblocks: pattern
      ? 'Unattended Instagram publishing, which is stopped until you decide.'
      : 'Nothing. This is a notification you asked to receive, not a task blocking the team.',
    whereToGo: '/admin/socials for the post, then the Social tab of /admin/homepage-team for the valve.',
    category: pattern ? 'valve' : 'approval',
    // A valve-off row must clear itself the moment the owner flips the valve
    // back. Without this the owner's own action left the row open, which is how
    // nine of ten open blockers ended up probe-less and hand-cleared.
    ...(pattern
      ? { verifyProbe: 'setting_true', verifyArg: VALVE_KEYS.instagramAutopublish }
      : {}),
    priority: pattern ? 1 : 2,
    source: 'agent',
    evidence: `Checked the ${rows.length} most recent posted rows; ${live} live, ${gone.length} gone, ${unknown} unknown.`,
  })

  return result
}
