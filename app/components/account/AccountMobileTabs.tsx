import { NavLink } from 'react-router'
import type { CustomerProfile } from '~/lib/shopify.server'

interface AccountMobileTabsProps {
  customer: CustomerProfile
}

interface TabItem {
  to: string
  label: string
  end?: boolean
  count?: number
}

/**
 * Quick-tab strip for jumping between account sections on mobile + tablet.
 * Mirrors the desktop AccountSidebar items but laid out as a horizontally
 * scrollable pill row. Hidden on lg+ where the full sidebar takes over.
 *
 * Sticks just below the AccountMobileHeader so it stays reachable while
 * scrolling a long account page.
 */
export function AccountMobileTabs({ customer }: AccountMobileTabsProps) {
  const items: TabItem[] = [
    { to: '/account',               label: 'Overview',      end: true },
    { to: '/account/profile',       label: 'Profile' },
    { to: '/account/wishlists',     label: 'Wishlists' },
    { to: '/account/orders',        label: 'Orders',        count: customer.orders.length },
    { to: '/account/subscriptions', label: 'Subscriptions' },
    { to: '/account/returns',       label: 'Returns' },
    { to: '/account/addresses',     label: 'Addresses',     count: customer.addresses.length },
    { to: '/account/preferences',   label: 'Preferences' },
  ]

  return (
    <div
      className="lg:hidden sticky top-[6.5rem] z-[58] border-b border-cream-2 bg-cream/95 backdrop-blur-sm"
      role="navigation"
      aria-label="Account sections"
    >
      <div
        className="flex items-center gap-2 overflow-x-auto px-4 py-2.5"
        style={{ scrollbarWidth: 'none' }}
      >
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end ?? false}
            className={({ isActive }) =>
              `shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors min-h-[36px] ${
                isActive
                  ? 'bg-ink text-cream'
                  : 'bg-cream-2 text-ink/70 hover:text-ink active:scale-[0.98]'
              }`
            }
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <span>{item.label}</span>
            {typeof item.count === 'number' && item.count > 0 && (
              <span className="text-[11px] font-semibold opacity-70 tabular-nums">
                {item.count}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  )
}
