import { useMemo, useState } from 'react'
import type { AdPlatformRow, BreakdownRow, PnlOrderFact } from '~/lib/pnl-core'
import { NALPAC_SHIPPING_RATES, fulfillmentFor, round2 } from '~/lib/pnl-core'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { count, dayLabel, money, multiple, pct } from './format'

const th = 'font-medium pb-2 px-2 first:pl-0 text-[11px] uppercase tracking-[0.08em] text-ink-3 whitespace-nowrap'
const td = 'py-2 px-2 tabular-nums whitespace-nowrap'

/** Share of revenue as a thin inline bar, so the table reads as a chart at a glance. */
function ShareBar({ value }: { value: number | null }) {
  const v = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div className="flex items-center gap-2 justify-end">
      <span className="text-xs text-ink-3 tabular-nums w-[46px] text-right">{pct(value, 0)}</span>
      <span className="relative h-1.5 w-16 rounded-full bg-paper-3 overflow-hidden" aria-hidden="true">
        <span className="absolute left-0 top-0 h-full rounded-full bg-coral" style={{ width: `${v}%` }} />
      </span>
    </div>
  )
}

export function BreakdownTable({
  rows, firstCol, profitLabel = 'Gross profit', limit = 12, showUnits = true, empty = 'No sales in this window.', compact = false,
}: {
  rows: BreakdownRow[]
  firstCol: string
  profitLabel?: string
  limit?: number
  showUnits?: boolean
  empty?: string
  /** Half-width cards: drop orders and margin, keep the columns that answer "what sells". */
  compact?: boolean
}) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, limit)
  if (rows.length === 0) return <p className="text-sm text-ink-3">{empty}</p>
  return (
    <>
      <ResponsiveTable>
        <table className={`w-full text-sm ${compact ? 'min-w-[440px]' : 'min-w-[680px]'}`}>
          <thead>
            <tr>
              <th className={`${th} text-left`}>{firstCol}</th>
              {!compact && <th className={`${th} text-right`}>Orders</th>}
              {showUnits && <th className={`${th} text-right`}>Units</th>}
              <th className={`${th} text-right`}>Revenue</th>
              <th className={`${th} text-right`}>{compact ? 'Profit' : profitLabel}</th>
              {!compact && <th className={`${th} text-right`}>Margin</th>}
              <th className={`${th} text-right`}>Share</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.key} className="border-t border-line">
                <td className="py-2 pr-3 text-ink max-w-[280px]"><span className="line-clamp-2">{r.label}</span></td>
                {!compact && <td className={`${td} text-right`}>{count(r.orders)}</td>}
                {showUnits && <td className={`${td} text-right`}>{count(r.units)}</td>}
                <td className={`${td} text-right`}>{money(r.revenue)}</td>
                <td className={`${td} text-right ${r.grossProfit < 0 ? 'text-[#A3261B]' : ''}`}>{money(r.grossProfit)}</td>
                {!compact && <td className={`${td} text-right text-ink-3`}>{pct(r.marginPct, 0)}</td>}
                <td className={`${td} pr-0`}><ShareBar value={r.sharePct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTable>
      {rows.length > limit && (
        <button type="button" onClick={() => setAll(v => !v)} className="mt-3 text-xs font-semibold text-plum hover:text-plum-2">
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </>
  )
}

export function AdPlatformsTable({ rows, netRevenue, newCustomers }: { rows: AdPlatformRow[]; netRevenue: number; newCustomers: number }) {
  if (rows.length === 0) {
    return (
      <div className="text-sm text-ink-3 space-y-2">
        <p>No ad spend is recorded for this window.</p>
        <p>
          Platform spend arrives through the CSV import on <a href="/admin/ad-studio/spend" className="link-coral">Ad Studio → Spend</a>.
          Spend on anything without an import (a newsletter sponsorship, an adult network) can be logged as an Advertising expense under Costs.
        </p>
      </div>
    )
  }
  const spend = rows.reduce((s, r) => s + r.spend, 0)
  return (
    <ResponsiveTable>
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr>
            <th className={`${th} text-left`}>Platform</th>
            <th className={`${th} text-right`}>Spend</th>
            <th className={`${th} text-right`}>Impr.</th>
            <th className={`${th} text-right`}>Clicks</th>
            <th className={`${th} text-right`}>CTR</th>
            <th className={`${th} text-right`}>CPC</th>
            <th className={`${th} text-right`}>Platform orders</th>
            <th className={`${th} text-right`}>Platform ROAS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.platform} className="border-t border-line">
              <td className="py-2 pr-3 text-ink">{r.platform}</td>
              <td className={`${td} text-right font-semibold`}>{money(r.spend)}</td>
              <td className={`${td} text-right`}>{r.impressions ? count(r.impressions) : '—'}</td>
              <td className={`${td} text-right`}>{r.clicks ? count(r.clicks) : '—'}</td>
              <td className={`${td} text-right text-ink-3`}>{pct(r.ctrPct, 2)}</td>
              <td className={`${td} text-right text-ink-3`}>{r.cpc == null ? '—' : money(r.cpc)}</td>
              <td className={`${td} text-right`}>{r.orders ? count(r.orders) : '—'}</td>
              <td className={`${td} text-right`}>{multiple(r.roas)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink/70 font-semibold">
            <td className="py-2 pr-3">All platforms</td>
            <td className={`${td} text-right`}>{money(spend)}</td>
            <td colSpan={4} className="py-2 text-right text-xs font-normal text-ink-3">
              Blended (Shopify revenue ÷ all ad spend)
            </td>
            <td className={`${td} text-right`}>{newCustomers > 0 ? `${money(round2(spend / newCustomers))} CAC` : '—'}</td>
            <td className={`${td} text-right`}>{spend > 0 ? multiple(netRevenue / spend) : '—'}</td>
          </tr>
        </tbody>
      </table>
    </ResponsiveTable>
  )
}

/** Every order in the window with its own profit, searchable, newest first. */
export function OrdersLedger({ orders, handlingFeePerOrder, storeDomain }: { orders: PnlOrderFact[]; handlingFeePerOrder: number | null; storeDomain: string | null }) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const PAGE = 25
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return orders
    return orders.filter(o =>
      o.name.toLowerCase().includes(s) || o.channel.toLowerCase().includes(s) || o.source.toLowerCase().includes(s) ||
      o.lines.some(l => l.title.toLowerCase().includes(s) || (l.sku ?? '').toLowerCase().includes(s)))
  }, [orders, q])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE)

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
        <input
          type="search"
          value={q}
          onChange={e => { setQ(e.target.value); setPage(0) }}
          placeholder="Search order, product, SKU, channel"
          className="w-full sm:w-72 rounded-[10px] border border-line-2 bg-paper px-3 py-2 text-sm focus:outline-none focus:border-plum"
          aria-label="Search orders"
        />
        <p className="text-xs text-ink-3">{count(filtered.length)} order{filtered.length === 1 ? '' : 's'}</p>
      </div>
      <ResponsiveTable>
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr>
              <th className={`${th} text-left`}>Order</th>
              <th className={`${th} text-left`}>Date</th>
              <th className={`${th} text-left`}>Items</th>
              <th className={`${th} text-left`}>Channel / source</th>
              <th className={`${th} text-right`}>Net revenue</th>
              <th className={`${th} text-right`}>Product cost</th>
              <th className={`${th} text-right`}>Fees + ship</th>
              <th className={`${th} text-right`}>Gross profit</th>
              <th className={`${th} text-right`}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(o => {
              const ful = fulfillmentFor(o, handlingFeePerOrder)
              const gp = round2(o.netRevenue - o.cogs - o.paymentFees - ful)
              const margin = o.netRevenue > 0 ? (gp / o.netRevenue) * 100 : null
              const numericId = o.id.split('/').pop()
              return (
                <tr key={o.id} className="border-t border-line align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {storeDomain ? (
                      <a href={`https://${storeDomain}/admin/orders/${numericId}`} target="_blank" rel="noreferrer" className="font-semibold text-ink hover:text-plum">{o.name}</a>
                    ) : <span className="font-semibold">{o.name}</span>}
                    {o.status !== 'PAID' && <span className="block text-[10px] uppercase tracking-wide text-ink-4">{o.status.replace(/_/g, ' ').toLowerCase()}</span>}
                    {o.customerType === 'returning' && <span className="block text-[10px] uppercase tracking-wide text-plum">returning</span>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-ink-3">{dayLabel(o.day)}</td>
                  <td className="py-2 pr-3 max-w-[260px]">
                    <span className="line-clamp-2 text-ink-2">{o.lines.filter(l => l.units > 0).map(l => `${l.units}× ${l.title}`).join(', ') || '—'}</span>
                  </td>
                  <td className="py-2 pr-3 text-ink-3 whitespace-nowrap">{o.channel}<span className="block text-[11px] text-ink-4">{o.source}</span></td>
                  <td className={`${td} text-right`}>{money(o.netRevenue)}</td>
                  <td className={`${td} text-right text-ink-3`}>
                    {money(o.cogs)}
                    {o.cogsMissingUnits > 0 && <span className="block text-[10px] text-[#A3261B]">{o.cogsMissingUnits} uncosted</span>}
                  </td>
                  <td className={`${td} text-right text-ink-3`}>
                    {money(o.paymentFees + ful)}
                    <span className="block text-[10px] text-ink-4">{NALPAC_SHIPPING_RATES[o.shippingTier].label}</span>
                  </td>
                  <td className={`${td} text-right font-semibold ${gp < 0 ? 'text-[#A3261B]' : 'text-ink'}`}>{money(gp)}</td>
                  <td className={`${td} text-right text-ink-3`}>{pct(margin, 0)}</td>
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr><td colSpan={9} className="py-8 text-center text-ink-3">No orders match.</td></tr>
            )}
          </tbody>
        </table>
      </ResponsiveTable>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3 text-xs">
          <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded-[8px] border border-line-2 px-2.5 py-1 disabled:opacity-40">Newer</button>
          <span className="text-ink-3 tabular-nums">{page + 1} / {pages}</span>
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} className="rounded-[8px] border border-line-2 px-2.5 py-1 disabled:opacity-40">Older</button>
        </div>
      )}
    </div>
  )
}
