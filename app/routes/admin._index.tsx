import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { getDashboardStats } from '~/lib/profit.server'
import { ProfitDashboard } from '~/components/admin/ProfitDashboard'

export const meta: MetaFunction = () => [{ title: 'Dashboard — xdipx Admin' }]

export async function loader(_: LoaderFunctionArgs) {
  const { rows, total } = await getDashboardStats(30)
  return { rows, total }
}

export default function AdminDashboard() {
  const { rows, total } = useLoaderData<typeof loader>()
  return (
    <div>
      <h1
        className="text-2xl font-bold text-brand-charcoal mb-8"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Dashboard
      </h1>
      <ProfitDashboard rows={rows} totals={total} />
    </div>
  )
}
