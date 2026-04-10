import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useLoaderData, useOutletContext } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { OrderCard } from '~/components/account/OrderCard'
import { EmptyState } from '~/components/account/EmptyState'
import type { AccountOutletContext } from './_layout.account'

export const meta: MetaFunction = () => [{ title: 'Orders — xdipx' }]

type StatusFilter = 'all' | 'processing' | 'shipped' | 'delivered' | 'returned'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all',        label: 'All'        },
  { value: 'processing', label: 'Processing' },
  { value: 'shipped',    label: 'Shipped'    },
  { value: 'delivered',  label: 'Delivered'  },
  { value: 'returned',   label: 'Returned'   },
]

function isStatusFilter(v: string | null): v is StatusFilter {
  return (
    v === 'all' ||
    v === 'processing' ||
    v === 'shipped' ||
    v === 'delivered' ||
    v === 'returned'
  )
}

function statusToQueryClause(status: StatusFilter): string | null {
  switch (status) {
    case 'processing': return 'fulfillment_status:unfulfilled'
    case 'shipped':    return 'fulfillment_status:shipped OR fulfillment_status:in_transit'
    case 'delivered':  return 'fulfillment_status:delivered'
    case 'returned':   return 'financial_status:refunded'
    default:           return null
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })

  const url = new URL(request.url)
  const after = url.searchParams.get('after')
  const q = (url.searchParams.get('q') ?? '').trim()
  const rawStatus = url.searchParams.get('status')
  const status: StatusFilter = isStatusFilter(rawStatus) ? rawStatus : 'all'

  // Build the Shopify order search query. Shopify's customer.orders query
  // string supports `name:<#>` for order-number search and `fulfillment_status:*`
  // / `financial_status:*` for status filtering. Clauses AND together when
  // space-separated.
  const clauses: string[] = []
  if (q) {
    const num = q.replace(/^#/, '')
    clauses.push(`name:${num}`)
  }
  const statusClause = statusToQueryClause(status)
  if (statusClause) clauses.push(statusClause)
  const queryString = clauses.length ? clauses.join(' ') : undefined

  const { orders, pageInfo } = await api.getOrders({
    first: 10,
    after: after ?? null,
    // exactOptionalPropertyTypes: only include `query` when we have one.
    ...(queryString ? { query: queryString } : {}),
  })

  return {
    orders,
    pageInfo,
    filters: { q, status },
    tokenType,
  }
}

export default function OrdersList() {
  const { orders, pageInfo, filters, tokenType } = useLoaderData<typeof loader>()
  const { customer } = useOutletContext<AccountOutletContext>()

  const hasFilters = filters.q.length > 0 || filters.status !== 'all'
  const isAccountAPI = tokenType === 'account'

  // Shared param builder — q + status only, no cursor. Both the filter
  // pill links and the "Load next" cursor link build off this so they
  // never drift out of sync.
  const baseParams = (status: StatusFilter): URLSearchParams => {
    const params = new URLSearchParams()
    if (filters.q) params.set('q', filters.q)
    if (status !== 'all') params.set('status', status)
    return params
  }

  // Switching pills resets `after` (we always start a fresh page).
  const buildFilterHref = (status: StatusFilter): string => {
    const qs = baseParams(status).toString()
    return qs ? `/account/orders?${qs}` : '/account/orders'
  }

  const buildNextHref = (cursor: string): string => {
    const params = baseParams(filters.status)
    params.set('after', cursor)
    return `/account/orders?${params.toString()}`
  }

  return (
    <div className="space-y-6">
      {/* Desktop heading (mobile sub-header already shows "Orders") */}
      <section className="hidden lg:block">
        <h1
          className="text-2xl font-bold text-brand-charcoal"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Orders <span className="text-brand-purple">♥</span>
        </h1>
        <p className="text-sm text-brand-charcoal/50 mt-0.5">
          {customer.email}
        </p>
      </section>

      {/* Search */}
      <form method="get" action="/account/orders" className="relative">
        <label htmlFor="order-search" className="sr-only">
          Search orders by order number
        </label>
        <span
          className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-charcoal/30"
          aria-hidden="true"
        >
          <SearchIcon />
        </span>
        <input
          id="order-search"
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="Search order number"
          className="w-full border border-brand-mist rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/50 bg-white"
        />
        {/* Keep the active status filter across searches */}
        {filters.status !== 'all' && (
          <input type="hidden" name="status" value={filters.status} />
        )}
      </form>

      {/* Status filter pills */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4 lg:mx-0 lg:px-0">
        {STATUS_FILTERS.map((f) => {
          const active = filters.status === f.value
          return (
            <Link
              key={f.value}
              to={buildFilterHref(f.value)}
              className={`shrink-0 text-xs font-semibold px-4 py-2 rounded-full transition-colors ${
                active
                  ? 'bg-brand-gradient text-white'
                  : 'bg-brand-mist text-brand-charcoal/70 hover:bg-brand-mist/70'
              }`}
              style={active ? { fontFamily: 'var(--font-display)' } : undefined}
              aria-current={active ? 'page' : undefined}
            >
              {f.label}
            </Link>
          )
        })}
      </div>

      {/* Orders list / empty state */}
      {orders.length === 0 ? (
        hasFilters ? (
          <div className="bg-white border border-brand-mist rounded-2xl px-6 py-10 text-center space-y-3">
            <p
              className="text-base font-semibold text-brand-charcoal"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              No orders match your filters <span className="text-brand-purple">♥</span>
            </p>
            <p className="text-sm text-brand-charcoal/60">
              Try clearing them to see everything.
            </p>
            <Link
              to="/account/orders"
              className="inline-flex items-center justify-center mt-1 px-5 py-2.5 rounded-full text-sm font-semibold text-brand-charcoal bg-brand-mist hover:bg-brand-mist/70 transition-colors"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Clear filters
            </Link>
          </div>
        ) : (
          <EmptyState
            title="No orders yet ♥"
            description="Your order history will show up here once you make your first purchase."
            cta={{ label: "Browse today's deal ♥", to: '/' }}
          />
        )
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <OrderCard order={order} />
            </li>
          ))}
        </ul>
      )}

      {/* Pagination — cursor only, hidden on Shop OAuth (single-page) */}
      {pageInfo.hasNextPage && pageInfo.endCursor && (
        <div className="flex justify-center pt-2">
          <Link
            to={buildNextHref(pageInfo.endCursor)}
            className="px-5 py-2.5 rounded-full text-sm font-semibold text-brand-charcoal bg-white border border-brand-mist hover:bg-brand-mist/40 transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Load next &rarr;
          </Link>
        </div>
      )}

      {/* Shop OAuth hint (Customer Account API returns a single page) */}
      {isAccountAPI && orders.length > 0 && (
        <p className="text-[11px] text-brand-charcoal/40 text-center pt-1">
          Showing recent orders only. Sign in with email for full history.
        </p>
      )}
    </div>
  )
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
