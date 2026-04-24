import type { SellingPlan, SellingPlanGroup } from '~/types'

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

/**
 * Returns the best (lowest-price) subscription option across all groups, or
 * null if no plan actually yields a lower price than basePrice. Used by the
 * PDP price teaser to decide whether to render the "or $Y with subscription"
 * line at all.
 */
export function getBestSubscriptionOffer(
  groups: SellingPlanGroup[] | undefined,
  basePrice: number,
): { price: number; discountPct: number } | null {
  if (!groups?.length) return null
  let bestPrice = basePrice
  for (const g of groups) {
    for (const sp of g.sellingPlans) {
      const p = getSubscriptionPrice(basePrice, sp)
      if (p < bestPrice) bestPrice = p
    }
  }
  if (bestPrice >= basePrice) return null
  const discountPct = Math.round(((basePrice - bestPrice) / basePrice) * 100)
  return { price: bestPrice, discountPct }
}
