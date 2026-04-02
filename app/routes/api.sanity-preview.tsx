import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'

// Enables Sanity draft preview mode by setting a secure cookie.
// Called by the Sanity Presentation tool when an editor clicks "Open Preview".
export async function loader({ request }: LoaderFunctionArgs) {
  const url    = new URL(request.url)
  const secret = url.searchParams.get('secret')
  const slug   = url.searchParams.get('slug') ?? '/'

  if (secret !== process.env['SANITY_PREVIEW_SECRET']) {
    return new Response('Invalid preview secret', { status: 401 })
  }

  const headers = new Headers()
  headers.set(
    'Set-Cookie',
    `__sanity_preview=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`,
  )
  return redirect(slug, { headers })
}
