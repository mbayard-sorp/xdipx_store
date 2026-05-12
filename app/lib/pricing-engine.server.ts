// Pure pricing rules engine for xdipx daily pricing agent. No I/O.

export interface PricingSnapshot {
  sku: string
  vendor: string | null
  productType?: string | null
  msrp: number
  wholesale: number
  mapPrice: number | null
  currentPrice: number
  currentCompareAt: number | null
  inSaleFeed: boolean
  nalpacDiscountPct: number | null
  productTitle?: string
  variantTitle?: string
}

export interface PricingRules {
  marginFloor?: number
  highMarginDiscount?: number
  mediumMarginDiscount?: number
  saleSweetener?: number
  perTypeOverrides?: Record<string, {
    highMarginDiscount?: number
    mediumMarginDiscount?: number
  }>
}

export type PricingTier =
  | 'map-locked'
  | 'sale-flow-through'
  | 'high-margin'
  | 'medium-margin'
  | 'thin-margin'
  | 'no-change-needed'
  | 'refuse-missing-data'

export interface PriceComputation {
  tier: PricingTier
  newPrice: number
  newCompareAt: number
  marginPct: number
  reason: string
  mapRespected: boolean
  flags: Array<'below-floor' | 'thin-margin' | 'no-msrp' | 'no-wholesale' | 'no-map-on-restricted' | 'increase-absorbed'>
  delta: number
  deltaPct: number
}

export const MAP_RESTRICTED_VENDORS = ['Lovense', 'Playground'] as const
export const MARGIN_FLOOR = 0.20
export const FLOOR_MULTIPLIER = 1.25
export const HIGH_MARGIN_DISCOUNT = 0.35
export const MEDIUM_MARGIN_DISCOUNT = 0.20
export const SALE_FLOW_SWEETENER = 0.05

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function isMapRestricted(vendor: string | null): boolean {
  if (!vendor) return false
  const trimmed = vendor.trim().toLowerCase()
  return MAP_RESTRICTED_VENDORS.some(v => v.toLowerCase() === trimmed)
}

function marginPct(price: number, wholesale: number): number {
  if (price <= 0) return 0
  return (price - wholesale) / price
}

function buildResult(
  tier: PricingTier,
  newPrice: number,
  msrp: number,
  wholesale: number,
  currentPrice: number,
  mapRespected: boolean,
  reason: string,
  flags: PriceComputation['flags'],
  effectiveMarginFloor: number
): PriceComputation {
  const finalPrice = round2(newPrice)
  const newCompareAt = round2(msrp)
  const margin = marginPct(finalPrice, wholesale)
  const flagsCopy = [...flags]
  if (margin < effectiveMarginFloor && !flagsCopy.includes('below-floor')) {
    flagsCopy.push('below-floor')
  }
  const delta = round2(finalPrice - currentPrice)
  const deltaPct = currentPrice > 0 ? round2(delta / currentPrice) : 0
  return { tier, newPrice: finalPrice, newCompareAt, marginPct: margin, reason, mapRespected, flags: flagsCopy, delta, deltaPct }
}

export function computeTargetPrice(snapshot: PricingSnapshot, rules?: PricingRules): PriceComputation {
  const { wholesale, msrp, mapPrice, currentPrice, inSaleFeed, nalpacDiscountPct, vendor, productType } = snapshot

  const effectiveMarginFloor = rules?.marginFloor ?? MARGIN_FLOOR
  const floorMultiplier = 1 / (1 - effectiveMarginFloor)
  const floor = wholesale * floorMultiplier

  const typeOverride = productType ? rules?.perTypeOverrides?.[productType] : undefined
  const effectiveHighDiscount = typeOverride?.highMarginDiscount ?? rules?.highMarginDiscount ?? HIGH_MARGIN_DISCOUNT
  const effectiveMediumDiscount = typeOverride?.mediumMarginDiscount ?? rules?.mediumMarginDiscount ?? MEDIUM_MARGIN_DISCOUNT
  const effectiveSaleSweetener = rules?.saleSweetener ?? SALE_FLOW_SWEETENER

  // Rule 1: refuse missing data
  if (wholesale <= 0 || msrp <= 0) {
    const flags: PriceComputation['flags'] = []
    if (wholesale <= 0) flags.push('no-wholesale')
    if (msrp <= 0) flags.push('no-msrp')
    const reason = `Missing required data: ${flags.join(', ')}. No price change applied.`
    return buildResult('refuse-missing-data', currentPrice, msrp > 0 ? msrp : currentPrice, wholesale, currentPrice, true, reason, flags, effectiveMarginFloor)
  }

  // Rule 2: MAP-locked vendors
  if (isMapRestricted(vendor)) {
    if (mapPrice == null || mapPrice <= 0) {
      return buildResult(
        'refuse-missing-data',
        currentPrice,
        msrp,
        wholesale,
        currentPrice,
        false,
        `Vendor ${vendor} is MAP-restricted but no MAP price is set. No price change applied.`,
        ['no-map-on-restricted'],
        effectiveMarginFloor
      )
    }
    const candidate = Math.max(mapPrice, floor)
    const mapRespected = mapPrice >= floor
    const flags: PriceComputation['flags'] = []
    const reason = `MAP-restricted vendor. newPrice = max(MAP $${mapPrice}, floor $${round2(floor)}) = $${round2(candidate)}.`
    const result = buildResult('map-locked', candidate, msrp, wholesale, currentPrice, mapRespected, reason, flags, effectiveMarginFloor)

    if (Math.abs(result.newPrice - currentPrice) < 0.01) {
      return { ...result, tier: 'no-change-needed', reason: 'Already at target.' }
    }
    return result
  }

  let tier: PricingTier
  let candidate: number
  const flags: PriceComputation['flags'] = []

  // Rule 3: sale flow-through
  if (inSaleFeed && nalpacDiscountPct != null && nalpacDiscountPct > 0) {
    tier = 'sale-flow-through'
    const target = msrp * (1 - nalpacDiscountPct - effectiveSaleSweetener)
    candidate = Math.max(target, floor)
    if (candidate > target) flags.push('below-floor')
    const reason = `Sale feed at ${Math.round(nalpacDiscountPct * 100)}% off + ${Math.round(effectiveSaleSweetener * 100)}pt sweetener. Target $${round2(target)}, floor $${round2(floor)}.`
    const result = buildResult(tier, candidate, msrp, wholesale, currentPrice, true, reason, flags, effectiveMarginFloor)
    return applyPostRules(result, currentPrice, wholesale, msrp, effectiveMarginFloor)
  }

  // Rule 4: high-margin
  if (msrp >= 2 * wholesale) {
    tier = 'high-margin'
    const target = msrp * (1 - effectiveHighDiscount)
    candidate = Math.max(target, floor)
    if (candidate > target) flags.push('below-floor')
    const reason = `High margin (MSRP/wholesale ratio ${round2(msrp / wholesale)}x). ${Math.round(effectiveHighDiscount * 100)}% off MSRP = $${round2(target)}, floor $${round2(floor)}.`
    const result = buildResult(tier, candidate, msrp, wholesale, currentPrice, true, reason, flags, effectiveMarginFloor)
    return applyPostRules(result, currentPrice, wholesale, msrp, effectiveMarginFloor)
  }

  // Rule 5: medium-margin
  if (msrp >= 1.5 * wholesale) {
    tier = 'medium-margin'
    const target = msrp * (1 - effectiveMediumDiscount)
    candidate = Math.max(target, floor)
    if (candidate > target) flags.push('below-floor')
    const reason = `Medium margin (MSRP/wholesale ratio ${round2(msrp / wholesale)}x). ${Math.round(effectiveMediumDiscount * 100)}% off MSRP = $${round2(target)}, floor $${round2(floor)}.`
    const result = buildResult(tier, candidate, msrp, wholesale, currentPrice, true, reason, flags, effectiveMarginFloor)
    return applyPostRules(result, currentPrice, wholesale, msrp, effectiveMarginFloor)
  }

  // Rule 6: thin-margin
  tier = 'thin-margin'
  candidate = floor
  flags.push('thin-margin')
  const reason = `Thin margin (MSRP/wholesale ratio ${round2(msrp / wholesale)}x). Pricing at floor $${round2(floor)}. Likely not worth carrying as a deal.`
  const result = buildResult(tier, candidate, msrp, wholesale, currentPrice, true, reason, flags, effectiveMarginFloor)
  return applyPostRules(result, currentPrice, wholesale, msrp, effectiveMarginFloor)
}

function applyPostRules(
  result: PriceComputation,
  currentPrice: number,
  wholesale: number,
  msrp: number,
  effectiveMarginFloor: number
): PriceComputation {
  const { newPrice } = result

  // no-change-needed: within $0.01
  if (Math.abs(newPrice - currentPrice) < 0.01) {
    return { ...result, tier: 'no-change-needed', reason: 'Already at target.' }
  }

  // increase-absorbed: computed price is a raise AND margin at currentPrice still >= floor
  if (newPrice > currentPrice && result.tier !== 'map-locked') {
    const currentMargin = marginPct(currentPrice, wholesale)
    if (currentMargin >= effectiveMarginFloor) {
      const revertedMargin = marginPct(currentPrice, wholesale)
      return {
        ...result,
        tier: 'no-change-needed',
        newPrice: currentPrice,
        newCompareAt: round2(msrp),
        marginPct: revertedMargin,
        reason: `Wholesale rose, margin still above ${Math.round(effectiveMarginFloor * 100)}%, no change.`,
        flags: [...result.flags, 'increase-absorbed'],
        delta: 0,
        deltaPct: 0,
      }
    }
  }

  return result
}
