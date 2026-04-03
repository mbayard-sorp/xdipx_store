/**
 * POST /api/reviews/:id/helpful
 * Increment helpful_yes or helpful_no for a review.
 */
import type { ActionFunctionArgs } from 'react-router'
import { voteHelpful } from '~/lib/reviews.server'

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const id = params['id']
  if (!id) return Response.json({ error: 'Missing review ID' }, { status: 400 })

  let vote: string | null
  try {
    const form = await request.formData()
    vote = form.get('vote') as string | null
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  if (vote !== 'yes' && vote !== 'no') {
    return Response.json({ error: 'Vote must be "yes" or "no"' }, { status: 400 })
  }

  try {
    const result = await voteHelpful(id, vote)
    return Response.json(result)
  } catch (err) {
    console.error('[reviews:helpful-vote]', err)
    return Response.json({ error: 'Failed to record vote' }, { status: 500 })
  }
}
