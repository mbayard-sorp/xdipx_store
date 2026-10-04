/**
 * md and up: the Live table inside ResponsiveTable (wires 8.3). Sticky first
 * column so the creative stays visible while the table scrolls inside its
 * wrapper, and the rule sentence as a second line inside the row (never a
 * tooltip), so the reason is read before the button is pressed.
 */
import { Fragment } from 'react'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { formatMoney, roasLabel, type LiveRow, type ShopHistoryDay } from '~/lib/ad-metrics-core'
import { LaneBadge } from './LaneBadge'
import { LiveActions, useLiveRowActions } from './LiveActions'
import { FireFade, Thumb } from './LiveRowCard'
import { RecommendationPill, RuleSentence } from './RuleSentence'

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th scope="col" className={`px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wide text-ink-3 ${className}`}>{children}</th>
}

function LiveTableRow({ row }: { row: LiveRow }) {
  const act = useLiveRowActions(row)
  const num = 'px-3 py-3 align-top font-mono text-sm tabular-nums text-ink'
  return (
    <Fragment>
      <FireFade row={row} as="tr" className="border-t border-line bg-paper">
        <td className="sticky left-0 z-10 bg-paper px-3 py-3 align-top">
          <div className="flex min-w-[180px] items-center gap-2">
            <Thumb row={row} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">
                <span className="font-mono text-xs text-ink-3">{row.label}</span>
              </p>
              {row.slogan && <p className="max-w-[16ch] truncate text-xs text-ink-3">{row.slogan}</p>}
            </div>
          </div>
        </td>
        <td className="px-3 py-3 align-top"><LaneBadge lane={row.lane} registerTier={row.registerTier} /></td>
        <td className={num}>{formatMoney(row.spendCents)}</td>
        <td className={num}>{row.impressions.toLocaleString('en-US')}</td>
        <td className={num}>{row.ctrPct == null ? 'n/a' : `${row.ctrPct.toFixed(1)}%`}</td>
        <td className={num}>{row.orders}</td>
        <td className={num}>{roasLabel(row)}</td>
        <td className="px-3 py-3 align-top"><RecommendationPill value={act.displayed} /></td>
      </FireFade>
      <tr className="bg-paper">
        <td colSpan={8} className="pb-3">
          {/* Sticky and fixed-width so the sentence and buttons stay in view while the table scrolls inside its wrapper. */}
          <div className="sticky left-3 w-[min(600px,100%)] px-3 pl-[72px]">
            <RuleSentence row={row} />
            <LiveActions row={row} act={act} className="mt-2" />
          </div>
        </td>
      </tr>
    </Fragment>
  )
}

export function LiveTable({ rows, lookbackDays }: { rows: LiveRow[]; lookbackDays: number }) {
  const w = `${lookbackDays}D`
  return (
    <ResponsiveTable className="rounded-2xl border border-line bg-paper">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr>
            <Th className="sticky left-0 z-10 bg-paper">Creative</Th>
            <Th>Lane</Th>
            <Th>Spend {w}</Th>
            <Th>Impr {w}</Th>
            <Th>CTR {w}</Th>
            <Th>Ord {w}</Th>
            <Th>ROAS {w}</Th>
            <Th>Rule</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => <LiveTableRow key={r.key} row={r} />)}
        </tbody>
      </table>
    </ResponsiveTable>
  )
}

/** Shop Campaigns history by day: stacked rows under md, a table inside ResponsiveTable above. */
export function ShopHistoryList({ days }: { days: ShopHistoryDay[] }) {
  return (
    <div>
      <ul className="space-y-2 md:hidden">
        {days.map(d => (
          <li key={`${d.day}${d.platform}`} className="rounded-2xl border border-line bg-paper p-4">
            <p className="font-mono text-xs text-ink-3">{d.day} · Shop history</p>
            <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-ink">{formatMoney(d.spendCents)}</p>
            <p className="font-mono text-[11px] tabular-nums text-ink-3">
              {d.impressions.toLocaleString('en-US')} impr · {d.clicks.toLocaleString('en-US')} clicks · {d.ctrPct == null ? 'n/a' : `${d.ctrPct.toFixed(1)}%`} CTR
            </p>
          </li>
        ))}
      </ul>
      <ResponsiveTable className="hidden rounded-2xl border border-line bg-paper md:block">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr><Th>Day</Th><Th>Spend</Th><Th>Impr</Th><Th>Clicks</Th><Th>CTR</Th></tr>
          </thead>
          <tbody>
            {days.map(d => (
              <tr key={`${d.day}${d.platform}`} className="border-t border-line">
                <td className="px-3 py-2 font-mono text-sm tabular-nums text-ink">{d.day}</td>
                <td className="px-3 py-2 font-mono text-sm tabular-nums text-ink">{formatMoney(d.spendCents)}</td>
                <td className="px-3 py-2 font-mono text-sm tabular-nums text-ink">{d.impressions.toLocaleString('en-US')}</td>
                <td className="px-3 py-2 font-mono text-sm tabular-nums text-ink">{d.clicks.toLocaleString('en-US')}</td>
                <td className="px-3 py-2 font-mono text-sm tabular-nums text-ink">{d.ctrPct == null ? 'n/a' : `${d.ctrPct.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTable>
    </div>
  )
}
