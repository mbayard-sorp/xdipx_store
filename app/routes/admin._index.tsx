import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useLoaderData } from 'react-router'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { dealHistory } from '../../db/schema'
import { getDashboardStats } from '~/lib/profit.server'
import { requireAdmin } from '~/lib/session.server'
import { ProfitDashboard } from '~/components/admin/ProfitDashboard'

export const meta: MetaFunction = () => [{ title: 'Dashboard — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const { rows, total } = await getDashboardStats(30)

  // Warn when the deal loop is in use (something is live) but the 23:59
  // activator would find nothing queued for the next rotation. Gating on a
  // live deal avoids a permanent nag while daily deals stay deferred.
  const [liveDeal] = await db
    .select({ id: dealHistory.id })
    .from(dealHistory)
    .where(eq(dealHistory.status, 'live'))
    .limit(1)
  let nextDealMissing = false
  if (liveDeal) {
    const [queued] = await db
      .select({ id: dealHistory.id })
      .from(dealHistory)
      .where(and(eq(dealHistory.status, 'queued'), isNull(dealHistory.completedAt)))
      .limit(1)
    nextDealMissing = !queued
  }

  return { rows, total, nextDealMissing }
}

export default function AdminDashboard() {
  const { rows, total, nextDealMissing } = useLoaderData<typeof loader>()
  return (
    <div>
      <h1
        className="text-2xl font-bold text-ink mb-8"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Dashboard
      </h1>
      {nextDealMissing && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-2xl px-5 py-3 text-sm text-yellow-800 flex items-center gap-3">
          <span>⚠️</span>
          <span>
            No approved deal is queued for the next rotation. Stage one via{' '}
            <Link to="/admin/settings" className="underline font-medium">Settings → Run Pipeline Now</Link>, then approve it on{' '}
            <Link to="/admin/queue" className="underline font-medium">the queue</Link>.
          </span>
        </div>
      )}
      <ProfitDashboard rows={rows} totals={total} />
    </div>
  )
}
