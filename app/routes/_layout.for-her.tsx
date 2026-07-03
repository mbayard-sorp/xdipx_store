import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { RETIRED_ROUTE_TARGETS } from '~/lib/retired-routes'

// /for-her is retired. Permanent redirect to the closest ungendered
// product-type collection; never redirect to the gendered /collections/for-her.
export async function loader({ request }: LoaderFunctionArgs) {
  const { search } = new URL(request.url)
  return redirect(`${RETIRED_ROUTE_TARGETS.forHer}${search}`, 301)
}

export default function ForHer() { return null }
