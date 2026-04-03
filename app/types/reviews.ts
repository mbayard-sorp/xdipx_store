export interface Review {
  id: string
  shopifyProductId: string
  shopifyOrderId: string | null
  shopifyCustomerId: string | null
  reviewerName: string
  reviewerEmail: string
  rating: number
  title: string | null
  body: string | null
  status: 'pending' | 'approved' | 'rejected' | 'spam'
  isVerifiedPurchase: boolean
  isFeatured: boolean
  isIncentivized: boolean
  helpfulYes: number
  helpfulNo: number
  aiSentiment: 'positive' | 'neutral' | 'negative' | null
  aiSummary: string | null
  aiSpamScore: number | null
  moderationNote: string | null
  moderatedBy: string | null
  moderatedAt: string | null
  replyBody: string | null
  replyAt: string | null
  source: 'organic' | 'email_invite' | 'import'
  inviteToken: string | null
  inviteTokenUsedAt: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  updatedAt: string
  // Joined
  media?: ReviewMedia[]
  attributeRatings?: ReviewAttributeRating[]
}

export interface ReviewMedia {
  id: string
  reviewId: string
  mediaType: 'image' | 'video'
  url: string
  thumbnailUrl: string | null
  sortOrder: number
  createdAt: string
}

export interface ReviewAttributeRating {
  id: string
  reviewId: string
  attributeName: string
  rating: number
}

export interface ReviewInvite {
  id: string
  shopifyOrderId: string
  shopifyCustomerId: string | null
  shopifyProductId: string
  reviewerEmail: string
  reviewerName: string
  inviteToken: string
  sentAt: string
  openedAt: string | null
  clickedAt: string | null
  completedAt: string | null
  reminderSentAt: string | null
  status: 'sent' | 'opened' | 'clicked' | 'completed' | 'expired'
}

export interface ReviewAggregate {
  shopifyProductId: string
  totalCount: number
  approvedCount: number
  averageRating: number
  rating1Count: number
  rating2Count: number
  rating3Count: number
  rating4Count: number
  rating5Count: number
  verifiedCount: number
  withPhotoCount: number
  lastUpdated: string
}

export interface CreateReviewInput {
  shopifyProductId: string
  shopifyOrderId?: string | undefined
  shopifyCustomerId?: string | undefined
  reviewerName: string
  reviewerEmail: string
  rating: number
  title?: string | undefined
  body?: string | undefined
  isVerifiedPurchase?: boolean | undefined
  isIncentivized?: boolean | undefined
  source?: 'organic' | 'email_invite' | 'import' | undefined
  inviteToken?: string | undefined
  ipAddress?: string | undefined
  userAgent?: string | undefined
  attributeRatings?: Record<string, number> | undefined
  mediaUrls?: { url: string; thumbnailUrl?: string | undefined; mediaType: 'image' | 'video' }[] | undefined
}

export interface CreateInviteInput {
  shopifyOrderId: string
  shopifyCustomerId?: string
  shopifyProductId: string
  reviewerEmail: string
  reviewerName: string
}

export interface ReviewSettings {
  autoApprove: boolean
  spamThreshold: number
  minBodyLength: number
  requireTitle: boolean
  inviteDelayDays: number
  reminderDelayDays: number
  remindersEnabled: boolean
  reviewsPerPage: number
  defaultSort: string
  showAiSummaries: boolean
  showIncentivizedLabel: boolean
  digestEmail: string | null
  webhookUrl: string | null
}

export interface ReviewStats {
  totalReviews: number
  pendingReviews: number
  approvedReviews: number
  rejectedReviews: number
  spamReviews: number
  averageRating: number
  totalInvitesSent: number
  inviteConversionRate: number
}

export interface AdminReviewFilters {
  status?: string | undefined
  productId?: string | undefined
  search?: string | undefined
  sort?: string | undefined
  page?: number | undefined
  perPage?: number | undefined
}

export interface ReviewAIAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative'
  summary: string
  spamScore: number
  spamReason: string | null
  suggestedStatus: 'approved' | 'pending' | 'spam'
  flags: string[]
}
