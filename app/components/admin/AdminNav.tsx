import { Link, useLocation, Form } from 'react-router'

const NAV_ITEMS = [
  { to: '/admin',          label: 'Dashboard',  icon: '📊' },
  { to: '/admin/queue',    label: 'Deal Queue',  icon: '📅' },
  { to: '/admin/today',    label: "Today's Deal",icon: '⭐' },
  { to: '/admin/generate', label: 'AI Generate', icon: '✨' },
  { to: '/admin/emails',   label: 'Emails',      icon: '✉️' },
]

export function AdminNav() {
  const { pathname } = useLocation()

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
        {NAV_ITEMS.map(({ to, label, icon }) => {
          const active = pathname === to || (to !== '/admin' && pathname.startsWith(to))
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
