/**
 * admin.ads.approve.tsx: the one-tap approve link from the owner digest
 * (ticket #16432, plan §5 and §9.8).
 *
 *   GET /admin/ads/approve?id=<id>&exp=<unix>&sig=<hmac>
 *
 * Both checks, always: the admin session first (requireAdmin, the same guard
 * as every admin route, which sends a signed-out tap to the login page), then
 * the signature. This loader runs alongside the admin layout's loaders, not
 * after them, so it checks the session itself. A good link calls the same
 * approveAction the console's Approve button calls and lands on the actions
 * page. A tampered, expired or already-decided link approves nothing and says
 * why in one sentence.
 *
 * Approving here applies nothing to a platform. The hourly applier sends
 * approved rows, and only while ads_spend_enabled and ads_auto_apply_enabled
 * are both on.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, data, redirect, useLoaderData } from 'react-router'
import { getAdminUser, requireAdmin } from '~/lib/session.server'
import { verifyApproveLink } from '~/lib/ads/approve-link.server'
import { approveAction } from '~/lib/ads/actions-view.server'

export const meta: MetaFunction = () => [{ title: 'Approve - Ads - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const verdict = verifyApproveLink(url.searchParams.get('id'), url.searchParams.get('exp'), url.searchParams.get('sig'))
  if (!verdict.ok) return data({ message: verdict.message }, { status: 403 })

  const admin = await getAdminUser(request)
  const result = await approveAction(verdict.id, admin?.email || 'owner')
  if (!result.ok) return data({ message: result.error }, { status: 409 })
  // Applied is the tab that shows approved rows waiting for the applier.
  throw redirect('/admin/ads/actions?tab=applied')
}

export default function AdsApprove() {
  const { message } = useLoaderData<typeof loader>()
  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl md:text-2xl text-ink">Nothing was approved</h1>
      <p className="text-sm text-ink-3">{message}</p>
      <Link
        to="/admin/ads/actions"
        className="inline-flex min-h-11 items-center rounded-full border border-ink bg-ink px-4 text-sm text-paper touch-manipulation"
      >
        Open the actions page
      </Link>
    </div>
  )
}
