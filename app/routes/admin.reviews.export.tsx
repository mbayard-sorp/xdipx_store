/**
 * /admin/reviews/export — Export reviews as CSV or JSON.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Form } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getReviewStats, getReviewsForExport } from '~/lib/reviews.server'
import type { Review } from '~/types/reviews'

export const meta: MetaFunction = () => [{ title: 'Export Reviews — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const stats = await getReviewStats()
  return { stats }
}

function reviewToCSVRow(r: Review): string {
  const escape = (s: string | null | undefined) =>
    `"${(s ?? '').replace(/"/g, '""')}"`
  return [
    escape(r.id),
    escape(r.shopifyProductId),
    escape(r.reviewerName),
    r.rating,
    escape(r.status),
    r.isVerifiedPurchase,
    escape(r.title),
    escape(r.body),
    escape(r.createdAt),
  ].join(',')
}

const CSV_HEADER = 'id,shopify_product_id,reviewer_name,rating,status,is_verified_purchase,title,body,created_at'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form   = await request.formData()
  const format = (form.get('format') as string | null) ?? 'csv'
  const status = (form.get('status') as string | null) ?? undefined

  const reviews = await getReviewsForExport({ status })

  if (format === 'json') {
    return new Response(JSON.stringify(reviews, null, 2), {
      headers: {
        'Content-Type':        'application/json',
        'Content-Disposition': `attachment; filename="reviews-export-${new Date().toISOString().split('T')[0]}.json"`,
      },
    })
  }

  // CSV
  const lines = [CSV_HEADER, ...reviews.map(reviewToCSVRow)]
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reviews-export-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  })
}

export default function AdminReviewExport() {
  const { stats } = useLoaderData<typeof loader>()

  return (
    <div className="max-w-lg">
      <h1
        className="text-2xl font-bold text-ink mb-8"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Export Reviews
      </h1>

      <div className="bg-white rounded-2xl border border-cream-2 p-6 space-y-6">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-cream-2 rounded-xl p-3">
            <p className="text-xs text-ink/50">Total reviews</p>
            <p className="text-2xl font-black text-ink" style={{ fontFamily: 'var(--font-display)' }}>
              {stats.totalReviews}
            </p>
          </div>
          <div className="bg-cream-2 rounded-xl p-3">
            <p className="text-xs text-ink/50">Approved</p>
            <p className="text-2xl font-black text-ink" style={{ fontFamily: 'var(--font-display)' }}>
              {stats.approvedReviews}
            </p>
          </div>
        </div>

        <Form method="post" className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
              Filter by status
            </label>
            <select
              name="status"
              className="border border-cream-2 rounded-xl px-3 py-2 text-sm text-ink w-full focus:outline-none focus:border-sage"
            >
              <option value="all">All reviews</option>
              <option value="approved">Approved only</option>
              <option value="pending">Pending only</option>
              <option value="rejected">Rejected only</option>
              <option value="spam">Spam only</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              Format
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input type="radio" name="format" value="csv" defaultChecked className="accent-sage" />
                CSV
              </label>
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input type="radio" name="format" value="json" className="accent-sage" />
                JSON
              </label>
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-coral text-white font-semibold py-3 rounded-full hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Download Export ♥
          </button>
        </Form>
      </div>
    </div>
  )
}
