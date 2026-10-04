/**
 * Sheet that shows a Meta paused draft payload: the human preview first, then
 * the raw JSON in its own scroll box. Read only. Nothing here sends anything.
 */
import { CloseIcon } from '~/components/admin/social/icons'

export function PayloadSheet({
  title,
  preview,
  warnings,
  payload,
  onClose,
}: {
  title: string
  preview: string[]
  warnings: string[]
  payload: unknown
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-40 flex flex-col bg-paper"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <p className="font-mono text-xs text-ink-3">{title}</p>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 touch-manipulation"
        >
          <CloseIcon size={12} /> Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto bg-paper-3 p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          <section aria-label="Preview">
            <p className="kicker mb-1">Preview</p>
            <ul className="space-y-1 text-sm text-ink-2">
              {preview.map((l, i) => <li key={i} className="break-words">{l}</li>)}
            </ul>
          </section>
          {warnings.length > 0 && (
            <section aria-label="Warnings">
              <p className="kicker mb-1">Read before creating the draft</p>
              <ul className="space-y-1 text-sm text-amber-800">
                {warnings.map((w, i) => <li key={i} className="break-words">{w}</li>)}
              </ul>
            </section>
          )}
          <section aria-label="Payload JSON">
            <p className="kicker mb-1">Payload</p>
            <pre className="max-h-[50dvh] overflow-auto rounded-xl border border-line bg-paper p-3 font-mono text-[11px] leading-relaxed text-ink-2">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </section>
        </div>
      </div>
    </div>
  )
}
