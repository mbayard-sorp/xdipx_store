/**
 * /admin/async-jobs — live view of batch enrichment jobs.
 *
 * Data flows exclusively through loader -> useLoaderData (spec rule).
 * Polling without useEffect-for-fetching: useRevalidator drives re-loads on
 * a ~4s cadence so all data still comes from the loader. The interval fires
 * only while any job is non-terminal (queued/submitted/processing/applying).
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useRevalidator } from 'react-router'
import { useEffect, useRef } from 'react'
import { requireAdmin } from '~/lib/session.server'
import { listRecentBatchJobs, getBatchJobById } from '~/lib/batch-orchestrator.server'

export const meta: MetaFunction = () => [{ title: 'Async Jobs — xdipx Admin' }]

// Status badge color map
const STATUS_COLORS: Record<string, string> = {
  queued:     'bg-paper-3 text-ink-3',
  submitted:  'bg-plum-soft text-plum',
  processing: 'bg-plum-soft text-plum',
  applying:   'bg-coral-soft text-coral',
  done:       'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const url = new URL(request.url)
  const jobIdParam = url.searchParams.get('jobId')

  // Single-job detail view when jobId is in query.
  if (jobIdParam) {
    const job = await getBatchJobById(jobIdParam)
    return { jobs: job ? [job] : [], singleJob: true }
  }

  const jobs = await listRecentBatchJobs(50)
  return { jobs, singleJob: false }
}

// Serializable summary type (omits large JSONB blobs for the list view).
type JobRow = Awaited<ReturnType<typeof listRecentBatchJobs>>[number]

function formatDuration(createdAt: Date, completedAt: Date | null): string {
  const end = completedAt ?? new Date()
  const ms  = end.getTime() - new Date(createdAt).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? 'bg-paper-3 text-ink-3'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-mono font-semibold ${cls}`}>
      {status}
    </span>
  )
}

function ProgressBar({ turn, maxTurns, status }: { turn: number; maxTurns: number; status: string }) {
  const pct = status === 'applying' || status === 'done' || status === 'failed'
    ? 100
    : maxTurns > 0 ? Math.min(100, Math.round((turn / maxTurns) * 100)) : 0
  return (
    <div className="h-1.5 bg-paper-3 rounded-full overflow-hidden w-full">
      <div
        className={`h-full rounded-full transition-all ${status === 'failed' ? 'bg-red-400' : status === 'done' ? 'bg-green-400' : 'bg-coral'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function JobCard({ job }: { job: JobRow }) {
  const skuList = (job.skuList as string[]) ?? []
  const runnerState = (job.runnerState as Record<string, { status?: string; turns?: number; error?: string; applyRetries?: number }>) ?? {}
  const products = (job.products as Array<{ productId: string; sku: string }>) ?? []

  return (
    <div className="bg-paper rounded-xl border border-line p-4 space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusBadge status={job.status} />
          <span className="text-xs font-mono text-ink-4 truncate">{job.jobId.slice(0, 8)}&hellip;</span>
          <span className="text-xs text-ink-3 font-medium">{job.source}</span>
          <span className="text-xs text-ink-4">/</span>
          <span className="text-xs text-ink-3">{job.jobType}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-4 shrink-0">
          <span>turn {job.turn}/{job.maxTurns}</span>
          <span>{formatDuration(job.createdAt, job.completedAt ?? job.failedAt)}</span>
        </div>
      </div>

      {/* Progress bar */}
      <ProgressBar turn={job.turn} maxTurns={job.maxTurns} status={job.status} />

      {/* SKU list */}
      <div className="flex flex-wrap gap-1.5">
        {skuList.map(sku => {
          const ps = products.find(p => p.sku === sku)
          const rs = ps ? runnerState[ps.productId] : undefined
          const psStatus = rs?.status ?? 'running'
          return (
            <span
              key={sku}
              className={`inline-block px-2 py-0.5 rounded text-xs font-mono ${
                psStatus === 'done'  ? 'bg-green-50 text-green-700' :
                psStatus === 'error' ? 'bg-red-50 text-red-600' :
                                       'bg-paper-2 text-ink-3'
              }`}
              title={rs?.error ?? undefined}
            >
              {sku}
              {psStatus === 'error' && <span className="ml-1 text-red-500">!</span>}
            </span>
          )
        })}
      </div>

      {/* Error message */}
      {job.error && (
        <p className="text-xs text-red-600 font-mono break-all bg-red-50 rounded p-2">{job.error}</p>
      )}

      {/* Gate deal */}
      {job.gatesDealId && (
        <p className="text-xs text-ink-4">
          Gates deal <span className="font-mono">#{job.gatesDealId}</span>
        </p>
      )}
    </div>
  )
}

const TERMINAL = new Set(['done', 'failed'])

export default function AsyncJobsPage() {
  const { jobs } = useLoaderData<typeof loader>()
  const { revalidate } = useRevalidator()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // UI timer — triggers loader revalidation on a cadence while any job is
  // non-terminal. This is a display-refresh timer, NOT a data fetch — all data
  // still comes from the loader (spec CLAUDE.md rule: no useEffect for data fetching).
  useEffect(() => {
    const hasInFlight = jobs.some(j => !TERMINAL.has(j.status))
    if (!hasInFlight) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
      return
    }
    intervalRef.current = setInterval(() => { void revalidate() }, 4000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [jobs, revalidate])

  const inFlight = jobs.filter(j => !TERMINAL.has(j.status))
  const terminal = jobs.filter(j =>  TERMINAL.has(j.status))

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Async Jobs
        </h1>
        <div className="flex items-center gap-2 text-xs text-ink-4">
          {inFlight.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-coral animate-pulse" />
              {inFlight.length} in flight
            </span>
          )}
          <span>{jobs.length} total</span>
        </div>
      </div>

      {jobs.length === 0 && (
        <div className="text-center py-16 text-ink-4 text-sm">
          No enrichment jobs yet.
        </div>
      )}

      {inFlight.length > 0 && (
        <section>
          <h2 className="kicker mb-3">In flight</h2>
          <div className="space-y-3">
            {inFlight.map(j => <JobCard key={j.jobId} job={j as JobRow} />)}
          </div>
        </section>
      )}

      {terminal.length > 0 && (
        <section>
          <h2 className="kicker mb-3">Completed</h2>
          <div className="space-y-3">
            {terminal.map(j => <JobCard key={j.jobId} job={j as JobRow} />)}
          </div>
        </section>
      )}
    </div>
  )
}
