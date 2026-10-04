/**
 * /admin/ad-studio/spend: placeholder until the Spend tab (wires section 9,
 * PR-H) ships. That PR replaces this file.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { EmptySlab } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Spend - Ad Studio - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return null
}

export default function SpendTab() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl md:text-2xl text-ink">Spend</h1>
      <EmptySlab
        kicker="Simulation"
        heading="No spend recorded."
        body="Spend stays off in simulation. The monthly cap, plan versus actual and CSV import show here once the Spend tab ships."
      />
    </div>
  )
}
