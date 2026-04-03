/**
 * GET /api/reviews/admin/pending-count
 * Returns cached pending review count. Used by AdminNav badge.
 * TTL: 60s via KV.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin }  from '~/lib/session.server'
import { kvGet, kvSet }  from '~/lib/kv.server'
import { getReviewStats } from '~/lib/reviews.server'

const CACHE_KEY = 'review:stats:pending'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  // Try cache first
  const cached = await kvGet<number>(CACHE_KEY)
  if (cached !== null) {
    return Response.json({ count: cached })
  }

  const stats = await getReviewStats()
  await kvSet(CACHE_KEY, stats.pendingReviews, 60)
  return Response.json({ count: stats.pendingReviews })
}
