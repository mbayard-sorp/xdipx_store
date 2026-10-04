/**
 * admin.ad-studio.tsx: layout for Ad Studio v2 (docs/store-team/ad-studio-v2-wires.md).
 *
 * Burn bar, the four tabs as child routes (each with its own loader, action and
 * ErrorBoundary so one tab can fail alone and the back button works), and a
 * toast region. The v1 batch generator UI that lived here is retired; its
 * server function (generateAdBatch in ad-creative.server.ts) is untouched and
 * PR-C replaces the creative path.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Outlet, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getAdBurn } from '~/lib/ad-burn.server'
import { countCreativesToRate, countToRate } from '~/lib/ad-ideas.server'
import { BurnBar } from '~/components/admin/ads/BurnBar'
import { StudioTabs } from '~/components/admin/ads/StudioTabs'
import { AdsToastProvider } from '~/components/admin/ads/AdsToast'

export const meta: MetaFunction = () => [{ title: 'Ad Studio - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const [burn, ideas, creatives] = await Promise.all([
    getAdBurn(),
    countToRate().catch(() => 0),
    countCreativesToRate().catch(() => 0),
  ])
  return { burn, badges: { ideas, creatives } }
}

export default function AdStudioLayout() {
  const { burn, badges } = useLoaderData<typeof loader>()
  return (
    <AdsToastProvider>
      <div className="pb-[calc(56px+env(safe-area-inset-bottom)+24px)] md:pb-0">
        <BurnBar burn={burn} />
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
