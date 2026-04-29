import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useLoaderData, useOutletContext } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { getCustomerReturn, rmaNumber } from '~/lib/returns.server'
import { ReturnStatusPill } from '~/components/account/ReturnStatusPill'
import { ReturnTimeline } from '~/components/account/ReturnTimeline'
import type { AccountOutletContext } from './_layout.account'

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const robots = { name: 'robots', content: 'noindex, nofollow' }
  if (!data) return [{ title: 'Return — xdipx' }, robots]
  return [{ title: `${data.rma} — xdipx` }, robots]
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })
  const customer = await api.getProfile()
  if (!customer) throw new Response('Unauthorized', { status: 401 })

  const id = Number(params['id'])
  if (!Number.isFinite(id)) {
    console.error('[returns/$id] bad id param', { param: params['id'] })
    throw new Response('Not found', { status: 404 })
  }

  const row = await getCustomerReturn(id, customer.id)
  if (!row) {
    console.error('[returns/$id] row not found or owner mismatch', {
      id,
      customerGid: customer.id,
    })
    throw new Response('Not found', { status: 404 })
  }

  const itemsTotalCents = row.lineItems.reduce(
    (sum, li) => sum + li.unitPriceCents * li.quantity, 0,
  )
  const labelCostCents = row.labelCostCents ?? row.labelCostEstimatedCents ?? 0
  const estimatedRefundCents = Math.max(0, itemsTotalCents - labelCostCents)

  return {
    rma: rmaNumber(row.shopifyReturnId),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    labelUrl: row.labelUrl,
    labelCostCents: row.labelCostCents,
    labelCostEstimatedCents: row.labelCostEstimatedCents,
    trackingNumber: row.trackingNumber,
    trackingStatus: row.trackingStatus,
    refundAmountCents: row.refundAmountCents,
    shopifyOrderId: row.shopifyOrderId,
    lineItems: row.lineItems,
    itemsTotalCents,
    labelCostFinalCents: labelCostCents,
    estimatedRefundCents,
    refundedAt: row.refundedAt?.toISOString() ?? null,
  }
}

export default function ReturnDetail() {
  const data = useLoaderData<typeof loader>()
  useOutletContext<AccountOutletContext>()

  return (
    <div className="space-y-6">
      <section className="hidden lg:block">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {data.rma} <span className="text-sage">♥</span>
        </h1>
        <p className="text-sm text-ink/50 mt-0.5">
          Started {new Date(data.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </section>

      <section className="bg-white border border-cream-2 rounded-2xl p-4 md:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <ReturnStatusPill status={data.status} />
          {data.trackingNumber && (
            <p className="text-[11px] text-ink/50 tabular-nums">
              Tracking: {data.trackingNumber}
            </p>
          )}
        </div>
        <ReturnTimeline status={data.status} />
      </section>

      {data.labelUrl && (data.status === 'label_sent' || data.status === 'in_transit' || data.status === 'approved') && (
        <section>
          <SectionHeading>Your return label</SectionHeading>
          <div className="bg-white border border-cream-2 rounded-2xl p-4 md:p-5 space-y-3">
            <p className="text-sm text-ink/70">
              Print this label, stick it on your package, and drop it off at USPS. We'll email you when
              the warehouse receives it.
            </p>
            <a
              href={data.labelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-5 py-3 rounded-full text-sm font-semibold text-white bg-coral hover:opacity-90 transition-opacity"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Download label ♥
            </a>
            <p className="text-[11px] text-ink/50">
              Ship to: Nalpac, 1365 Jarvis St, Ferndale, MI 48220
            </p>
          </div>
        </section>
      )}

      {!data.labelUrl && (data.status === 'approved' || data.status === 'requested') && (
        <section className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 md:p-5">
          <p className="text-sm text-yellow-800">
            Your return is approved but we couldn't generate a label automatically. Email{' '}
            <a href="mailto:hello@xdipx.com" className="underline font-semibold">hello@xdipx.com</a>{' '}
            with your RMA number ({data.rma}) and we'll sort it out.
          </p>
        </section>
      )}

      <section>
        <SectionHeading>Items</SectionHeading>
        <ul className="bg-white border border-cream-2 rounded-2xl divide-y divide-cream-2 overflow-hidden">
          {data.lineItems.map((li, i) => (
            <li key={i} className="p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{li.title}</p>
                {li.variantTitle && li.variantTitle !== 'Default Title' && (
                  <p className="text-xs text-ink/50 mt-0.5 truncate">{li.variantTitle}</p>
                )}
                <p className="text-xs text-ink/60 mt-1">&times; {li.quantity}</p>
              </div>
              <p className="text-sm font-semibold text-ink tabular-nums shrink-0">
                ${((li.unitPriceCents * li.quantity) / 100).toFixed(2)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionHeading>Refund breakdown</SectionHeading>
        <div className="bg-white border border-cream-2 rounded-2xl p-4 md:p-5 space-y-2 text-sm">
          <Row label="Items total" amountCents={data.itemsTotalCents} />
          <Row
            label={`Return shipping${data.labelCostCents == null ? ' (estimated)' : ''}`}
            amountCents={-data.labelCostFinalCents}
          />
          <div className="pt-2 border-t border-cream-2 flex items-center justify-between">
            <span className="text-sm font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
              {data.status === 'refunded' ? 'Refunded' : 'Estimated refund'}
            </span>
            <span className="text-sm font-bold text-ink tabular-nums">
              ${((data.refundAmountCents ?? data.estimatedRefundCents) / 100).toFixed(2)}
            </span>
          </div>
          {data.refundedAt && (
            <p className="text-[11px] text-ink/50 pt-1">
              Refunded on {new Date(data.refundedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </div>
      </section>

      <section className="flex flex-col sm:flex-row gap-3 pt-2">
        <Link
          to="/account/returns"
          className="flex-1 text-center px-5 py-3 rounded-full text-sm font-semibold text-ink border border-cream-2 bg-white hover:bg-cream-2/40 transition-colors"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          All returns
        </Link>
        <a
          href="mailto:hello@xdipx.com"
          className="flex-1 text-center px-5 py-3 rounded-full text-sm font-semibold text-ink border border-cream-2 bg-white hover:bg-cream-2/40 transition-colors"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Need help?
        </a>
      </section>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-bold text-ink mb-2" style={{ fontFamily: 'var(--font-display)' }}>
      {children}
    </h2>
  )
}

function Row({ label, amountCents }: { label: string; amountCents: number }) {
  const sign = amountCents < 0 ? '−' : ''
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink/60">{label}</span>
      <span className="text-ink tabular-nums">
        {sign}${Math.abs(amountCents / 100).toFixed(2)}
      </span>
    </div>
  )
}
