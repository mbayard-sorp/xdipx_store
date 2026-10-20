/**
 * /admin/ads/signals (ticket #16686, plan §9.2, §9.8 and §12). Read only,
 * loader only.
 *
 * What Meta says about the account that the mirror and the insights pull do
 * not: the ad account's status, changes made outside the control plane, ad
 * errors and disapprovals, the opportunity score with its recommendations,
 * and anomaly signals. Each panel is the newest ad_health_snapshots row of
 * its kind with its age. Account and activity come from the hourly
 * ads-insights run; the rest come from the daily ads routine through
 * POST /api/team/ad-health-snapshot. No platform call happens while the page
 * loads.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { isRouteErrorResponse, useLoaderData, useRevalidator, useRouteError } from 'react-router'
import type { ReactNode } from 'react'
import { requireAdmin } from '~/lib/session.server'
import { loadSignalsPage, type Reading } from '~/lib/ads/health-snapshots-console.server'
import type { SnapshotAge } from '~/lib/ads/health-snapshots-core'
import { formatMoney } from '~/lib/ad-metrics-core'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { ErrorSlab } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Signals - Ads - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return loadSignalsPage(new Date())
}

function Age({ age, source }: { age: SnapshotAge; source: string }) {
  return (
    <span className={`font-mono text-[11px] ${age.stale ? 'text-amber-800' : 'text-ink-3'}`}>
      {age.age}, {source}{age.stale ? ', stale' : ''}
    </span>
  )
}

function Panel({ title, reading, empty, children }: {
  title: string
  reading: Reading<unknown> | null
  empty: string
  children?: ReactNode
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="kicker">{title}</p>
        {reading && <Age age={reading.age} source={reading.source} />}
      </div>
      <div className="rounded-2xl border border-line bg-paper p-4">
        {reading ? children : <p className="text-sm text-ink-3">{empty}</p>}
      </div>
    </section>
  )
}

function when(iso: string | null): string {
  if (!iso) return 'n/a'
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : iso
}

const ROUTINE_EMPTY = 'No snapshot yet. The daily ads routine records this through /api/team/ad-health-snapshot.'

export default function AdsSignals() {
  const page = useLoaderData<typeof loader>()
  const { account, activity, errors, opportunity, anomaly } = page
  const cronEmpty = page.tokenConfigured
    ? 'No reading yet. The hourly ads-insights run records this on its next pass.'
    : 'No reading yet. It needs META_ADS_ACCESS_TOKEN and META_AD_ACCOUNT_ID in production; the hourly ads-insights run reads it once they are set.'

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-xl md:text-2xl text-ink">Signals</h1>
        <p className="font-mono text-[11px] text-ink-3">Meta, from stored snapshots.</p>
      </header>

      {page.failed.length > 0 && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Some reads failed ({page.failed.join(', ')}). Migration 136 may not be applied yet. Panels that depend on them show as empty.
        </p>
      )}

      <Panel title="Account status" reading={account} empty={cronEmpty}>
        {account && (
          <div className="space-y-2">
            <p className={`text-sm font-medium ${account.data.problem ? 'text-red-800' : 'text-ink'}`}>
              {account.data.problem ? account.data.problem.title : `${account.data.statusName}${account.data.name ? `: ${account.data.name}` : ''}`}
            </p>
            {account.data.problem && <p className="text-sm text-red-800">{account.data.problem.sentence} The owner has been paged.</p>}
            <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <div><dt className="font-mono text-[11px] uppercase text-ink-3">account_status</dt><dd>{account.data.accountStatus ?? 'n/a'}</dd></div>
              <div><dt className="font-mono text-[11px] uppercase text-ink-3">disable_reason</dt><dd>{account.data.disableReasonName ?? 'n/a'}</dd></div>
              <div>
                <dt className="font-mono text-[11px] uppercase text-ink-3">Spent lifetime</dt>
                <dd>{account.data.amountSpentCents == null ? 'n/a' : formatMoney(account.data.amountSpentCents)}</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase text-ink-3">Spend cap</dt>
                <dd>{account.data.spendCapCents ? formatMoney(account.data.spendCapCents) : 'none'}</dd>
              </div>
            </dl>
          </div>
        )}
      </Panel>

      <Panel title="Out-of-band changes" reading={activity} empty={cronEmpty}>
        {activity && (
          <div className="space-y-2">
            <p className="text-sm text-ink">
              {activity.data.outOfBandCount === 0
                ? `No changes from outside the control plane in the last ${activity.data.windowHours ?? 24} hours.`
                : `${activity.data.outOfBandCount} change${activity.data.outOfBandCount === 1 ? '' : 's'} in the last ${activity.data.windowHours ?? 24} hours did not come from our system user or the ledger.`}
              {activity.data.systemUserName ? ` Our system user is ${activity.data.systemUserName}.` : ''}
            </p>
            {activity.data.items.length > 0 && (
              <ResponsiveTable>
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-ink-3">
                      <th className="py-1 pr-3 font-normal">When</th>
                      <th className="py-1 pr-3 font-normal">Actor</th>
                      <th className="py-1 pr-3 font-normal">Object</th>
                      <th className="py-1 pr-3 font-normal">What changed</th>
                      <th className="py-1 font-normal">Ours?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.data.items.map((it, i) => (
                      <tr key={`${it.eventTime}-${it.objectId}-${i}`} className={`border-t border-line align-top ${it.outOfBand ? 'bg-amber-50' : ''}`}>
                        <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">{when(it.eventTime)}</td>
                        <td className="py-1.5 pr-3 break-words">
                          {it.actorName ?? it.actorId ?? 'unknown'}
                          {it.applicationName && <span className="block text-xs text-ink-3">via {it.applicationName}</span>}
                        </td>
                        <td className="py-1.5 pr-3 break-words">
                          {it.objectName ?? it.objectId ?? 'n/a'}
                          {it.objectType && <span className="block font-mono text-[11px] uppercase text-ink-3">{it.objectType}</span>}
                        </td>
                        <td className="py-1.5 pr-3 break-words">
                          {it.translatedEventType ?? it.eventType ?? 'n/a'}
                          {it.extraData && <span className="block max-w-xs truncate text-xs text-ink-3" title={it.extraData}>{it.extraData}</span>}
                        </td>
                        <td className={`py-1.5 text-xs ${it.outOfBand ? 'text-amber-800' : 'text-ink-3'}`}>{it.outOfBand ? 'No' : 'Yes'}<span className="block">{it.why}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ResponsiveTable>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Errors and disapprovals" reading={errors} empty={ROUTINE_EMPTY}>
        {errors && (errors.data.length === 0 ? (
          <p className="text-sm text-ink">Meta reported no errors.</p>
        ) : (
          <ul className="divide-y divide-line">
            {errors.data.map((e, i) => (
              <li key={`${e.id}-${i}`} className="py-2 text-sm">
                <p className="break-words text-ink">{e.message}</p>
                <p className="font-mono text-[11px] uppercase text-ink-3">
                  {[e.severity, e.level, e.name ?? e.id].filter(Boolean).join(' · ') || 'no detail'}
                </p>
              </li>
            ))}
          </ul>
        ))}
      </Panel>

      <Panel title="Opportunity score" reading={opportunity} empty={ROUTINE_EMPTY}>
        {opportunity && (
          <div className="space-y-2">
            <p className="font-mono text-lg font-semibold tabular-nums text-ink">
              {opportunity.data.score == null ? 'n/a' : `${Math.round(opportunity.data.score)} / 100`}
            </p>
            {opportunity.data.recommendations.length === 0 ? (
              <p className="text-sm text-ink-3">No recommendations listed.</p>
            ) : (
              <ul className="divide-y divide-line">
                {opportunity.data.recommendations.map((r, i) => (
                  <li key={`${r.title}-${i}`} className="py-2 text-sm">
                    <p className="font-medium text-ink">{r.title}{r.impact ? <span className="ml-2 font-mono text-xs text-ink-3">{r.impact}</span> : null}</p>
                    {r.detail && <p className="break-words text-ink-3">{r.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-4">Meta's recommendations are inputs, not orders. Anything that changes spend still goes through the ledger.</p>
          </div>
        )}
      </Panel>

      <Panel title="Anomaly signals" reading={anomaly} empty={ROUTINE_EMPTY}>
        {anomaly && (anomaly.data.length === 0 ? (
          <p className="text-sm text-ink">No anomalies flagged.</p>
        ) : (
          <ul className="divide-y divide-line">
            {anomaly.data.map((a, i) => (
              <li key={`${a.metric}-${i}`} className="py-2 text-sm">
                <p className="break-words text-ink">{a.message}</p>
                <p className="font-mono text-[11px] uppercase text-ink-3">
                  {[a.severity, a.metric, a.direction, a.object].filter(Boolean).join(' · ') || 'no detail'}
                </p>
              </li>
            ))}
          </ul>
        ))}
      </Panel>
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
      <h1 className="font-display text-xl md:text-2xl text-ink">Signals</h1>
      <ErrorSlab
        title="Couldn't load the signals."
        message={message}
        onRetry={() => revalidator.revalidate()}
        retrying={revalidator.state === 'loading'}
      />
    </div>
  )
}
