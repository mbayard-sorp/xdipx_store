import { useFetcher } from 'react-router'
import { useState, useRef, useEffect } from 'react'

export function NewThreadForm() {
  const fetcher = useFetcher()
  const [expanded, setExpanded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isSubmitting = fetcher.state !== 'idle'

  // Auto-focus composer when expanded
  useEffect(() => {
    if (expanded && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [expanded])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      const form = e.currentTarget.form
      if (form && !isSubmitting) form.requestSubmit()
    }
  }

  return (
    <div className="bg-paper border border-line rounded-2xl mb-6 overflow-hidden">
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full text-left px-5 py-4 flex items-center gap-3 hover:bg-cream/50 transition-colors"
        >
          <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-coral text-white shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </span>
          <span className="text-sm font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
            New thread
          </span>
          <span className="text-xs text-muted ml-1">Start a new Reddit reply draft with Emma</span>
        </button>
      ) : (
        <fetcher.Form method="post" className="p-5 space-y-4">
          <input type="hidden" name="intent" value="create" />

          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
              New thread
            </h3>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-muted hover:text-ink transition-colors"
              aria-label="Collapse"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
              Reddit post URL (optional)
            </label>
            <input
              type="url"
              name="redditPostUrl"
              placeholder="https://reddit.com/r/sextoys/comments/..."
              className="w-full rounded-xl border border-line bg-cream text-ink text-sm px-3 py-2 placeholder:text-muted/40 focus:outline-none focus:border-coral/50 focus:ring-1 focus:ring-coral/20 transition-all"
              style={{ fontFamily: 'var(--font-body)' }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
              Paste the Reddit post (optional)
            </label>
            <textarea
              name="redditPostExcerpt"
              rows={4}
              placeholder="Paste the original post text here so Emma has context..."
              className="w-full rounded-xl border border-line bg-cream text-ink text-sm px-3 py-2.5 placeholder:text-muted/40 focus:outline-none focus:border-coral/50 focus:ring-1 focus:ring-coral/20 transition-all resize-none"
              style={{ fontFamily: 'var(--font-body)' }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
              What do you want to ask Emma? <span className="text-coral">*</span>
            </label>
            <textarea
              ref={textareaRef}
              name="firstUserMessage"
              rows={3}
              required
              minLength={3}
              placeholder="e.g. Draft a reply recommending a quiet wand under $150 for beginners..."
              onKeyDown={handleKeyDown}
              className="w-full rounded-xl border border-line bg-cream text-ink text-sm px-3 py-2.5 placeholder:text-muted/40 focus:outline-none focus:border-coral/50 focus:ring-1 focus:ring-coral/20 transition-all resize-none"
              style={{ fontFamily: 'var(--font-body)' }}
            />
            <p className="text-xs text-muted/60 mt-1">Cmd+Enter to submit</p>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="px-4 py-2 text-sm font-medium text-muted hover:text-ink transition-colors rounded-xl"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={[
                'px-5 py-2 text-sm font-semibold rounded-xl transition-all',
                isSubmitting
                  ? 'bg-coral/40 text-white cursor-not-allowed'
                  : 'bg-coral text-white hover:bg-coral-2 active:bg-coral-deep',
              ].join(' ')}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {isSubmitting ? 'Starting...' : 'Start thread'}
            </button>
          </div>
        </fetcher.Form>
      )}
    </div>
  )
}
