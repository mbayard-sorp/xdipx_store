import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, Form, redirect, useActionData, useLoaderData, useNavigation } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { getReturnableFulfillments, type ReturnReasonCode, type ReturnableLineItem } from '~/lib/shopify.server'
import {
  createCustomerReturn,
  estimateLabelCostCents,
  isOrderWithinReturnWindow,
} from '~/lib/returns.server'
import { verifyAddress } from '~/lib/easypost.server'

export const meta: MetaFunction = () => [{ title: 'Start a return — xdipx' }, { name: 'robots', content: 'noindex, nofollow' }]

const REASONS: { code: ReturnReasonCode; label: string }[] = [
  { code: 'DEFECTIVE',        label: 'Defective / damaged' },
  { code: 'WRONG_ITEM',       label: 'Wrong item received' },
  { code: 'NOT_AS_DESCRIBED', label: 'Not as described' },
  { code: 'UNWANTED',         label: "Didn't end up wanting it" },
  { code: 'SIZE_TOO_LARGE',   label: 'Too large' },
  { code: 'SIZE_TOO_SMALL',   label: 'Too small' },
  { code: 'OTHER',            label: 'Other' },
]

export async function loader({ request }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const url = new URL(request.url)
  const rawOrderId = url.searchParams.get('orderId')
  if (!rawOrderId) throw redirect('/account/orders')
  // Customer Account API appends ?key=<token> to order GIDs; strip it before
  // calling Admin API, which rejects query-string suffixes on IDs.
  const orderId = rawOrderId.split('?')[0] ?? rawOrderId

  const api = customerAPI({ token, tokenType })
  console.log('[returns-new] loader', { rawOrderId, orderId, tokenType })
  let customer, order
  try {
    ;[customer, order] = await Promise.all([
      api.getProfile(),
      api.getOrder(rawOrderId),
    ])
  } catch (err) {
    console.error('[returns-new] profile/getOrder failed', err)
    throw err
  }
  if (!customer) throw redirect('/account/login')
  if (!order) throw new Response('Order not found', { status: 404 })

  const withinWindow = isOrderWithinReturnWindow(null, order.processedAt)
  console.log('[returns-new] withinWindow', { withinWindow, processedAt: order.processedAt })

  let returnables: Awaited<ReturnType<typeof getReturnableFulfillments>> = []
  if (withinWindow) {
    try {
      returnables = await getReturnableFulfillments(orderId)
    } catch (err) {
      console.error('[returns-new] getReturnableFulfillments failed', err)
      throw err
    }
  }

  return {
    customerId: customer.id,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      currencyCode: order.totalPrice.currencyCode,
    },
    returnables,
    withinWindow,
  }
}

interface ActionData {
  error?: string
}

export async function action({ request }: ActionFunctionArgs): Promise<Response | ActionData> {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })
  const customer = await api.getProfile()
  if (!customer) throw redirect('/account/login')

  const form = await request.formData()
  const rawOrderIdInput = String(form.get('orderId') || '')
  const orderId = rawOrderIdInput.split('?')[0] ?? rawOrderIdInput
  const currencyCode = String(form.get('currencyCode') || 'USD')
  const hygieneAttested = form.get('hygieneAttested') === 'on'
  const labelCostAcknowledged = form.get('labelCostAck') === 'on'

  // Re-fetch the order to get the shipping address (used as label "from").
  const order = await api.getOrder(rawOrderIdInput)
  if (!order) return { error: 'Order not found.' }
  const addr = order.shippingAddress
  if (!addr || !addr.address1 || !addr.city || !addr.provinceCode || !addr.zip) {
    return { error: 'No shipping address on file for this order. Email hello@xdipx.com and we\'ll help.' }
  }
  const fromAddress = {
    name: [addr.firstName, addr.lastName].filter(Boolean).join(' ') || customer.email,
    ...(addr.company ? { company: addr.company } : {}),
    street1: addr.address1,
    ...(addr.address2 ? { street2: addr.address2 } : {}),
    city:    addr.city,
    state:   addr.provinceCode,
    zip:     addr.zip,
    country: addr.countryCodeV2 ?? 'US',
    ...(addr.phone ? { phone: addr.phone } : {}),
    ...(customer.email ? { email: customer.email } : {}),
  }

  // Verify deliverability BEFORE creating the Shopify return so address
  // failures don't leave orphan RMAs.
  const verified = await verifyAddress(fromAddress)
  if (!verified.ok) {
    if (verified.code === 'undeliverable') {
      return {
        error:
          "We couldn't generate a return label for the shipping address on this order. " +
          'USPS needs a residential or business street address where carriers deliver — ' +
          "stadiums, event venues, and unverified PO boxes don't work. " +
          'Email hello@xdipx.com with a deliverable address and your order number and we\'ll start the return for you.',
      }
    }
    if (verified.code === 'incomplete') {
      return {
        error:
          'The shipping address on this order is missing information we need for a return label. ' +
          'Email hello@xdipx.com with a complete street address, city, state, and ZIP and we\'ll help.',
      }
    }
    return {
      error:
        "We couldn't verify the shipping address with our label service. " +
        'Email hello@xdipx.com and we\'ll start the return for you.',
    }
  }

  if (!hygieneAttested) return { error: 'Please confirm items are unopened and in original packaging.' }
  if (!labelCostAcknowledged) return { error: 'Please acknowledge the return shipping deduction.' }

  // Parse selected line items. Inputs are named `qty__<fulfillmentLineItemId>`
  // and `reason__<fulfillmentLineItemId>`. We also persist orderLineItemId
  // and unit price via hidden inputs.
  const selections: Parameters<typeof createCustomerReturn>[0]['selections'] = []

  for (const [key, rawValue] of form.entries()) {
    if (!key.startsWith('qty__')) continue
    const qty = Number(rawValue)
    if (!Number.isFinite(qty) || qty <= 0) continue
    const fliId = key.slice('qty__'.length)
    const orderLineItemId = String(form.get(`oli__${fliId}`) || '')
    const reason = String(form.get(`reason__${fliId}`) || 'OTHER') as ReturnReasonCode
    const note = (form.get(`note__${fliId}`) as string | null)?.trim() || undefined
    const title = String(form.get(`title__${fliId}`) || '')
    const variantTitle = (form.get(`variant__${fliId}`) as string | null) || null
    const unitPriceCents = Number(form.get(`price__${fliId}`) || '0')

    if (!orderLineItemId) continue

    selections.push({
      fulfillmentLineItemId: fliId,
      orderLineItemId,
      quantity:       qty,
      title,
      variantTitle,
      unitPriceCents,
      reason,
      ...(note ? { reasonNote: note } : {}),
    })
  }

  if (selections.length === 0) return { error: 'Select at least one item to return.' }

  // Flat parcel estimate — Phase 2 uses a conservative small-parcel default.
  // Phase 3 replaces with actual product dim/weight from Shopify variant data.
  const parcel = { lengthIn: 10, widthIn: 7, heightIn: 4, weightOz: 16 }
  const labelCostEstimatedCents = estimateLabelCostCents(parcel)

  const result = await createCustomerReturn({
    orderId,
    customerGid: customer.id,
    currencyCode,
    selections,
    labelCostEstimatedCents,
    parcel,
    fromAddress,
  })

  if (!result.ok) return { error: result.error }
  const redirectTo = `/account/returns/${result.returnRow.id}`
  console.log('[returns-new] redirecting to', { redirectTo, rowId: result.returnRow.id })
  throw redirect(redirectTo)
}

export default function ReturnWizard() {
  const { order, returnables, withinWindow } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const nav = useNavigation()
  const submitting = nav.state === 'submitting'

  if (!withinWindow) {
    return <OutOfWindow orderNumber={order.orderNumber} />
  }

  const allItems = returnables.flatMap(rf => rf.lineItems)
  if (allItems.length === 0) {
    return <NothingReturnable orderNumber={order.orderNumber} />
  }

  return (
    <div className="space-y-6">
      <section className="hidden lg:block">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Start a return <span className="text-sage">♥</span>
        </h1>
        <p className="text-sm text-ink/50 mt-0.5">
          Order #{order.orderNumber}
        </p>
      </section>

      <Form method="post" className="space-y-5">
        <input type="hidden" name="orderId" value={order.id} />
        <input type="hidden" name="currencyCode" value={order.currencyCode} />

        <section className="space-y-3">
          <SectionHeading>What are you sending back?</SectionHeading>
          <ul className="bg-white border border-cream-2 rounded-2xl divide-y divide-cream-2 overflow-hidden">
            {allItems.map(item => (
              <ItemRow key={item.fulfillmentLineItemId} item={item} />
            ))}
          </ul>
        </section>

        <section>
          <SectionHeading>Before you submit</SectionHeading>
          <div className="bg-white border border-cream-2 rounded-2xl p-4 md:p-5 space-y-3 text-sm text-ink/80">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="hygieneAttested"
                className="mt-0.5 h-4 w-4 rounded border-cream-2 accent-sage"
              />
              <span>
                I confirm these items are <strong>unopened and in their original packaging</strong>.
                Opened intimate products, consumables, and clearance items cannot be returned for
                hygiene and safety reasons.
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="labelCostAck"
                className="mt-0.5 h-4 w-4 rounded border-cream-2 accent-sage"
              />
              <span>
                I understand the <strong>return shipping cost will be deducted from my refund</strong>{' '}
                once my return is received at the warehouse.
              </span>
            </label>
          </div>
        </section>

        {actionData && 'error' in actionData && actionData.error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
            {actionData.error}
          </p>
        )}

        <section className="flex flex-col sm:flex-row gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 px-5 py-3 rounded-full text-sm font-semibold text-white bg-coral hover:opacity-90 transition-opacity disabled:opacity-60"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {submitting ? 'Creating return…' : 'Create return & get label ♥'}
          </button>
          <Link
            to={`/account/orders/${encodeURIComponent(order.id)}`}
            className="flex-1 text-center px-5 py-3 rounded-full text-sm font-semibold text-ink border border-cream-2 bg-white hover:bg-cream-2/40 transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Cancel
          </Link>
        </section>

        <p className="text-[11px] text-ink/50 text-center">
          Returns ship to our warehouse in Ferndale, MI. USPS Ground Advantage, ~3–5 business days.
        </p>
      </Form>
    </div>
  )
}

function ItemRow({ item }: { item: ReturnableLineItem }) {
  return (
    <li className="p-4 space-y-3">
      <input type="hidden" name={`oli__${item.fulfillmentLineItemId}`} value={item.orderLineItemId} />
      <input type="hidden" name={`title__${item.fulfillmentLineItemId}`} value={item.title} />
      <input type="hidden" name={`variant__${item.fulfillmentLineItemId}`} value={item.variantTitle ?? ''} />
      <input
        type="hidden"
        name={`price__${item.fulfillmentLineItemId}`}
        value={String(Math.round(Number(item.unitPrice?.amount ?? 0) * 100))}
      />

      <div className="flex items-start gap-3">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.title}
            loading="lazy"
            className="w-12 h-12 rounded-xl object-cover border border-cream-2 shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-cream-2 shrink-0" aria-hidden="true" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink truncate">{item.title}</p>
          {item.variantTitle && item.variantTitle !== 'Default Title' && (
            <p className="text-xs text-ink/50 mt-0.5 truncate">{item.variantTitle}</p>
          )}
          {item.unitPrice && (
            <p className="text-xs text-ink/60 mt-1 tabular-nums">
              ${parseFloat(item.unitPrice.amount).toFixed(2)} each · up to {item.quantity} returnable
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-ink/60">Quantity</span>
          <select
            name={`qty__${item.fulfillmentLineItemId}`}
            defaultValue="0"
            className="mt-1 block w-full text-sm border border-cream-2 rounded-xl px-3 py-2 bg-white"
          >
            <option value="0">— don't return —</option>
            {Array.from({ length: item.quantity }, (_, i) => i + 1).map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-ink/60">Reason</span>
          <select
            name={`reason__${item.fulfillmentLineItemId}`}
            defaultValue="UNWANTED"
            className="mt-1 block w-full text-sm border border-cream-2 rounded-xl px-3 py-2 bg-white"
          >
            {REASONS.map(r => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-[11px] font-semibold text-ink/60">
          Anything else you want to tell us? (optional)
        </span>
        <textarea
          name={`note__${item.fulfillmentLineItemId}`}
          rows={2}
          maxLength={500}
          className="mt-1 block w-full text-sm border border-cream-2 rounded-xl px-3 py-2 bg-white resize-none"
        />
      </label>
    </li>
  )
}

function OutOfWindow({ orderNumber }: { orderNumber: number }) {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-cream-2 rounded-2xl p-6 text-center space-y-3">
        <p
          className="text-base font-semibold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Return window has passed <span className="text-sage">♥</span>
        </p>
        <p className="text-sm text-ink/60">
          Order #{orderNumber} is outside our 30-day return window. Reach out to support if there's a
          problem with the product and we'll see what we can do.
        </p>
        <a
          href="mailto:hello@xdipx.com"
          className="inline-flex mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-ink bg-cream-2 hover:bg-cream-2/70 transition-colors"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Email support
        </a>
      </div>
    </div>
  )
}

function NothingReturnable({ orderNumber }: { orderNumber: number }) {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-cream-2 rounded-2xl p-6 text-center space-y-3">
        <p
          className="text-base font-semibold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Nothing to return here <span className="text-sage">♥</span>
        </p>
        <p className="text-sm text-ink/60">
          Order #{orderNumber} doesn't have any returnable items right now. This usually means items
          haven't been delivered yet, or a return is already in progress.
        </p>
        <Link
          to="/account/returns"
          className="inline-flex mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-ink bg-cream-2 hover:bg-cream-2/70 transition-colors"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          See my returns
        </Link>
      </div>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-sm font-bold text-ink mb-2"
      style={{ fontFamily: 'var(--font-display)' }}
    >
      {children}
    </h2>
  )
}
