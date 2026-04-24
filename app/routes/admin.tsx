import type { LoaderFunctionArgs } from 'react-router'
import { Outlet, useLoaderData } from 'react-router'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { getSiteSettings } from '~/lib/sanity.server'
import { AdminNav }     from '~/components/admin/AdminNav'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const [settings, adminUser] = await Promise.all([
    getSiteSettings(),
    getAdminUser(request),
  ])
  return {
    logoUrl: settings?.logoUrl ?? null,
    adminUser: adminUser ? { name: adminUser.name, email: adminUser.email, role: adminUser.role } : null,
  }
}

export default function AdminLayout() {
  const { logoUrl, adminUser } = useLoaderData<typeof loader>()
  return (
    <div className="flex min-h-screen bg-cream-2">
      <AdminNav logoUrl={logoUrl} adminUser={adminUser} />
      <div className="flex-1 p-8 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
