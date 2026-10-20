/**
 * admin.ad-studio.tsx: layout for Ad Studio v2 (docs/store-team/ad-studio-v2-wires.md).
 *
 * Burn bar, the tabs as child routes (each with its own loader, action and
 * ErrorBoundary so one tab can fail alone and the back button works), and a
 * toast region. Live and Spend moved to the ads console (ticket #16413); the
 * tab bar links there as "Console".
 *
 * The burn bar's spend, cap and valve come from loadTopBar, the same read the
 * console's top bar makes (the insights mirror), so the two bars never show
 * different numbers for today. Orders today still come from getAdBurn, which
 * the console bar does not show. The v1 batch generator UI that lived here is retired; its
 * server function (generateAdBatch in ad-creative.server.ts) is untouched and
 * PR-C replaces the creative path.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Outlet, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getAdBurn } from '~/lib/ad-burn.server'
import { loadTopBar } from '~/lib/ads/console.server'
import { countCreativesToRate, countToRate } from '~/lib/ad-ideas.server'
import { getSimulationExit } from '~/lib/ad-spend.server'
import { BurnBar, type BurnBarData } from '~/components/admin/ads/BurnBar'
import { StudioTabs } from '~/components/admin/ads/StudioTabs'
import { AdsToastProvider } from '~/components/admin/ads/AdsToast'

export const meta: MetaFunction = () => [{ title: 'Ad Studio - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const [bar, orders, ideas, creatives, simulation] = await Promise.all([
    loadTopBar(),
    getAdBurn(),
    countToRate().catch(() => 0),
    countCreativesToRate().catch(() => 0),
    getSimulationExit().catch(() => null),
  ])
  const burn: BurnBarData = {
    ok: bar.spendTodayCents != null,
    spendCents: bar.spendTodayCents,
    ordersToday: orders.ok ? orders.ordersToday : null,
    dailyCapCents: bar.dailyCapCents,
    spendEnabled: bar.spendEnabled,
  }
  return { burn, simulation, badges: { ideas, creatives } }
}

export default function AdStudioLayout() {
  const { burn, badges, simulation } = useLoaderData<typeof loader>()
  return (
    <AdsToastProvider>
      <div className="pb-[calc(56px+env(safe-area-inset-bottom)+24px)] md:pb-0">
        <BurnBar burn={burn} exit={simulation} />
        <div className="pt-4 md:grid md:grid-cols-[72px_minmax(0,1fr)] md:gap-6 md:pt-6">
          <StudioTabs badges={badges} />
          <main className="min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </AdsToastProvider>
  )
}
