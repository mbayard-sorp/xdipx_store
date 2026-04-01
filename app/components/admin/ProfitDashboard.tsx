interface DayRow {
  summaryDate:  string
  totalOrders:  number | null
  totalRevenue: string | null
  totalProfit:  string | null
  featuredSku:  string | null
}

interface Totals {
  revenue: number
  profit:  number
  orders:  number
}

interface ProfitDashboardProps {
  rows:   DayRow[]
  totals: Totals
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export function ProfitDashboard({ rows, totals }: ProfitDashboardProps) {
  const margin = totals.revenue > 0
    ? ((totals.profit / totals.revenue) * 100).toFixed(1)
    : '0'

  return (
    <div>
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Revenue (30d)"  value={fmt(totals.revenue)} />
        <KpiCard label="Profit (30d)"   value={fmt(totals.profit)}  highlight />
        <KpiCard label="Orders (30d)"   value={String(totals.orders)} />
        <KpiCard label="Margin"         value={`${margin}%`} />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-mist text-brand-charcoal/60 text-xs uppercase tracking-wide">
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">SKU</th>
              <th className="px-4 py-3 text-right">Orders</th>
              <th className="px-4 py-3 text-right">Revenue</th>
              <th className="px-4 py-3 text-right">Profit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.summaryDate} className="border-t border-brand-mist hover:bg-brand-mist/50 transition-colors">
                <td className="px-4 py-3 font-medium">{row.summaryDate}</td>
                <td className="px-4 py-3 text-brand-charcoal/60">{row.featuredSku ?? '—'}</td>
                <td className="px-4 py-3 text-right">{row.totalOrders ?? 0}</td>
                <td className="px-4 py-3 text-right">{fmt(parseFloat(row.totalRevenue ?? '0'))}</td>
                <td className={`px-4 py-3 text-right font-semibold ${parseFloat(row.totalProfit ?? '0') > 0 ? 'text-green-600' : 'text-brand-charcoal/40'}`}>
                  {fmt(parseFloat(row.totalProfit ?? '0'))}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-charcoal/40">
                  No data yet. Run your first deal to see profit tracking.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function KpiCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl p-5 ${highlight ? 'bg-brand-gradient text-white' : 'bg-white shadow-sm'}`}>
      <p className={`text-xs font-medium mb-1 ${highlight ? 'text-white/70' : 'text-brand-charcoal/50'}`}>{label}</p>
      <p
        className={`text-2xl font-black ${highlight ? 'text-white' : 'text-brand-charcoal'}`}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </p>
    </div>
  )
}
