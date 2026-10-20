/**
 * admin.ads.audiences.tsx: the audiences mirror and the M8 exclusions check
 * (ticket #16435, plan §4 and §7 phase 6b). Read only, loader only.
 *
 * The exclusions check lists every Meta ad set still on the platform, paused
 * included, with a pass mark when its targeting excludes at least two custom
 * audiences. docs/ads-policy.md M8 names the pair: the Shopify customer list
 * and the Klaviyo subscriber lists. Names are matched when they say so.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { loadAudiencesPage } from '~/lib/ads/audiences.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'

export const meta: MetaFunction = () => [{ title: 'Audiences - Ads - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return loadAudiencesPage()
}

const fmt = new Intl.NumberFormat('en-US')

function sizeRange(lower: number | null, upper: number | null): string {
  if (lower === null && upper === null) return 'n/a'
  if (lower !== null && upper !== null && upper !== lower) return `${fmt.format(lower)} to ${fmt.format(upper)}`
  return fmt.format((lower ?? upper) as number)
}

function when(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

export default function AdsAudiences() {
  const { audiences, exclusions, lastSyncedAt } = useLoaderData<typeof loader>()
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-xl md:text-2xl text-ink">Audiences</h1>
        <p className="text-xs text-ink-4">{lastSyncedAt ? `Last synced ${when(lastSyncedAt)}` : 'Not synced yet'}</p>
      </div>

      <section aria-label="Exclusions check" className="space-y-2">
        <p className="kicker">Exclusions check</p>
        {exclusions.length === 0 ? (
          <p className="text-sm text-ink-3">
            Under M8, every Meta ad set must exclude the Shopify customer list and the Klaviyo subscriber lists before it is launch-ready, and the mirror holds no Meta ad sets yet.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {exclusions.map(x => (
              <li key={x.externalId} className="flex gap-3 px-3 py-3 text-sm">
                <span
                  aria-label={x.ok ? 'Pass' : 'Fail'}
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-paper ${x.ok ? 'bg-sage' : 'bg-coral'}`}
                >
                  {x.ok ? '✓' : '✕'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-ink break-words">
                    {x.name ?? x.externalId}
                    <span className="ml-2 font-mono text-[11px] uppercase text-ink-4">{x.effectiveStatus ?? 'unknown'}</span>
                  </p>
                  {x.excluded.length === 0 ? (
                    <p className="text-xs text-ink-3">Excludes no custom audiences.</p>
                  ) : (
                    <p className="text-xs text-ink-3 break-words">
                      Excludes {x.excluded.map(a => (a.name ? `${a.name} (${a.id})` : a.id)).join(', ')}
                    </p>
                  )}
                  {x.excluded.length > 0 && (!x.customer || !x.subscriber) && (
                    <p className="text-xs text-ink-4">
                      {!x.customer && !x.subscriber
                        ? 'Neither M8 audience is recognizable by name.'
                        : !x.customer
                          ? 'No customer list recognizable by name.'
                          : 'No subscriber list recognizable by name.'}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Audiences" className="space-y-2">
        <p className="kicker">Mirror</p>
        {audiences.length === 0 ? (
          <p className="text-sm text-ink-3">No audiences synced yet. The entity sync pulls them every 6 hours.</p>
        ) : (
          <ResponsiveTable className="rounded-xl border border-line">
            <table className="w-full min-w-[720px] text-sm text-left">
              <thead className="bg-paper-2 text-[11px] uppercase tracking-wide text-ink-4">
                <tr>
                  {['Name', 'Kind', 'Role', 'Size', 'Status', 'Synced'].map(h => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {audiences.map(a => (
                  <tr key={`${a.platform}:${a.externalId}`}>
                    <td className="px-3 py-2 text-ink">
                      {a.name ?? a.externalId}
                      <span className="block font-mono text-[11px] text-ink-4">{a.platform} {a.externalId}</span>
                    </td>
                    <td className="px-3 py-2 text-ink-3">{a.kind}</td>
                    <td className={`px-3 py-2 ${a.role === 'exclusion' ? 'text-plum' : 'text-ink-3'}`}>{a.role}</td>
                    <td className="px-3 py-2 tabular-nums text-ink-3">{sizeRange(a.sizeLower, a.sizeUpper)}</td>
                    <td className="px-3 py-2 text-ink-3">{a.status ?? 'n/a'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-4">{when(a.syncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        )}
      </section>
    </div>
  )
}
