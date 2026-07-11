import { redirect } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

/**
 * /admin/deal-manager is retired — /admin/deals is the sole deal editor.
 * Kept as a redirect because /admin/today issued browser-cached 301s here.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const target = new URL('/admin/deals', url.origin)
  target.search = url.search
  return redirect(target.toString(), 308)
}
