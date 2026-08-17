/**
 * The X removal watcher (ticket #3745).
 *
 * As of 2026-08-16 X publishes UNATTENDED (`x_autopublish_enabled`, flipped in
 * session), and until this file existed nothing would notice a removal there.
 * `xTickDeps` disabled the watch outright because `runRemovalWatch` is
 * Instagram-specific: it reads Graph API media state and, on a pattern, turns
 * the INSTAGRAM valve off. Its own comment named the gap: X suspends accounts
 * too.
 *
 * Same semantics as `social-removal-watch.server.ts`, and deliberately so; the
 * comments there carry the reasoning and are not repeated here. Each publish
 * tick, check the most recent posted X rows in one batch GET /2/tweets (a
 * deleted or withheld tweet comes back in the `errors` array), mark removed
 * rows `deleted`, step `social_freq_x` down on a removal, and on
 * VALVE_OFF_AT_REMOVALS removals inside the window write `x_autopublish_enabled`
 * false and file an owner blocker.
 *
 * Same honest limit as Instagram: it cannot distinguish a platform takedown
 * from the owner deleting a post himself, and errs toward caution.
 *
 * Stepping a valve OFF and a quota DOWN are the only writes here. Nothing in
 * this module can loosen anything.
 */

import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import { lookupTweets } from './twitter.server'
import { setPipelineSettingAudited } from './settings.server'
import { fileBlocker } from './owner-blockers.server'
import { getPipelineSetting } from './feed-processor.server'
import { VALVE_KEYS } from './team-keys'
import {
  WATCH_SAMPLE,
  WATCH_WINDOW_DAYS,
  VALVE_OFF_AT_REMOVALS,
  steppedDown,
  type RemovalWatchResult,
  type RemovalWatchRepo,
  type PostedRow,
} from './social-removal-watch.server'

/** Batch verdicts for a set of tweet ids. Injected so tests never touch X. */
export type TweetStatesFn = (ids: string[]) => Promise<
  | { ok: true; states: Map<string, { state: 'live' | 'gone' | 'unknown'; detail?: string }> }
  | { ok: false; detail: string }
>

export interface XRemovalWatchDeps {
  tweetStates?: TweetStatesFn
  readSetting?: (key: string) => Promise<string | null>
  writeSetting?: (key: string, value: string) => Promise<void>
  fileBlocker?: (input: Parameters<typeof fileBlocker>[0]) => Promise<unknown>
  repo?: RemovalWatchRepo
  now?: () => Date
}

/** Default verdicts via one batch lookup (`lookupTweets` in twitter.server). */
export const getTweetStates: TweetStatesFn = async (ids) => {
  const lookup = await lookupTweets(ids)
  if (!lookup.ok) return { ok: false, detail: lookup.detail }
  const states = new Map<string, { state: 'live' | 'gone' | 'unknown'; detail?: string }>()
  for (const id of ids) {
    if (lookup.result.found.has(id)) {
      states.set(id, { state: 'live' })
    } else if (lookup.result.gone.has(id)) {
      const detail = lookup.result.gone.get(id)
      states.set(id, { state: 'gone', ...(detail ? { detail } : {}) })
    } else {
      const detail = lookup.result.unknown.get(id)
      states.set(id, { state: 'unknown', ...(detail ? { detail } : {}) })
    }
  }
  return { ok: true, states }
}

/** The Instagram repo's queries, scoped to platform 'x'. */
export const dbXRemovalWatchRepo: RemovalWatchRepo = {
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
        eq(socialPosts.platform, 'x'),
        eq(socialPosts.status, 'posted'),
        isNotNull(socialPosts.externalPostId),
        // Same NULLS-FIRST-under-DESC guard as the Instagram repo.
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
    await db.update(socialPosts)
      .set({ status: 'deleted', errorMessage: detail })
      .where(eq(socialPosts.id, id))
  },
  countRemovedSince: async (since) => {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(socialPosts)
      .where(and(
        eq(socialPosts.platform, 'x'),
        eq(socialPosts.status, 'deleted'),
        gte(socialPosts.postedAt, since),
      ))
    return rows[0]?.n ?? 0
  },
}

/**
 * One sweep over the most recent posted X rows. Safe to call every tick: one
 * batch API call, and it writes nothing unless something is actually gone.
 */
export async function runXRemovalWatch(deps: XRemovalWatchDeps = {}): Promise<RemovalWatchResult> {
  const repo = deps.repo ?? dbXRemovalWatchRepo
  const tweetStates = deps.tweetStates ?? getTweetStates
  const readSetting = deps.readSetting ?? getPipelineSetting
  const writeSetting = deps.writeSetting
    ?? ((key: string, value: string) => setPipelineSettingAudited(key, value, 'system', 'x-removal-watch').then(() => undefined))
  const file = deps.fileBlocker ?? fileBlocker
  const now = deps.now?.() ?? new Date()

  const rows = await repo.recentLive(WATCH_SAMPLE)
  if (rows.length === 0) {
    return { checked: 0, removed: [], removalsInWindow: 0, unknown: 0, abstained: 'nothing_posted' }
  }

  // A whole-request failure is a statement about the credential or the rate
  // limit, never about the posts, so the sweep concludes nothing. An auth
  // failure additionally gets a blocker, because while it persists removals
  // are invisible on a channel that publishes unattended.
  const verdicts = await tweetStates(rows.map(r => r.externalPostId))
  if (!verdicts.ok) {
    if (/\b(401|403)\b/.test(verdicts.detail)) {
      await file({
        dedupeKey: 'x-removal-watch-token-unhealthy',
        title: 'X removal watch cannot read the account',
        detail:
          `GET /2/tweets for the ${rows.length} most recent X posts failed outright (${verdicts.detail.slice(0, 200)}). ` +
          'That is a credential problem, not a removal, so the watcher concluded nothing and stepped ' +
          'nothing down. Until this is resolved, removals are NOT being detected on X.',
        unblocks: 'Removal detection, which is the safety net under X autopublish.',
        whereToGo: 'X developer portal for the app keys, then update X_API_KEY / X_ACCESS_TOKEN in Vercel.',
        category: 'credential',
        priority: 1,
        source: 'agent',
      })
      return { checked: rows.length, removed: [], removalsInWindow: 0, unknown: rows.length, abstained: 'token_unhealthy' }
    }
    return { checked: rows.length, removed: [], removalsInWindow: 0, unknown: rows.length }
  }

  const gone: PostedRow[] = []
  let live = 0
  let unknown = 0
  const details = new Map<number, string>()

  for (const row of rows) {
    const state = verdicts.states.get(row.externalPostId) ?? { state: 'unknown' as const }
    if (state.state === 'live') { live++; continue }
    if (state.state === 'unknown') { unknown++; continue }
    gone.push(row)
    details.set(row.id, state.detail ?? 'X reports this tweet no longer exists')
  }

  // Same all-gone guard as Instagram: a scope-reduced credential can flag every
  // id at once, so a sweep only believes "gone" when at least one other post
  // answered normally in the same pass.
  if (gone.length > 0 && live === 0) {
    await file({
      dedupeKey: 'x-removal-watch-token-unhealthy',
      title: 'X removal watch cannot tell removals from a broken credential',
      detail:
        `Every one of the ${rows.length} most recent X posts came back gone and none answered normally. ` +
        'That pattern is far more likely to be a credential or permission problem than an account purge, ' +
        'so the watcher concluded nothing and stepped nothing down. Until this is resolved, removals ' +
        'are NOT being detected on X.',
      unblocks: 'Removal detection, which is the safety net under X autopublish.',
      whereToGo: 'Check @hello_xdipx directly, then the X developer portal keys in Vercel.',
      category: 'credential',
      priority: 1,
      source: 'agent',
    })
    return { checked: rows.length, removed: [], removalsInWindow: 0, unknown, abstained: 'token_unhealthy' }
  }

  for (const row of gone) {
    await repo.markRemoved(row.id, details.get(row.id) ?? 'Removed from X')
  }

  const since = new Date(now.getTime() - WATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const removalsInWindow = await repo.countRemovedSince(since)

  const result: RemovalWatchResult = {
    checked: rows.length,
    removed: gone.map(r => r.id),
    removalsInWindow,
    unknown,
  }
  if (gone.length === 0) return result

  // ── A removal happened. Step down. ───────────────────────────────────────
  const raw = await readSetting('social_freq_x')
  const current = Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : 1
  const next = steppedDown(current)
  if (next !== current) {
    await writeSetting('social_freq_x', String(next))
    result.frequencySteppedTo = next
  }

  const pattern = removalsInWindow >= VALVE_OFF_AT_REMOVALS
  if (pattern) {
    await writeSetting(VALVE_KEYS.xAutopublish, 'false')
    result.valveTurnedOff = true
  }

  await file({
    dedupeKey: pattern ? 'x-removals-pattern' : `x-removal-${gone.map(r => r.id).join('-')}`,
    title: pattern
      ? `X removed ${removalsInWindow} posts in ${WATCH_WINDOW_DAYS} days; autopublish turned OFF`
      : `X removed a post (social_posts #${gone.map(r => r.id).join(', #')})`,
    detail:
      `${gone.map(r => `#${r.id}: "${r.caption.slice(0, 120)}"`).join('\n')}\n\n` +
      `X drafting frequency stepped ${current} -> ${next}/day. ` +
      (pattern
        ? `x_autopublish_enabled was turned OFF: ${removalsInWindow} removals inside ` +
          `${WATCH_WINDOW_DAYS} days is a pattern, not an incident, and the next correct action ` +
          'needs a person. Nothing publishes unattended until you turn it back on.'
        : 'Autopublish is still ON. One removal steps volume down; it does not stop the channel.') +
      '\n\nThe watcher cannot tell a platform takedown from a post you deleted yourself; if this was ' +
      'you, no action is needed and volume is earned back by a clean stretch.',
    unblocks: pattern
      ? 'Unattended X publishing, which is stopped until you decide.'
      : 'Nothing. This is a notification you asked to receive, not a task blocking the team.',
    whereToGo: '/admin/socials for the post, then the Social tab of /admin/homepage-team for the valve.',
    category: pattern ? 'valve' : 'approval',
    priority: pattern ? 1 : 2,
    source: 'agent',
    evidence: `Checked the ${rows.length} most recent posted rows; ${live} live, ${gone.length} gone, ${unknown} unknown.`,
  })

  return result
}
