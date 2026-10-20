/**
 * /admin/ads/breakdowns (ticket #16686, plan §9.2 "Weekly, Sunday"). Read
 * only, loader only.
 *
 * The newest breakdown snapshot per dimension (placement, age, gender),
 * summed across ad sets: spend, leads, CPL and share of spend per slice. A
 * slice that clears the §9.2 action floor (at least 25% of spend, at least 10
 * leads on it and on the rest, and a CPL at least 2x the rest's) is marked.
 * Every other slice is greyed out as below floor, diagnostic only: at this
 * volume a difference there is noise, not a verdict.
 *
 * Snapshots come from Sunday's 09:00 UTC ads-insights restatement run, or
 * from the ads routine through POST /api/team/ad-health-snapshot.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { isRouteErrorResponse, useLoaderData, useRevalidator, useRouteError } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { loadBreakdownsPage, type BreakdownPanel } from '~/lib/ads/health-snapshots-console.server'
import { BREAKDOWN_LABELS, SLICE_CPL_MULTIPLE, SLICE_MIN_LEADS, SLICE_MIN_SHARE, type BreakdownDimension } from '~/lib/ads/health-snapshots-core'
import { formatMoney } from '~/lib/ad-metrics-core'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { EmptySlab, ErrorSlab } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Breakdowns - Ads - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return loadBreakdownsPage(new Date())
}

function label(dimension: string): string {
  return BREAKDOWN_LABELS[dimension as BreakdownDimension] ?? dimension
}

function PanelTable({ p }: { p: BreakdownPanel }) {
  const anyFloor = p.slices.some(s => s.meetsFloor)
  return (
    <section aria-label={label(p.dimension)} className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="kicker">{label(p.dimension)}</p>
        <span className={`font-mono text-[11px] ${p.age.stale ? 'text-amber-800' : 'text-ink-3'}`}>
          {p.since && p.until ? `${p.since} to ${p.until}, ` : ''}{p.age.age}, {p.source}{p.age.stale ? ', stale' : ''}
        </span>
      </div>
      <div className="space-y-2 rounded-2xl border border-line bg-paper p-4">
        {p.slices.length === 0 ? (
          <p className="text-sm text-ink-3">The snapshot has no rows: nothing delivered in that week.</p>
        ) : (
          <>
            <p className="text-sm text-ink">
              {formatMoney(p.totalSpendCents)} and {p.totalLeads} lead{p.totalLeads === 1 ? '' : 's'} across {p.adsets} ad set{p.adsets === 1 ? '' : 's'}.{' '}
              {anyFloor ? 'Marked slices clear the action floor.' : 'No slice clears the action floor, so nothing here is a verdict.'}
            </p>
            <ResponsiveTable>
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-ink-3">
                    <th className="py-1 pr-3 font-normal">Slice</th>
                    <th className="py-1 pr-3 font-normal">Spend</th>
                    <th className="py-1 pr-3 font-normal">Share</th>
                    <th className="py-1 pr-3 font-normal">Leads</th>
                    <th className="py-1 pr-3 font-normal">CPL</th>
                    <th className="py-1 pr-3 font-normal">Rest CPL</th>
                    <th className="py-1 font-normal">Floor</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {p.slices.map(s => (
                    <tr key={s.slice} className={`border-t border-line ${s.meetsFloor ? 'bg-coral-soft text-ink' : 'text-ink-4'}`}>
                      <td className="py-1.5 pr-3 font-mono text-xs break-words">{s.slice}</td>
                      <td className="py-1.5 pr-3">{formatMoney(s.spendCents)}</td>
                      <td className="py-1.5 pr-3">{Math.round(s.share * 100)}%</td>
                      <td className="py-1.5 pr-3">{s.leads}</td>
                      <td className="py-1.5 pr-3">{s.cplCents == null ? 'n/a' : formatMoney(s.cplCents)}</td>
                      <td className="py-1.5 pr-3">{s.restCplCents == null ? 'n/a' : formatMoney(s.restCplCents)}</td>
                      <td className="py-1.5 text-xs">
                        {s.meetsFloor
                          ? <span className="font-semibold text-red-800">Act: {s.floorNote}</span>
                          : <span>Below floor, diagnostic only ({s.floorNote})</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </>
        )}
      </div>
    </section>
  )
}

export default function AdsBreakdowns() {
  const page = useLoaderData<typeof loader>()
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-xl md:text-2xl text-ink">Breakdowns</h1>
        <p className="font-mono text-[11px] text-ink-3">Meta, ad-set level, last 7 complete days.</p>
      </header>

      <p className="text-sm text-ink-3">
        The action floor (plan §9.2): a slice carries at least {Math.round(SLICE_MIN_SHARE * 100)}% of spend, has at least {SLICE_MIN_LEADS} leads on it and on the rest, and its CPL is at least {SLICE_CPL_MULTIPLE}x the rest's. Below that, a slice is diagnostic only.
      </p>

      {page.failed.length > 0 && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The breakdown read failed. Migration 136 may not be applied yet.
        </p>
      )}

      {page.panels.length === 0 ? (
        <EmptySlab
          kicker="No breakdowns yet"
          heading="Nothing pulled so far"
          body={page.tokenConfigured
            ? 'Sunday\'s 09:00 UTC insights run pulls placement, age and gender for the week before. The first one lands then.'
            : 'The weekly pull needs META_ADS_ACCESS_TOKEN and META_AD_ACCOUNT_ID in production. Until they are set, only a breakdown the ads routine records shows here.'}
        />
      ) : (
        page.panels.map(p => <PanelTable key={p.dimension} p={p} />)
      )}
    </div>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  const revalidator = useRevalidator()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl md:text-2xl text-ink">Breakdowns</h1>
      <ErrorSlab
        title="Couldn't load the breakdowns."
        message={message}
        onRetry={() => revalidator.revalidate()}
        retrying={revalidator.state === 'loading'}
      />
    </div>
  )
}
