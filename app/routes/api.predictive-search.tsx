import type { LoaderFunctionArgs } from 'react-router'
import { predictiveSearchUnified } from '~/lib/search.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'

// GET /api/predictive-search?q=vibrator
export async function loader({ request }: LoaderFunctionArgs) {
  const rl = await checkRateLimit(request, 'psearch', 30, 60)
  if (!rl.ok) return rateLimited()

  const q = new URL(request.url).searchParams.get('q')?.trim().slice(0, 64) ?? ''
  if (q.length < 2) return Response.json({ products: [], pages: [], blogPosts: [] })
  try {
    const result = await predictiveSearchUnified(q)
    return Response.json(result)
  } catch (err) {
    console.error('[api.predictive-search] error:', err)
    return Response.json({ products: [], pages: [], blogPosts: [] })
  }
}
