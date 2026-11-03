/**
 * /admin/email: read-only dashboard for the daily promo email program
 * (ticket #15005, owner direction 2026-10-12). Upcoming/drafted sends,
 * sent-campaign metrics with a per-block breakdown, and the email-analyst's
 * learning ledger (`decision` events).
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useFetcher, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getEmailAdminData, type EmailSendRow, type PendingCampaignRow } from '~/lib/email-admin.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { pushApprovedCampaign, defaultCampaignPushDeps } from '~/lib/klaviyo-campaigns.server'

export const meta: MetaFunction = () => [{ title: 'Email - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return getEmailAdminData()
}

/**
 * Ticket #19543: the owner-session action that turns an approved `kind:campaign`
 * brief into a Klaviyo draft, the admin-UI counterpart to
 * `scripts/push-approved-campaigns.ts`. `pushApprovedCampaign` is itself
 * valve-gated on `email_campaign_push_enabled` (default off) and draft-only; this
 * action adds no gate of its own beyond `requireAdmin`.
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')

  if (intent === 'push-campaign') {
    const id = Number(form.get('id'))
    const suggestion = String(form.get('suggestion') ?? '')
    if (!Number.isFinite(id) || id <= 0 || !suggestion) {
      return { ok: false as const, error: 'bad request', result: undefined }
    }
    const result = await pushApprovedCampaign({ id, suggestion }, defaultCampaignPushDeps())
    return { ok: result.pushed, error: undefined, result }
  }

  return { ok: false as const, error: 'unknown intent', result: undefined }
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

function PendingCampaignsSection({ rows, valveOn }: { rows: PendingCampaignRow[]; valveOn: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-3">No approved campaign briefs waiting.</p>
  }
  return (
    <div className="space-y-3">
      {!valveOn && (
        <p className="text-xs text-ink-3">
          `email_campaign_push_enabled` is off. Pushing will not create a Klaviyo draft until the owner flips it on /admin/homepage-team.
        </p>
      )}
      <ul className="space-y-3">
        {rows.map(row => (
          <PendingCampaignCard key={row.id} row={row} />
        ))}
      </ul>
    </div>
  )
}

function PendingCampaignCard({ row }: { row: PendingCampaignRow }) {
  const fetcher = useFetcher<typeof action>()
  const pushed = row.alreadyDrafted || fetcher.data?.ok === true
  const pending = fetcher.state !== 'idle'
  return (
    <li className="rounded-2xl border border-line bg-paper p-4">
      <p className="kicker">{row.createdAt.slice(0, 10)} · #{row.id}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{row.suggestion}</p>
      <fetcher.Form method="post" className="mt-3 flex flex-col gap-1 md:flex-row md:items-center">
        <input type="hidden" name="intent" value="push-campaign" />
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="suggestion" value={row.suggestion} />
        <button
          type="submit"
          disabled={pushed || pending}
          className="rounded-full border border-line px-4 py-2 text-sm text-ink disabled:opacity-50"
        >
          {pushed ? 'Drafted in Klaviyo' : pending ? 'Pushing…' : 'Push to Klaviyo draft'}
        </button>
        {fetcher.data && !fetcher.data.ok && (
          <span className="text-xs text-coral">{fetcher.data.result?.reason ?? fetcher.data.error}</span>
        )}
        {fetcher.data?.ok && fetcher.data.result?.editUrl && (
          <a href={fetcher.data.result.editUrl} target="_blank" rel="noreferrer" className="link-coral text-xs">
            Open in Klaviyo
          </a>
        )}
      </fetcher.Form>
    </li>
  )
}

export default function AdminEmail() {
  const { upcoming, sent, ledger, pendingCampaigns, campaignPushValveOn } = useLoaderData<typeof loader>()

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
        <h2 className="font-display text-lg text-ink">Approved campaign briefs</h2>
        <PendingCampaignsSection rows={pendingCampaigns} valveOn={campaignPushValveOn} />
      </section>

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
