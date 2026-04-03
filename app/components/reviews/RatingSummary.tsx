import { Link } from 'react-router'
import type { ReviewAggregate } from '~/types/reviews'
import { StarRating } from './StarRating'

interface RatingSummaryProps {
  aggregate: ReviewAggregate
  productId: string
}

export function RatingSummary({ aggregate, productId }: RatingSummaryProps) {
  const {
    approvedCount,
    averageRating,
    rating1Count,
    rating2Count,
    rating3Count,
    rating4Count,
    rating5Count,
    verifiedCount,
    withPhotoCount,
  } = aggregate

  const total = approvedCount || 1 // avoid division by zero

  const bars = [
    { stars: 5, count: rating5Count },
    { stars: 4, count: rating4Count },
    { stars: 3, count: rating3Count },
    { stars: 2, count: rating2Count },
    { stars: 1, count: rating1Count },
  ]

  const recommendPct =
    approvedCount > 0
      ? Math.round(((rating4Count + rating5Count) / approvedCount) * 100)
      : 0

  return (
    <section className="bg-white rounded-2xl border border-brand-mist p-6 mb-6">
      <div className="flex flex-col sm:flex-row gap-6 items-start">

        {/* Average rating */}
        <div className="flex flex-col items-center sm:items-start shrink-0">
          <span
            className="text-6xl font-black text-brand-charcoal"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {averageRating.toFixed(1)}
          </span>
          <StarRating value={Math.round(averageRating)} readonly size="lg" />
          <span className="text-sm text-brand-charcoal/50 mt-1">
            {approvedCount} review{approvedCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Bar chart */}
        <div className="flex-1 w-full space-y-1.5">
          {bars.map(({ stars, count }) => (
            <div key={stars} className="flex items-center gap-2">
              <span className="text-xs text-brand-charcoal/60 w-4 text-right shrink-0">{stars}</span>
              <span className="text-brand-charcoal/40 text-xs shrink-0">★</span>
              <div className="flex-1 h-2 bg-brand-mist rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.round((count / total) * 100)}%`,
                    background: '#7B2FBE',
                  }}
                />
              </div>
              <span className="text-xs text-brand-charcoal/50 w-6 shrink-0">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Badges */}
      {approvedCount > 0 && (
        <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t border-brand-mist">
          <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 text-xs font-medium px-3 py-1 rounded-full">
            <span aria-hidden="true">♥</span>
            {recommendPct}% recommend
          </span>
          {verifiedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-brand-mist text-brand-purple text-xs font-medium px-3 py-1 rounded-full">
              <span aria-hidden="true">✓</span>
              {verifiedCount} verified purchase{verifiedCount !== 1 ? 's' : ''}
            </span>
          )}
          {withPhotoCount > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-brand-mist text-brand-charcoal/60 text-xs font-medium px-3 py-1 rounded-full">
              <span aria-hidden="true">📷</span>
              {withPhotoCount} with photo{withPhotoCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* CTA */}
      <div className="mt-5">
        <Link
          to={`/review?productId=${productId}`}
          className="inline-block bg-brand-gradient text-white font-semibold text-sm px-6 py-2.5 rounded-full hover:opacity-90 transition-opacity"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Write a Review ♥
        </Link>
      </div>
    </section>
  )
}
