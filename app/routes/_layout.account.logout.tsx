import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { logoutCustomerSession } from '~/lib/customer-session.server'

// GET /account/logout — just redirect to login (link from account page)
export async function loader({ request }: LoaderFunctionArgs) {
  const headers = await logoutCustomerSession(request)
  throw redirect('/', { headers })
}

export default function Logout() {
  return null
}
