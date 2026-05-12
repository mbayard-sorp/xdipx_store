import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { applyApprovedChange, rejectChange } from '~/lib/pricing-agent.server'
import { db } from '~/lib/db.server'
import { pricingChanges } from '../../db/schema'
import { eq, and, sql } from 'drizzle-orm'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const adminUser = await getAdminUser(request)
  const approvedBy = adminUser?.email ?? 'admin'

  let body: Record<string, unknown>
  const ct = request.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    body = await request.json()
  } else {
    const fd = await request.formData()
    body = Object.fromEntries(fd)
  }

  const actionType = body['action'] as string

  if (actionType === 'approve-all') {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    const pending = await db
      .select()
      .from(pricingChanges)
      .where(
        and(
          eq(pricingChanges.status, 'pending'),
          sql`${pricingChanges.runDate}::text = ${todayStr}`,
        ),
      )

    const errors: Array<{ changeId: number; error: string }> = []
    for (const row of pending) {
      try {
        await applyApprovedChange(row.id, approvedBy)
      } catch (err) {
        errors.push({ changeId: row.id, error: String(err) })
      }
    }

    return Response.json({
      ok: errors.length === 0,
      processed: pending.length - errors.length,
      errors,
    })
  }

  const changeId = Number(body['changeId'])
  if (!changeId || isNaN(changeId)) {
    return Response.json({ ok: false, error: 'Missing changeId' }, { status: 400 })
  }

  if (actionType === 'approve') {
    await applyApprovedChange(changeId, approvedBy)
    return Response.json({ ok: true, processed: 1, errors: [] })
  }

  if (actionType === 'reject') {
    await rejectChange(changeId, approvedBy)
    return Response.json({ ok: true, processed: 1, errors: [] })
  }

  return Response.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}
