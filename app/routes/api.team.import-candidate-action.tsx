import type { ActionFunctionArgs } from 'react-router'
import { and, eq, gte, sql } from 'drizzle-orm'
import { assertTeamAuth } from '~/lib/team.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import {
  approveAndImport,
  updateCandidateStatus,
} from '~/lib/import-monitor.server'
import { db } from '~/lib/db.server'
import { importCandidates } from '../../db/schema'

const DEFAULT_MAX_ACTIONS_PER_RUN = 20

async function countProcessedToday(reviewedBy: string): Promise<number> {
  const res = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(importCandidates)
    .where(
      and(
        gte(importCandidates.reviewedAt, sql`current_date`),
        eq(importCandidates.reviewedBy, reviewedBy),
      ),
    )
  return Number(res[0]?.n ?? 0)
}

async function runIntent(id: number, intent: string, reviewedBy: string, reason?: string) {
  if (intent === 'approve') {
    return await approveAndImport(id, reviewedBy)
  }
  if (intent === 'reject') {
    await updateCandidateStatus(id, 'rejected', {
      reviewedBy,
      ...(reason !== undefined ? { rejectionReason: reason } : {}),
    })
    return { ok: true, id }
  }
  if (intent === 'watch') {
    await updateCandidateStatus(id, 'watching', { reviewedBy })
    return { ok: true, id }
  }
  return { ok: false, id, error: `Unknown intent: ${intent}` }
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)

  const enabled = await getPipelineSetting('product_manager_enabled')
  if (enabled !== 'true') {
    return Response.json({ ok: false, error: 'product_manager disabled' }, { status: 403 })
  }

  const form = await request.formData()
  const intent = form.get('intent') as string
  const idRaw = form.get('id') as string | null
  const idsRaw = form.get('ids') as string | null
  const reason = (form.get('reason') as string | null) ?? undefined
  const reviewedBy = (form.get('reviewedBy') as string | null) || 'product-manager-agent'

  const capRaw = await getPipelineSetting('product_manager_max_actions_per_run')
  const cap = Math.max(0, parseInt(capRaw ?? String(DEFAULT_MAX_ACTIONS_PER_RUN), 10) || DEFAULT_MAX_ACTIONS_PER_RUN)
  const alreadyToday = await countProcessedToday(reviewedBy)
  const remaining = Math.max(0, cap - alreadyToday)

  // Bulk path: ids is a CSV of IDs
  if (idsRaw) {
    const ids = idsRaw
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n))

    const toProcess = ids.slice(0, remaining)
    const skippedDueToCap = ids.slice(remaining)

    const results: unknown[] = []
    for (const id of toProcess) {
      results.push(await runIntent(id, intent, reviewedBy, reason))
    }
    return Response.json({ ok: true, results, skippedDueToCap })
  }

  // Single path
  const id = idRaw ? parseInt(idRaw, 10) : NaN
  if (isNaN(id)) {
    return Response.json({ ok: false, error: 'Missing or invalid id' }, { status: 400 })
  }

  if (remaining <= 0) {
    return Response.json({ ok: true, results: [], skippedDueToCap: [id] })
  }

  const result = await runIntent(id, intent, reviewedBy, reason)
  return Response.json({ ok: true, results: [result], skippedDueToCap: [] })
}
