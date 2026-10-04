/**
 * /admin/ad-studio lands on Ideas. (When Creatives tab ships in PR-C and ideas
 * are empty while creatives await rating, this is where that redirect goes.)
 */
import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { requireAdmin } from '~/lib/session.server'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  throw redirect('/admin/ad-studio/ideas')
}
