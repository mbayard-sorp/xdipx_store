/**
 * Instagram comment support lane, phase 1 (ticket #2027, owner direction
 * 2026-08-08: "yes, we need a support team to reply to comments").
 *
 * Two operations, both against the same Graph API this account already
 * publishes through (see `./instagram.server.ts` for the shared `igRequest`
 * request/error convention):
 *
 *   1. `ingestRecentComments()` -- for every Instagram post published in the
 *      last 14 days (`social_posts` where platform='instagram' and
 *      status='posted'), GET /{media_id}/comments and upsert each comment
 *      into `social_comments` at status 'inbound'. Idempotent: the unique
 *      index on `external_comment_id` (migration 093) makes a repeat fetch
 *      of the same window a no-op for comments already seen.
 *   2. `postCommentReply(commentId, text)` -- POST /{comment_id}/replies,
 *      records `external_reply_id`.
 *
 * Auth needs the `instagram_manage_comments` scope on IG_GRAPH_ACCESS_TOKEN,
 * beyond the `instagram_content_publish` scope the publisher already uses.
 * A token missing that scope must degrade to a clear, actionable message
 * (surfaced as an admin banner by the caller), never a crash or a silent
 * empty ingest -- see `describeCommentsApiError`.
 */
import { and, desc, eq, gte } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { socialComments, socialPosts } from '../../../db/schema'
import { igRequest, describeInstagramApiError, type MetaError } from './instagram.server'
import { getInstagramAccessToken } from '~/lib/instagram-token.server'
import { kvGet, kvSet } from '~/lib/kv.server'

const RECENT_POST_WINDOW_DAYS = 14

/**
 * Ticket #20826: one Instagram post that was later deleted or had its
 * permissions changed must not take the hourly ingest down for the other
 * posts in the window, and must not be retried hourly forever once it is
 * clearly gone. Meta's "object does not exist, cannot be loaded due to
 * missing permissions, or does not support this operation" shape is code
 * 100, subcode 33 (the same classification `getInstagramMediaState` in
 * `./instagram.server.ts` already uses for the removal watcher, kept local
 * here rather than shared since it is a two-line check on the same `MetaError`
 * shape both files already import).
 */
function isObjectMissingError(error: MetaError): boolean {
  return error.code === 100 && (error.error_subcode === 33 || error.error_subcode === undefined)
}

/** Consecutive "object does not exist" errors before a post stops being retried hourly. */
const UNREACHABLE_AFTER_CONSECUTIVE_ERRORS = 3
/** Persisted {mediaId: consecutive-error-count} map. No TTL, same as `KV_KEYS.pinnedAccessoryIds`. */
const UNREACHABLE_COUNTS_KV_KEY = 'social:ig:comments-ingest:unreachable-counts'

async function loadUnreachableCounts(): Promise<Record<string, number>> {
  return (await kvGet<Record<string, number>>(UNREACHABLE_COUNTS_KV_KEY)) ?? {}
}

/** Meta's "missing permission" shape: code 10, or code 200 with subcode 33. */
function isMissingScopeError(error: MetaError): boolean {
  return error.code === 10 || (error.code === 200 && error.error_subcode === 33)
}

/**
 * Same message convention as `describeInstagramApiError`, extended with the
 * comments-specific scope this lane needs beyond ordinary publishing.
 */
export function describeCommentsApiError(error: MetaError): string {
  if (isMissingScopeError(error)) {
    return (
      `${error.message ?? 'Missing permission'}. IG_GRAPH_ACCESS_TOKEN needs the `
      + 'instagram_manage_comments scope to read or reply to comments. Regenerate it in the Meta '
      + 'App Dashboard (Instagram > API setup with Instagram business login), granting that scope, '
      + 'and update the Vercel env var.'
    )
  }
  return describeInstagramApiError(error)
}

interface RawComment {
  id?: string
  text?: string
  username?: string
  timestamp?: string
}

export interface IngestResult {
  ok: boolean
  postsChecked: number
  fetched: number
  inserted: number
  detail?: string
  /**
   * Set only when there was nothing to check at all (no eligible posts in
   * the window) — the honest "no work" case, distinct from a check that ran
   * against real posts and found zero comments. `classifyCronOutcome`
   * (`app/lib/cron-runs.server.ts`) recognizes this exact field name and
   * records the cron run as 'skipped' rather than a blank 'succeeded', so
   * the weekly social drift check (routine-weekly-strategy.md step 3d, line
   * 6) can tell "nothing to check" apart from "posts existed and genuinely
   * got zero comments" (both `ok:true`, but only the latter leaves
   * `postsChecked > 0`).
   */
  skipped?: string
  /**
   * Ticket #20826: posts excluded from this run's `postsChecked` because
   * they already hit `UNREACHABLE_AFTER_CONSECUTIVE_ERRORS` consecutive
   * "object does not exist" errors on prior runs. Present (possibly 0)
   * whenever the run actually considered the post list; absent on the two
   * early-exit paths above (no token, no posts at all) where the question
   * does not apply.
   */
  skippedUnreachable?: number
}

/**
 * Recently-published Instagram posts to pull comments for. Requires an
 * `externalPostId` (the Graph API media id set once the publish call
 * succeeds), so a still-drafting or failed row is never queried.
 */
async function recentInstagramMediaIds(): Promise<string[]> {
  const since = new Date(Date.now() - RECENT_POST_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({ externalPostId: socialPosts.externalPostId })
    .from(socialPosts)
    .where(and(
      eq(socialPosts.platform, 'instagram'),
      eq(socialPosts.status, 'posted'),
      gte(socialPosts.postedAt, since),
    ))
    .orderBy(desc(socialPosts.postedAt))
  return rows.map(r => r.externalPostId).filter((id): id is string => !!id)
}

/** One media's comments, upserted. Never throws: every failure is reported in the result. */
async function ingestMediaComments(
  mediaId: string,
  token: string,
): Promise<{ fetched: number; inserted: number; malformed: number; detail?: string; objectMissing?: boolean }> {
  const res = await igRequest(`/${mediaId}/comments`, {
    method: 'GET',
    params: { fields: 'id,text,username,timestamp,replies' },
    token,
  })
  if (!res.ok) {
    return {
      fetched: 0,
      inserted: 0,
      malformed: 0,
      detail: describeCommentsApiError(res.error),
      objectMissing: isObjectMissingError(res.error),
    }
  }

  const raw = (res.data['data'] as RawComment[] | undefined) ?? []
  let inserted = 0
  let malformed = 0
  for (const c of raw) {
    // A real comment always carries an id and text; an item missing either
    // is not a comment this parser recognizes (ticket #12077 tracks this
    // separately from "already ingested" so a run that fetches real
    // comments but silently drops every one of them, rather than skipping
    // ones it has already seen, can be told apart and fail loudly).
    if (!c.id || !c.text) { malformed++; continue }
    const result = await db
      .insert(socialComments)
      .values({
        externalCommentId: c.id,
        externalPostId: mediaId,
        platform: 'instagram',
        username: c.username ?? null,
        text: c.text,
        commentedAt: c.timestamp ? new Date(c.timestamp) : null,
      })
      .onConflictDoNothing({ target: socialComments.externalCommentId })
      .returning({ id: socialComments.id })
    if (result.length > 0) inserted++
  }
  return { fetched: raw.length, inserted, malformed }
}

/**
 * Ingest new comments for every Instagram post from the last 14 days.
 * Called hourly from /cron/instagram-comments-ingest. Never throws: a
 * missing token or a missing scope reports a clear `detail` in the result
 * (rendered as an admin banner) instead of failing the cron invocation.
 */
export async function ingestRecentComments(): Promise<IngestResult> {
  const token = await getInstagramAccessToken()
  if (!token) {
    return { ok: false, postsChecked: 0, fetched: 0, inserted: 0, detail: 'IG_GRAPH_ACCESS_TOKEN is not configured' }
  }

  const mediaIds = await recentInstagramMediaIds()
  if (mediaIds.length === 0) {
    // Nothing to check at all, as opposed to a check that ran against real
    // posts and found zero comments (ticket #12077, DONE WHEN 1/3): the
    // `skipped` field below is what lets the weekly drift check tell this
    // apart from "no maker engagement happened".
    return {
      ok: true,
      postsChecked: 0,
      fetched: 0,
      inserted: 0,
      skipped: 'no Instagram posts in the last 14 days to check for comments',
    }
  }

  // Ticket #20826: skip posts already marked unreachable rather than
  // retrying an "object does not exist" error hourly forever.
  const unreachableCounts = await loadUnreachableCounts()
  const checkIds: string[] = []
  let skippedUnreachable = 0
  for (const id of mediaIds) {
    if ((unreachableCounts[id] ?? 0) >= UNREACHABLE_AFTER_CONSECUTIVE_ERRORS) skippedUnreachable++
    else checkIds.push(id)
  }

  if (checkIds.length === 0) {
    return {
      ok: true,
      postsChecked: 0,
      fetched: 0,
      inserted: 0,
      skippedUnreachable,
      skipped: `all ${mediaIds.length} Instagram post(s) in the last 14 days are marked unreachable`,
    }
  }

  let fetched = 0
  let inserted = 0
  let malformed = 0
  let erroredCount = 0
  let firstErrorDetail: string | undefined
  let unreachableCountsChanged = false
  for (const mediaId of checkIds) {
    const result = await ingestMediaComments(mediaId, token)
    fetched += result.fetched
    inserted += result.inserted
    malformed += result.malformed
    if (result.detail) {
      erroredCount++
      if (!firstErrorDetail) firstErrorDetail = result.detail
      if (result.objectMissing) {
        unreachableCounts[mediaId] = (unreachableCounts[mediaId] ?? 0) + 1
        unreachableCountsChanged = true
      }
    } else if (mediaId in unreachableCounts) {
      // A previously-flaky post answered cleanly again; clear its strike count.
      delete unreachableCounts[mediaId]
      unreachableCountsChanged = true
    }
  }
  if (unreachableCountsChanged) await kvSet(UNREACHABLE_COUNTS_KV_KEY, unreachableCounts)

  // Ticket #12077, DONE WHEN 2: a run that fetched real comments but stored
  // none of them, where the shortfall isn't explained by every fetched
  // comment already being known (an ordinary, healthy re-fetch of an
  // already-ingested window — onConflictDoNothing legitimately returns
  // nothing there), is a defect, most likely the Graph API returning a
  // comment shape this parser doesn't recognize. That must fail loudly
  // rather than reporting a blank "succeeded" that looks identical to a
  // quiet week. Independent of the per-post API-error accounting below: it
  // only fires when no per-post error already explains the shortfall.
  const malformedFailure = erroredCount === 0 && fetched > 0 && inserted === 0 && malformed > 0
  if (malformedFailure) {
    firstErrorDetail =
      `Instagram returned ${fetched} comment(s) across ${checkIds.length} post(s), but ${malformed} `
      + 'lacked an id or text field this parser expects and 0 were stored. Check the Graph API '
      + 'response shape (fields=id,text,username,timestamp,replies).'
  }

  // Ticket #20826, DONE WHEN 3: one bad post (or a few) must not fail the
  // whole run — only a run where EVERY checked post errored is a real
  // failure (e.g. the access token itself is dead, which errors every post
  // identically rather than just the one Meta says is gone).
  const allErrored = checkIds.length > 0 && erroredCount === checkIds.length

  return {
    ok: !malformedFailure && !allErrored,
    postsChecked: checkIds.length,
    fetched,
    inserted,
    skippedUnreachable,
    ...(firstErrorDetail ? { detail: firstErrorDetail } : {}),
  }
}

export interface ReplyResult {
  ok: boolean
  externalReplyId?: string
  detail?: string
}

/** Post one reply to a comment, via POST /{comment_id}/replies. */
export async function postCommentReply(externalCommentId: string, text: string): Promise<ReplyResult> {
  const token = await getInstagramAccessToken()
  if (!token) return { ok: false, detail: 'IG_GRAPH_ACCESS_TOKEN is not configured' }
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, detail: 'Reply text is empty' }

  const res = await igRequest(`/${externalCommentId}/replies`, {
    method: 'POST',
    params: { message: trimmed },
    token,
  })
  if (!res.ok) return { ok: false, detail: describeCommentsApiError(res.error) }

  const id = String(res.data['id'] ?? '')
  if (!id) return { ok: false, detail: 'Instagram replied but returned no comment id' }
  return { ok: true, externalReplyId: id }
}
