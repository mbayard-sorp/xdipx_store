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
function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
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
function SearchFilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  )
}
function SlidersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="6" r="2" fill="white" />
      <circle cx="15" cy="12" r="2" fill="white" />
      <circle cx="9" cy="18" r="2" fill="white" />
    </svg>
  )
}
function LabsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3h6v6l5 10H4L9 9V3z" />
      <line x1="9" y1="3" x2="15" y2="3" />
    </svg>
  )
}
function IvrIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}
function ChatBubbleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="9" y1="10" x2="15" y2="10" />
      <line x1="9" y1="14" x2="13" y2="14" />
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
function PricingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  )
}
function ImportsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
    </svg>
  )
}
function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

interface AdminUserInfo {
  name: string
  email: string
  role: 'owner' | 'admin'
}

const NAV_ITEMS = [
  { to: '/admin',                label: 'Dashboard',    Icon: DashboardIcon },
  { to: '/admin/deals',              label: 'Deals',            Icon: StarIcon       },
  { to: '/admin/homepage-team',      label: 'Homepage Team',    Icon: SlidersIcon    },
  { to: '/admin/marketing-calendar', label: 'Marketing Calendar', Icon: SocialsIcon  },
  { to: '/admin/pricing',           label: 'Pricing',          Icon: PricingIcon    },
  { to: '/admin/checkout-upsells',  label: 'Checkout Upsells', Icon: CartUpsellIcon },
  { to: '/admin/bulk-import',       label: 'Bulk Import',      Icon: UploadIcon     },
  { to: '/admin/merge-variants',   label: 'Merge Variants',   Icon: VaultIcon      },
  { to: '/admin/collections-mgr', label: 'Collections Mgr.',  Icon: VaultIcon     },
  { to: '/admin/reviews',        label: 'Reviews',      Icon: ReviewsIcon,  badgeKey: 'reviews' },
  { to: '/admin/voice-and-sms',  label: 'Voice & SMS',  Icon: IvrIcon       },
  { to: '/admin/voicemails',     label: 'Voicemails',   Icon: PhoneIcon,    badgeKey: 'voicemails' },
  { to: '/admin/calls',          label: 'Calls',        Icon: PhoneIcon     },
  { to: '/admin/phone-orders',   label: 'Phone Orders', Icon: CartUpsellIcon },
  { to: '/admin/socials',        label: 'Socials',      Icon: SocialsIcon   },
  { to: '/admin/search-filters',    label: 'Search Filters',   Icon: SearchFilterIcon },
  { to: '/admin/discovery-rules',   label: 'Discovery Rules',  Icon: SlidersIcon      },
  { to: '/admin/imports',           label: 'Imports',          Icon: ImportsIcon      },
  { to: '/admin/async-jobs',     label: 'Async Jobs',    Icon: LabsIcon      },
  { to: '/admin/usage',          label: 'API Usage',     Icon: PricingIcon   },
  { to: '/admin/seo-regen',      label: 'SEO Regen',     Icon: LabsIcon      },
  { to: '/admin/labs',           label: 'Labs',          Icon: LabsIcon      },
  { to: '/admin/emma-chat',      label: 'Emma Chat',    Icon: ChatBubbleIcon },
  { to: '/admin/pm-chat',        label: 'PM Chat',      Icon: ChatBubbleIcon },
  { to: '/admin/settings',       label: 'Settings',     Icon: SettingsIcon  },
]

export function AdminNav({ logoUrl, adminUser }: { logoUrl: string | null; adminUser: AdminUserInfo | null }) {
  const { pathname } = useLocation()
  const [pendingReviews, setPendingReviews] = useState<number | null>(null)
  const [newVoicemails, setNewVoicemails] = useState<number | null>(null)

  useEffect(() => {
    // Fetch pending count from API (60s cache via KV on server)
    fetch('/api/reviews/admin/pending-count')
      .then(r => r.json() as Promise<{ count: number }>)
      .then(data => setPendingReviews(data.count))
      .catch(() => {/* non-critical */})

    fetch('/api/admin/voicemails/new-count')
      .then(r => r.json() as Promise<{ count: number }>)
      .then(data => setNewVoicemails(data.count))
      .catch(() => {/* non-critical */})
  }, [pathname])

  // Build nav items — add Users link for owners
  const navItems = adminUser?.role === 'owner'
    ? [...NAV_ITEMS, { to: '/admin/users', label: 'Users', Icon: UsersIcon }]
    : NAV_ITEMS

  return (
    <aside className="w-56 bg-ink min-h-screen flex flex-col py-6 px-4 shrink-0">
      <Link to="/" className="block mb-8">
        {logoUrl ? (
          <img src={logoUrl} alt="xdipx" className="h-8 w-auto" />
        ) : (
          <span
            className="text-2xl font-black text-coral select-none"
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
        {navItems.map(({ to, label, Icon, badgeKey }) => {
          const active = pathname === to || (to !== '/admin' && pathname.startsWith(to))
          const badge  =
            badgeKey === 'reviews' && pendingReviews && pendingReviews > 0 ? pendingReviews :
            badgeKey === 'voicemails' && newVoicemails && newVoicemails > 0 ? newVoicemails :
            null
          return (
            <Link
              key={to}
              to={to}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                active
                  ? 'bg-coral text-white shadow-sm'
                  : 'text-white/60 hover:text-white hover:bg-white/10',
              ].join(' ')}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <Icon />
              {label}
              {badge != null && (
                <span className="ml-auto bg-coral text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="pt-4 border-t border-white/10">
        {adminUser && (
          <Link
            to="/admin/account"
            className="block px-3 py-2 mb-2 rounded-lg hover:bg-white/5 transition-colors"
          >
            <p className="text-white/80 text-sm font-medium truncate">{adminUser.name}</p>
            <p className="text-white/40 text-xs truncate">{adminUser.email}</p>
          </Link>
        )}
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
