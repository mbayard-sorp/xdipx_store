import { redirect } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

/**
 * /admin/today is a legacy URL — kept as a redirect so bookmarks don't 404.
 * The deal editor now lives at /admin/deals.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const target = new URL('/admin/deals', url.origin)
  target.search = url.search
  return redirect(target.toString(), 308)
}
