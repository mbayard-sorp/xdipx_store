import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getCatalogOpportunities } from '~/lib/import-monitor.server'

export const meta: MetaFunction = () => [{ title: 'Catalog Opportunities — xdipx Admin' }]

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const opportunities = await getCatalogOpportunities()
  return { opportunities }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminImportsOpportunitiesPage() {
  const { opportunities } = useLoaderData<typeof loader>()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Catalog Opportunities
        </h1>
        <div className="flex gap-3">
          <Link
            to="/admin/imports"
            className="text-xs font-semibold px-4 py-2 bg-cream border border-line text-ink rounded-full hover:border-coral/50 transition-colors"
          >
            Candidates
          </Link>
          <Link
            to="/admin/imports/opportunities"
            className="text-xs font-semibold px-4 py-2 bg-coral text-white rounded-full"
          >
            Opportunities
          </Link>
        </div>
      </div>

      {/* Brand opportunities */}
      <section className="bg-white rounded-2xl border border-line overflow-hidden">
        <div className="px-5 py-4 border-b border-line">
          <h2
            className="text-base font-semibold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Brand Opportunities
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Brands in the Nalpac feed not yet carried, sorted by average deal score
          </p>
        </div>
        {opportunities.brandOpportunities.length === 0 ? (
          <p className="text-sm text-muted px-5 py-8 text-center">No brand opportunities found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Brand</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Tier</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Products</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Avg score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {opportunities.brandOpportunities.map(b => (
                  <tr key={b.brand} className="hover:bg-cream/50">
                    <td className="px-4 py-3 text-xs font-medium text-ink">{b.brand}</td>
                    <td className="px-4 py-3 text-xs text-muted">{b.tier ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-ink">{b.count}</td>
                    <td className="px-4 py-3 text-xs text-ink">
                      {b.avgScore != null ? parseFloat(String(b.avgScore)).toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Brand coverage */}
      <section className="bg-white rounded-2xl border border-line overflow-hidden">
        <div className="px-5 py-4 border-b border-line">
          <h2
            className="text-base font-semibold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Brand Coverage
          </h2>
          <p className="text-xs text-muted mt-0.5">All brands in feed — which are already carried</p>
        </div>
        {opportunities.brandCoverage.length === 0 ? (
          <p className="text-sm text-muted px-5 py-8 text-center">No data.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Brand</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Carried</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {opportunities.brandCoverage.map(b => (
                  <tr key={b.brand} className="hover:bg-cream/50">
                    <td className="px-4 py-3 text-xs text-ink font-medium">{b.brand}</td>
                    <td className="px-4 py-3 text-xs">
                      {b.carried ? (
                        <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                            <circle cx="7" cy="7" r="6" fill="#dcfce7" stroke="#16a34a" strokeWidth="1.2" />
                            <path d="M4.5 7l2 2 3-3" stroke="#16a34a" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Yes
                        </span>
                      ) : (
                        <span className="text-muted">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Category coverage */}
      <section className="bg-white rounded-2xl border border-line overflow-hidden">
        <div className="px-5 py-4 border-b border-line">
          <h2
            className="text-base font-semibold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Category Coverage
          </h2>
          <p className="text-xs text-muted mt-0.5">Categories in feed vs. products carried</p>
        </div>
        {opportunities.categoryCoverage.length === 0 ? (
          <p className="text-sm text-muted px-5 py-8 text-center">No data.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Category</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Carried</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {opportunities.categoryCoverage.map(c => (
                  <tr key={c.category} className="hover:bg-cream/50">
                    <td className="px-4 py-3 text-xs text-ink font-medium">{c.category}</td>
                    <td className="px-4 py-3 text-xs">
                      {c.carried ? (
                        <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                            <circle cx="7" cy="7" r="6" fill="#dcfce7" stroke="#16a34a" strokeWidth="1.2" />
                            <path d="M4.5 7l2 2 3-3" stroke="#16a34a" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Yes
                        </span>
                      ) : (
                        <span className="text-muted">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
