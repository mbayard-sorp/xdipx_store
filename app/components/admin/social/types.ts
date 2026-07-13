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
}

export const PLATFORM_LABELS: Record<string, string> = {
  x: 'X',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
}
