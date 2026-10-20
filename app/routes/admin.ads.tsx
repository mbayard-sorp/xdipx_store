/**
 * admin.ads.tsx: layout for the ads console (ticket #16411, plan section 4).
 *
 * Ad Studio keeps ideas and creatives; this console holds operations. It sits
 * under the admin auth guard (admin.tsx) and checks the session itself too,
 * like every admin layout. The sticky bar shows today's spend from the
 * insights mirror against the daily cap, plus the simulation badge.
 *
 * Sub-nav: only Overview is built. Tree, Actions, Audiences, Experiments,
 * Channels and Settings join SECTIONS as their phases ship, so the nav never
 * links to a page that does not exist yet.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { NavLink, Outlet, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { loadTopBar } from '~/lib/ads/console.server'
import { getSimulationExit } from '~/lib/ad-spend.server'
import { ConsoleTopBar } from '~/components/admin/ads/ConsoleTopBar'

export const meta: MetaFunction = () => [{ title: 'Ads - xdipx Admin' }]

const SECTIONS: Array<{ to: string; label: string; end: boolean }> = [
  { to: '/admin/ads', label: 'Overview', end: true },
  { to: '/admin/ads/audiences', label: 'Audiences', end: false },
  { to: '/admin/ads/experiments', label: 'Experiments', end: false },
]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const [bar, simulation] = await Promise.all([
    loadTopBar(),
    getSimulationExit().catch(() => null),
  ])
  return { bar, simulation }
}

export default function AdsConsoleLayout() {
  const { bar, simulation } = useLoaderData<typeof loader>()
  return (
    <div>
      <ConsoleTopBar bar={bar} exit={simulation} />
      <nav aria-label="Ads console" className="mt-4 flex flex-wrap gap-1 md:mt-6">
        {SECTIONS.map(s => (
          <NavLink
            key={s.to}
            to={s.to}
            end={s.end}
            prefetch="intent"
            className={({ isActive }) =>
              `inline-flex min-h-11 items-center rounded-full border px-4 font-mono text-[11px] uppercase tracking-wide touch-manipulation md:min-h-9 ${
                isActive ? 'border-coral bg-coral-soft text-ink' : 'border-line bg-paper text-ink-3 hover:border-ink-4'
              }`
            }
          >
            {s.label}
          </NavLink>
        ))}
      </nav>
      <main className="mt-4 min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
