import { Link, useLocation } from 'react-router'

interface Tab {
  href:  string
  label: string
  match: (path: string) => boolean
  icon:  React.ReactNode
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12l9-9 9 9" /><path d="M5 10v11h14V10" />
    </svg>
  )
}
function ShopIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  )
}
function PicksIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2" />
    </svg>
  )
}
function SavedIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.6z" />
    </svg>
  )
}
function YouIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  )
}

const TABS: Tab[] = [
  { href: '/',             label: 'Home',  icon: <HomeIcon  />, match: p => p === '/' },
  { href: '/collections',  label: 'Shop',  icon: <ShopIcon  />, match: p => p.startsWith('/collections') || p === '/for-him' || p === '/for-her' },
  { href: '/picks',        label: 'Picks', icon: <PicksIcon />, match: p => p.startsWith('/picks') || p.startsWith('/products') },
  { href: '/account/wishlist', label: 'Saved', icon: <SavedIcon />, match: p => p.startsWith('/account/wishlist') || p.startsWith('/lists') },
  { href: '/account',      label: 'You',   icon: <YouIcon   />, match: p => p.startsWith('/account') && !p.startsWith('/account/wishlist') },
]

export function MobileTabBar() {
  const { pathname } = useLocation()

  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-[55] bg-paper/95 backdrop-blur border-t border-line shadow-[0_-1px_0_rgba(0,0,0,0.02)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-5">
        {TABS.map(tab => {
          const active = tab.match(pathname)
          return (
            <li key={tab.label} className="flex">
              <Link
                to={tab.href}
                className={[
                  'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] tracking-wide',
                  active ? 'text-coral' : 'text-ink/70',
                ].join(' ')}
                style={{ fontFamily: 'var(--font-display)' }}
                aria-current={active ? 'page' : undefined}
              >
                <span className={active ? 'text-coral' : 'text-ink/80'}>{tab.icon}</span>
                <span className="font-semibold">{tab.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
