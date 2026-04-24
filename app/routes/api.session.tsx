import { createHash } from 'node:crypto'
import type { LoaderFunctionArgs } from 'react-router'
import { getCustomerToken } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { getHeartedProductIds } from '~/lib/wishlist.server'

export type SessionData = {
  isCustomerLoggedIn: boolean
  customerFirstName: string | null
  customerIdHash: string | null
  heartedProductIds: string[]
  wishlistCount: number
}

const EMPTY: SessionData = {
  isCustomerLoggedIn: false,
  customerFirstName: null,
  customerIdHash: null,
  heartedProductIds: [],
  wishlistCount: 0,
}

function noStoreJson(data: SessionData): Response {
  return Response.json(data, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Vary': 'Cookie',
    },
  })
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customerToken = await getCustomerToken(request)
  if (!customerToken) return noStoreJson(EMPTY)

  try {
    const profile = await customerAPI(customerToken).getProfile()
    if (!profile) return noStoreJson(EMPTY)
    const heartedProductIds = await getHeartedProductIds(profile.id)
    const customerIdHash = createHash('sha256')
      .update(customerToken.token)
      .digest('hex')
      .slice(0, 12)
    return noStoreJson({
      isCustomerLoggedIn: true,
      customerFirstName: profile.firstName ?? null,
      customerIdHash,
      heartedProductIds,
      wishlistCount: heartedProductIds.length,
    })
  } catch {
    // Token likely expired
    return noStoreJson(EMPTY)
  }
}
