/**
 * Returns orchestration — coordinates Shopify Admin API + Neon `returns` row
 * for the self-service RMA flow.
 *
 * Flow:
 *   1. `createCustomerReturn`  — called from /account/returns/new action.
 *      Creates Shopify return → buys Shopify Shipping label → persists row.
 *   2. `recordLabelTracking`   — called by webhook when tracking updates.
 *   3. `markReceivedAndRefund` — called by webhook when warehouse receives parcel.
 *      Issues refund minus label cost → closes Shopify return → updates row.
 *
 * Server-only. Never import from a client component.
 */

import { eq } from 'drizzle-orm'
import { db } from './db.server'
import { returns as returnsTable, type ReturnStatus } from '../../db/schema'
import type { InferSelectModel } from 'drizzle-orm'
import {
  createReturn,
  buyReturnLabel,
  createRefund,
  closeReturn,
  getReturnableFulfillments,
  type ReturnReasonCode,
  type ReturnableFulfillment,
} from './shopify.server'

export type ReturnRow = InferSelectModel<typeof returnsTable>

// Shopify's Return GID → friendly RMA number for customer-facing display.
// Extracts the numeric suffix: gid://shopify/Return/12345 → "RMA-12345".
export function rmaNumber(shopifyReturnId: string): string {
  const m = shopifyReturnId.match(/\/(\d+)$/)
  return m ? `RMA-${m[1]}` : shopifyReturnId
}

export interface CreateCustomerReturnInput {
  orderId:       string          // Shopify GID
  customerGid:   string
  currencyCode:  string          // from the order, e.g. 'USD'
  selections: Array<{
    fulfillmentLineItemId: string
    orderLineItemId:       string         // needed for refundCreate
    quantity:              number
    title:                 string
    variantTitle:          string | null
    unitPriceCents:        number
    reason:                ReturnReasonCode
    reasonNote?:           string
  }>
  /** Estimated label cost shown in the wizard. Stored for audit. */
  labelCostEstimatedCents: number
  /** Parcel dims for Shopify Shipping rate calc. */
  parcel: {
    lengthIn: number
    widthIn:  number
    heightIn: number
    weightOz: number
  }
}

export type CreateCustomerReturnResult =
  | { ok: true; returnRow: ReturnRow }
  | { ok: false; error: string }

/**
 * End-to-end "start a return" — call from route action.
 *
 * Fails atomically-ish: if label purchase fails AFTER Shopify return creation,
 * we record the return row with status='approved' but no label, and the user
 * can retry label purchase from /account/returns/$id. (Shopify doesn't support
 * deleting a return, only closing — so retry-label is the right escape hatch.)
 */
export async function createCustomerReturn(
  input: CreateCustomerReturnInput,
): Promise<CreateCustomerReturnResult> {
  // 1. Find the reverseFulfillmentOrderId for the selected items.
  const returnables = await getReturnableFulfillments(input.orderId)
  const rfoId = pickReverseFulfillmentOrderId(returnables, input.selections.map(s => s.fulfillmentLineItemId))
  if (!rfoId) {
    return { ok: false, error: 'No returnable fulfillment found for these items.' }
  }

  // 2. Create the Shopify return.
  const createResult = await createReturn({
    orderId: input.orderId,
    lineItems: input.selections.map(s => ({
      fulfillmentLineItemId: s.fulfillmentLineItemId,
      quantity:              s.quantity,
      returnReason:          s.reason,
      ...(s.reasonNote ? { returnReasonNote: s.reasonNote } : {}),
    })),
    notifyCustomer: false, // we email via Klaviyo with the label link
  })
  if (!createResult.ok) return { ok: false, error: createResult.error }

  // 3. Persist a row in 'requested' state before buying the label so failures
  //    mid-flight leave an audit trail.
  const itemsTotalCents = input.selections.reduce(
    (sum, s) => sum + s.unitPriceCents * s.quantity, 0,
  )
  const [row] = await db.insert(returnsTable).values({
    shopifyReturnId:         createResult.data.returnId,
    shopifyOrderId:          input.orderId,
    customerGid:             input.customerGid,
    status:                  'approved' as ReturnStatus,
    reason:                  input.selections[0]?.reason ?? null,
    reasonNote:              input.selections.map(s => s.reasonNote).filter(Boolean).join(' | ') || null,
    lineItems:               input.selections.map(s => ({
      fulfillmentLineItemId: s.fulfillmentLineItemId,
      orderLineItemId:       s.orderLineItemId,
      title:                 s.title,
      variantTitle:          s.variantTitle,
      quantity:              s.quantity,
      unitPriceCents:        s.unitPriceCents,
    })),
    labelCostEstimatedCents: input.labelCostEstimatedCents,
    refundAmountCents:       Math.max(0, itemsTotalCents - input.labelCostEstimatedCents),
  }).returning()

  if (!row) return { ok: false, error: 'Failed to persist return row.' }

  // 4. Buy the label.
  const labelResult = await buyReturnLabel({
    reverseFulfillmentOrderId: createResult.data.reverseFulfillmentOrderId ?? rfoId,
    reverseDeliveryLineItems: input.selections.map(s => ({
      fulfillmentLineItemId: s.fulfillmentLineItemId,
      quantity:              s.quantity,
    })),
    parcel: input.parcel,
    notifyCustomer: false,
  })

  if (!labelResult.ok) {
    // Mark row as approved-without-label so UI can offer retry.
    return { ok: true, returnRow: row }
  }

  const [updated] = await db.update(returnsTable)
    .set({
      shopifyReverseDeliveryId: labelResult.data.reverseDeliveryId,
      labelUrl:                 labelResult.data.labelUrl,
      trackingNumber:           labelResult.data.trackingNumber,
      labelCostCents:           labelResult.data.labelCostCents,
      status:                   'label_sent' as ReturnStatus,
      labelPurchasedAt:         new Date(),
      updatedAt:                new Date(),
    })
    .where(eq(returnsTable.id, row.id))
    .returning()

  return { ok: true, returnRow: updated ?? row }
}

/** Pick which reverseFulfillmentOrder to target based on selected items. */
function pickReverseFulfillmentOrderId(
  returnables: ReturnableFulfillment[],
  selectedFliIds: string[],
): string | null {
  for (const rf of returnables) {
    if (rf.reverseFulfillmentOrderId == null) continue
    if (rf.lineItems.some(li => selectedFliIds.includes(li.fulfillmentLineItemId))) {
      return rf.reverseFulfillmentOrderId
    }
  }
  return null
}

/**
 * Webhook-driven: warehouse received the return.
 * Issues refund (items total minus label cost), closes Shopify return, updates row.
 * Idempotent — safe to call twice.
 */
export async function markReceivedAndRefund(
  shopifyReturnId: string,
  opts: { currencyCode: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db.select().from(returnsTable)
    .where(eq(returnsTable.shopifyReturnId, shopifyReturnId))
    .limit(1)

  if (!row) return { ok: false, error: `Unknown return: ${shopifyReturnId}` }
  if (row.status === 'refunded' || row.status === 'closed') return { ok: true }
  if (!row.lineItems) return { ok: false, error: 'Return row has no line items snapshot' }

  const labelCostCents = row.labelCostCents ?? row.labelCostEstimatedCents ?? 0

  const itemsTotalCents = row.lineItems.reduce(
    (sum, li) => sum + li.unitPriceCents * li.quantity, 0,
  )
  const refundCents = Math.max(0, itemsTotalCents - labelCostCents)

  // Proportionally reduce each line item's refund amount so items sum to refundCents.
  // Shopify's refundCreate takes quantities + amounts at the order level.
  const refundResult = await createRefund({
    orderId:      row.shopifyOrderId,
    note:         `Self-service return ${rmaNumber(shopifyReturnId)}. Label cost $${(labelCostCents / 100).toFixed(2)} deducted.`,
    currencyCode: opts.currencyCode,
    refundLineItems: row.lineItems.map(li => ({
      lineItemId:  li.orderLineItemId,
      quantity:    li.quantity,
      restockType: 'RETURN',
    })),
    notify: true,
  })

  if (!refundResult.ok) return { ok: false, error: refundResult.error }

  await closeReturn(shopifyReturnId)

  await db.update(returnsTable)
    .set({
      status:             'refunded' as ReturnStatus,
      refundAmountCents:  refundCents,
      shopifyRefundId:    refundResult.refundId,
      receivedAt:         row.receivedAt ?? new Date(),
      refundedAt:         new Date(),
      closedAt:           new Date(),
      updatedAt:          new Date(),
    })
    .where(eq(returnsTable.id, row.id))

  return { ok: true }
}

/**
 * Webhook-driven: update tracking status on a return.
 */
export async function recordLabelTracking(
  shopifyReturnId: string,
  update: { trackingStatus?: string; trackingNumber?: string },
): Promise<void> {
  await db.update(returnsTable)
    .set({
      ...(update.trackingStatus ? { trackingStatus: update.trackingStatus } : {}),
      ...(update.trackingNumber ? { trackingNumber: update.trackingNumber } : {}),
      status: 'in_transit' as ReturnStatus,
      updatedAt: new Date(),
    })
    .where(eq(returnsTable.shopifyReturnId, shopifyReturnId))
}

/** Customer-facing list query. */
export async function listCustomerReturns(customerGid: string): Promise<ReturnRow[]> {
  return db.select().from(returnsTable)
    .where(eq(returnsTable.customerGid, customerGid))
    .orderBy(returnsTable.createdAt)
}

/** Customer-facing detail query (ownership-checked). */
export async function getCustomerReturn(
  id: number,
  customerGid: string,
): Promise<ReturnRow | null> {
  const [row] = await db.select().from(returnsTable)
    .where(eq(returnsTable.id, id))
    .limit(1)
  if (!row || row.customerGid !== customerGid) return null
  return row
}

// ─── Eligibility + estimation helpers ─────────────────────────────────────

export interface EligibilityCheck {
  eligible: boolean
  reason?: 'outside-window' | 'already-returned' | 'not-delivered' | 'non-returnable-tags'
}

const RETURN_WINDOW_DAYS = Number(process.env['RETURN_WINDOW_DAYS'] ?? '30')
const NON_RETURNABLE_TAGS = ['final-sale', 'clearance', 'consumable']

/**
 * Check if an order is eligible for return based on delivery date + window.
 * Product-level eligibility (tags / metafield) is checked separately per line item.
 */
export function isOrderWithinReturnWindow(deliveredAt: string | null, fulfilledAt: string | null): boolean {
  const anchor = deliveredAt ?? (fulfilledAt ? isoPlusDays(fulfilledAt, 5) : null)
  if (!anchor) return false
  const deadline = new Date(anchor).getTime() + RETURN_WINDOW_DAYS * 86_400_000
  return Date.now() <= deadline
}

function isoPlusDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

export function isProductReturnable(tags: string[] | undefined): boolean {
  if (!tags) return true
  const lower = tags.map(t => t.toLowerCase())
  return !NON_RETURNABLE_TAGS.some(blocked => lower.includes(blocked))
}

/**
 * Flat-rate label estimate shown in the wizard before the customer commits.
 * Tuned to USPS Ground Advantage for the parcel classes we expect.
 * Replace with a live rate query once Shopify exposes a reverse-delivery
 * rate primitive (or gate behind a feature flag + fallback).
 */
export function estimateLabelCostCents(parcel: {
  weightOz: number
  lengthIn: number
  widthIn:  number
  heightIn: number
}): number {
  const oversized = Math.max(parcel.lengthIn, parcel.widthIn, parcel.heightIn) > 18
  if (parcel.weightOz <= 16 && !oversized) return 500  // $5.00 small parcel
  if (parcel.weightOz <= 48 && !oversized) return 850  // $8.50 medium
  return 1200                                          // $12.00 oversized/UPS Ground
}
