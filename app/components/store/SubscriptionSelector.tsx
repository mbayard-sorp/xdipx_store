import { useState, useEffect } from 'react'
import type { SellingPlanGroup, SellingPlan } from '~/types'

interface SubscriptionSelectorProps {
  sellingPlanGroups: SellingPlanGroup[]
  basePrice: number
  selectedPlanId: string | null
  onPlanChange: (planId: string | null) => void
}

export function getSubscriptionPrice(basePrice: number, plan: SellingPlan): number {
  const adj = plan.priceAdjustments[0]?.adjustmentValue
  if (!adj) return basePrice
  switch (adj.__typename) {
    case 'SellingPlanPercentagePriceAdjustment':
      return basePrice * (1 - adj.adjustmentPercentage / 100)
    case 'SellingPlanFixedAmountPriceAdjustment':
      return Math.max(0, basePrice - parseFloat(adj.adjustmentAmount.amount))
    case 'SellingPlanFixedPriceAdjustment':
      return parseFloat(adj.price.amount)
    default:
      return basePrice
  }
}

function getMaxDiscount(groups: SellingPlanGroup[]): number {
  let max = 0
  for (const g of groups) {
    for (const sp of g.sellingPlans) {
      const adj = sp.priceAdjustments[0]?.adjustmentValue
      if (adj?.__typename === 'SellingPlanPercentagePriceAdjustment') {
        max = Math.max(max, adj.adjustmentPercentage)
      }
    }
  }
  return max
}

export function SubscriptionSelector({
  sellingPlanGroups,
  basePrice,
  selectedPlanId,
  onPlanChange,
}: SubscriptionSelectorProps) {
  const allPlans = sellingPlanGroups.flatMap(g => g.sellingPlans)
  const [isSubscription, setIsSubscription] = useState(selectedPlanId !== null)
  const maxDiscount = getMaxDiscount(sellingPlanGroups)

  // Auto-select the first plan when switching to subscription mode
  useEffect(() => {
    if (isSubscription && !selectedPlanId && allPlans.length > 0) {
      onPlanChange(allPlans[0]!.id)
    }
    if (!isSubscription && selectedPlanId) {
      onPlanChange(null)
    }
  }, [isSubscription])

  if (!allPlans.length) return null

  const activePlan = allPlans.find(p => p.id === selectedPlanId)
  const subscriptionPrice = activePlan ? getSubscriptionPrice(basePrice, activePlan) : basePrice
  const savings = basePrice - subscriptionPrice

  return (
    <div className="space-y-3">
      {/* Purchase type toggle */}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Purchase type">
        <button
          type="button"
          onClick={() => setIsSubscription(false)}
          aria-pressed={!isSubscription}
          className={[
            'rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition-all text-left',
            !isSubscription
              ? 'border-coral bg-coral/10 text-ink'
              : 'border-cream-2 text-ink/50 hover:border-ink/20',
          ].join(' ')}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          One-time purchase
          <span className="block text-xs font-normal mt-0.5 opacity-70">
            ${basePrice.toFixed(2)}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setIsSubscription(true)}
          aria-pressed={isSubscription}
          className={[
            'rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition-all text-left',
            isSubscription
              ? 'border-sage bg-sage/10 text-ink'
              : 'border-cream-2 text-ink/50 hover:border-ink/20',
          ].join(' ')}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Subscribe & Save{maxDiscount > 0 ? ` ${maxDiscount}%` : ''}
          <span className="block text-xs font-normal mt-0.5 opacity-70">
            ${subscriptionPrice.toFixed(2)}/delivery
          </span>
        </button>
      </div>

      {/* Frequency selector */}
      {isSubscription && allPlans.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-ink/60 uppercase tracking-wide">
            Delivery frequency
          </p>
          <div className="flex flex-wrap gap-2">
            {allPlans.map(plan => {
              const isActive = plan.id === selectedPlanId
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => onPlanChange(plan.id)}
                  aria-pressed={isActive}
                  className={[
                    'px-3 py-1.5 text-sm rounded-full border-2 font-medium transition-all',
                    isActive
                      ? 'border-sage text-sage bg-sage/5'
                      : 'border-cream-2 text-ink/60 hover:border-ink/20',
                  ].join(' ')}
                >
                  {plan.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Savings callout */}
      {isSubscription && savings > 0 && (
        <p className="text-xs font-semibold text-sage flex items-center gap-1.5">
          <HeartIcon />
          You save ${savings.toFixed(2)} per delivery
        </p>
      )}
    </div>
  )
}

function HeartIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  )
}
