import type { ActionFunctionArgs } from 'react-router'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { assertTeamAuth } from '~/lib/team.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import {
  approveAndImport,
  updateCandidateStatus,
} from '~/lib/import-monitor.server'
import { fetchAllNalpacFeeds } from '~/lib/nalpac-feeds.server'
import { collapseMasters, type MasterRecord } from '~/lib/master-collapse.server'
import { db } from '~/lib/db.server'
import { importCandidates } from '../../db/schema'

const DEFAULT_MAX_ACTIONS_PER_RUN = 20

// Each approve runs ~12-15s of sequential Shopify Admin calls (variant images,
// inventory items, metafields, all rate-limit-paced). A 10-id chunk (~120-150s)
// reliably meets or exceeds the serverless+proxy timeout and can reset the
// connection mid-chunk (confirmed 2026-08-18, curl exit 35), leaving no
// response for the ids that DID import even though they landed in Shopify.
// Overflow ids come back in `deferred` for the caller to resubmit. Reject/
// watch are cheap DB writes and are not clamped. Ticket #4099: lowered from
// 10 to 5 so a full-cap (20-action) approve batch stays comfortably under the
// timeout in a single request; the `deferred` slice below drains whatever is
// left across as many follow-up requests as it takes, at any chunk size.
const MAX_APPROVALS_PER_REQUEST = 5

/**
 * Split capped ids into the chunk that this request will process and the
 * remainder to hand back as `deferred` for the caller to resubmit. Approve
 * is clamped to `perRequestLimit` (see MAX_APPROVALS_PER_REQUEST); reject and
 * watch are cheap DB writes and go through in one request regardless of size.
 */
export function splitApprovalChunk(
  capAllowed: number[],
  intent: string,
  perRequestLimit: number = MAX_APPROVALS_PER_REQUEST,
): { toProcess: number[]; deferred: number[] } {
  const limit = intent === 'approve' ? perRequestLimit : capAllowed.length
  return { toProcess: capAllowed.slice(0, limit), deferred: capAllowed.slice(limit) }
}

/**
 * Ticket #7387: `product_manager_max_actions_per_run` used to count every
 * action toward the same budget, so Step 4b hygiene closeouts (reject on a
 * row already `status='imported'` -- an enrich-parked row, or one whose
 * Shopify draft was since deleted) competed with the pending-drain for cap
 * and always lost, letting rows like #4880 age indefinitely for lack of
 * budget. A reject on an already-imported row is not a new import decision,
 * so it is exempt from the cap; only `reject` is checked (approve/watch on
 * an already-imported row is not a real workflow, so skip the query then).
 */
async function partitionHygieneRejects(
  ids: number[],
  intent: string,
): Promise<{ hygiene: number[]; regular: number[] }> {
  if (intent !== 'reject' || ids.length === 0) return { hygiene: [], regular: ids }
  const rows = await db
    .select({ id: importCandidates.id, status: importCandidates.status })
    .from(importCandidates)
    .where(inArray(importCandidates.id, ids))
  const importedIds = new Set(rows.filter(r => r.status === 'imported').map(r => r.id))
  return {
    hygiene: ids.filter(id => importedIds.has(id)),
    regular: ids.filter(id => !importedIds.has(id)),
  }
}

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

async function runIntent(
  id: number,
  intent: string,
  reviewedBy: string,
  reason?: string,
  preloadedMasters?: MasterRecord[],
) {
  if (intent === 'approve') {
    return await approveAndImport(id, reviewedBy, preloadedMasters ? { preloadedMasters } : {})
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

    // #7387: hygiene rejects on already-imported rows never touch the cap.
    const { hygiene, regular } = await partitionHygieneRejects(ids, intent)
    const capAllowed = regular.slice(0, remaining)
    const skippedDueToCap = regular.slice(remaining)

    // Chunk approvals per request; overflow is returned for resubmission.
    const { toProcess, deferred } = splitApprovalChunk(capAllowed, intent)

    // One feed fetch + master collapse shared by the whole batch — without this
    // every approveAndImport re-fetches and re-collapses the ~17k-SKU feed.
    let preloadedMasters: MasterRecord[] | undefined
    if (intent === 'approve' && toProcess.length > 1) {
      preloadedMasters = collapseMasters((await fetchAllNalpacFeeds()).snapshots)
    }

    const results: unknown[] = []
    for (const id of [...hygiene, ...toProcess]) {
      results.push(await runIntent(id, intent, reviewedBy, reason, preloadedMasters))
    }
    return Response.json({ ok: true, results, skippedDueToCap, deferred })
  }

  // Single path
  const id = idRaw ? parseInt(idRaw, 10) : NaN
  if (isNaN(id)) {
    return Response.json({ ok: false, error: 'Missing or invalid id' }, { status: 400 })
  }

  if (remaining <= 0) {
    // #7387: a hygiene reject (already-imported row) still isn't a new
    // import decision even at full cap.
    const { hygiene } = await partitionHygieneRejects([id], intent)
    if (hygiene.length === 0) {
      return Response.json({ ok: true, results: [], skippedDueToCap: [id] })
    }
  }

  const result = await runIntent(id, intent, reviewedBy, reason)
  return Response.json({ ok: true, results: [result], skippedDueToCap: [] })
}
