import { useState } from 'react'
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
  const [navOpen, setNavOpen] = useState(false)
  return (
    <div className="min-h-screen bg-cream-2">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 bg-ink px-4 py-3">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-expanded={navOpen}
          aria-controls="admin-nav"
          aria-label="Open navigation"
          className="text-white/80 hover:text-white p-1 -ml-1"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span
          className="text-lg font-black text-coral select-none"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          xdipx
        </span>
        <span className="text-white/40 text-[10px] font-medium tracking-widest uppercase">
          admin
        </span>
      </header>

      <div className="flex md:min-h-screen">
        <AdminNav
          logoUrl={logoUrl}
          adminUser={adminUser}
          open={navOpen}
          onClose={() => setNavOpen(false)}
        />
        <div className="flex-1 min-w-0 p-4 md:p-8 overflow-auto">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
