import type { MonthColumn, StatementRow } from '~/lib/pnl-core'
import { statementRows } from '~/lib/pnl-core'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { Delta } from './Card'
import { cost, money, monthLabel, pct } from './format'

function show(r: StatementRow, v: number | null | undefined): string {
  if (v == null) return '—'
  return r.isCost ? cost(v) : money(v)
}

const rowClass: Record<StatementRow['kind'], string> = {
  header: 'text-[11px] uppercase tracking-[0.08em] text-ink-3 font-semibold pt-5',
  line: 'text-ink-2',
  subtotal: 'font-semibold text-ink border-t border-line',
  total: 'font-bold text-ink border-t-2 border-ink/80 text-[15px]',
  memo: 'text-ink-4 text-xs italic',
}

/**
 * The statement for one window against the one before it. Costs read as
 * negatives, subtotals carry a rule above, and "% of revenue" is the column
 * that makes two periods of different size comparable.
 */
export function StatementTable({
  rows, prevRows, netRevenue, hasPrev,
}: {
  rows: StatementRow[]
  prevRows: StatementRow[] | null
  netRevenue: number
  hasPrev: boolean
}) {
  const prevByKey = new Map((prevRows ?? []).map(r => [r.key, r]))
  return (
    <ResponsiveTable>
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
            <th className="text-left font-medium pb-2">Line</th>
            <th className="text-right font-medium pb-2">This period</th>
            <th className="text-right font-medium pb-2 w-[90px]">% of rev.</th>
            {hasPrev && <th className="text-right font-medium pb-2">Prior period</th>}
            {hasPrev && <th className="text-right font-medium pb-2 w-[90px]">Change</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            if (r.kind === 'header') {
              return (
                <tr key={r.key}><td colSpan={hasPrev ? 5 : 3} className={rowClass.header}>{r.label}</td></tr>
              )
            }
            const p = prevByKey.get(r.key)
            const share = r.value != null && netRevenue > 0 && r.kind !== 'memo' ? (r.value / netRevenue) * 100 * (r.isCost ? -1 : 1) : null
            const delta = p?.value != null && r.value != null && p.value !== 0 ? ((r.value - p.value) / Math.abs(p.value)) * 100 : null
            return (
              <tr key={r.key} className={rowClass[r.kind]}>
                <td className={`py-1.5 pr-3 ${r.indent === 1 ? 'pl-4' : ''}`}>
                  {r.label}
                  {r.hint && <span className="block text-[11px] font-normal not-italic text-ink-4">{r.hint}</span>}
                </td>
                <td className={`py-1.5 text-right tabular-nums ${r.kind === 'total' && (r.value ?? 0) < 0 ? 'text-[#A3261B]' : ''}`}>{show(r, r.value)}</td>
                <td className="py-1.5 text-right tabular-nums text-ink-3 text-xs">{share == null ? '' : pct(share)}</td>
                {hasPrev && <td className="py-1.5 text-right tabular-nums text-ink-3">{p ? show(r, p.value) : '—'}</td>}
                {hasPrev && (
                  <td className="py-1.5 text-right">
                    {r.kind !== 'memo' && r.value != null && p?.value != null && <Delta value={delta} goodWhenUp={!r.isCost} />}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </ResponsiveTable>
  )
}

/** The month-by-month P&L: one column per calendar month in the window, plus a total. */
export function MonthlyStatement({ columns, total, fulfillmentSet }: { columns: MonthColumn[]; total: MonthColumn['totals']; fulfillmentSet: boolean }) {
  const all = [...columns.map(c => ({ key: c.month, label: monthLabel(c.month), partial: c.partial, rows: statementRows(c.totals, { fulfillmentSet }) })),
    { key: 'total', label: 'Total', partial: false, rows: statementRows(total, { fulfillmentSet }) }]
  // Row order from the total column, which has every dynamic line any month has.
  const order = all[all.length - 1]!.rows
  return (
    <ResponsiveTable>
      <table className="w-full text-sm" style={{ minWidth: `${220 + all.length * 110}px` }}>
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
            <th className="text-left font-medium pb-2 sticky left-0 bg-paper z-[1]">Line</th>
            {all.map(c => (
              <th key={c.key} className={`text-right font-medium pb-2 whitespace-nowrap ${c.key === 'total' ? 'text-ink' : ''}`}>
                {c.label}{c.partial ? '*' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map(r => {
            if (r.kind === 'header') return <tr key={r.key}><td colSpan={all.length + 1} className={`${rowClass.header} sticky left-0 bg-paper`}>{r.label}</td></tr>
            return (
              <tr key={r.key} className={rowClass[r.kind]}>
                <td className={`py-1.5 pr-3 whitespace-nowrap sticky left-0 bg-paper z-[1] ${r.indent === 1 ? 'pl-4' : ''}`}>{r.label}</td>
                {all.map(c => {
                  const cell = c.rows.find(x => x.key === r.key)
                  return (
                    <td key={c.key} className={`py-1.5 text-right tabular-nums whitespace-nowrap ${c.key === 'total' ? 'bg-paper-2' : ''} ${r.kind === 'total' && (cell?.value ?? 0) < 0 ? 'text-[#A3261B]' : ''}`}>
                      {show(r, cell ? cell.value : 0)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {columns.some(c => c.partial) && <p className="text-[11px] text-ink-4 mt-2">* Partial month: only the days inside the selected range.</p>}
    </ResponsiveTable>
  )
}
