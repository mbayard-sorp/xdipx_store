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

export const meta: MetaFunction = () => [{ title: 'Start a return — xdipx' }]

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
  const [customer, order] = await Promise.all([
    api.getProfile(),
    api.getOrder(rawOrderId),
  ])
  if (!customer) throw redirect('/account/login')
  if (!order) throw new Response('Order not found', { status: 404 })

  // Window check — use first successful fulfillment as delivery anchor.
  // Storefront API doesn't expose deliveredAt cleanly, so we approximate
  // using the order processedAt + 5d as floor. Shopify Admin API does
  // expose it; upgrade path is to add it to OrderDetail later.
  const withinWindow = isOrderWithinReturnWindow(null, order.processedAt)

  // Load returnable fulfillments from Admin API.
  const returnables = withinWindow ? await getReturnableFulfillments(orderId) : []

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
  })

  if (!result.ok) return { error: result.error }
  throw redirect(`/account/returns/${result.returnRow.id}`)
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
          className="text-2xl font-bold text-brand-charcoal"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Start a return <span className="text-brand-purple">♥</span>
        </h1>
        <p className="text-sm text-brand-charcoal/50 mt-0.5">
          Order #{order.orderNumber}
        </p>
      </section>

      <Form method="post" className="space-y-5">
        <input type="hidden" name="orderId" value={order.id} />
        <input type="hidden" name="currencyCode" value={order.currencyCode} />

        <section className="space-y-3">
          <SectionHeading>What are you sending back?</SectionHeading>
          <ul className="bg-white border border-brand-mist rounded-2xl divide-y divide-brand-mist overflow-hidden">
            {allItems.map(item => (
              <ItemRow key={item.fulfillmentLineItemId} item={item} />
            ))}
          </ul>
        </section>

        <section>
          <SectionHeading>Before you submit</SectionHeading>
          <div className="bg-white border border-brand-mist rounded-2xl p-4 md:p-5 space-y-3 text-sm text-brand-charcoal/80">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="hygieneAttested"
                className="mt-0.5 h-4 w-4 rounded border-brand-mist accent-brand-purple"
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
                className="mt-0.5 h-4 w-4 rounded border-brand-mist accent-brand-purple"
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
            className="flex-1 px-5 py-3 rounded-full text-sm font-semibold text-white bg-brand-gradient hover:opacity-90 transition-opacity disabled:opacity-60"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {submitting ? 'Creating return…' : 'Create return & get label ♥'}
          </button>
          <Link
            to={`/account/orders/${encodeURIComponent(order.id)}`}
            className="flex-1 text-center px-5 py-3 rounded-full text-sm font-semibold text-brand-charcoal border border-brand-mist bg-white hover:bg-brand-mist/40 transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Cancel
          </Link>
        </section>

        <p className="text-[11px] text-brand-charcoal/50 text-center">
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
            className="w-12 h-12 rounded-xl object-cover border border-brand-mist shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-brand-mist shrink-0" aria-hidden="true" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-brand-charcoal truncate">{item.title}</p>
          {item.variantTitle && item.variantTitle !== 'Default Title' && (
            <p className="text-xs text-brand-charcoal/50 mt-0.5 truncate">{item.variantTitle}</p>
          )}
          {item.unitPrice && (
            <p className="text-xs text-brand-charcoal/60 mt-1 tabular-nums">
              ${parseFloat(item.unitPrice.amount).toFixed(2)} each · up to {item.quantity} returnable
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-brand-charcoal/60">Quantity</span>
          <select
            name={`qty__${item.fulfillmentLineItemId}`}
            defaultValue="0"
            className="mt-1 block w-full text-sm border border-brand-mist rounded-xl px-3 py-2 bg-white"
          >
            <option value="0">— don't return —</option>
            {Array.from({ length: item.quantity }, (_, i) => i + 1).map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-brand-charcoal/60">Reason</span>
          <select
            name={`reason__${item.fulfillmentLineItemId}`}
            defaultValue="UNWANTED"
            className="mt-1 block w-full text-sm border border-brand-mist rounded-xl px-3 py-2 bg-white"
          >
            {REASONS.map(r => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-[11px] font-semibold text-brand-charcoal/60">
          Anything else you want to tell us? (optional)
        </span>
        <textarea
          name={`note__${item.fulfillmentLineItemId}`}
          rows={2}
          maxLength={500}
          className="mt-1 block w-full text-sm border border-brand-mist rounded-xl px-3 py-2 bg-white resize-none"
        />
      </label>
    </li>
  )
}

function OutOfWindow({ orderNumber }: { orderNumber: number }) {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-brand-mist rounded-2xl p-6 text-center space-y-3">
        <p
          className="text-base font-semibold text-brand-charcoal"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Return window has passed <span className="text-brand-purple">♥</span>
        </p>
        <p className="text-sm text-brand-charcoal/60">
          Order #{orderNumber} is outside our 30-day return window. Reach out to support if there's a
          problem with the product and we'll see what we can do.
        </p>
        <a
          href="mailto:support@xdipx.com"
          className="inline-flex mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-brand-charcoal bg-brand-mist hover:bg-brand-mist/70 transition-colors"
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
      <div className="bg-white border border-brand-mist rounded-2xl p-6 text-center space-y-3">
        <p
          className="text-base font-semibold text-brand-charcoal"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Nothing to return here <span className="text-brand-purple">♥</span>
        </p>
        <p className="text-sm text-brand-charcoal/60">
          Order #{orderNumber} doesn't have any returnable items right now. This usually means items
          haven't been delivered yet, or a return is already in progress.
        </p>
        <Link
          to="/account/returns"
          className="inline-flex mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-brand-charcoal bg-brand-mist hover:bg-brand-mist/70 transition-colors"
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
      className="text-sm font-bold text-brand-charcoal mb-2"
      style={{ fontFamily: 'var(--font-display)' }}
    >
      {children}
    </h2>
  )
}
