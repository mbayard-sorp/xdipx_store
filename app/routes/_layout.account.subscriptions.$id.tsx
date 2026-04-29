import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useLoaderData, useOutletContext } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { adminGetSubscriptionContract } from '~/lib/shopify.server'
import { SubscriptionStatusPill } from '~/components/account/SubscriptionStatusPill'
import { formatCadence } from '~/components/account/SubscriptionContractCard'
import type { AccountOutletContext } from './_layout.account'

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const robots = { name: 'robots', content: 'noindex, nofollow' }
  if (!data) return [{ title: 'Subscription — xdipx' }, robots]
  const line = data.contract.lines[0]
  const title = line ? line.title : 'Subscription'
  return [{ title: `${title} — xdipx` }, robots]
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })

  const rawId = params['id']
  if (!rawId) {
    throw new Response('Subscription not found', { status: 404 })
  }
  const contractId = decodeURIComponent(rawId)

  const profile = await api.getProfile()
  if (!profile) {
    throw new Response('Unauthorized', { status: 401 })
  }

  const contract = await adminGetSubscriptionContract(contractId)
  if (!contract) {
    throw new Response('Subscription not found', { status: 404 })
  }

  // Ownership check: the requesting customer must own this contract
  if (contract.customerId !== profile.id) {
    throw new Response('Subscription not found', { status: 404 })
  }

  return { contract }
}

export default function SubscriptionDetailRoute() {
  const { contract } = useLoaderData<typeof loader>()
  useOutletContext<AccountOutletContext>() // type contract guard (matches orders detail pattern)

  const cadence = formatCadence(contract)

  const nextDate = contract.nextBillingDate
    ? new Date(contract.nextBillingDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  const createdDate = new Date(contract.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const addr = contract.shippingAddress

  return (
    <div className="space-y-6">
      {/* Desktop heading — mobile sub-header already shows "Subscription" */}
      <section className="hidden lg:block">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Subscription <span className="text-sage">♥</span>
        </h1>
        <p className="text-sm text-ink/50 mt-0.5">
          {cadence} {nextDate ? `\u00b7 Next charge ${nextDate}` : ''}
        </p>
      </section>

      {/* Summary card */}
      <section className="bg-white border border-cream-2 rounded-2xl p-4 md:p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs text-ink/60">
              Started {createdDate}
            </p>
            <p className="text-sm font-semibold text-ink">{cadence}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <SubscriptionStatusPill status={contract.status} />
              {nextDate && (
                <span className="text-[11px] text-ink/50">
                  Next charge: {nextDate}
                </span>
              )}
            </div>
          </div>
          {contract.subtotalAmount && (
            <p className="text-lg font-bold text-ink tabular-nums shrink-0">
              ${parseFloat(contract.subtotalAmount.amount).toFixed(2)}{' '}
              <span className="text-[11px] font-normal text-ink/40">
                {contract.subtotalAmount.currencyCode}
              </span>
            </p>
          )}
        </div>
      </section>

      {/* Items */}
      <section>
        <SectionHeading>Items</SectionHeading>
        <ul className="bg-white border border-cream-2 rounded-2xl divide-y divide-cream-2 overflow-hidden">
          {contract.lines.map((line) => {
            const lineTotal = (
              parseFloat(line.currentPrice.amount) * line.quantity
            ).toFixed(2)

            return (
              <li key={line.id} className="flex items-start gap-3 p-4">
                {line.imageUrl ? (
                  <img
                    src={line.imageUrl}
                    alt={line.title}
                    loading="lazy"
                    className="w-12 h-12 rounded-xl object-cover border border-cream-2 shrink-0"
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-xl bg-cream-2 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">
                    {line.title}
                  </p>
                  {line.variantTitle && line.variantTitle !== 'Default Title' && (
                    <p className="text-xs text-ink/50 mt-0.5 truncate">
                      {line.variantTitle}
                    </p>
                  )}
                  <p className="text-xs text-ink/60 mt-1">
                    &times; {line.quantity}
                  </p>
                </div>
                <p className="text-sm font-semibold text-ink tabular-nums shrink-0">
                  ${lineTotal}
                </p>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Shipping address */}
      {addr && (addr.address1 || addr.city) && (
        <section>
          <SectionHeading>Ships to</SectionHeading>
          <address className="bg-white border border-cream-2 rounded-2xl p-4 md:p-5 not-italic text-sm text-ink/80 space-y-0.5">
            {(addr.firstName || addr.lastName) && (
              <p>{[addr.firstName, addr.lastName].filter(Boolean).join(' ')}</p>
            )}
            {addr.address1 && <p>{addr.address1}</p>}
            {addr.address2 && <p>{addr.address2}</p>}
            {(addr.city || addr.province || addr.zip) && (
              <p>
                {[addr.city, addr.province].filter(Boolean).join(', ')}
                {addr.zip ? ` ${addr.zip}` : ''}
              </p>
            )}
            {addr.country && <p>{addr.country}</p>}
            {addr.phone && (
              <p className="text-ink/50 mt-1">{addr.phone}</p>
            )}
          </address>
        </section>
      )}

      {/* "Need to make a change?" section */}
      <section className="bg-cream-2 rounded-2xl p-5 space-y-2">
        <h2
          className="text-sm font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Need to make a change? <span className="text-sage">♥</span>
        </h2>
        <p className="text-sm text-ink/70">
          Want to skip a delivery, pause, change your cadence, or cancel?
          Our support team can help with any subscription changes.
        </p>
        <a
          href={`mailto:hello@xdipx.com?subject=${encodeURIComponent(`Subscription change request — ${contract.id}`)}`}
          className="inline-flex items-center justify-center mt-1 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-coral hover:opacity-90 transition-opacity"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Contact support
        </a>
      </section>

      {/* Back link */}
      <div className="pt-2">
        <Link
          to="/account/subscriptions"
          className="text-sm font-semibold text-sage hover:text-sun transition-colors"
        >
          &larr; All subscriptions
        </Link>
      </div>

      {/* Reassurance strip */}
      <p className="text-[11px] text-ink/50 text-center pt-1">
        <span aria-hidden="true">♥</span> Shipped in plain packaging. Discreet billing.
      </p>
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
