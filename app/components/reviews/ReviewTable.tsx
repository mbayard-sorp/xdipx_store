import type { Review } from '~/types/reviews'
import { StarRating } from './StarRating'

interface ReviewTableProps {
  reviews: Review[]
  total: number
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  onView: (review: Review) => void
}

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-amber-50  text-amber-700',
  approved: 'bg-green-50  text-green-700',
  rejected: 'bg-red-50    text-red-700',
  spam:     'bg-gray-100  text-gray-500',
}

function relativeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
  })
}

export function ReviewTable({
  reviews,
  total,
  selectedIds,
  onSelect,
  onView,
}: ReviewTableProps) {
  const allSelected = reviews.length > 0 && reviews.every(r => selectedIds.includes(r.id))

  const toggleAll = () => {
    if (allSelected) {
      onSelect(selectedIds.filter(id => !reviews.some(r => r.id === id)))
    } else {
      onSelect([...new Set([...selectedIds, ...reviews.map(r => r.id)])])
    }
  }

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelect(selectedIds.filter(sid => sid !== id))
    } else {
      onSelect([...selectedIds, id])
    }
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-brand-mist bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-brand-mist text-left">
            <th className="px-4 py-3 w-8">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all reviews"
                className="rounded border-brand-mist"
              />
            </th>
            <th className="px-4 py-3 text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider">Reviewer</th>
            <th className="px-4 py-3 text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider">Rating</th>
            <th className="px-4 py-3 text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider">Title / Preview</th>
            <th className="px-4 py-3 text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider">Date</th>
            <th className="px-4 py-3 text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody>
          {reviews.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center text-brand-charcoal/40">
                No reviews found.
              </td>
            </tr>
          )}
          {reviews.map(review => (
            <tr
              key={review.id}
              className="border-b border-brand-mist last:border-0 hover:bg-brand-mist/40 transition-colors"
            >
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(review.id)}
                  onChange={() => toggleOne(review.id)}
                  aria-label={`Select review by ${review.reviewerName}`}
                  className="rounded border-brand-mist"
                />
              </td>
              <td className="px-4 py-3">
                <div>
                  <p className="font-medium text-brand-charcoal text-xs">{review.reviewerName}</p>
                  {review.isVerifiedPurchase && (
                    <span className="text-[10px] text-green-600">✓ Verified</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <StarRating value={review.rating} readonly size="sm" />
              </td>
              <td className="px-4 py-3 max-w-xs">
                {review.title && (
                  <p className="font-semibold text-xs text-brand-charcoal truncate">{review.title}</p>
                )}
                {review.body && (
                  <p className="text-xs text-brand-charcoal/50 truncate">
                    {review.body.slice(0, 80)}
                  </p>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={[
                  'text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize',
                  STATUS_STYLES[review.status] ?? 'bg-brand-mist text-brand-charcoal',
                ].join(' ')}>
                  {review.status}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-brand-charcoal/50 whitespace-nowrap">
                {relativeDate(review.createdAt)}
              </td>
              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => onView(review)}
                  className="text-xs font-medium text-brand-purple hover:text-brand-purple-light transition-colors"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  View →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {total > reviews.length && (
        <div className="px-4 py-2 border-t border-brand-mist text-xs text-brand-charcoal/40 text-right">
          Showing {reviews.length} of {total}
        </div>
      )}
    </div>
  )
}
