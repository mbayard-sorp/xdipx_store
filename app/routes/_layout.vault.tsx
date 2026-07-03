import { redirect } from 'react-router'
import { RETIRED_ROUTE_TARGETS } from '~/lib/retired-routes'

// /vault is retired. Permanent redirect to the collections hub.
export async function loader() {
  return redirect(RETIRED_ROUTE_TARGETS.vault, 301)
}

export default function Vault() { return null }
