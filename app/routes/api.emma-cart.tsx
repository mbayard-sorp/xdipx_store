import type { LoaderFunctionArgs } from 'react-router'
import { getCartIdFromCookie } from '~/lib/cart.server'
import { getCart, getCustomerProfile } from '~/lib/shopify.server'
import { getCustomerToken } from '~/lib/customer-session.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'
import { deriveEmmaCartSignals } from '~/lib/emma-cart.server'
import { getEmmaCartAside } from '~/lib/emma-cart-aside.server'

const SEARCH_COOKIE = 'xdipx_last_q'

function readLastSearchCookie(request: Request): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const pair of header.split(/;\s*/)) {
    const [k, ...rest] = pair.split('=')
    if (k === SEARCH_COOKIE && rest.length > 0) {
      try {
        const raw = decodeURIComponent(rest.join('='))
        return raw ? raw.slice(0, 80) : null
      } catch {
        return null
      }
    }
  }
  return null
}

export async function loader({ request }: LoaderFunctionArgs) {
  const rl = await checkRateLimit(request, 'emma-cart-aside', 30, 60)
  if (!rl.ok) return rateLimited()

  const cartId = getCartIdFromCookie(request)
  if (!cartId) {
    return Response.json(
      { body: null, source: 'no-cart' },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  const [cart, customerToken] = await Promise.all([
    getCart(cartId),
    getCustomerToken(request),
  ])
  const profile = customerToken?.tokenType === 'storefront'
    ? await getCustomerProfile(customerToken.token).catch(() => null)
    : null

  const lastSearchQuery = readLastSearchCookie(request)
  const signals = deriveEmmaCartSignals({ cart, profile, lastSearchQuery })
  if (!signals) {
    return Response.json(
      { body: null, source: 'empty-cart' },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  const aside = await getEmmaCartAside({ ...signals, lastSearchQuery })

  return Response.json(
    { body: aside.text, source: aside.source },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
