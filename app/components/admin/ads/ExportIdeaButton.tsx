/**
 * "Export idea" on a hearted google or microsoft idea. Search ideas carry text
 * only, so the Editor file is built straight from the idea (intent=export-idea)
 * and stored. Build, success (summary plus Download) and error states are all
 * visible. Nothing is uploaded anywhere.
 */
import { useFetcher } from 'react-router'
import { ExternalIcon } from '~/components/admin/social/icons'

interface ExportIdeaResult {
  ok: boolean
  error?: string
  errorCode?: string
  summary?: string[]
  warnings?: string[]
  url?: string | null
  filename?: string
}

export function ExportIdeaButton({ ideaId, action, lane }: { ideaId: number; action: string; lane: string }) {
  const fetcher = useFetcher<ExportIdeaResult>()
  const pending = fetcher.state !== 'idle'
  const r = fetcher.data
  const label = lane === 'microsoft' ? 'Export Microsoft Ads file' : 'Export Google Ads file'
  return (
    <div className="mt-2 lg:text-right" aria-busy={pending}>
      <button
        type="button"
        disabled={pending}
        onClick={() => fetcher.submit({ intent: 'export-idea', ideaId: String(ideaId) }, { method: 'post', action })}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation"
      >
        {pending ? 'Building' : label}
      </button>
      {r?.ok === false && (
        <p role="alert" className="mt-1 break-words text-xs text-red-800">{r.errorCode ? `${r.errorCode}: ` : ''}{r.error ?? 'The export did not build.'}</p>
      )}
      {r?.ok === true && !pending && (
        <div role="status" className="mt-1 space-y-0.5 text-xs text-ink-3">
          {(r.summary ?? []).map((l, i) => <p key={i} className="break-words">{l}</p>)}
          {r.url && (
            <a href={`${r.url}?download=1`} download={r.filename} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 font-medium text-ink underline-offset-2 hover:underline">
              Download {r.filename} <ExternalIcon size={12} />
            </a>
          )}
          {(r.warnings ?? []).slice(0, 3).map((w, i) => <p key={`w${i}`} className="break-words text-amber-800">{w}</p>)}
        </div>
      )}
    </div>
  )
}
