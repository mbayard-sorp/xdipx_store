/**
 * Learn mode (ticket #5718). The empty state is the design: at 2 episodes a
 * week there is almost no data for months, and a rollup over three rows is a
 * lie with a table around it. Binding honesty rules, from the plan:
 *   - below 5 posted episodes: NO rollups, only the raw list and the count
 *   - every rollup row prints its n; underpowered rows are dimmed
 *   - no percentage comparison is ever shown for n under 3 (medians only here)
 *   - an unswept row reads "not yet swept", never 0
 *   - sweep freshness is printed (a stale sweep looks exactly like bad
 *     performance, and that misread is expensive)
 */
import { useLoaderData } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import type { LearnDimension } from '~/lib/video-learn.server'
import { getValve, VALVE_KEYS } from '~/lib/team.server'

const DIMENSIONS: { key: LearnDimension; label: string }[] = [
  { key: 'speaker', label: 'By speaker' },
  { key: 'format', label: 'By format' },
  { key: 'product', label: 'By product' },
]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  // Server-only import stays inside the loader: the component references
  // minSignal via loader data, so no server module reaches the client bundle.
  const { listEpisodePerformance, rollupByDimension, listBatchSignals, MIN_EPISODES_FOR_SIGNAL } = await import('~/lib/video-learn.server')
  const [rows, sweepOn, process] = await Promise.all([
    listEpisodePerformance().catch(() => []),
    getValve(VALVE_KEYS.socialMetricsSweep).catch(() => false),
    listBatchSignals().catch(() => ({ batches: [], flags: [] })),
  ])
  const measured = rows.filter(r => !r.unswept)
  const rollups = measured.length >= MIN_EPISODES_FOR_SIGNAL
    ? DIMENSIONS.map(d => ({ ...d, rows: rollupByDimension(rows, d.key) }))
    : []
  return { rows, measuredCount: measured.length, rollups, sweepOn, minSignal: MIN_EPISODES_FOR_SIGNAL, batches: process.batches, flags: process.flags }
}

export default function Learn() {
  const { rows, measuredCount, rollups, sweepOn, minSignal, batches, flags } = useLoaderData<typeof loader>()
  const tripped = flags.filter(f => f.triggered)
  return (
    <div className="space-y-4">
      {tripped.length > 0 && (
        <section className="rounded-2xl border border-coral bg-coral-soft p-3 text-xs text-ink">
          <h2 className="mb-1 font-semibold">Pitch loop flags</h2>
          <ul className="space-y-1">
            {tripped.map(f => (
              <li key={f.key}>{f.detail}: {f.action}.</li>
            ))}
          </ul>
        </section>
      )}

      {batches.length > 0 && (
        <section className="rounded-2xl border border-line bg-paper p-3 md:p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">Pitch batches</h2>
          <ResponsiveTable>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="py-2 pr-3 font-semibold">Batch</th>
                  <th className="py-2 pr-3 font-semibold">Clips</th>
                  <th className="py-2 pr-3 font-semibold">Edit ratio</th>
                  <th className="py-2 pr-3 font-semibold">Approved</th>
                  <th className="py-2 pr-3 font-semibold">Needs changes</th>
                  <th className="py-2 pr-3 font-semibold">Re-rolls/job</th>
                  <th className="py-2 pr-3 font-semibold">Hours to decide</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {batches.map(b => (
                  <tr key={b.batchId}>
                    <td className="py-2 pr-3 font-mono text-xs text-ink">{b.startedAt.slice(0, 10)}</td>
                    <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">{b.decided}/{b.episodes}</td>
                    <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">{b.editRatio ?? '·'}</td>
                    <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">{b.approvedRate ?? '·'}</td>
                    <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">{b.needsChangesRate ?? '·'}</td>
                    <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">{b.rerollRate ?? '·'}</td>
                    <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">{b.medianHoursToDecision ?? '·'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        </section>
      )}

      {!sweepOn && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          The metrics sweep valve (social_metrics_sweep_enabled) is OFF, so numbers here only move
          when a routine captures them by hand. Instagram insights are free; flip it on the Social
          tab of /admin/homepage-team.
        </p>
      )}

      {rows.length === 0 ? (
        <section className="rounded-2xl border border-line bg-paper-2 p-6 text-sm text-ink-3">
          Nothing posted yet. The first numbers arrive about 24 hours after the first episode goes
          live on Instagram.
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-line bg-paper p-3 md:p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">
              Posted episodes <span className="font-mono text-xs text-ink-3">({rows.length} posted, {measuredCount} measured)</span>
            </h2>
            <ResponsiveTable>
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                    <th className="py-2 pr-3 font-semibold">Ep</th>
                    <th className="py-2 pr-3 font-semibold">Hook</th>
                    <th className="py-2 pr-3 font-semibold">Speaker</th>
                    <th className="py-2 pr-3 font-semibold">Reach</th>
                    <th className="py-2 pr-3 font-semibold">Saves</th>
                    <th className="py-2 pr-3 font-semibold">Plays</th>
                    <th className="py-2 pr-3 font-semibold">Avg watched</th>
                    <th className="py-2 pr-3 font-semibold">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map(r => (
                    <tr key={r.episodeId} className="align-top">
                      <td className="py-2 pr-3 font-mono text-xs text-ink">{r.label}</td>
                      <td className="max-w-[280px] truncate py-2 pr-3 text-xs text-ink" title={r.hookText ?? r.logline}>
                        {r.hookText ?? r.logline}
                        <span className="ml-1 font-mono text-ink-4">({r.format})</span>
                      </td>
                      <td className="py-2 pr-3 text-xs text-ink-3">{r.speaker}</td>
                      {r.unswept ? (
                        <td colSpan={4} className="py-2 pr-3 text-xs text-ink-4">not yet swept</td>
                      ) : (
                        <>
                          <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink">
                            {r.primaryReach ?? '·'}
                            {r.primaryReachSource === 'x_impressions' && <span className="ml-1 text-ink-4">X impr.</span>}
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">{r.saves ?? '·'}</td>
                          <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">{r.plays ?? '·'}</td>
                          <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">
                            {r.avgPctViewed != null ? `${r.avgPctViewed}% of ${r.runtimeSeconds ?? '?'}s` : '·'}
                          </td>
                        </>
                      )}
                      <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">
                        {r.costUsd != null ? `$${r.costUsd.toFixed(2)}` : '·'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </section>

          {rollups.length === 0 ? (
            <p className="text-xs text-ink-3">
              {measuredCount} measured episode{measuredCount === 1 ? '' : 's'}. Rollups start at{' '}
              {minSignal}; until then a grouped table would be reading noise as a finding.
            </p>
          ) : (
            rollups.map(group => (
              <section key={group.key} className="rounded-2xl border border-line bg-paper p-3 md:p-4">
                <h2 className="mb-2 text-sm font-semibold text-ink">{group.label}</h2>
                <ResponsiveTable>
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                        <th className="py-2 pr-3 font-semibold">Value</th>
                        <th className="py-2 pr-3 font-semibold">n</th>
                        <th className="py-2 pr-3 font-semibold">Median reach</th>
                        <th className="py-2 pr-3 font-semibold">Median saves</th>
                        <th className="py-2 pr-3 font-semibold">Median watched</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {group.rows.map(r => (
                        <tr key={r.value} className={r.underpowered ? 'opacity-50' : ''}>
                          <td className="py-2 pr-3 text-xs text-ink">{r.value}</td>
                          <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">
                            {r.n}{r.underpowered ? ' · too few to compare' : ''}
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink">{r.medianPrimaryReach ?? '·'}</td>
                          <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">{r.medianSaves ?? '·'}</td>
                          <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">
                            {r.medianAvgPctViewed != null ? `${r.medianAvgPctViewed}%` : '·'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ResponsiveTable>
              </section>
            ))
          )}
        </>
      )}
    </div>
  )
}
