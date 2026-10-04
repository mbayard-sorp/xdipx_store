/**
 * CSV import for Google Ads and Shop Campaigns reports (wires 9.3). Two steps
 * through the same fetcher: the file is read and previewed (nothing written),
 * then committed. States: idle, drag over, reading, parsed preview, committing,
 * error. A phone has no drag, so under md the box reads "Import a ... CSV" with
 * the source select and Choose file. Import is ink solid: coral stays on Save cap.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useFetcher } from 'react-router'
import { useAdsToast } from './AdsToast'
import { formatMoney } from '~/lib/ad-metrics-core'
import type { ImportResult } from '~/lib/ad-metrics.server'

type ImportSource = 'shop' | 'google'

type ImportActionData =
  | { ok: true; intent: 'import-preview'; result: ImportResult }
  | { ok: true; intent: 'import-commit'; result: ImportResult; message: string }
  | { ok: false; intent?: string; error: string }

const MAX_BYTES = 8 * 1024 * 1024

function shortDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function CsvDropZone({ actionPath }: { actionPath: string }) {
  const fetcher = useFetcher<ImportActionData>()
  const toast = useAdsToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<ImportSource>('shop')
  const [file, setFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<unknown>(null)
  const handled = useRef<unknown>(null)

  const busy = fetcher.state !== 'idle'
  const pendingIntent = busy ? String(fetcher.formData?.get('intent') ?? '') : ''
  const data = fetcher.data && fetcher.data !== dismissed ? fetcher.data : null

  useEffect(() => {
    if (fetcher.state !== 'idle' || !data || handled.current === data) return
    handled.current = data
    if (data.ok && data.intent === 'import-commit') {
      toast.show({ message: data.message })
      setFile(null)
      setDismissed(data)
    }
  }, [fetcher.state, data, toast])

  function submit(intent: 'import-preview' | 'import-commit', f: File) {
    const fd = new FormData()
    fd.set('intent', intent)
    fd.set('source', source)
    fd.set('file', f)
    fetcher.submit(fd, { method: 'post', action: actionPath, encType: 'multipart/form-data' })
  }

  function take(f: File | undefined | null) {
    if (!f) return
    setLocalError(null)
    if (f.size === 0) { setLocalError('That file is empty.'); return }
    if (f.size > MAX_BYTES) { setLocalError('That file is over 8 MB. Export a shorter date range.'); return }
    setFile(f)
    setDismissed(null)
    submit('import-preview', f)
  }

  function reset() {
    setFile(null)
    setLocalError(null)
    setDismissed(fetcher.data ?? null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDrag(false)
    take(e.dataTransfer.files?.[0])
  }

  const stage: 'reading' | 'committing' | 'preview' | 'error' | 'idle' =
    pendingIntent === 'import-commit' ? 'committing'
      : busy ? 'reading'
        : data?.ok && data.intent === 'import-preview' && file ? 'preview'
          : localError || (data && !data.ok) ? 'error' : 'idle'
  const errorText = localError ?? (data && !data.ok ? data.error : null)
  const result = data?.ok ? data.result : null

  const boxBase = 'rounded-2xl border-2 border-dashed p-4 lg:p-5 min-h-[120px] outline-none focus-visible:border-ink'

  return (
    <section aria-label="CSV import">
      <h2 className="sr-only">CSV import</h2>
      <div
        id="csv-import"
        tabIndex={-1}
        aria-busy={busy}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`${boxBase} ${drag ? 'border-ink bg-paper-3' : 'border-line-3 bg-paper'}`}
      >
        {drag ? (
          <p className="text-sm text-ink">Drop to read it</p>
        ) : stage === 'reading' || stage === 'committing' ? (
          <p className="text-sm text-ink-2" role="status">
            {stage === 'reading' ? 'Reading ' : 'Importing '}
            <span className="font-mono">{file?.name ?? 'the file'}</span>
          </p>
        ) : stage === 'preview' && result ? (
          <div>
            <p className="break-all font-mono text-sm font-semibold text-ink">{file?.name}</p>
            <p className="mt-1 font-mono text-xs tabular-nums text-ink-2">
              {result.fileRows} rows{result.dateRange ? ` · ${shortDay(result.dateRange.from)} to ${shortDay(result.dateRange.to)}` : ''}
            </p>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-2">
              {result.matchedRows} matched to creatives · {result.unmatchedRows} land as account level
            </p>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-2">Spend {formatMoney(result.totalSpendCents)}</p>
            <p className="mt-1 text-xs text-ink-3">Orders come from Shopify attribution, not from this file. Nothing is written until you import.</p>
            {result.unmatched.length > 0 && (
              <details className="mt-2 text-xs text-ink-3">
                <summary className="min-h-11 cursor-pointer py-3 text-ink-2 underline-offset-2 hover:underline">
                  See the {result.unmatched.length} account level rows
                </summary>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono">
                  {result.unmatched.slice(0, 25).map(u => (
                    <li key={u.line}>line {u.line}, {u.day}, {formatMoney(u.spendCents)}{u.campaign ? `, ${u.campaign}` : ''}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={reset} className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 touch-manipulation">
                Cancel
              </button>
              <button type="button" onClick={() => file && submit('import-commit', file)} className="min-h-11 rounded-full bg-ink px-4 text-sm font-medium text-white touch-manipulation">
                Import {result.fileRows} rows
              </button>
            </div>
          </div>
        ) : stage === 'error' && errorText ? (
          <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <p className="break-words">{errorText}</p>
            <button
              type="button"
              onClick={() => { reset(); inputRef.current?.click() }}
              className="mt-3 min-h-11 rounded-full border border-red-300 bg-paper px-4 font-medium text-red-800 hover:border-red-500 touch-manipulation"
            >
              Choose another file
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-ink-3">
              <span className="md:hidden">Import a Google Ads or Shop Campaigns CSV</span>
              <span className="hidden md:inline">Drop a Google Ads or Shop Campaigns CSV</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-ink-3">
                <span className="sr-only md:not-sr-only">Source</span>
                <select
                  value={source}
                  onChange={e => setSource(e.target.value as ImportSource)}
                  className="min-h-11 rounded-xl border border-line bg-paper px-3 text-sm text-ink"
                >
                  <option value="shop">Shop Campaigns</option>
                  <option value="google">Google Ads</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 touch-manipulation"
              >
                Choose file
              </button>
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a CSV file"
          onChange={e => take(e.target.files?.[0])}
        />
      </div>
    </section>
  )
}
