import type { LoaderFunctionArgs } from 'react-router'
import { generateEmmaTagline } from '~/lib/claude.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const limit = process.env['NODE_ENV'] === 'production' ? 30 : 200
  const rl = await checkRateLimit(request, 'emma-tagline', limit, 300)
  if (!rl.ok) return rateLimited()

  const tagline = await generateEmmaTagline()
  return Response.json(
    { tagline },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
