import { redirect } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const target = new URL('/admin/deal-manager', url.origin)
  target.search = url.search
  return redirect(target.toString(), 301)
}
