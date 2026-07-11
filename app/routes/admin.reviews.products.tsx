/**
 * /admin/reviews/products — Products with review aggregates.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getProductsWithReviews } from '~/lib/reviews.server'
import { StarRating } from '~/components/reviews/StarRating'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'

export const meta: MetaFunction = () => [{ title: 'Reviews by Product — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const products = await getProductsWithReviews()
  return { products }
}

export default function AdminReviewsByProduct() {
  const { products } = useLoaderData<typeof loader>()

  return (
    <div>
      <h1
        className="text-2xl font-bold text-ink mb-8"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Reviews by Product
      </h1>

      <div className="bg-white rounded-2xl border border-cream-2 overflow-hidden">
        <ResponsiveTable>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-cream-2 text-left">
              <th className="px-5 py-3 text-xs font-semibold text-ink/50 uppercase tracking-wider">Product ID</th>
              <th className="px-5 py-3 text-xs font-semibold text-ink/50 uppercase tracking-wider">Rating</th>
              <th className="px-5 py-3 text-xs font-semibold text-ink/50 uppercase tracking-wider">Approved</th>
              <th className="px-5 py-3 text-xs font-semibold text-ink/50 uppercase tracking-wider">Total</th>
              <th className="px-5 py-3 text-xs font-semibold text-ink/50 uppercase tracking-wider">Verified</th>
              <th className="px-5 py-3 text-xs font-semibold text-ink/50 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-ink/40">
                  No products with reviews yet.
                </td>
              </tr>
            )}
            {products.map(product => (
              <tr key={product.shopifyProductId} className="border-b border-cream-2 last:border-0 hover:bg-cream-2/40 transition-colors">
                <td className="px-5 py-3">
                  <p className="font-mono text-xs text-ink">{product.shopifyProductId}</p>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <StarRating value={Math.round(product.averageRating)} readonly size="sm" />
                    <span className="text-xs text-ink/60">{product.averageRating.toFixed(1)}</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-sm font-semibold text-ink">{product.approvedCount}</td>
                <td className="px-5 py-3 text-sm text-ink/60">{product.totalCount}</td>
                <td className="px-5 py-3 text-sm text-ink/60">{product.verifiedCount}</td>
                <td className="px-5 py-3">
                  <a
                    href={`/admin/reviews/queue?productId=${product.shopifyProductId}`}
                    className="text-xs font-medium text-sage hover:text-sun transition-colors"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    Manage →
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </ResponsiveTable>
      </div>
    </div>
  )
}
