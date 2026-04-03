import { useState } from 'react'
import type { Review } from '~/types/reviews'
import { StarRating }   from './StarRating'
import { HelpfulVote }  from './HelpfulVote'
import { SellerReply }  from './SellerReply'
import { MediaLightbox } from './MediaLightbox'

interface ReviewCardProps {
  review: Review
  showAiSummary?: boolean
}

const TRUNCATE_AT = 300

function relativeTime(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime()
  const days  = Math.floor(diff / 86400000)
  const weeks = Math.floor(days  / 7)
  const months= Math.floor(days  / 30)
  if (days  < 1)  return 'today'
  if (days  < 7)  return `${days} day${days !== 1 ? 's' : ''} ago`
  if (weeks < 5)  return `${weeks} week${weeks !== 1 ? 's' : ''} ago`
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''} ago`
  return `over a year ago`
}

function initials(name: string): string {
  return name.split(' ').map(p => p[0]?.toUpperCase() ?? '').slice(0, 2).join('')
}

export function ReviewCard({ review, showAiSummary = true }: ReviewCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const body = review.body ?? ''
  const needsTruncation = body.length > TRUNCATE_AT
  const displayBody = needsTruncation && !expanded ? body.slice(0, TRUNCATE_AT) + '…' : body
  const media = review.media ?? []

  return (
    <article className="bg-white rounded-xl border border-brand-mist p-5">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        {/* Avatar */}
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
          style={{ background: '#7B2FBE', fontFamily: 'var(--font-display)' }}
          aria-hidden="true"
        >
          {initials(review.reviewerName)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
              {review.reviewerName}
            </span>
            {review.isVerifiedPurchase && (
              <span className="inline-flex items-center gap-0.5 bg-green-50 text-green-700 text-[10px] font-medium px-2 py-0.5 rounded-full">
                ✓ Verified
              </span>
            )}
            {review.isIncentivized && (
              <span className="inline-flex items-center bg-amber-50 text-amber-700 text-[10px] font-medium px-2 py-0.5 rounded-full">
                Incentivized
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <StarRating value={review.rating} readonly size="sm" />
            <span className="text-xs text-brand-charcoal/40">{relativeTime(review.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* Title */}
      {review.title && (
        <h3 className="font-semibold text-brand-charcoal mb-1.5 text-sm" style={{ fontFamily: 'var(--font-display)' }}>
          {review.title}
        </h3>
      )}

      {/* Body */}
      {body && (
        <div className="text-sm text-brand-charcoal/80 leading-relaxed">
          <p>{displayBody}</p>
          {needsTruncation && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-brand-purple text-xs font-medium mt-1 hover:underline"
            >
              {expanded ? 'Read less' : 'Read more'}
            </button>
          )}
        </div>
      )}

      {/* AI summary */}
      {showAiSummary && review.aiSummary && (
        <p className="text-xs text-brand-charcoal/50 italic mt-2 pl-3 border-l-2 border-brand-mist">
          {review.aiSummary}
        </p>
      )}

      {/* Media thumbnails */}
      {media.length > 0 && (
        <div className="flex gap-2 mt-3 flex-wrap">
          {media.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setLightboxIndex(i)}
              className="w-14 h-14 rounded-lg overflow-hidden bg-brand-mist border border-brand-mist hover:border-brand-purple/40 transition-colors"
              aria-label={`View ${m.mediaType} ${i + 1}`}
            >
              {m.mediaType === 'image' ? (
                <img
                  src={m.thumbnailUrl ?? m.url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xl">🎥</div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Helpful vote */}
      <HelpfulVote
        reviewId={review.id}
        helpfulYes={review.helpfulYes}
        helpfulNo={review.helpfulNo}
      />

      {/* Seller reply */}
      {review.replyBody && review.replyAt && (
        <SellerReply replyBody={review.replyBody} replyAt={review.replyAt} />
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <MediaLightbox
          media={media}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </article>
  )
}
