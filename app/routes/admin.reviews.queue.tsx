/**
 * /admin/reviews/queue — Full moderation queue.
 */
import { useState }  from 'react'
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher, Form, useSearchParams } from 'react-router'
import { requireAdmin }     from '~/lib/session.server'
import {
  getAdminReviewQueue,
  updateReviewStatus,
  updateReviewReply,
  updateReviewFeatured,
  deleteReview,
  getReviewById,
} from '~/lib/reviews.server'
import { generateReviewResponseSuggestion } from '~/lib/reviews-ai.server'
import { ReviewTable }  from '~/components/reviews/ReviewTable'
import { ReviewDrawer } from '~/components/reviews/ReviewDrawer'
import type { Review }  from '~/types/reviews'

export const meta: MetaFunction = () => [{ title: 'Review Queue — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url    = new URL(request.url)
  const status = url.searchParams.get('status') ?? 'pending'
  const search = url.searchParams.get('search') ?? undefined
  const sort   = url.searchParams.get('sort')   ?? 'newest'
  const page   = parseInt(url.searchParams.get('page') ?? '1', 10)

  const { reviews, total } = await getAdminReviewQueue({ status, search, sort, page, perPage: 20 })
  return { reviews, total, status, search: search ?? '', sort, page }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form    = await request.formData()
  const intent  = form.get('intent') as string
  const reviewId = form.get('reviewId') as string | null

  // Bulk
  if (intent.startsWith('bulk-')) {
    const ids = JSON.parse(form.get('ids') as string ?? '[]') as string[]
    const op  = intent.replace('bulk-', '') as 'approve' | 'reject' | 'spam' | 'delete'

    await Promise.allSettled(ids.map(id =>
      op === 'delete'
        ? deleteReview(id)
        : updateReviewStatus(id, op as Review['status'], { moderatedBy: 'admin-bulk' }),
    ))

    return Response.json({ ok: true })
  }

  if (!reviewId) return Response.json({ error: 'Missing reviewId' }, { status: 400 })

  switch (intent) {
    case 'approve':
      await updateReviewStatus(reviewId, 'approved', { moderatedBy: 'admin' })
      break
    case 'reject':
      await updateReviewStatus(reviewId, 'rejected', {
        moderatedBy: 'admin',
        moderationNote: form.get('moderationNote') as string | undefined,
      })
      break
    case 'spam':
      await updateReviewStatus(reviewId, 'spam', { moderatedBy: 'admin' })
      break
    case 'feature':
      await updateReviewFeatured(reviewId, form.get('isFeatured') === 'true')
      break
    case 'reply':
      await updateReviewReply(reviewId, form.get('replyBody') as string)
      break
    case 'suggest-reply': {
      const review = await getReviewById(reviewId)
      if (review) {
        const suggestion = await generateReviewResponseSuggestion(review)
        return Response.json({ ok: true, suggestion })
      }
      break
    }
    case 'delete':
      await deleteReview(reviewId)
      break
  }

  return Response.json({ ok: true })
}

const STATUS_TABS = [
  { value: 'all',      label: 'All'      },
  { value: 'pending',  label: 'Pending'  },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'spam',     label: 'Spam'     },
]

export default function AdminReviewQueue() {
  const { reviews, total, status, search, sort, page } = useLoaderData<typeof loader>()
  const [searchParams] = useSearchParams()
  const [selectedIds, setSelectedIds]   = useState<string[]>([])
  const [activeReview, setActiveReview] = useState<Review | null>(null)
  const bulkFetcher = useFetcher()

  const perPage    = 20
  const totalPages = Math.ceil(total / perPage)

  const buildUrl = (overrides: Record<string, string | number>) => {
    const p = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(overrides)) p.set(k, String(v))
    return `/admin/reviews/queue?${p.toString()}`
  }

  const handleBulk = (op: string) => {
    bulkFetcher.submit(
      { intent: `bulk-${op}`, ids: JSON.stringify(selectedIds) },
      { method: 'post' },
    )
    setSelectedIds([])
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Review Queue
        </h1>
        <a
          href="/admin/reviews/export"
          className="text-xs text-sage hover:text-sun transition-colors font-medium"
        >
          Export →
        </a>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto">
        {STATUS_TABS.map(tab => (
          <a
            key={tab.value}
            href={buildUrl({ status: tab.value, page: 1 })}
            className={[
              'shrink-0 text-xs font-medium px-4 py-1.5 rounded-full transition-colors',
              status === tab.value
                ? 'bg-ink text-white'
                : 'bg-cream-2 text-ink/60 hover:bg-cream-2/80',
            ].join(' ')}
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {/* Search + sort */}
      <Form method="get" action="/admin/reviews/queue" className="flex gap-2 mb-4">
        <input type="hidden" name="status" value={status} />
        <input
          name="search"
          type="search"
          defaultValue={search}
          placeholder="Search reviewer, title, body..."
          className="flex-1 border border-cream-2 rounded-xl px-4 py-2 text-sm text-ink focus:outline-none focus:border-sage transition-colors"
        />
        <select
          name="sort"
          defaultValue={sort}
          className="border border-cream-2 rounded-xl px-3 py-2 text-sm text-ink"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="highest">Highest rated</option>
          <option value="lowest">Lowest rated</option>
          <option value="spam_risk">Spam risk</option>
        </select>
        <button
          type="submit"
          className="bg-cream-2 text-ink px-4 py-2 rounded-xl text-sm hover:bg-cream-2/70 transition-colors"
        >
          Search
        </button>
      </Form>

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 mb-4 bg-ink text-white px-4 py-3 rounded-xl">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <div className="flex gap-2 ml-auto">
            {['approve', 'reject', 'spam', 'delete'].map(op => (
              <button
                key={op}
                type="button"
                onClick={() => handleBulk(op)}
                className="text-xs font-medium px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 transition-colors capitalize"
              >
                {op}
              </button>
            ))}
          </div>
        </div>
      )}

      <ReviewTable
        reviews={reviews}
        total={total}
        selectedIds={selectedIds}
        onSelect={setSelectedIds}
        onView={review => setActiveReview(review)}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          {page > 1 && (
            <a
              href={buildUrl({ page: page - 1 })}
              className="text-sm text-ink/60 hover:text-ink px-4 py-2 border border-cream-2 rounded-full"
            >
              ← Prev
            </a>
          )}
          <span className="text-sm text-ink/50">{page} / {totalPages}</span>
          {page < totalPages && (
            <a
              href={buildUrl({ page: page + 1 })}
              className="text-sm text-ink/60 hover:text-ink px-4 py-2 border border-cream-2 rounded-full"
            >
              Next →
            </a>
          )}
        </div>
      )}

      <ReviewDrawer
        review={activeReview}
        onClose={() => setActiveReview(null)}
        onUpdate={() => setActiveReview(null)}
      />
    </div>
  )
}
