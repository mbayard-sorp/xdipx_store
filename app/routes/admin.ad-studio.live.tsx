/**
 * /admin/ad-studio/live: placeholder until the metrics import and rules PRs
 * (G and H) ship the Live tab (wires section 8). Those PRs replace this file.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { EmptySlab } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Live - Ad Studio - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return null
}

export default function LiveTab() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl md:text-2xl text-ink">Live</h1>
      <EmptySlab
        kicker="Simulation"
        heading="Nothing live."
        body="Spend is off in simulation. Per-creative spend, orders and the rules that fired show here once metrics import ships."
      />
    </div>
  )
}
