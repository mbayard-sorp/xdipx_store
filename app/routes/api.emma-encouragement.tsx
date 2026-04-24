import type { ActionFunctionArgs } from 'react-router'
import { getEmmaEncouragement, type EncouragementArgs } from '~/lib/emma-encouragement.server'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'

/**
 * POST /api/emma-encouragement — returns a single first-person line from
 * Emma summarizing the shopper's current filter selections. Rendered in
 * the strip above the product grid; debounced client-side so it only
 * fires after the shopper pauses.
 *
 * Body: EncouragementArgs (see emma-encouragement.server.ts).
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rl = await checkRateLimit(request, 'emma-encouragement', 30, 60)
  if (!rl.ok) return rateLimited()

  let body: EncouragementArgs
  try {
    body = (await request.json()) as EncouragementArgs
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!body || (body.surface !== 'search' && body.surface !== 'collection') || !body.filters) {
    return new Response(JSON.stringify({ error: 'Invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const result = await getEmmaEncouragement(body)
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
