import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { pricingAuditLog } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { updateVariantPricing } from '~/lib/shopify.server'

/**
 * Bulk-approve every pending row in the audit log. Applies each price to Shopify
 * and flips the row to `applied`. Failures are collected per-row and reported;
 * a single Shopify failure does not abort the batch.
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const adminUser = await getAdminUser(request)
  const actingAs = adminUser?.email ?? 'admin'

  const pending = await db
    .select()
    .from(pricingAuditLog)
    .where(eq(pricingAuditLog.status, 'pending'))

  let approved = 0
  let failed = 0
  const errors: string[] = []

  for (const row of pending) {
    const sellPrice = row.newSell
    if (!sellPrice) {
      failed++
      errors.push(`${row.sku ?? row.variantId}: no sell price`)
      continue
    }
    const compareAt = row.newCompareAt ?? sellPrice

    try {
      await updateVariantPricing(row.variantId, sellPrice, compareAt)
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${row.sku ?? row.variantId}: ${msg}`)
      continue
    }

    await db
      .update(pricingAuditLog)
      .set({
        status: 'applied',
        rationale: `${row.rationale ?? ''} [bulk-approved by ${actingAs}]`.trim(),
      })
      .where(eq(pricingAuditLog.id, row.id))

    approved++
  }

  return Response.json({
    ok: true,
    approved,
    failed,
    total: pending.length,
    errors: errors.slice(0, 20),
  })
}
