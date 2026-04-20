import { useState } from 'react'
import { useFetcher } from 'react-router'
import type { Review } from '~/types/reviews'
import { StarRating }    from './StarRating'
import { AIAnalysisPanel } from './AIAnalysisPanel'
import { MediaLightbox }  from './MediaLightbox'

interface ReviewDrawerProps {
  review: Review | null
  onClose: () => void
  onUpdate: () => void
}

const STATUS_LABEL: Record<string, string> = {
  pending:  '⏳ Pending',
  approved: '✓ Approved',
  rejected: '✕ Rejected',
  spam:     '⚠ Spam',
}

export function ReviewDrawer({ review, onClose, onUpdate }: ReviewDrawerProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [reply, setReply] = useState(review?.replyBody ?? '')
  const [replyMode, setReplyMode] = useState(false)

  const actionFetcher = useFetcher<{ ok: boolean }>()
  const replyFetcher  = useFetcher<{ ok: boolean; reply?: string }>()
  const aiSuggestFetcher = useFetcher<{ ok: boolean; suggestion?: string }>()

  const isLoading = actionFetcher.state !== 'idle'

  // Update reply field when AI suggestion comes back
  if (aiSuggestFetcher.data?.suggestion && reply !== aiSuggestFetcher.data.suggestion) {
    setReply(aiSuggestFetcher.data.suggestion)
  }

  const handleAction = (intent: string) => {
    if (!review) return
    actionFetcher.submit(
      { intent, reviewId: review.id },
      { method: 'post', action: '/api/reviews/admin' },
    )
    onUpdate()
  }

  const handleReply = () => {
    if (!review || !reply.trim()) return
    replyFetcher.submit(
      { intent: 'reply', reviewId: review.id, replyBody: reply },
      { method: 'post', action: '/api/reviews/admin' },
    )
    setReplyMode(false)
    onUpdate()
  }

  const handleAISuggest = () => {
    if (!review) return
    aiSuggestFetcher.submit(
      { intent: 'suggest-reply', reviewId: review.id },
      { method: 'post', action: '/api/reviews/admin' },
    )
  }

  const media = review?.media ?? []

  if (!review) return null

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Review details"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cream-2 shrink-0">
          <h2
            className="font-bold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Review Detail
          </h2>
          <button
            onClick={onClose}
            className="text-ink/40 hover:text-ink text-xl leading-none"
            aria-label="Close panel"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 px-6 py-5 space-y-5 overflow-y-auto">

          {/* Reviewer info */}
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
              style={{ background: '#7C8F78', fontFamily: 'var(--font-display)' }}
              aria-hidden="true"
            >
              {review.reviewerName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-sm text-ink">{review.reviewerName}</p>
              <p className="text-xs text-ink/50">{review.reviewerEmail}</p>
              {review.shopifyOrderId && (
                <p className="text-xs text-ink/40">Order: {review.shopifyOrderId}</p>
              )}
              <div className="flex gap-2 mt-1 flex-wrap">
                {review.isVerifiedPurchase && (
                  <span className="text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded-full">✓ Verified</span>
                )}
                {review.isIncentivized && (
                  <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Incentivized</span>
                )}
                {review.source !== 'organic' && (
                  <span className="text-[10px] text-ink/40 bg-cream-2 px-2 py-0.5 rounded-full capitalize">{review.source}</span>
                )}
              </div>
            </div>
            <div className="ml-auto">
              <StarRating value={review.rating} readonly size="sm" />
            </div>
          </div>

          {/* Current status */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink/50">Status:</span>
            <span className="text-xs font-semibold capitalize">{STATUS_LABEL[review.status] ?? review.status}</span>
          </div>

          {/* Title + body */}
          {review.title && (
            <h3 className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
              {review.title}
            </h3>
          )}
          {review.body && (
            <p className="text-sm text-ink/80 leading-relaxed">{review.body}</p>
          )}

          {/* Media */}
          {media.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {media.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  className="w-16 h-16 rounded-lg overflow-hidden bg-cream-2 border border-cream-2 hover:border-sage/40 transition-colors"
                  aria-label={`View ${m.mediaType} ${i + 1}`}
                >
                  {m.mediaType === 'image' ? (
                    <img src={m.thumbnailUrl ?? m.url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl">🎥</div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* AI Analysis */}
          <AIAnalysisPanel review={review} />

          {/* Feature toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink/60">Featured review</span>
            <actionFetcher.Form method="post" action="/api/reviews/admin">
              <input type="hidden" name="intent"    value="feature" />
              <input type="hidden" name="reviewId"  value={review.id} />
              <input type="hidden" name="isFeatured" value={review.isFeatured ? 'false' : 'true'} />
              <button
                type="submit"
                className={[
                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                  review.isFeatured ? 'bg-sage' : 'bg-cream-2',
                ].join(' ')}
                aria-label={review.isFeatured ? 'Unfeature review' : 'Feature review'}
              >
                <span className={[
                  'inline-block w-3.5 h-3.5 rounded-full bg-white transition-transform shadow',
                  review.isFeatured ? 'translate-x-4' : 'translate-x-0.5',
                ].join(' ')} />
              </button>
            </actionFetcher.Form>
          </div>

          {/* Reply section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
                Seller reply
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAISuggest}
                  disabled={aiSuggestFetcher.state !== 'idle'}
                  className="text-xs text-sage hover:text-sun transition-colors disabled:opacity-50"
                >
                  {aiSuggestFetcher.state !== 'idle' ? 'Generating...' : '✨ AI Suggest'}
                </button>
                {!replyMode && (
                  <button
                    type="button"
                    onClick={() => setReplyMode(true)}
                    className="text-xs text-ink/50 hover:text-ink transition-colors"
                  >
                    {review.replyBody ? 'Edit' : 'Add reply'}
                  </button>
                )}
              </div>
            </div>

            {review.replyBody && !replyMode && (
              <div className="bg-cream-2 rounded-xl p-3 text-sm text-ink/80 italic">
                {review.replyBody}
              </div>
            )}

            {replyMode && (
              <div className="space-y-2">
                <textarea
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  rows={4}
                  className="w-full border border-cream-2 rounded-xl px-3 py-2 text-sm text-ink focus:outline-none focus:border-sage transition-colors resize-none"
                  placeholder="Write a warm, on-brand reply..."
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleReply}
                    disabled={replyFetcher.state !== 'idle'}
                    className="text-xs font-semibold bg-coral text-white px-4 py-1.5 rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {replyFetcher.state !== 'idle' ? 'Saving...' : 'Save reply'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReplyMode(false)}
                    className="text-xs text-ink/50 hover:text-ink transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="px-6 py-4 border-t border-cream-2 shrink-0">
          <div className="flex gap-2 flex-wrap">
            {review.status !== 'approved' && (
              <button
                type="button"
                onClick={() => handleAction('approve')}
                disabled={isLoading}
                className="flex-1 py-2 rounded-full text-sm font-semibold bg-green-500 text-white hover:bg-green-600 transition-colors disabled:opacity-50"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                ✓ Approve
              </button>
            )}
            {review.status !== 'rejected' && (
              <button
                type="button"
                onClick={() => handleAction('reject')}
                disabled={isLoading}
                className="flex-1 py-2 rounded-full text-sm font-semibold bg-red-100 text-red-700 hover:bg-red-200 transition-colors disabled:opacity-50"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                ✕ Reject
              </button>
            )}
            {review.status !== 'spam' && (
              <button
                type="button"
                onClick={() => handleAction('spam')}
                disabled={isLoading}
                className="py-2 px-4 rounded-full text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                ⚠ Spam
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <MediaLightbox
          media={media}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  )
}
