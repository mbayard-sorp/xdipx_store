/**
 * /admin/reviews — Reviews KPI dashboard.
 */
import type { LoaderFunctionArgs, MetaFunction, ActionFunctionArgs } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { requireAdmin }       from '~/lib/session.server'
import { getReviewStats, getReviewsPerDay, getAdminReviewQueue, updateReviewStatus } from '~/lib/reviews.server'
import { ReviewKPICard }      from '~/components/reviews/ReviewKPICard'
import { ReviewDrawer }       from '~/components/reviews/ReviewDrawer'
import { useState }           from 'react'
import type { Review }        from '~/types/reviews'

export const meta: MetaFunction = () => [{ title: 'Reviews — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const [stats, perDay, recentData] = await Promise.all([
    getReviewStats(),
    getReviewsPerDay(),
    getAdminReviewQueue({ status: 'pending', perPage: 10, page: 1 }),
  ])
  return { stats, perDay, recent: recentData.reviews }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form     = await request.formData()
  const intent   = form.get('intent') as string
  const reviewId = form.get('reviewId') as string

  if (intent === 'approve') {
    await updateReviewStatus(reviewId, 'approved', { moderatedBy: 'admin' })
  } else if (intent === 'reject') {
    await updateReviewStatus(reviewId, 'rejected', { moderatedBy: 'admin' })
  }

  return Response.json({ ok: true })
}

export default function AdminReviewsDashboard() {
  const { stats, perDay, recent } = useLoaderData<typeof loader>()
  const [activeReview, setActiveReview] = useState<Review | null>(null)
  const fetcher = useFetcher()

  // Chart dimensions
  const chartH   = 60
  const chartW   = 300
  const maxCount = Math.max(...perDay.map(d => d.count), 1)

  const barW   = perDay.length > 0 ? chartW / perDay.length - 1 : 8

  return (
    <div>
      <h1
        className="text-2xl font-bold text-brand-charcoal mb-8"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Reviews
      </h1>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <ReviewKPICard
          title="Pending"
          value={stats.pendingReviews}
          subtitle="Awaiting moderation"
          cta={{ label: 'Review queue', to: '/admin/reviews/queue' }}
        />
        <ReviewKPICard
          title="Approved"
          value={stats.approvedReviews}
          subtitle="Published to store"
        />
        <ReviewKPICard
          title="Avg Rating"
          value={stats.averageRating.toFixed(1)}
          subtitle={`across ${stats.totalReviews} reviews`}
        />
        <ReviewKPICard
          title="Invite Rate"
          value={`${Math.round(stats.inviteConversionRate * 100)}%`}
          subtitle={`${stats.totalInvitesSent} invites sent`}
          cta={{ label: 'Invites', to: '/admin/reviews/invites' }}
        />
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        {/* Reviews / day bar chart */}
        <div className="bg-white rounded-2xl border border-brand-mist p-5">
          <p
            className="text-xs font-semibold text-brand-charcoal/50 uppercase tracking-widest mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Reviews (last 30 days)
          </p>
          {perDay.length > 0 ? (
            <svg
              viewBox={`0 0 ${chartW} ${chartH}`}
              className="w-full"
              aria-label="Reviews per day chart"
            >
              {perDay.map((d, i) => {
                const h = Math.round((d.count / maxCount) * chartH)
                return (
                  <rect
                    key={d.date}
                    x={i * (barW + 1)}
                    y={chartH - h}
                    width={barW}
                    height={h}
                    fill="#7B2FBE"
                    opacity={0.7}
                    rx={1}
                  />
                )
              })}
            </svg>
          ) : (
            <p className="text-brand-charcoal/40 text-sm text-center py-4">No data yet</p>
          )}
        </div>

        {/* Rating donut */}
        <div className="bg-white rounded-2xl border border-brand-mist p-5">
          <p
            className="text-xs font-semibold text-brand-charcoal/50 uppercase tracking-widest mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Status breakdown
          </p>
          <div className="space-y-2">
            {[
              { label: 'Approved', count: stats.approvedReviews, color: '#22c55e' },
              { label: 'Pending',  count: stats.pendingReviews,  color: '#f59e0b' },
              { label: 'Rejected', count: stats.rejectedReviews, color: '#ef4444' },
              { label: 'Spam',     count: stats.spamReviews,     color: '#9ca3af' },
            ].map(({ label, count, color }) => {
              const total = stats.totalReviews || 1
              return (
                <div key={label} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-xs text-brand-charcoal/70 w-16">{label}</span>
                  <div className="flex-1 h-1.5 bg-brand-mist rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round((count / total) * 100)}%`,
                        background: color,
                      }}
                    />
                  </div>
                  <span className="text-xs text-brand-charcoal/50 w-6 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Recent pending reviews */}
      <div className="bg-white rounded-2xl border border-brand-mist p-5">
        <div className="flex items-center justify-between mb-4">
          <p
            className="font-bold text-brand-charcoal"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Pending Reviews
          </p>
          <a
            href="/admin/reviews/queue"
            className="text-xs text-brand-purple hover:text-brand-purple-light transition-colors font-medium"
          >
            View all →
          </a>
        </div>

        <div className="space-y-3">
          {recent.length === 0 && (
            <p className="text-brand-charcoal/40 text-sm text-center py-6">No pending reviews ♥</p>
          )}
          {recent.map(review => (
            <div
              key={review.id}
              className="flex items-center gap-3 py-3 border-b border-brand-mist last:border-0"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-charcoal truncate">{review.reviewerName}</p>
                <p className="text-xs text-brand-charcoal/50 truncate">
                  {review.title ?? review.body?.slice(0, 60) ?? 'No content'}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <fetcher.Form method="post">
                  <input type="hidden" name="intent"   value="approve" />
                  <input type="hidden" name="reviewId" value={review.id} />
                  <button
                    type="submit"
                    className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-3 py-1 rounded-full font-medium transition-colors"
                  >
                    ✓
                  </button>
                </fetcher.Form>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent"   value="reject" />
                  <input type="hidden" name="reviewId" value={review.id} />
                  <button
                    type="submit"
                    className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1 rounded-full font-medium transition-colors"
                  >
                    ✕
                  </button>
                </fetcher.Form>
                <button
                  type="button"
                  onClick={() => setActiveReview(review)}
                  className="text-xs text-brand-purple hover:text-brand-purple-light transition-colors font-medium"
                >
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ReviewDrawer
        review={activeReview}
        onClose={() => setActiveReview(null)}
        onUpdate={() => setActiveReview(null)}
      />
    </div>
  )
}
