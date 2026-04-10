import type { LoaderFunctionArgs } from 'react-router'
import { Outlet, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getSiteSettings } from '~/lib/sanity.server'
import { AdminNav }     from '~/components/admin/AdminNav'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const settings = await getSiteSettings()
  return { logoUrl: settings?.logoUrl ?? null }
}

export default function AdminLayout() {
  const { logoUrl } = useLoaderData<typeof loader>()
  return (
    <div className="flex min-h-screen bg-brand-mist">
      <AdminNav logoUrl={logoUrl} />
      <div className="flex-1 p-8 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
