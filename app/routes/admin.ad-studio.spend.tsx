/**
 * /admin/ad-studio/spend: retired. The Spend tab's owner controls moved to the
 * ads console at /admin/ads/settings (ticket #16413, plan section 7 phase 3c).
 * Old bookmarks and links land there with their query string intact.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { requireAdmin } from '~/lib/session.server'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return redirect(`/admin/ads/settings${new URL(request.url).search}`, 302)
}
