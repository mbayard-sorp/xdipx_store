import { Suspense } from 'react'
import { Await } from 'react-router'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import type { LeadFunnelReport } from '~/lib/lead-funnel-report.server'

const usd = (n: number) => `$${n.toFixed(2)}`
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-2 p-3">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="font-display text-lg text-ink">{value}</div>
    </div>
  )
}

function Body({ r }: { r: LeadFunnelReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Leads" value={String(r.totals.leads)} />
        <Stat label="Lead to order" value={pct(r.totals.leadToOrderRate)} />
        <Stat label="Orders" value={String(r.totals.orders)} />
        <Stat label="Revenue" value={usd(r.totals.revenue)} />
      </div>

      <ResponsiveTable>
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th className="py-1 pr-3">utm_content</th>
              <th className="py-1 pr-3 text-right">Leads</th>
              <th className="py-1 pr-3 text-right">Ordered</th>
              <th className="py-1 pr-3 text-right">Rate</th>
              <th className="py-1 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {r.byUtmContent.length === 0 && (
              <tr><td colSpan={5} className="py-2 text-ink-3">No leads in the window.</td></tr>
            )}
            {r.byUtmContent.map(row => (
              <tr key={row.key} className="border-t border-line">
                <td className="py-1 pr-3 break-all">{row.key}</td>
                <td className="py-1 pr-3 text-right">{row.leads}</td>
                <td className="py-1 pr-3 text-right">{row.convertedLeads}</td>
                <td className="py-1 pr-3 text-right">{pct(row.leadToOrderRate)}</td>
                <td className="py-1 text-right">{usd(row.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTable>

      <ResponsiveTable>
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th className="py-1 pr-3">Interest</th>
              <th className="py-1 pr-3 text-right">Leads</th>
              <th className="py-1 pr-3 text-right">Ordered</th>
              <th className="py-1 pr-3 text-right">Rate</th>
              <th className="py-1 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {r.byInterest.map(row => (
              <tr key={row.key} className="border-t border-line">
                <td className="py-1 pr-3">{row.key}</td>
                <td className="py-1 pr-3 text-right">{row.leads}</td>
                <td className="py-1 pr-3 text-right">{row.convertedLeads}</td>
                <td className="py-1 pr-3 text-right">{pct(row.leadToOrderRate)}</td>
                <td className="py-1 text-right">{usd(row.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTable>

      <p className="text-xs text-ink-3">
        Door B (GA4 start_interest picks): {r.doorB ? r.doorB.total : 'unavailable'}.
        Door A orders in order_attribution (curious_lead): {r.orderAttribution ? r.orderAttribution.reduce((s, x) => s + x.orders, 0) : 'unavailable'}.
        Reads up to {r.leadsCap} leads.
      </p>
      {r.gaps.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-coral">
          {r.gaps.map(g => <li key={g}>{g}</li>)}
        </ul>
      )}
    </div>
  )
}

export function LeadFunnelCard({ report }: { report: Promise<LeadFunnelReport> }) {
  return (
    <section className="rounded-xl border border-line bg-paper p-4">
      <h2 className="font-display text-lg text-ink">Lead funnel, last 30 days</h2>
      <p className="mb-3 text-xs text-ink-3">Paid leads joined to Klaviyo Placed Order after capture.</p>
      <Suspense fallback={<p className="text-sm text-ink-3">Reading Klaviyo and GA4...</p>}>
        <Await resolve={report} errorElement={<p className="text-sm text-coral">Lead funnel report failed to load.</p>}>
          {r => <Body r={r} />}
        </Await>
      </Suspense>
    </section>
  )
}
