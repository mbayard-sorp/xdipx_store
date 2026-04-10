import type { ReactElement } from 'react'
import { Link } from 'react-router'
import type { SubscriptionContract } from '~/lib/shopify.server'
import { SubscriptionStatusPill } from './SubscriptionStatusPill'

/**
 * Build a human-readable cadence string from a subscription contract's
 * delivery or billing policy. Exported so the detail route can reuse it.
 */
export function formatCadence(contract: SubscriptionContract): string {
  const policy = contract.deliveryPolicy ?? contract.billingPolicy
  if (!policy) return 'Recurring'

  const { interval, intervalCount } = policy

  if (intervalCount === 1) {
    switch (interval) {
      case 'DAY':   return 'Every day'
      case 'WEEK':  return 'Every week'
      case 'MONTH': return 'Every month'
      case 'YEAR':  return 'Every year'
      default:      return `Every ${interval.toLowerCase()}`
    }
  }

  const unit =
    interval === 'DAY'   ? 'days'   :
    interval === 'WEEK'  ? 'weeks'  :
    interval === 'MONTH' ? 'months' :
    interval === 'YEAR'  ? 'years'  :
    interval.toLowerCase() + 's'

  return `Every ${intervalCount} ${unit}`
}

interface SubscriptionContractCardProps {
  contract: SubscriptionContract
}

export function SubscriptionContractCard({
  contract,
}: SubscriptionContractCardProps): ReactElement {
  const { id, status, nextBillingDate, lines, subtotalAmount } = contract
  const detailHref = `/account/subscriptions/${encodeURIComponent(id)}`
  const cadence = formatCadence(contract)

  const primaryLine = lines[0]
  const extraCount = lines.length > 1 ? lines.length - 1 : 0

  const nextDate = nextBillingDate
    ? new Date(nextBillingDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  return (
    <Link
      to={detailHref}
      className="block border border-brand-mist rounded-2xl p-4 bg-white hover:bg-brand-mist/30 transition-colors"
    >
      <div className="flex items-start gap-3">
        {/* Product image */}
        {primaryLine?.imageUrl ? (
          <img
            src={primaryLine.imageUrl}
            alt={primaryLine.title}
            loading="lazy"
            className="w-14 h-14 rounded-xl object-cover border border-brand-mist shrink-0"
          />
        ) : (
          <div
            className="w-14 h-14 rounded-xl bg-brand-mist shrink-0"
            aria-hidden="true"
          />
        )}

        <div className="flex-1 min-w-0">
          {/* Title + extra count */}
          <p
            className="text-sm font-bold text-brand-charcoal truncate"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {primaryLine?.title ?? 'Subscription'}
            {extraCount > 0 && (
              <span className="text-xs font-normal text-brand-charcoal/50 ml-1">
                +{extraCount} more
              </span>
            )}
          </p>

          {/* Cadence */}
          <p className="text-xs text-brand-charcoal/60 mt-0.5">{cadence}</p>

          {/* Status + next charge */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <SubscriptionStatusPill status={status} />
            {nextDate && (
              <span className="text-[11px] text-brand-charcoal/50">
                Next: {nextDate}
              </span>
            )}
          </div>
        </div>

        {/* Subtotal */}
        {subtotalAmount && (
          <p className="text-sm font-bold text-brand-charcoal tabular-nums shrink-0">
            ${parseFloat(subtotalAmount.amount).toFixed(2)}
            <span className="text-[11px] font-normal text-brand-charcoal/40 ml-0.5">
              {subtotalAmount.currencyCode}
            </span>
          </p>
        )}
      </div>
    </Link>
  )
}
