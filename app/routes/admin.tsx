import type { LoaderFunctionArgs } from 'react-router'
import { Outlet } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { AdminNav }     from '~/components/admin/AdminNav'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return null
}

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen bg-brand-mist">
      <AdminNav />
      <div className="flex-1 p-8 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
