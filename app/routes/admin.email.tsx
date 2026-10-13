/**
 * /admin/email: read-only dashboard for the daily promo email program
 * (ticket #15005, owner direction 2026-10-12). Upcoming/drafted sends,
 * sent-campaign metrics with a per-block breakdown, and the email-analyst's
 * learning ledger (`decision` events).
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getEmailAdminData, type EmailSendRow } from '~/lib/email-admin.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'

export const meta: MetaFunction = () => [{ title: 'Email - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return getEmailAdminData()
}

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}

function num(n: number | null): string {
  return n == null ? '—' : n.toLocaleString()
}

function money(v: string | null): string {
  return v == null ? '—' : `$${v}`
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <p className="kicker">{label}</p>
      <p className="mt-1 font-display text-xl text-ink">{value}</p>
    </div>
  )
}

function UpcomingTable({ rows }: { rows: EmailSendRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-3">No drafted or upcoming sends.</p>
  }
  return (
    <ResponsiveTable>
      <table className="min-w-[640px] w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th className="py-2 pr-4 font-medium">Send date</th>
            <th className="py-2 pr-4 font-medium">Subject</th>
            <th className="py-2 pr-4 font-medium">Audience</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 font-medium">Klaviyo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-line last:border-0">
              <td className="py-2 pr-4 text-ink">{r.sendDate ?? '—'}</td>
              <td className="py-2 pr-4 text-ink">{r.subject ?? '—'}</td>
              <td className="py-2 pr-4 text-ink-2">{r.audience ?? '—'}</td>
              <td className="py-2 pr-4 text-ink-2">{r.status}</td>
              <td className="py-2 text-ink-2">
                {r.klaviyoCampaignId ? (
                  <a
                    href={`https://www.klaviyo.com/campaign/${r.klaviyoCampaignId}/edit`}
                    target="_blank" rel="noreferrer"
                    className="link-coral"
                  >
                    Open in Klaviyo
                  </a>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTable>
  )
}

function SentTable({ rows }: { rows: EmailSendRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-3">No sent campaigns yet.</p>
  }
  return (
    <ResponsiveTable>
      <table className="min-w-[960px] w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th className="py-2 pr-4 font-medium">Sent</th>
            <th className="py-2 pr-4 font-medium">Subject</th>
            <th className="py-2 pr-4 font-medium">Recipients</th>
            <th className="py-2 pr-4 font-medium">Unique clicks</th>
            <th className="py-2 pr-4 font-medium">Click rate</th>
            <th className="py-2 pr-4 font-medium">Attributed orders</th>
            <th className="py-2 pr-4 font-medium">Attributed revenue</th>
            <th className="py-2 pr-4 font-medium">Unsubs</th>
            <th className="py-2 font-medium">Spam</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-line last:border-0">
              <td className="py-2 pr-4 text-ink">{r.sentAt ? r.sentAt.slice(0, 10) : '—'}</td>
              <td className="py-2 pr-4 text-ink">{r.subject ?? '—'}</td>
              <td className="py-2 pr-4 text-ink-2">{num(r.metrics?.recipients ?? null)}</td>
              <td className="py-2 pr-4 text-ink-2">{num(r.metrics?.clicksUnique ?? null)}</td>
              <td className="py-2 pr-4 text-ink-2">{pct(r.metrics?.clickRate ?? null)}</td>
              <td className="py-2 pr-4 text-ink-2">{num(r.metrics?.attributedOrders ?? null)}</td>
              <td className="py-2 pr-4 text-ink-2">{money(r.metrics?.attributedRevenue ?? null)}</td>
              <td className="py-2 pr-4 text-ink-2">{num(r.metrics?.unsubscribes ?? null)}</td>
              <td className="py-2 text-ink-2">{num(r.metrics?.spamComplaints ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTable>
  )
}

function ByBlockTable({ rows }: { rows: EmailSendRow[] }) {
  const withBlocks = rows.filter(r => r.metrics?.byBlock && Object.keys(r.metrics.byBlock).length > 0)
  if (withBlocks.length === 0) {
    return <p className="text-sm text-ink-3">No per-block attribution yet.</p>
  }
  return (
    <ResponsiveTable>
      <table className="min-w-[640px] w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th className="py-2 pr-4 font-medium">Send</th>
            <th className="py-2 pr-4 font-medium">Block</th>
            <th className="py-2 pr-4 font-medium">Orders</th>
            <th className="py-2 font-medium">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {withBlocks.flatMap(r =>
            Object.entries(r.metrics!.byBlock!).map(([block, stats]) => (
              <tr key={`${r.id}-${block}`} className="border-b border-line last:border-0">
                <td className="py-2 pr-4 text-ink-3">{r.sendDate ?? r.campaignKey}</td>
                <td className="py-2 pr-4 text-ink">{block}</td>
                <td className="py-2 pr-4 text-ink-2">{num(stats.orders)}</td>
                <td className="py-2 text-ink-2">{money(stats.revenue)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </ResponsiveTable>
  )
}

export default function AdminEmail() {
  const { upcoming, sent, ledger } = useLoaderData<typeof loader>()

  const totalRecipients = sent.reduce((n, r) => n + (r.metrics?.recipients ?? 0), 0)
  const totalOrders = sent.reduce((n, r) => n + (r.metrics?.attributedOrders ?? 0), 0)
  const totalRevenue = sent.reduce((n, r) => n + parseFloat(r.metrics?.attributedRevenue ?? '0'), 0)
  const totalUnsubs = sent.reduce((n, r) => n + (r.metrics?.unsubscribes ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-xl md:text-2xl text-ink">Email</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Sent campaigns" value={String(sent.length)} />
        <StatCard label="Total recipients" value={totalRecipients.toLocaleString()} />
        <StatCard label="Attributed orders" value={totalOrders.toLocaleString()} />
        <StatCard label="Attributed revenue" value={`$${totalRevenue.toFixed(2)}`} />
      </div>
      {totalUnsubs > 0 && (
        <p className="text-xs text-ink-3">{totalUnsubs.toLocaleString()} total unsubscribes across sent campaigns.</p>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg text-ink">Upcoming &amp; drafted</h2>
        <UpcomingTable rows={upcoming} />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg text-ink">Sent campaigns</h2>
        <SentTable rows={sent} />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg text-ink">Per-block attribution</h2>
        <ByBlockTable rows={sent} />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg text-ink">Learning ledger</h2>
        {ledger.length === 0 ? (
          <p className="text-sm text-ink-3">No decisions recorded yet — nothing has cleared the confidence bar.</p>
        ) : (
          <ul className="space-y-3">
            {ledger.map(entry => (
              <li key={entry.id} className="rounded-2xl border border-line bg-paper p-4">
                <p className="kicker">{entry.ts.slice(0, 10)}</p>
                <p className="mt-1 text-sm text-ink">{entry.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
