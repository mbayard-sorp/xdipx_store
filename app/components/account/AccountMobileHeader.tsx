import { Link, useLocation } from 'react-router'
import type { CustomerProfile } from '~/lib/shopify.server'

interface AccountMobileHeaderProps {
  customer: CustomerProfile
}

interface SectionInfo {
  title: string
  isDashboard: boolean
}

function getSectionInfo(pathname: string, firstName: string): SectionInfo {
  // Normalize trailing slash.
  const path = pathname.replace(/\/+$/, '') || '/'

  if (path === '/account') {
    return {
      title: `Hi, ${firstName || 'friend'} \u2665`,
      isDashboard: true,
    }
  }

  // Orders.
  if (path === '/account/orders') {
    return { title: 'Orders', isDashboard: false }
  }
  if (path.startsWith('/account/orders/')) {
    return { title: 'Order detail', isDashboard: false }
  }

  // Addresses.
  if (path === '/account/addresses') {
    return { title: 'Addresses', isDashboard: false }
  }
  if (path === '/account/addresses/new') {
    return { title: 'New address', isDashboard: false }
  }
  if (/^\/account\/addresses\/[^/]+\/edit$/.test(path)) {
    return { title: 'Edit address', isDashboard: false }
  }

  // Subscriptions.
  if (path === '/account/subscriptions') {
    return { title: 'Subscriptions', isDashboard: false }
  }
  if (path.startsWith('/account/subscriptions/')) {
    return { title: 'Subscription', isDashboard: false }
  }

  // Profile / preferences.
  if (path === '/account/profile') {
    return { title: 'Profile', isDashboard: false }
  }
  if (path === '/account/preferences') {
    return { title: 'Preferences', isDashboard: false }
  }

  // Fallback.
  return { title: 'Account', isDashboard: false }
}

export function AccountMobileHeader({ customer }: AccountMobileHeaderProps) {
  const { pathname } = useLocation()
  const section = getSectionInfo(pathname, customer.firstName || '')
  const initial =
    (customer.firstName?.trim().charAt(0) || 'X').toUpperCase()

  const isProfilePage = pathname.replace(/\/+$/, '') === '/account/profile'

  return (
    <div className="lg:hidden sticky top-14 z-50 bg-brand-cream/95 backdrop-blur-sm border-b border-brand-mist h-12 flex items-center px-4 gap-3">
      {/* Left: avatar OR back arrow */}
      {section.isDashboard ? (
        <div
          className="w-8 h-8 rounded-full bg-brand-gradient text-white flex items-center justify-center text-sm font-bold shrink-0"
          style={{ fontFamily: 'var(--font-display)' }}
          aria-hidden="true"
        >
          {initial}
        </div>
      ) : (
        <Link
          to="/account"
          aria-label="Back to account"
          className="w-8 h-8 -ml-1 flex items-center justify-center text-brand-charcoal/70 hover:text-brand-charcoal rounded-full"
        >
          <BackIcon />
        </Link>
      )}

      {/* Center: title */}
      <p
        className="flex-1 text-sm font-bold text-brand-charcoal truncate"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {section.title}
      </p>

      {/* Right: gear (hidden on profile page itself) */}
      {!isProfilePage && (
        <Link
          to="/account/profile"
          aria-label="Profile settings"
          className="w-8 h-8 flex items-center justify-center text-brand-charcoal/60 hover:text-brand-charcoal rounded-full shrink-0"
        >
          <GearIcon />
        </Link>
      )}
    </div>
  )
}

function BackIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
