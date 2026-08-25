/**
 * Client-safe shapes shared by the calendar route and its components
 * (Social Studio v2 Phase 4, #4939).
 */
import type { CalendarPostLike } from '~/lib/social-calendar'

export interface CalendarPost extends CalendarPostLike {
  id: number
  platform: string
  status: string
  reviewStatus: string
  tweetText: string
  editedText: string | null
  mediaUrls: string[] | null
  posterUrl: string | null
  videoJobId: number | null
  scheduledAt: string | null
  scheduledFor: string | null
  postedAt: string | null
  createdAt: string | null
  /** Effective gate verdict (`gate_status`, stamp fallback), computed server-side. */
  gateStatus: string | null
  externalPostId: string | null
  errorMessage: string | null
}

/** A move the owner asked for, LA wall clock. */
export interface MoveRequest {
  postId: number
  date: string
  time: string
}

/** Short platform labels for the cap indicator ("IG 2/3"). */
export const PLATFORM_SHORT: Record<string, string> = {
  instagram: 'IG',
  x: 'X',
  tiktok: 'TT',
  facebook: 'FB',
  youtube: 'YT',
  linkedin: 'LI',
}

/** The caption the chip shows: the owner's edit wins over the agent draft. */
export function chipCaption(post: Pick<CalendarPost, 'tweetText' | 'editedText'>, max = 40): string {
  const raw = (post.editedText || post.tweetText || '').replace(/\s+/g, ' ').trim()
  return raw.length > max ? `${raw.slice(0, max).trimEnd()}…` : raw
}

/** The thumb to show: a video's poster, otherwise the first still. */
export function chipThumb(post: Pick<CalendarPost, 'mediaUrls' | 'posterUrl' | 'videoJobId'>): string | null {
  const first = post.mediaUrls?.[0] ?? null
  if (post.videoJobId != null || first?.split('?')[0]?.endsWith('.mp4')) return post.posterUrl ?? null
  return first
}

/**
 * Which rows the owner can delete from the calendar sheet. Mirrors
 * `canDeletePost` in admin.socials.queue.tsx (ticket #4908/#4935): drafts and
 * failed rows always; live X posts only when a tweet id exists to delete on
 * X first; live Instagram posts as a row-only removal (no delete API); every
 * other live platform and `publishing`/`deleted` rows are refused.
 */
export function canDeleteCalendarPost(post: Pick<CalendarPost, 'status' | 'platform' | 'externalPostId'>): boolean {
  if (post.status === 'draft' || post.status === 'failed') return true
  if (post.status !== 'posted') return false
  if (post.platform === 'x') return !!post.externalPostId
  return post.platform === 'instagram'
}

// ── Calendar-sheet verb gating (ticket #5417) ───────────────────────────────
// Pure so the sheet's button visibility is a direct unit test rather than
// something only provable by rendering the modal. The actual write always
// goes through the queue route's own intents (review / post-approved-draft /
// post-media / delete-post); these only decide whether a button shows.

/** Approve: a still-editorial draft, not yet approved and not gate-BLOCKed. */
export function canApproveCalendarPost(post: Pick<CalendarPost, 'status' | 'reviewStatus'>): boolean {
  return post.status === 'draft' && (post.reviewStatus === 'pending_review' || post.reviewStatus === 'needs_changes')
}

/**
 * Post now: an approved draft. X can ship caption-only; every other
 * platform's `post-media` intent requires at least one media URL.
 */
export function canPostCalendarNow(post: Pick<CalendarPost, 'status' | 'reviewStatus' | 'platform' | 'mediaUrls'>): boolean {
  return post.status === 'draft' && post.reviewStatus === 'approved'
    && (post.platform === 'x' || (post.mediaUrls?.length ?? 0) > 0)
}

/** Edit: anything short of a published row. History is not edited. */
export function canEditCalendarPost(post: Pick<CalendarPost, 'status'>): boolean {
  return post.status !== 'posted'
}

/** Which queue-route intent "Post now" fires, per platform. */
export function postNowIntent(platform: string): 'post-approved-draft' | 'post-media' {
  return platform === 'x' ? 'post-approved-draft' : 'post-media'
}
