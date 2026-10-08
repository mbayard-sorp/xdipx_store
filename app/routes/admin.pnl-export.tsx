/**
 * /admin/pnl-export: CSV downloads for the P&L dashboard.
 *
 *   ?kind=statement  the statement, one column per month in the range plus a total
 *   ?kind=orders     every order in the range with its own revenue, costs and profit
 *
 * Same range parameters as /admin, resolved the same way.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getStoreTimezone, loadPnlData } from '~/lib/pnl.server'
import { dayInTz, monthlyColumns, ordersCsv, resolveRange, statementCsv, totalsFor } from '~/lib/pnl-core'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const kind = url.searchParams.get('kind') === 'orders' ? 'orders' : 'statement'
  const tz = await getStoreTimezone()
  const today = dayInTz(Date.now(), tz)
  const range = resolveRange({ range: url.searchParams.get('range'), from: url.searchParams.get('from'), to: url.searchParams.get('to') }, today)
  const { inputs } = await loadPnlData({ from: range.from, to: range.to })

  let body: string
  if (kind === 'orders') {
    const orders = inputs.orders.filter(o => o.day >= range.from && o.day <= range.to).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    body = ordersCsv(orders, inputs.handlingFeePerOrder)
  } else {
    const months = monthlyColumns(inputs, range.from, range.to)
    const cols = months.length > 1
      ? [...months.map(m => ({ label: m.partial ? `${m.from} to ${m.to}` : m.month, totals: m.totals })), { label: 'Total', totals: totalsFor(inputs, range.from, range.to) }]
      : [{ label: `${range.from} to ${range.to}`, totals: totalsFor(inputs, range.from, range.to) }]
    body = statementCsv(cols)
  }
  const filename = `xdipx-${kind === 'orders' ? 'orders' : 'pnl'}-${range.from}-to-${range.to}.csv`
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
