/**
 * /admin/ad-studio/creatives: placeholder until PR-C ships the render lane and
 * the Creatives tab (wires section 5). PR-C replaces this file.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { EmptySlab } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Creatives - Ad Studio - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return null
}

export default function CreativesTab() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl md:text-2xl text-ink">Creatives</h1>
      <EmptySlab
        kicker="Simulation"
        heading="Nothing rendered yet."
        body="Creatives appear after you heart an idea and a render pass runs. The render lane is not built yet."
        action={
          <Link to="/admin/ad-studio/ideas" className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4">
            Rate ideas
          </Link>
        }
      />
    </div>
  )
}
