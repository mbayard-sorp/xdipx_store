import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { pricingAuditLog } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { updateVariantPricing } from '~/lib/shopify.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const adminUser = await getAdminUser(request)
  const actingAs = adminUser?.email ?? 'admin'

  let body: Record<string, unknown>
  const ct = request.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    body = await request.json()
  } else {
    const fd = await request.formData()
    body = Object.fromEntries(fd)
  }

  const actionType = body['action'] as string
  const auditId = Number(body['auditId'])

  if (!auditId || isNaN(auditId)) {
    return Response.json({ ok: false, error: 'Missing auditId' }, { status: 400 })
  }

  // Load the row
  const rows = await db
    .select()
    .from(pricingAuditLog)
    .where(eq(pricingAuditLog.id, auditId))
    .limit(1)

  const row = rows[0]
  if (!row) {
    return Response.json({ ok: false, error: 'Audit row not found' }, { status: 404 })
  }

  if (row.status !== 'pending') {
    return Response.json({ ok: false, error: `Row is already ${row.status}` }, { status: 400 })
  }

  if (actionType === 'reject') {
    await db
      .update(pricingAuditLog)
      .set({
        status: 'rejected',
        rationale: `${row.rationale ?? ''} [rejected by ${actingAs}]`.trim(),
      })
      .where(eq(pricingAuditLog.id, auditId))
    return Response.json({ ok: true, status: 'rejected' })
  }

  if (actionType === 'approve' || actionType === 'edit-approve') {
    // For edit-approve, caller provides a custom sell price.
    const customSell = actionType === 'edit-approve' ? String(body['customSell'] ?? '') : null
    const sellPrice = customSell && customSell !== '' ? customSell : row.newSell
    const compareAt = row.newCompareAt ?? row.newSell

    if (!sellPrice) {
      return Response.json({ ok: false, error: 'No sell price available' }, { status: 400 })
    }

    try {
      await updateVariantPricing(
        row.variantId,
        sellPrice,
        compareAt ?? sellPrice,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return Response.json({ ok: false, error: `Shopify update failed: ${msg}` }, { status: 500 })
    }

    await db
      .update(pricingAuditLog)
      .set({
        status: 'applied',
        newSell: sellPrice,
        rationale: `${row.rationale ?? ''} [approved by ${actingAs}${actionType === 'edit-approve' ? ` at $${parseFloat(sellPrice).toFixed(2)}` : ''}]`.trim(),
      })
      .where(eq(pricingAuditLog.id, auditId))

    return Response.json({ ok: true, status: 'applied', appliedSell: sellPrice })
  }

  return Response.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}
