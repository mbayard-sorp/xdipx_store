import { useLoaderData, useFetcher, useRevalidator, Link } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { kvGet, KV_KEYS } from '~/lib/kv.server'
import type { BulkImportJob, BulkImportJobSummary } from '~/types'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const job = await kvGet<BulkImportJob>(KV_KEYS.bulkImportJob)
  if (!job) return { job: null }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { groups: _groups, ...summary } = job
  return { job: summary as BulkImportJobSummary }
}

const API = '/api/admin/bulk-import/process'

// ─── Phase 0: File picker ──────────────────────────────────────────────────

function FilePicker({ onParsed }: { onParsed: (csv: string) => void }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function readFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => onParsed(e.target?.result as string)
    reader.readAsText(file)
  }

  return (
    <div
      className={[
        'border-2 border-dashed rounded-2xl p-16 text-center transition-colors cursor-pointer',
        dragging ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-purple-400 bg-white',
      ].join(' ')}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) readFile(file)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f) }}
      />
      <UploadIcon className="mx-auto mb-4 text-gray-300" />
      <p className="text-gray-800 font-semibold text-base">Drop your Nalpac CSV here, or click to browse</p>
      <p className="text-gray-500 text-sm mt-1">Modified CSV with Master SKU / Variant Option columns</p>
    </div>
  )
}

// ─── Phase 1: Preview (idle) ───────────────────────────────────────────────

function PreviewPhase({
  job,
  onStart,
  onCancel,
  isSubmitting,
}: {
  job: BulkImportJobSummary
  onStart: () => void
  onCancel: () => void
  isSubmitting: boolean
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total products"   value={job.total} />
        <StatCard label="Parse errors"     value={job.parseErrors.length} warn={job.parseErrors.length > 0} />
        <StatCard label="Ready to import"  value={job.total - job.parseErrors.length} />
      </div>

      {job.parseErrors.length > 0 && (
        <details className="bg-red-50 border border-red-200 rounded-xl p-4">
          <summary className="text-red-700 text-sm font-semibold cursor-pointer">
            {job.parseErrors.length} parse error{job.parseErrors.length !== 1 ? 's' : ''} — will be skipped
          </summary>
          <ul className="mt-3 space-y-1">
            {job.parseErrors.map((e, i) => (
              <li key={i} className="text-red-800 text-xs font-mono">{e.sku}: {e.message}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex gap-3">
        <button
          onClick={onStart}
          disabled={isSubmitting || job.total === 0}
          className="px-6 py-2.5 rounded-xl bg-coral text-white font-semibold text-sm disabled:opacity-50 shadow-sm"
        >
          {isSubmitting ? 'Starting…' : `Start Import (${job.total} products)`}
        </button>
        <button
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-6 py-2.5 rounded-xl border border-gray-300 text-gray-600 hover:text-gray-900 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Phase 2: Progress ─────────────────────────────────────────────────────

function ProgressPhase({
  job,
  onPause,
  onResume,
  onReset,
  isSubmitting,
}: {
  job: BulkImportJobSummary
  onPause: () => void
  onResume: () => void
  onReset: () => void
  isSubmitting: boolean
}) {
  const total     = job.total || 1
  const attempted = job.processed + job.skipped + job.failed
  const pct       = Math.round((attempted / total) * 100)

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm p-6 border border-gray-100">
        <div className="flex justify-between text-sm text-gray-500 mb-2">
          <span>{attempted} of {job.total} processed</span>
          <span className="font-semibold text-gray-800">{pct}%</span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-coral transition-all duration-300 rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Imported"  value={job.processed} />
        <StatCard label="Skipped"   value={job.skipped} />
        <StatCard label="Failed"    value={job.failed} warn={job.failed > 0} />
        <StatCard label="Remaining" value={Math.max(0, job.total - attempted)} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge status={job.status} />

        {job.status === 'running' && (
          <button
            onClick={onPause}
            disabled={isSubmitting}
            className="px-5 py-2 rounded-xl border border-gray-300 text-gray-600 hover:text-gray-900 text-sm transition-colors"
          >
            Pause
          </button>
        )}
        {job.status === 'paused' && (
          <button
            onClick={onResume}
            disabled={isSubmitting}
            className="px-5 py-2 rounded-xl bg-coral text-white text-sm font-semibold shadow-sm"
          >
            Resume
          </button>
        )}
        {job.status !== 'done' && (
          <button
            onClick={onReset}
            disabled={isSubmitting}
            className="px-5 py-2 rounded-xl border border-red-200 text-red-600 hover:text-red-800 hover:border-red-300 text-sm transition-colors"
          >
            Reset
          </button>
        )}
        {job.status === 'done' && (
          <>
            <Link to="/admin/queue" className="text-orange-600 text-sm font-medium hover:underline">
              View in Queue →
            </Link>
            <button
              onClick={onReset}
              className="ml-auto px-5 py-2 rounded-xl border border-gray-300 text-gray-600 hover:text-gray-900 text-sm transition-colors"
            >
              Clear &amp; Start New Import
            </button>
          </>
        )}
      </div>

      {job.errors.length > 0 && (() => {
        const hardErrors = job.errors.filter(e => e.level !== 'warning')
        const warnings   = job.errors.filter(e => e.level === 'warning')
        return (
          <>
            {hardErrors.length > 0 && (
              <details className="bg-red-50 border border-red-200 rounded-xl p-4">
                <summary className="text-red-700 text-sm font-semibold cursor-pointer">
                  {hardErrors.length} import error{hardErrors.length !== 1 ? 's' : ''}
                </summary>
                <ul className="mt-3 space-y-1 max-h-48 overflow-y-auto">
                  {hardErrors.map((e, i) => (
                    <li key={i} className="text-red-800 text-xs font-mono">{e.sku}: {e.message}</li>
                  ))}
                </ul>
              </details>
            )}
            {warnings.length > 0 && (
              <details className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <summary className="text-amber-700 text-sm font-semibold cursor-pointer">
                  {warnings.length} warning{warnings.length !== 1 ? 's' : ''} (non-fatal — product imported, downstream sync failed)
                </summary>
                <ul className="mt-3 space-y-1 max-h-48 overflow-y-auto">
                  {warnings.map((e, i) => (
                    <li key={i} className="text-amber-800 text-xs font-mono">{e.sku}: {e.message}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )
      })()}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function BulkImportPage() {
  const { job }        = useLoaderData<typeof loader>()
  const fetcher        = useFetcher<{ job?: BulkImportJobSummary; ok?: boolean; error?: string }>()
  const { revalidate } = useRevalidator()
  const [isPolling, setIsPolling] = useState(false)

  const liveJob = (fetcher.data as { job?: BulkImportJobSummary } | undefined)?.job ?? job

  useEffect(() => {
    if (!isPolling) return
    if (fetcher.state !== 'idle') return
    if (liveJob?.status !== 'running') return
    const timer = setTimeout(() => {
      const fd = new FormData()
      fd.append('intent', 'next')
      fetcher.submit(fd, { method: 'post', action: API })
    }, 400)
    return () => clearTimeout(timer)
  }, [isPolling, fetcher.state, liveJob?.status, fetcher])

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data) {
      revalidate()
      const status = (fetcher.data as { job?: BulkImportJobSummary }).job?.status
      if (status && status !== 'running') setIsPolling(false)
    }
  }, [fetcher.state, fetcher.data, revalidate])

  function submitIntent(intent: string, extra?: Record<string, string>) {
    const fd = new FormData()
    fd.append('intent', intent)
    if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, v)
    fetcher.submit(fd, { method: 'post', action: API })
  }

  function handleFileParsed(csv: string) {
    submitIntent('start', { csv })
  }
  function handleStart() {
    submitIntent('begin')
    setIsPolling(true)
  }
  function handlePause() {
    setIsPolling(false)
    submitIntent('pause')
  }
  function handleResume() {
    submitIntent('resume')
    setIsPolling(true)
  }
  function handleReset() {
    setIsPolling(false)
    submitIntent('reset')
  }

  const isSubmitting = fetcher.state !== 'idle'
  const apiError     = (fetcher.data as { error?: string } | undefined)?.error

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-display)' }}>
          Bulk Import
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Import products from a modified Nalpac CSV with master/variant relationships.
        </p>
      </div>

      {apiError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {apiError}
        </div>
      )}

      {!liveJob && !isSubmitting && <FilePicker onParsed={handleFileParsed} />}

      {!liveJob && isSubmitting && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-500 text-sm">
          Parsing CSV…
        </div>
      )}

      {liveJob && liveJob.status === 'idle' && (
        <PreviewPhase job={liveJob} onStart={handleStart} onCancel={handleReset} isSubmitting={isSubmitting} />
      )}

      {liveJob && liveJob.status !== 'idle' && (
        <ProgressPhase job={liveJob} onPause={handlePause} onResume={handleResume} onReset={handleReset} isSubmitting={isSubmitting} />
      )}
    </div>
  )
}

// ─── Shared components ─────────────────────────────────────────────────────

function StatCard({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className={['text-2xl font-bold', warn ? 'text-red-600' : 'text-gray-900'].join(' ')}>
        {value.toLocaleString()}
      </div>
      <div className="text-gray-500 text-xs mt-0.5">{label}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: BulkImportJobSummary['status'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    idle:    { label: 'Idle',    cls: 'bg-gray-100 text-gray-600' },
    running: { label: 'Running', cls: 'bg-green-100 text-green-700' },
    paused:  { label: 'Paused',  cls: 'bg-yellow-100 text-yellow-700' },
    done:    { label: 'Done',    cls: 'bg-blue-100 text-blue-700' },
    error:   { label: 'Error',   cls: 'bg-red-100 text-red-700' },
  }
  const { label, cls } = map[status] ?? map['idle']!
  return <span className={`px-3 py-1 rounded-full text-xs font-semibold ${cls}`}>{label}</span>
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}
