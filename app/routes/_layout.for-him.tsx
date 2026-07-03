import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { RETIRED_ROUTE_TARGETS } from '~/lib/retired-routes'

// /for-him is retired. Permanent redirect to the closest ungendered
// product-type collection; never redirect to the gendered /collections/for-him.
export async function loader({ request }: LoaderFunctionArgs) {
  const { search } = new URL(request.url)
  return redirect(`${RETIRED_ROUTE_TARGETS.forHim}${search}`, 301)
}

export default function ForHim() { return null }
