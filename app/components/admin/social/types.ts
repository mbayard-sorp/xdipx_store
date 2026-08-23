import { weightedTweetLength, X_CAPTION_MAX } from '~/lib/social-publish/x-limits'

/** Client-safe row shape for social drafts rendered by the Social Studio. */
export interface SocialPostRow {
  id: number
  platform: string
  postType: string
  externalPostId: string | null
  tweetText: string
  mediaUrls: string[] | null
  status: string
  errorMessage: string | null
  postedAt?: string | Date | null
  createdAt: string | Date | null
  createdBy: string | null
  reviewStatus: string
  feedback: string | null
  editedText: string | null
  reviewedBy: string | null
  reviewedAt: string | Date | null
  scheduledFor: string | null
  reworkedFrom: number | null
  /** Video pipeline linkage (065): set when this draft is a fanned-out video. */
  videoJobId: number | null
  posterUrl: string | null
  /** Durable product linkage (080). */
  shopifyProductId?: string | null
  /** Social Studio v2 columns (084); optional so older callers still type-check. */
  scheduledAt?: string | Date | null
  permalink?: string | null
  gateStatus?: string | null
  gateCheckedAt?: string | Date | null
  gateFindings?: { check: string; verdict: string; note?: string }[] | null
  castSlugs?: string[] | null
  updatedAt?: string | Date | null
}

/** The live X account. The old hardcoded `xdipx` handle only worked via redirect. */
export const X_HANDLE = 'hello_xdipx'

/** Link to the live post: the stored permalink first, else X by id. Instagram stores a media id only. */
export function livePostUrl(post: Pick<SocialPostRow, 'platform' | 'externalPostId' | 'permalink'>): string | null {
  if (post.permalink) return post.permalink
  if (post.platform === 'x' && post.externalPostId) return `https://x.com/${X_HANDLE}/status/${post.externalPostId}`
  return null
}

/** True when the draft's media is a video (fanned out from the video pipeline). */
export function isVideoPost(post: Pick<SocialPostRow, 'videoJobId' | 'mediaUrls'>): boolean {
  return post.videoJobId != null || !!post.mediaUrls?.[0]?.split('?')[0]?.endsWith('.mp4')
}

export const PLATFORM_LABELS: Record<string, string> = {
  x: 'X',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
}

/** LinkedIn's post ceiling. Plain characters, no link weighting. */
export const LINKEDIN_CAPTION_MAX = 3000

/**
 * Caption length the way the platform itself counts it.
 *
 * X bills every link at the fixed t.co width, so a caption carrying two PDP
 * URLs runs ~500 raw characters and still fits inside 280. Counting raw
 * `.length` in the review UI disabled Approve on drafts the publish gate had
 * already passed and X would have accepted, which stalled the whole X queue.
 * Same helper the gate and the publisher use, so the three agree.
 */
export function platformCaptionLength(platform: string, caption: string): number {
  return platform === 'x' ? weightedTweetLength(caption) : caption.length
}

/** Would this platform reject the caption for length? Drives the Approve gate. */
export function captionOverPlatformLimit(platform: string, caption: string): boolean {
  if (platform === 'x') return weightedTweetLength(caption) > X_CAPTION_MAX
  if (platform === 'linkedin') return caption.length > LINKEDIN_CAPTION_MAX
  return false
}
