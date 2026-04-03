import { Link, useLocation, Form } from 'react-router'
import { useEffect, useState } from 'react'

// Pending count is loaded client-side from the KV API route
const NAV_ITEMS = [
  { to: '/admin',              label: 'Dashboard',   icon: '📊' },
  { to: '/admin/today',        label: "Today's Deal", icon: '⭐' },
  { to: '/admin/schedule',     label: 'Schedule',     icon: '🗓️' },
  { to: '/admin/queue',        label: 'Deal Queue',   icon: '📋' },
  { to: '/admin/reviews',      label: 'Reviews',      icon: '⭐', badgeKey: 'reviews' },
  { to: '/admin/generate',     label: 'AI Generate',  icon: '✨' },
  { to: '/admin/emails',       label: 'Emails',       icon: '✉️' },
  { to: '/admin/settings',     label: 'Settings',     icon: '⚙️' },
]

export function AdminNav() {
  const { pathname } = useLocation()
  const [pendingReviews, setPendingReviews] = useState<number | null>(null)

  useEffect(() => {
    // Fetch pending count from API (60s cache via KV on server)
    fetch('/api/reviews/admin/pending-count')
      .then(r => r.json() as Promise<{ count: number }>)
      .then(data => setPendingReviews(data.count))
      .catch(() => {/* non-critical */})
  }, [pathname])

  return (
    <aside className="w-56 bg-brand-charcoal min-h-screen flex flex-col py-6 px-4 shrink-0">
      <Link to="/" className="block mb-8">
        <span
          className="text-2xl font-black text-brand-gradient select-none"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          xdipx
        </span>
        <span className="text-white/40 text-xs block">admin</span>
      </Link>

      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map(({ to, label, icon, badgeKey }) => {
          const active = pathname === to || (to !== '/admin' && pathname.startsWith(to))
          const badge  = badgeKey === 'reviews' && pendingReviews && pendingReviews > 0 ? pendingReviews : null
          return (
            <Link
              key={to}
              to={to}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                active
                  ? 'bg-brand-gradient text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/10',
              ].join(' ')}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {badge != null && (
                <span className="ml-auto bg-brand-coral text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <Form method="post" action="/admin/login">
        <input type="hidden" name="intent" value="logout" />
        <button
          type="submit"
          className="w-full text-left px-3 py-2.5 text-white/40 hover:text-white/70 text-sm transition-colors"
        >
          Sign out →
        </button>
      </Form>
    </aside>
  )
}
