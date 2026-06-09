// Shared CDN cache headers for public storefront routes.
// Do not use on routes with admin-bypass logic (_layout._index.tsx) or
// private/no-store responses (api.cart.tsx loader).
export const STOREFRONT_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
} as const
