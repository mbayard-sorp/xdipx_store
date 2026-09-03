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

const RECENT_POST_WINDOW_DAYS = 14

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
async function ingestMediaComments(mediaId: string, token: string): Promise<{ fetched: number; inserted: number; detail?: string }> {
  const res = await igRequest(`/${mediaId}/comments`, {
    method: 'GET',
    params: { fields: 'id,text,username,timestamp,replies' },
    token,
  })
  if (!res.ok) return { fetched: 0, inserted: 0, detail: describeCommentsApiError(res.error) }

  const raw = (res.data['data'] as RawComment[] | undefined) ?? []
  let inserted = 0
  for (const c of raw) {
    if (!c.id || !c.text) continue
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
  return { fetched: raw.length, inserted }
}

/**
 * Ingest new comments for every Instagram post from the last 14 days.
 * Called hourly from /cron/instagram-comments-ingest. Never throws: a
 * missing token or a missing scope reports a clear `detail` in the result
 * (rendered as an admin banner) instead of failing the cron invocation.
 */
export async function ingestRecentComments(): Promise<IngestResult> {
  const token = process.env['IG_GRAPH_ACCESS_TOKEN']?.trim()
  if (!token) {
    return { ok: false, postsChecked: 0, fetched: 0, inserted: 0, detail: 'IG_GRAPH_ACCESS_TOKEN is not configured' }
  }

  const mediaIds = await recentInstagramMediaIds()
  let fetched = 0
  let inserted = 0
  let firstErrorDetail: string | undefined
  for (const mediaId of mediaIds) {
    const result = await ingestMediaComments(mediaId, token)
    fetched += result.fetched
    inserted += result.inserted
    if (result.detail && !firstErrorDetail) firstErrorDetail = result.detail
  }

  return {
    ok: !firstErrorDetail,
    postsChecked: mediaIds.length,
    fetched,
    inserted,
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
  const token = process.env['IG_GRAPH_ACCESS_TOKEN']?.trim()
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
