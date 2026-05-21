import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import {
  approveAndImport,
  updateCandidateStatus,
} from '~/lib/import-monitor.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const adminUser = await getAdminUser(request)
  const reviewedBy = adminUser?.email ?? 'admin'

  const form = await request.formData()
  const intent = form.get('intent') as string
  const idRaw = form.get('id') as string | null
  const idsRaw = form.get('ids') as string | null
  const reason = (form.get('reason') as string | null) ?? undefined

  // Bulk path: ids is a CSV of IDs
  if (idsRaw) {
    const ids = idsRaw
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n))

    const results: unknown[] = []
    for (const id of ids) {
      if (intent === 'approve') {
        results.push(await approveAndImport(id))
      } else if (intent === 'reject') {
        await updateCandidateStatus(id, 'rejected', {
          reviewedBy,
          ...(reason !== undefined ? { rejectionReason: reason } : {}),
        })
        results.push({ ok: true, id })
      } else if (intent === 'watch') {
        await updateCandidateStatus(id, 'watching', { reviewedBy })
        results.push({ ok: true, id })
      }
    }
    return Response.json({ ok: true, results })
  }

  // Single path
  const id = idRaw ? parseInt(idRaw, 10) : NaN
  if (isNaN(id)) {
    return Response.json({ ok: false, error: 'Missing or invalid id' }, { status: 400 })
  }

  if (intent === 'approve') {
    const result = await approveAndImport(id)
    return Response.json(result)
  }

  if (intent === 'reject') {
    await updateCandidateStatus(id, 'rejected', {
      reviewedBy,
      ...(reason !== undefined ? { rejectionReason: reason } : {}),
    })
    return Response.json({ ok: true })
  }

  if (intent === 'watch') {
    await updateCandidateStatus(id, 'watching', { reviewedBy })
    return Response.json({ ok: true })
  }

  return Response.json({ ok: false, error: `Unknown intent: ${intent}` }, { status: 400 })
}
