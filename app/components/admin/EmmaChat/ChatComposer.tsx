import { useFetcher } from 'react-router'
import { useRef, useEffect, useCallback } from 'react'

interface ChatComposerProps {
  disabled?: boolean
  onSubmitted?: () => void
  /** Required when the composer is mounted on the single-chat page where the
   *  action lives at the parent route — the parent action needs the threadId.
   *  Optional in legacy thread-page contexts where the threadId is in the URL. */
  threadId?: number
}

export function ChatComposer({ disabled = false, onSubmitted, threadId }: ChatComposerProps) {
  const fetcher = useFetcher()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isSubmitting = fetcher.state !== 'idle'

  // Auto-resize textarea (1–6 rows)
  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    const lineHeight = 24
    const minHeight = lineHeight
    const maxHeight = lineHeight * 6
    el.style.height = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight) + 'px'
  }

  // Clear + notify after successful send
  const prevState = useRef(fetcher.state)
  useEffect(() => {
    if (prevState.current !== 'idle' && fetcher.state === 'idle' && fetcher.data) {
      if (textareaRef.current) {
        textareaRef.current.value = ''
        autoResize(textareaRef.current)
      }
      onSubmitted?.()
    }
    prevState.current = fetcher.state
  }, [fetcher.state, fetcher.data, onSubmitted])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      const form = e.currentTarget.form
      if (form && !disabled && !isSubmitting) {
        form.requestSubmit()
      }
    }
  }, [disabled, isSubmitting])

  return (
    <fetcher.Form method="post" className="flex gap-2 items-end">
      <input type="hidden" name="intent" value="send" />
      {threadId != null && <input type="hidden" name="threadId" value={threadId} />}
      <textarea
        ref={textareaRef}
        name="content"
        rows={1}
        placeholder="Ask Emma... (Cmd+Enter to send)"
        disabled={disabled || isSubmitting}
        onInput={e => autoResize(e.currentTarget)}
        onKeyDown={handleKeyDown}
        className={[
          'flex-1 resize-none rounded-xl border border-line bg-paper text-ink text-sm px-3 py-2.5',
          'placeholder:text-muted/50 focus:outline-none focus:border-coral/50 focus:ring-1 focus:ring-coral/20',
          'transition-all overflow-hidden min-h-[40px]',
          (disabled || isSubmitting) ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
        style={{ fontFamily: 'var(--font-body)', lineHeight: '24px' }}
      />
      <button
        type="submit"
        disabled={disabled || isSubmitting}
        className={[
          'shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all',
          disabled || isSubmitting
            ? 'bg-coral/40 text-white cursor-not-allowed'
            : 'bg-coral text-white hover:bg-coral-2 active:bg-coral-deep',
        ].join(' ')}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {isSubmitting ? 'Sending...' : 'Send'}
      </button>
    </fetcher.Form>
  )
}
