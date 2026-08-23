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
