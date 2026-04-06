/**
 * Bulk import processing endpoint.
 * Each call processes exactly 1 product group to stay within Vercel's 60s limit.
 * Job state (including full groups array) is persisted in KV.
 *
 * Intents: start | begin | next | pause | resume | reset
 */
import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { kvGet, kvSet, kvDel, KV_KEYS } from '~/lib/kv.server'
import { parseBulkImportCSV, importProductGroup } from '~/lib/bulk-import.server'
import type { BulkImportJob, BulkImportJobSummary } from '~/types'
import { randomUUID } from 'crypto'

const JOB_TTL = 86400 // 24 hours

function toSummary(job: BulkImportJob): BulkImportJobSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { groups: _groups, ...summary } = job
  return summary
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const form    = await request.formData()
  const intent  = (form.get('intent') as string | null) ?? ''
  const csvText = (form.get('csv') as string | null) ?? undefined

  console.log('[bulk-import] intent:', intent, '| has csv:', !!csvText)

  // ── start: parse CSV and create a new idle job ─────────────────────────────
  if (intent === 'start') {
    if (!csvText) {
      return Response.json({ error: 'csv is required' }, { status: 400 })
    }

    let groups, parseErrors
    try {
      ;({ groups, parseErrors } = parseBulkImportCSV(csvText))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return Response.json({ error: `CSV parse failed: ${msg}` }, { status: 400 })
    }

    const job: BulkImportJob = {
      jobId:        randomUUID(),
      status:       'idle',
      total:        groups.length,
      processed:    0,
      skipped:      0,
      failed:       0,
      errors:       [],
      parseErrors,
      groups,
      currentIndex: 0,
      startedAt:    new Date().toISOString(),
      updatedAt:    new Date().toISOString(),
    }

    await kvSet(KV_KEYS.bulkImportJob, job, JOB_TTL)
    return Response.json({ job: toSummary(job) })
  }

  // All other intents require an existing job
  const job = await kvGet<BulkImportJob>(KV_KEYS.bulkImportJob)
  if (!job) {
    return Response.json({ error: 'No active import job' }, { status: 404 })
  }

  // ── begin: transition idle → running ───────────────────────────────────────
  if (intent === 'begin') {
    job.status    = 'running'
    job.updatedAt = new Date().toISOString()
    await kvSet(KV_KEYS.bulkImportJob, job, JOB_TTL)
    return Response.json({ job: toSummary(job) })
  }

  // ── next: process one group ────────────────────────────────────────────────
  if (intent === 'next') {
    if (job.status !== 'running') {
      return Response.json({ job: toSummary(job) })
    }

    if (job.currentIndex >= job.groups.length) {
      job.status    = 'done'
      job.updatedAt = new Date().toISOString()
      await kvSet(KV_KEYS.bulkImportJob, job, JOB_TTL)
      return Response.json({ job: toSummary(job) })
    }

    const group = job.groups[job.currentIndex]!
    const result = await importProductGroup(group)

    job.currentIndex++
    if (result.skipped) {
      job.skipped++
    } else if (!result.success) {
      job.failed++
      job.errors.push({ sku: result.sku, message: result.error ?? 'Unknown error' })
    } else {
      job.processed++
    }

    if (job.currentIndex >= job.groups.length) {
      job.status = 'done'
    }

    job.updatedAt = new Date().toISOString()
    await kvSet(KV_KEYS.bulkImportJob, job, JOB_TTL)
    return Response.json({ job: toSummary(job) })
  }

  // ── pause ──────────────────────────────────────────────────────────────────
  if (intent === 'pause') {
    job.status    = 'paused'
    job.updatedAt = new Date().toISOString()
    await kvSet(KV_KEYS.bulkImportJob, job, JOB_TTL)
    return Response.json({ job: toSummary(job) })
  }

  // ── resume ─────────────────────────────────────────────────────────────────
  if (intent === 'resume') {
    job.status    = 'running'
    job.updatedAt = new Date().toISOString()
    await kvSet(KV_KEYS.bulkImportJob, job, JOB_TTL)
    return Response.json({ job: toSummary(job) })
  }

  // ── reset ──────────────────────────────────────────────────────────────────
  if (intent === 'reset') {
    await kvDel(KV_KEYS.bulkImportJob)
    return Response.json({ ok: true })
  }

  return Response.json({ error: `Unknown intent: ${intent}` }, { status: 400 })
}
