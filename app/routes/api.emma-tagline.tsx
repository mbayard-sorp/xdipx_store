import type { LoaderFunctionArgs } from 'react-router'
import { getEmmaTagline } from '~/lib/claude.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const limit = process.env['NODE_ENV'] === 'production' ? 30 : 200
  const rl = await checkRateLimit(request, 'emma-tagline', limit, 300)
  if (!rl.ok) return rateLimited()

  // Served from a shared, pre-generated rotating bank (ticket #3981), not a
  // per-request model call. `no-store` keeps each open showing a fresh pick.
  const tagline = await getEmmaTagline()
  return Response.json(
    { tagline },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
