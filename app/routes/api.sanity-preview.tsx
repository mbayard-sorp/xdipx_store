import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { timingSafeEqual } from 'node:crypto'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// Enables Sanity draft preview mode by setting a secure cookie.
// Called by the Sanity Presentation tool when an editor clicks "Open Preview".
export async function loader({ request }: LoaderFunctionArgs) {
  const url      = new URL(request.url)
  const secret   = url.searchParams.get('secret') ?? ''
  const slug     = url.searchParams.get('slug') ?? '/'
  const expected = process.env['SANITY_PREVIEW_SECRET']

  if (!expected || !safeEqual(secret, expected)) {
    return new Response('Invalid preview secret', { status: 401 })
  }

  // Only allow relative redirects — prevent open-redirect via ?slug=https://evil
  const safeSlug = slug.startsWith('/') && !slug.startsWith('//') ? slug : '/'

  const headers = new Headers()
  headers.set(
    'Set-Cookie',
    `__sanity_preview=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`,
  )
  return redirect(safeSlug, { headers })
}
