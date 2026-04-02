import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'

// Clears the preview cookie and redirects back to the homepage.
export async function loader(_: LoaderFunctionArgs) {
  const headers = new Headers()
  headers.set(
    'Set-Cookie',
    `__sanity_preview=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  )
  return redirect('/', { headers })
}
