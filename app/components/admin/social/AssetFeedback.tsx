/**
 * Owner heart / thumbs-down on a library image (ticket #11551).
 *
 * Posts intent=feedback to an admin route action (requireAdmin) through a
 * fetcher, so there is no page reload. Clicking either control sets the
 * verdict at once and opens a compact popover of fixed reason chips plus an
 * optional note. A chip toggle saves immediately; the note saves on close.
 * On phones the popover is a bottom sheet; from md: up it anchors to the card.
 */
import { useState } from 'react'
import { useFetcher } from 'react-router'
import { FEEDBACK_REASONS, NOTE_MAX, type FeedbackVerdict } from '~/lib/social-asset-feedback-reasons'

export interface AssetFeedbackState {
  verdict: FeedbackVerdict
  reasons: string[]
  note: string | null
}

type SaveResult = { ok: boolean; error?: string }

export function HeartGlyph({ filled, size = 16 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
      <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.9 3.9 4.5 7.3 4.5c2 0 3.5 1.1 4.7 2.8 1.2-1.7 2.7-2.8 4.7-2.8 3.4 0 5.6 3.4 4.5 6.6-1.7 4.8-9.2 9.4-9.2 9.4z" />
    </svg>
  )
}

export function ThumbDownGlyph({ filled, size = 16 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
      <path d="M10 15v4.5a2.5 2.5 0 0 0 2.5 2.5l3.5-8V3H6.6a2 2 0 0 0-2 1.7l-1.4 8A2 2 0 0 0 5.2 15H10zM16 3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
    </svg>
  )
}

export function AssetFeedbackControls({
  assetId,
  initial,
  action,
  size = 'sm',
}: {
  assetId: number
  initial: AssetFeedbackState | null
  /** Admin route that handles intent=feedback. */
  action: string
  /** sm = overlay on a grid card, md = inline on the detail drawer. */
  size?: 'sm' | 'md'
}) {
  const fetcher = useFetcher<SaveResult>()
  const [state, setState] = useState<AssetFeedbackState | null>(initial)
  const [open, setOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState(initial?.note ?? '')

  function save(next: AssetFeedbackState | null) {
    const fd = new FormData()
    fd.set('intent', 'feedback')
    fd.set('assetId', String(assetId))
    fd.set('verdict', next ? next.verdict : 'clear')
    if (next) {
      fd.set('reasons', next.reasons.join(','))
      fd.set('note', next.note ?? '')
    }
    fetcher.submit(fd, { method: 'post', action })
  }

  function pick(verdict: FeedbackVerdict) {
    if (state?.verdict === verdict) { setOpen(o => !o); return }
    // Switching verdict drops reasons (they belong to the other vocabulary) but keeps the note.
    const next = { verdict, reasons: [], note: noteDraft.trim() || null }
    setState(next)
    save(next)
    setOpen(true)
  }

  function toggleReason(value: string) {
    if (!state) return
    const has = state.reasons.includes(value)
    const next = { ...state, reasons: has ? state.reasons.filter(r => r !== value) : [...state.reasons, value] }
    setState(next)
    save(next)
  }

  function close() {
    setOpen(false)
    if (state && (noteDraft.trim() || null) !== state.note) {
      const next = { ...state, note: noteDraft.trim() || null }
      setState(next)
      save(next)
    }
  }

  function remove() {
    setState(null)
    setNoteDraft('')
    setOpen(false)
    save(null)
  }

  const btn = size === 'sm'
    ? 'w-9 h-9 md:w-8 md:h-8'
    : 'w-11 h-11'
  const loved = state?.verdict === 'up'
  const rejected = state?.verdict === 'down'

  return (
    <div className="relative inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => pick('up')}
        aria-pressed={loved}
        aria-label={`Love asset ${assetId}`}
        title="Love it"
        className={`${btn} inline-flex items-center justify-center rounded-full border transition-colors ${loved ? 'bg-coral border-coral text-white' : 'bg-paper/90 border-line text-ink-3 hover:text-coral'}`}
      >
        <HeartGlyph filled={loved} />
      </button>
      <button
        type="button"
        onClick={() => pick('down')}
        aria-pressed={rejected}
        aria-label={`Thumbs down asset ${assetId}`}
        title="Not this one"
        className={`${btn} inline-flex items-center justify-center rounded-full border transition-colors ${rejected ? 'bg-ink border-ink text-white' : 'bg-paper/90 border-line text-ink-3 hover:text-ink'}`}
      >
        <ThumbDownGlyph filled={rejected} />
      </button>

      {open && state && (
        <>
          <button type="button" aria-label="Close feedback" onClick={close} className="fixed inset-0 z-30 bg-ink/20 md:bg-transparent cursor-default" />
          <div
            role="dialog"
            aria-label={`Feedback for asset ${assetId}`}
            className="fixed inset-x-2 bottom-2 z-40 rounded-2xl border border-line bg-paper p-3 shadow-lg md:absolute md:inset-x-auto md:bottom-auto md:top-full md:right-0 md:mt-1 md:w-72"
          >
            <p className="text-xs font-semibold text-ink mb-2">
              {state.verdict === 'up' ? 'What works here ♥' : 'What missed'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {FEEDBACK_REASONS[state.verdict].map(r => {
                const on = state.reasons.includes(r.value)
                return (
                  <button
                    key={r.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleReason(r.value)}
                    className={`min-h-9 px-2.5 rounded-full border text-xs ${on ? 'border-coral bg-coral-soft text-ink' : 'border-line bg-paper text-ink-3 hover:border-ink-4'}`}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>
            <textarea
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              maxLength={NOTE_MAX}
              rows={2}
              placeholder="Anything else (optional)"
              aria-label="Feedback note"
              className="mt-2 w-full rounded-lg border border-line bg-paper p-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-coral/30"
            />
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={remove} className="min-h-9 px-3 text-xs text-ink-3 hover:text-ink">Remove rating</button>
              <span className="flex-1" />
              <span className="text-[11px] text-ink-4">{fetcher.state !== 'idle' ? 'Saving' : 'Saved'}</span>
              <button type="button" onClick={close} className="min-h-9 px-3 rounded-full bg-coral text-white text-xs font-semibold hover:bg-coral-2">Done</button>
            </div>
          </div>
        </>
      )}
      {fetcher.data?.ok === false && fetcher.state === 'idle' && (
        <span role="alert" className="absolute top-full left-0 mt-1 whitespace-nowrap rounded bg-paper px-1.5 py-0.5 text-[10px] text-red-700">{fetcher.data.error}</span>
      )}
    </div>
  )
}
