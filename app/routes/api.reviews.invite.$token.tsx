/**
 * GET /api/reviews/invite/:token
 * Track invite opened, then redirect to /review?token=X
 */
import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { markInviteOpened } from '~/lib/reviews.server'

export async function loader({ params }: LoaderFunctionArgs) {
  const token = params['token']
  if (!token) return redirect('/')

  // Track open (fire-and-forget)
  markInviteOpened(token).catch(err => {
    console.error('[invite:open-track]', err)
  })

  return redirect(`/review?token=${encodeURIComponent(token)}`)
}
