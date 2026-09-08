/**
 * Whether the PDP should present its buy CTA as purchasable right now.
 *
 * A variant's `availableForSale` reads true at 0 quantity whenever Shopify's
 * `inventoryPolicy` for it is CONTINUE (oversell allowed), so it cannot be
 * trusted alone as a "genuinely buyable" signal. `totalInventory` is
 * Shopify's own tracked-stock total across every variant on the product and
 * is `null` only when nothing on the product tracks inventory at all; a
 * tracked product summing to 0 or less is unambiguous, whatever any one
 * variant's oversell policy says. Ticket #8025: sku 77731 (ACTIVE Shopify
 * product, totalInventory 0) rendered as an ordinary buyable PDP because
 * `availableForSale` was true, and was the store's single biggest search
 * impression source at the time.
 *
 * Deliberately scoped to this one signal (Shopify's product-level
 * `totalInventory`): it does not resolve per-variant oversell risk on a
 * multi-variant product where only the selected variant is depleted, which
 * stays with the broader inventory-reconciliation ticket (#8020).
 */
export function isPdpInStock(opts: {
  isDigital: boolean
  totalInventory: number | null | undefined
  variantAvailableForSale: boolean | undefined
  multiVariant: boolean
  dealQty: number
}): boolean {
  if (opts.isDigital) return true
  const trackedOutOfStock = opts.totalInventory != null && opts.totalInventory <= 0
  if (trackedOutOfStock) return false
  return opts.variantAvailableForSale ?? (opts.multiVariant ? false : opts.dealQty > 0)
}
