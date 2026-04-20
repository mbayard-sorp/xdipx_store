import { Link, useLocation } from 'react-router'
import type { Review, ReviewAggregate } from '~/types/reviews'
import { ReviewCard }    from './ReviewCard'
import { RatingSummary } from './RatingSummary'

interface ReviewListProps {
  reviews: Review[]
  aggregate: ReviewAggregate
  productId: string
  total: number
  page: number
  sort: string
  filter: string
}

const SORT_OPTIONS = [
  { value: 'newest',  label: 'Newest'      },
  { value: 'oldest',  label: 'Oldest'      },
  { value: 'highest', label: 'Highest rated' },
  { value: 'lowest',  label: 'Lowest rated'  },
  { value: 'helpful', label: 'Most helpful'  },
]

const FILTER_TABS = [
  { value: 'all',        label: 'All'        },
  { value: 'verified',   label: 'Verified'   },
  { value: 'with_photo', label: 'With photo' },
  { value: '5star',      label: '5★'         },
  { value: '4star',      label: '4★'         },
  { value: '3star',      label: '3★ & below' },
]

function buildReviewUrl(
  pathname: string,
  search: string,
  overrides: Record<string, string | number>,
): string {
  const params = new URLSearchParams(search)
  for (const [k, v] of Object.entries(overrides)) {
    params.set(k, String(v))
  }
  return `${pathname}?${params.toString()}`
}

export function ReviewList({
  reviews,
  aggregate,
  productId,
  total,
  page,
  sort,
  filter,
}: ReviewListProps) {
  const { pathname, search } = useLocation()
  const perPage = 10
  const totalPages = Math.ceil(total / perPage)

  return (
    <section className="mt-8">
      <h2
        className="text-xl font-bold text-ink mb-4"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Customer Reviews
      </h2>

      <RatingSummary aggregate={aggregate} productId={productId} />

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-4 scrollbar-hide">
        {FILTER_TABS.map(tab => (
          <Link
            key={tab.value}
            to={buildReviewUrl(pathname, search, { reviewFilter: tab.value, reviewPage: 1 })}
            className={[
              'shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors',
              filter === tab.value
                ? 'bg-sage text-white border-sage'
                : 'border-cream-2 text-ink/60 hover:border-sage/40',
            ].join(' ')}
            style={{ fontFamily: 'var(--font-display)' }}
            prefetch="intent"
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Sort + count */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-ink/50">
          {total} review{total !== 1 ? 's' : ''}
        </span>
        <label className="flex items-center gap-2 text-sm text-ink/60">
          Sort:
          <select
            className="border border-cream-2 rounded-lg px-2 py-1 text-sm text-ink bg-white"
            value={sort}
            onChange={e => {
              window.location.href = buildReviewUrl(pathname, search, { reviewSort: e.target.value, reviewPage: 1 })
            }}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Reviews */}
      {reviews.length === 0 ? (
        <div className="text-center py-12 text-ink/40">
          <p className="text-4xl mb-3" aria-hidden="true">♥</p>
          <p className="font-medium">No reviews yet — be the first!</p>
          <Link
            to={`/review?productId=${productId}`}
            className="inline-block mt-4 bg-coral text-white font-semibold text-sm px-6 py-2.5 rounded-full hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Write a Review ♥
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map(review => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          {page > 1 && (
            <Link
              to={buildReviewUrl(pathname, search, { reviewPage: page - 1 })}
              className="px-4 py-2 text-sm border border-cream-2 rounded-full text-ink/60 hover:border-sage/40 transition-colors"
              prefetch="intent"
            >
              ← Prev
            </Link>
          )}
          <span className="text-sm text-ink/50">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              to={buildReviewUrl(pathname, search, { reviewPage: page + 1 })}
              className="px-4 py-2 text-sm border border-cream-2 rounded-full text-ink/60 hover:border-sage/40 transition-colors"
              prefetch="intent"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
