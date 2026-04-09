import type { ReactNode } from 'react'
import { NavLink, Link } from 'react-router'
import type { CustomerProfile } from '~/lib/shopify.server'

interface AccountSidebarProps {
  customer: CustomerProfile
}

interface NavItem {
  to: string
  label: string
  end?: boolean
  count?: number
}

export function AccountSidebar({ customer }: AccountSidebarProps) {
  const initial =
    (customer.firstName?.trim().charAt(0) || 'X').toUpperCase()

  const items: NavItem[] = [
    { to: '/account',               label: 'Overview',      end: true },
    { to: '/account/orders',        label: 'Orders',        count: customer.orders.length },
    { to: '/account/subscriptions', label: 'Subscriptions' },
    { to: '/account/addresses',     label: 'Addresses',     count: customer.addresses.length },
    { to: '/account/profile',       label: 'Profile' },
    { to: '/account/preferences',   label: 'Preferences' },
  ]

  return (
    <aside className="hidden lg:flex flex-col w-[260px] shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] border-r border-brand-mist bg-brand-cream px-5 py-8">
      {/* Profile block */}
      <div className="flex items-center gap-3">
        <div
          className="w-11 h-11 rounded-full bg-brand-gradient text-white flex items-center justify-center font-bold text-lg shrink-0"
          style={{ fontFamily: 'var(--font-display)' }}
          aria-hidden="true"
        >
          {initial}
        </div>
        <div className="min-w-0">
          <p
            className="text-sm font-bold text-brand-charcoal truncate"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Hi, {customer.firstName || 'friend'} <span className="text-brand-purple">♥</span>
          </p>
          <p className="text-xs text-brand-charcoal/50 truncate">{customer.email}</p>
        </div>
      </div>

      {/* Section label */}
      <p className="mt-8 mb-2 text-[10px] font-semibold uppercase tracking-widest text-brand-charcoal/40">
        Account
      </p>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5">
        {items.map((item) => (
          <NavItemLink key={item.to} item={item} />
        ))}
      </nav>

      {/* Bottom — sign out */}
      <div className="mt-auto pt-6 border-t border-brand-mist">
        <Link
          to="/account/logout"
          className="flex items-center gap-2 text-sm text-brand-charcoal/50 hover:text-brand-charcoal transition-colors min-h-[44px] px-3 rounded-xl hover:bg-brand-mist/40"
        >
          <LogoutIcon />
          <span>Sign out</span>
        </Link>
      </div>
    </aside>
  )
}

function NavItemLink({ item }: { item: NavItem }): ReactNode {
  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      className={({ isActive }) =>
        `relative flex items-center justify-between gap-3 px-3 py-2.5 min-h-[44px] rounded-xl transition-colors ${
          isActive
            ? 'bg-brand-mist/60 text-brand-charcoal font-semibold'
            : 'text-brand-charcoal/60 hover:bg-brand-mist/40 hover:text-brand-charcoal'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-brand-coral"
              aria-hidden="true"
            />
          )}
          <span>{item.label}</span>
          {typeof item.count === 'number' && item.count > 0 && (
            <span className="text-[11px] font-semibold text-brand-charcoal/40 tabular-nums">
              {item.count}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

function LogoutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}
