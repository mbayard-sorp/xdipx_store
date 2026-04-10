import { Link, useLocation, Form } from 'react-router'
import { useEffect, useState } from 'react'

// SVG icon components — consistent 16×16 stroke icons
function DashboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}
function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}
function ReviewsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  )
}
function SocialsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4l11.733 16h4.267l-11.733-16z" />
      <path d="M4 20l6.768-6.768M17.5 4l-6.768 6.768" />
    </svg>
  )
}
function CartUpsellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
function VaultIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 9V7M12 17v-2M9 12H7M17 12h-2" />
    </svg>
  )
}
function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

const NAV_ITEMS = [
  { to: '/admin',                label: 'Dashboard',    Icon: DashboardIcon },
  { to: '/admin/deals',              label: 'Deals',            Icon: StarIcon       },
  { to: '/admin/checkout-upsells',  label: 'Checkout Upsells', Icon: CartUpsellIcon },
  { to: '/admin/bulk-import',       label: 'Bulk Import',      Icon: UploadIcon     },
  { to: '/admin/collections-mgr', label: 'Collections Mgr.',  Icon: VaultIcon     },
  { to: '/admin/reviews',        label: 'Reviews',      Icon: ReviewsIcon,  badgeKey: 'reviews' },
  { to: '/admin/emails',         label: 'Emails',       Icon: MailIcon      },
  { to: '/admin/socials',        label: 'Socials',      Icon: SocialsIcon   },
  { to: '/admin/settings',       label: 'Settings',     Icon: SettingsIcon  },
]

export function AdminNav({ logoUrl }: { logoUrl: string | null }) {
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
        {logoUrl ? (
          <img src={logoUrl} alt="xdipx" className="h-8 w-auto" />
        ) : (
          <span
            className="text-2xl font-black text-brand-gradient select-none"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            xdipx
          </span>
        )}
        <span className="text-white/40 text-xs block mt-0.5 font-medium tracking-widest uppercase">
          admin
        </span>
      </Link>

      <nav className="flex-1 space-y-0.5" aria-label="Admin navigation">
        {NAV_ITEMS.map(({ to, label, Icon, badgeKey }) => {
          const active = pathname === to || (to !== '/admin' && pathname.startsWith(to))
          const badge  = badgeKey === 'reviews' && pendingReviews && pendingReviews > 0 ? pendingReviews : null
          return (
            <Link
              key={to}
              to={to}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                active
                  ? 'bg-brand-gradient text-white shadow-sm'
                  : 'text-white/60 hover:text-white hover:bg-white/10',
              ].join(' ')}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <Icon />
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

      <div className="pt-4 border-t border-white/10">
        <Form method="post" action="/admin/login">
          <input type="hidden" name="intent" value="logout" />
          <button
            type="submit"
            className="w-full text-left px-3 py-2.5 text-white/40 hover:text-white/70 text-sm transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out
          </button>
        </Form>
      </div>
    </aside>
  )
}
