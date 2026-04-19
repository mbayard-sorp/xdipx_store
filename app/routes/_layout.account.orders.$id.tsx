import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useFetcher, useLoaderData, useOutletContext, redirect } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { StatusPill } from '~/components/account/StatusPill'
import { OrderTrackingStepper } from '~/components/account/OrderTrackingStepper'
import { addLinesToCart, createCart, getCart } from '~/lib/shopify.server'
import { getCartIdFromCookie, setCartCookie } from '~/lib/cart.server'
import type { OrderDetail } from '~/lib/shopify.server'
import { isOrderWithinReturnWindow } from '~/lib/returns.server'
import type { AccountOutletContext } from './_layout.account'

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Order — xdipx' }]
  return [{ title: `Order #${data.order.orderNumber} — xdipx` }]
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })

  const rawId = params['id']
  if (!rawId) {
    throw new Response('Order not found', { status: 404 })
  }
  const orderId = decodeURIComponent(rawId)

  const order = await api.getOrder(orderId)

  if (!order) {
    // Customer Account API branch always returns null (not yet supported);
    // route to a friendly 404 that the root error boundary will handle.
    throw new Response('Order not found', { status: 404 })
  }

  const fulfilled = order.fulfillmentStatus?.toLowerCase() === 'fulfilled'
  const notCanceled = !order.canceledAt
  const withinWindow = isOrderWithinReturnWindow(null, order.processedAt)
  const returnEligible = fulfilled && notCanceled && withinWindow

  return { order, tokenType, returnEligible }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })

  const rawId = params['id']
  if (!rawId) return { error: 'Order not found' }
  const order = await api.getOrder(decodeURIComponent(rawId))
  if (!order) return { error: 'Order not found' }

  const lines = order.lineItems
    .filter(li => li.variantId)
    .map(li => ({ variantId: li.variantId as string, quantity: li.quantity }))

  if (lines.length === 0) {
    return { error: 'No items from this order are available to reorder.' }
  }

  const headers = new Headers()
  let cartId = getCartIdFromCookie(request)

  const tryAdd = async (id: string) => addLinesToCart(id, lines)

  let cart
  try {
    if (!cartId) {
      const fresh = await createCart()
      cartId = fresh.id
      headers.set('Set-Cookie', setCartCookie(cartId))
    }
    cart = await tryAdd(cartId)
  } catch {
    try {
      const fresh = await createCart()
      cartId = fresh.id
      headers.set('Set-Cookie', setCartCookie(cartId))
      cart = await tryAdd(cartId)
    } catch {
      return { error: 'Some items are no longer available. Please add them manually.' }
    }
  }

  const checkoutUrl = cart?.checkoutUrl ?? (await getCart(cartId))?.checkoutUrl
  if (!checkoutUrl) return { error: 'Could not start checkout. Please try again.' }

  return redirect(checkoutUrl, { headers })
}

export default function OrderDetailRoute() {
  const { order, returnEligible } = useLoaderData<typeof loader>()
  useOutletContext<AccountOutletContext>() // ensure type contract holds
  const reorderFetcher = useFetcher<typeof action>()
  const reordering = reorderFetcher.state !== 'idle'
  const reorderError =
    reorderFetcher.data && 'error' in reorderFetcher.data ? reorderFetcher.data.error : null

  const processedDate = new Date(order.processedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const canceled = Boolean(order.canceledAt)
  const canceledDate = order.canceledAt
    ? new Date(order.canceledAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  return (
    <div className="space-y-6">
      {/* Desktop heading — mobile sub-header already shows "Order detail" */}
      <section className="hidden lg:block">
        <h1
          className="text-2xl font-bold text-brand-charcoal"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Order #{order.orderNumber}{' '}
          <span className="text-brand-purple">♥</span>
        </h1>
        <p className="text-sm text-brand-charcoal/50 mt-0.5">
          Placed {processedDate}
        </p>
      </section>

      {/* Top summary card */}
      <section className="bg-white border border-brand-mist rounded-2xl p-4 md:p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p
              className="text-sm font-bold text-brand-charcoal lg:hidden"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Order #{order.orderNumber}
            </p>
            <p className="text-xs text-brand-charcoal/60 mt-0.5">
              Placed {processedDate}
            </p>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <StatusPill value={order.financialStatus} kind="financial" />
              <StatusPill value={order.fulfillmentStatus} kind="fulfillment" />
            </div>
          </div>
          <p className="text-lg font-bold text-brand-charcoal tabular-nums shrink-0">
            ${parseFloat(order.totalPrice.amount).toFixed(2)}{' '}
            <span className="text-[11px] font-normal text-brand-charcoal/40">
              {order.totalPrice.currencyCode}
            </span>
          </p>
        </div>
      </section>

      {/* Canceled notice OR tracking stepper */}
      {canceled ? (
        <section className="border-2 border-red-300 bg-red-50/60 rounded-2xl p-4 md:p-5">
          <p
            className="text-sm font-bold text-red-700"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Order canceled on {canceledDate}
          </p>
          <p className="text-xs text-red-600/80 mt-1">
            Reason: {order.cancelReason ?? 'Not specified'}
          </p>
        </section>
      ) : (
        <section>
          <SectionHeading>Tracking</SectionHeading>
          <OrderTrackingStepper
            financialStatus={order.financialStatus}
            fulfillmentStatus={order.fulfillmentStatus}
            fulfillments={order.successfulFulfillments}
            statusUrl={order.statusUrl}
          />
        </section>
      )}

      {/* Line items */}
      <section>
        <SectionHeading>Items</SectionHeading>
        <ul className="bg-white border border-brand-mist rounded-2xl divide-y divide-brand-mist overflow-hidden">
          {order.lineItems.map((li, i) => (
            <li key={`${li.title}-${i}`} className="flex items-start gap-3 p-4">
              {li.imageUrl ? (
                <img
                  src={li.imageUrl}
                  alt={li.title}
                  loading="lazy"
                  className="w-12 h-12 rounded-xl object-cover border border-brand-mist shrink-0"
                />
              ) : (
                <div
                  className="w-12 h-12 rounded-xl bg-brand-mist shrink-0"
                  aria-hidden="true"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-brand-charcoal truncate">
                  {li.title}
                </p>
                {li.variantTitle && li.variantTitle !== 'Default Title' && (
                  <p className="text-xs text-brand-charcoal/50 mt-0.5 truncate">
                    {li.variantTitle}
                  </p>
                )}
                <p className="text-xs text-brand-charcoal/60 mt-1">
                  &times; {li.quantity}
                </p>
              </div>
              {li.unitPrice && (
                <p className="text-sm font-semibold text-brand-charcoal tabular-nums shrink-0">
                  ${parseFloat(li.unitPrice.amount).toFixed(2)}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Payment summary */}
      <section>
        <SectionHeading>Summary</SectionHeading>
        <div className="bg-white border border-brand-mist rounded-2xl p-4 md:p-5 space-y-2 text-sm">
          <SummaryRow label="Subtotal" amount={order.subtotalPrice} />
          <SummaryRow label="Shipping" amount={order.totalShippingPrice} />
          <SummaryRow label="Tax" amount={order.totalTax} />
          <div className="pt-2 border-t border-brand-mist flex items-center justify-between">
            <span
              className="text-sm font-bold text-brand-charcoal"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Total
            </span>
            <span className="text-sm font-bold text-brand-charcoal tabular-nums">
              ${parseFloat(order.totalPrice.amount).toFixed(2)}{' '}
              <span className="text-[11px] font-normal text-brand-charcoal/40">
                {order.totalPrice.currencyCode}
              </span>
            </span>
          </div>
        </div>
      </section>

      {/* Shipping address */}
      {order.shippingAddress && order.shippingAddress.formatted.length > 0 && (
        <section>
          <SectionHeading>Shipping to</SectionHeading>
          <address className="bg-white border border-brand-mist rounded-2xl p-4 md:p-5 not-italic text-sm text-brand-charcoal/80 space-y-0.5">
            {order.shippingAddress.formatted.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </address>
        </section>
      )}

      {/* Action buttons */}
      <section className="space-y-2 pt-2">
        {reorderError && (
          <p className="text-xs text-red-600 text-center">{reorderError}</p>
        )}
        <div className="flex flex-col sm:flex-row gap-3">
          <reorderFetcher.Form method="post" className="flex-1">
            <button
              type="submit"
              disabled={reordering}
              className="w-full text-center px-5 py-3 rounded-full text-sm font-semibold text-white bg-brand-gradient hover:opacity-90 transition-opacity disabled:opacity-60"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {reordering ? 'Adding to cart…' : <>Reorder <span aria-hidden="true">♥</span></>}
            </button>
          </reorderFetcher.Form>
          {returnEligible && (
            <Link
              to={`/account/returns/new?orderId=${encodeURIComponent(order.id)}`}
              className="flex-1 text-center px-5 py-3 rounded-full text-sm font-semibold text-brand-charcoal border border-brand-mist bg-white hover:bg-brand-mist/40 transition-colors"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Start a return
            </Link>
          )}
          <a
            href="mailto:hello@xdipx.com"
            className="flex-1 text-center px-5 py-3 rounded-full text-sm font-semibold text-brand-charcoal border border-brand-mist bg-white hover:bg-brand-mist/40 transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Need help?
          </a>
        </div>
      </section>

      {/* Reassurance strip */}
      <p className="text-[11px] text-brand-charcoal/50 text-center pt-1">
        <span aria-hidden="true">♥</span> Shipped in plain packaging. Discreet billing.
      </p>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-sm font-bold text-brand-charcoal mb-2"
      style={{ fontFamily: 'var(--font-display)' }}
    >
      {children}
    </h2>
  )
}

function SummaryRow({
  label,
  amount,
}: {
  label: string
  amount: OrderDetail['subtotalPrice']
}) {
  if (!amount) return null
  return (
    <div className="flex items-center justify-between">
      <span className="text-brand-charcoal/60">{label}</span>
      <span className="text-brand-charcoal tabular-nums">
        ${parseFloat(amount.amount).toFixed(2)}
      </span>
    </div>
  )
}
