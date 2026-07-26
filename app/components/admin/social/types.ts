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
