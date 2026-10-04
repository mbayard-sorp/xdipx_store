/**
 * Planned versus actual spend per campaign and lane (wires 9.4, 9.5). A phone
 * track list under md (outline track is the plan, ink fill is the actual) and a
 * table inside ResponsiveTable from md up. 7d and 30d switch locally; both
 * windows come from the loader, so nothing is fetched in the browser.
 */
import { useState } from 'react'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { formatMoney, formatRoas } from '~/lib/ad-metrics-core'
import type { PlanRow } from '~/lib/ad-spend-core'
import { laneLabel } from './LaneBadge'
import { EmptySlab } from './StateSlabs'

function signed(cents: number): string {
  const sign = cents < 0 ? '-' : '+'
  return `${sign}${formatMoney(Math.abs(cents))}`
}

function rowLabel(r: PlanRow): string {
  if (r.plannedSource === 'none') return `${laneLabel(r.lane)} account`
  return `${laneLabel(r.lane)}${r.tier ? ` ${r.tier}` : ''}`
}

function sourceNote(r: PlanRow): string {
  return r.plannedSource === 'campaign' ? 'campaign plan' : r.plannedSource === 'lane-share' ? 'share of daily cap' : 'no plan'
}

export function PlanVsActual({ plan7, plan30, onEmptyAction }: { plan7: PlanRow[]; plan30: PlanRow[]; onEmptyAction: () => void }) {
  const [win, setWin] = useState<7 | 30>(7)
  const rows = win === 7 ? plan7 : plan30
  const hasAny = plan7.length > 0 || plan30.length > 0

  return (
    <section aria-label="Planned versus actual" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="kicker">Planned vs actual, {win}d</h2>
        <div role="group" aria-label="Window" className="flex gap-1">
          {([7, 30] as const).map(d => (
            <button
              key={d}
              type="button"
              aria-pressed={win === d}
              onClick={() => setWin(d)}
              className={`min-h-11 min-w-11 md:min-h-9 md:min-w-9 rounded-full border px-2 font-mono text-[11px] touch-manipulation ${win === d ? 'border-coral bg-coral-soft text-ink' : 'border-line bg-paper text-ink-3 hover:border-ink-4'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {!hasAny ? (
        <EmptySlab
          kicker="Simulation"
          heading="No spend recorded."
          body="Spend stays off in simulation. Import Shop Campaigns history to watch the rules on real numbers."
          action={
            <button type="button" onClick={onEmptyAction} className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 touch-manipulation">
              Import a CSV
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-paper p-4 text-sm text-ink-3">Nothing planned or spent in the last {win} days.</p>
      ) : (
        <>
          <ul className="space-y-3 rounded-2xl border border-line bg-paper p-4 md:hidden">
            {rows.map(r => {
              const ratio = r.plannedCents && r.plannedCents > 0 ? Math.min(1, r.actualCents / r.plannedCents) : 0
              return (
                <li key={r.key} className="list-none">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-[11px] uppercase tracking-wide text-ink-2">{rowLabel(r)}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-ink">
                      {formatMoney(r.actualCents)}
                      {r.plannedCents != null && <span className="text-ink-3"> / {formatMoney(r.plannedCents)}</span>}
                    </span>
                  </div>
                  {r.plannedCents != null ? (
                    <div className="mt-1 h-2 overflow-hidden rounded-full border border-line-3 bg-paper" role="img" aria-label={`${formatMoney(r.actualCents)} of ${formatMoney(r.plannedCents)} planned`}>
                      <div className="h-full w-full origin-left bg-ink-2" style={{ transform: `scaleX(${ratio})` }} />
                    </div>
                  ) : null}
                  <p className="mt-1 truncate text-xs text-ink-3">{r.campaignName}, {sourceNote(r)}</p>
                </li>
              )
            })}
          </ul>

          <div className="hidden md:block">
            <ResponsiveTable>
              <table className="w-full min-w-[600px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line font-mono text-[11px] uppercase tracking-wide text-ink-3">
                    <th scope="col" className="py-2 pr-3 font-normal">Campaign / lane</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">Planned</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">Actual</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">Orders</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">Net ROAS</th>
                    <th scope="col" className="py-2 text-right font-normal">Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map(r => (
                    <tr key={r.key} className="align-top">
                      <td className="py-2 pr-3">
                        <span className="text-ink">{r.campaignName}</span>{' '}
                        <span className="font-mono text-[11px] uppercase tracking-wide text-ink-3">{rowLabel(r)}</span>
                        <span className="block text-xs text-ink-3">{sourceNote(r)}</span>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink-2">{r.plannedCents == null ? 'n/a' : formatMoney(r.plannedCents)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink">{formatMoney(r.actualCents)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink-2">{r.orders}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink-2">{formatRoas(r.netRoas)}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-ink-2">{r.deltaCents == null ? 'n/a' : signed(r.deltaCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </div>
        </>
      )}
    </section>
  )
}
