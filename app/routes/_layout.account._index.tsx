import { useEffect } from 'react'
import type { MetaFunction } from 'react-router'
import { Link, useOutletContext, useSearchParams } from 'react-router'
import type { StorefrontOrder } from '~/lib/shopify.server'
import type { AccountOutletContext } from './_layout.account'
import { trackLogin, trackSignUp } from '~/lib/analytics.client'
import { DashboardTile } from '~/components/account/DashboardTile'
import { ProfileCompletion } from '~/components/account/ProfileCompletion'
import { StatusPill } from '~/components/account/StatusPill'
import { EmptyState } from '~/components/account/EmptyState'
import { MergeLocalHearts } from '~/components/store/MergeLocalHearts'
import { useSession } from '~/lib/session-context'

export const meta: MetaFunction = () => [{ title: 'Account — xdipx' }]

export default function AccountDashboard() {
  const { customer } = useOutletContext<AccountOutletContext>()
  const { wishlistCount } = useSession()
  const recentOrder = customer.orders[0] ?? null
  const [searchParams, setSearchParams] = useSearchParams()

  // GA4: fire login/sign_up event after redirect from auth
  useEffect(() => {
    const from = searchParams.get('from')
    if (from === 'login') {
      trackLogin('email')
      setSearchParams(prev => { prev.delete('from'); return prev }, { replace: true })
    } else if (from === 'register') {
      trackSignUp('email')
      setSearchParams(prev => { prev.delete('from'); return prev }, { replace: true })
    } else if (from === 'google') {
      trackLogin('google')
      setSearchParams(prev => { prev.delete('from'); return prev }, { replace: true })
    } else if (from === 'facebook') {
      trackLogin('facebook')
      setSearchParams(prev => { prev.delete('from'); return prev }, { replace: true })
    } else if (from === 'shop') {
      trackLogin('shop')
      setSearchParams(prev => { prev.delete('from'); return prev }, { replace: true })
    }
  }, [])

  return (
    <div className="space-y-6">
      <MergeLocalHearts />
      {/* Desktop greeting (mobile header already shows this) */}
      <section className="hidden lg:block">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Hi, {customer.firstName || 'friend'} <span className="text-sage">♥</span>
        </h1>
        <p className="text-sm text-ink/50 mt-0.5">{customer.email}</p>
      </section>

      {/* Profile completion (renders null when nothing is pending) */}
      <ProfileCompletion customer={customer} />

      {/* Tile grid */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <DashboardTile
          label="Orders"
          value={customer.orders.length}
          to="/account/orders"
        />
        <DashboardTile
          label="Wishlists"
          value={wishlistCount}
          to="/account/wishlists"
        />
        <DashboardTile
          label="Addresses"
          value={customer.addresses.length}
          to="/account/addresses"
        />
        <DashboardTile
          label="Profile"
          value="Edit"
          to="/account/profile"
        />
        <DashboardTile
          label="Preferences"
          value="Set up"
          to="/account/preferences"
          accent="setup"
        />
      </section>

      {/* Most recent order OR empty state */}
      {recentOrder ? (
        <section>
          <h2
            className="text-base font-bold text-ink mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Most recent order
          </h2>
          <RecentOrderCard order={recentOrder} />
        </section>
      ) : (
        <EmptyState
          title="No orders yet ♥"
          description="Your next favorite thing is one tap away."
          cta={{ label: "See today's deal ♥", to: '/' }}
        />
      )}

      {/* Klaviyo nudge — only when marketing is OFF */}
      {!customer.acceptsMarketing && (
        <section className="bg-cream-2 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p
              className="text-sm font-bold text-ink"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Want tomorrow's deal in your inbox?
            </p>
            <p className="text-xs text-ink/60 mt-1">
              One email a day, midnight sharp. No spam, just flings.
            </p>
          </div>
          <Link
            to="/account/preferences"
            className="shrink-0 inline-flex items-center justify-center px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-coral hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Dip me in ♥
          </Link>
        </section>
      )}
    </div>
  )
}

function RecentOrderCard({ order }: { order: StorefrontOrder }) {
  const date = new Date(order.processedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  const { financialStatus, fulfillmentStatus, totalPrice, lineItems } = order
  const firstItem = lineItems[0]
  const moreCount = lineItems.length > 1 ? lineItems.length - 1 : 0
  const lineItemSummary = firstItem
    ? moreCount > 0
      ? `${firstItem.title} + ${moreCount} more`
      : firstItem.title
    : 'No items'

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            Order #{order.orderNumber}{' '}
            <span className="text-ink/40">· {date}</span>
          </p>
          <p className="text-xs text-ink/60 mt-1 truncate">
            {lineItemSummary}
          </p>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            <StatusPill value={financialStatus} kind="financial" />
            <StatusPill value={fulfillmentStatus} kind="fulfillment" />
          </div>
        </div>
        <p className="text-sm font-bold text-ink whitespace-nowrap">
          ${parseFloat(totalPrice.amount).toFixed(2)}
        </p>
      </div>
      <div className="pt-3 border-t border-cream-2">
        <Link
          to={`/account/orders/${encodeURIComponent(order.id)}`}
          className="text-sm font-semibold text-sage hover:text-sun transition-colors"
        >
          View order &rarr;
        </Link>
      </div>
    </div>
  )
}
