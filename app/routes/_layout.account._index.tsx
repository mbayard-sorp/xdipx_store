import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { getStorefrontCustomer } from '~/lib/shopify.server'
import { getAccountCustomer } from '~/lib/customer-oauth.server'
import type { StorefrontCustomer, StorefrontOrder } from '~/lib/shopify.server'
import type { AccountCustomer, AccountOrder } from '~/lib/customer-oauth.server'

export const meta: MetaFunction = () => [{ title: 'My Account — xdipx' }]

export async function loader({ request }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)

  let customer: (StorefrontCustomer | AccountCustomer) | null = null

  if (tokenType === 'storefront') {
    customer = await getStorefrontCustomer(token)
  } else {
    customer = await getAccountCustomer(token)
  }

  if (!customer) {
    // Token may have expired — boot back to login
    throw new Response(null, { status: 302, headers: { Location: '/account/login' } })
  }

  return { customer }
}

export default function AccountPage() {
  const { customer } = useLoaderData<typeof loader>()

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold text-brand-charcoal"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Hi, {customer.firstName || customer.email} ♥
          </h1>
          <p className="text-sm text-brand-charcoal/50 mt-0.5">{customer.email}</p>
        </div>
        <Link
          to="/account/logout"
          className="text-sm text-brand-charcoal/40 hover:text-brand-charcoal transition-colors"
        >
          Sign out
        </Link>
      </div>

      {/* Orders */}
      <section>
        <h2
          className="text-base font-bold text-brand-charcoal mb-4"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Your Orders
        </h2>

        {customer.orders.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
            <p className="text-brand-charcoal/40 text-sm">No orders yet.</p>
            <Link
              to="/"
              className="mt-4 inline-block text-sm font-semibold text-brand-purple hover:underline"
            >
              Check today's deal →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {customer.orders.map(order => (
              <OrderRow key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function OrderRow({ order }: { order: StorefrontOrder | AccountOrder }) {
  const date = new Date(order.processedAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  const orderNum = 'orderNumber' in order ? order.orderNumber : order.number
  const total    = order.totalPrice

  const financial   = order.financialStatus?.toLowerCase()
  const fulfillment = order.fulfillmentStatus?.toLowerCase()

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-brand-charcoal">
            Order #{orderNum}
          </p>
          <p className="text-xs text-brand-charcoal/50 mt-0.5">{date}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-brand-charcoal">
            {total.currencyCode} ${parseFloat(total.amount).toFixed(2)}
          </p>
          <div className="flex gap-1.5 mt-1 justify-end flex-wrap">
            <StatusBadge value={financial} type="financial" />
            <StatusBadge value={fulfillment} type="fulfillment" />
          </div>
        </div>
      </div>

      {/* Line items */}
      {order.lineItems.length > 0 && (
        <ul className="border-t border-brand-mist pt-3 space-y-1">
          {order.lineItems.map((li, i) => (
            <li key={i} className="flex items-center gap-3 text-sm text-brand-charcoal/70">
              {'imageUrl' in li && li.imageUrl && (
                <img
                  src={li.imageUrl}
                  alt={li.title}
                  className="w-8 h-8 rounded-lg object-cover bg-brand-mist shrink-0"
                />
              )}
              <span className="flex-1 truncate">{li.title}</span>
              <span className="text-xs text-brand-charcoal/40 shrink-0">×{li.quantity}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatusBadge({ value, type }: { value: string; type: 'financial' | 'fulfillment' }) {
  const colorMap: Record<string, string> = {
    paid:       'bg-green-100 text-green-700',
    refunded:   'bg-red-100 text-red-700',
    pending:    'bg-yellow-100 text-yellow-700',
    fulfilled:  'bg-blue-100 text-blue-700',
    unfulfilled: 'bg-gray-100 text-gray-500',
    shipped:    'bg-blue-100 text-blue-700',
  }
  const label = value.replace(/_/g, ' ')
  const color = colorMap[value] ?? 'bg-gray-100 text-gray-500'

  if (type === 'fulfillment' && value === 'unfulfilled') return null

  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${color}`}>
      {label}
    </span>
  )
}
