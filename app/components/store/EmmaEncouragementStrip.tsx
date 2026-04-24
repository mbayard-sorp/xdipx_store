import { useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher, useSearchParams } from 'react-router'

interface EmmaEncouragementStripProps {
  surface:     'search' | 'collection'
  collection?: string
  query?:      string
  /** ms to wait after the last filter change before firing. */
  debounceMs?: number
  className?:  string
}

interface Payload {
  message: string
  source:  'cache' | 'claude' | 'fallback'
}

/**
 * Strip above the product grid that shows a first-person Emma line
 * summarizing the shopper's current filter selections. Fires after the
 * shopper pauses for `debounceMs` (default 1800ms) so it doesn't chatter
 * on every chip toggle.
 */
export function EmmaEncouragementStrip({
  surface,
  collection,
  query = '',
  debounceMs = 1800,
  className,
}: EmmaEncouragementStripProps) {
  const [params] = useSearchParams()
  const fetcher = useFetcher<Payload>()
  const [message, setMessage] = useState<string>('')
  const [pending, setPending] = useState(false)
  const lastKeyRef = useRef<string>('')

  const filters = useMemo(() => ({
    moods:     params.getAll('mood'),
    audiences: params.getAll('audience'),
    matters:   params.getAll('matters'),
    budgetMax: params.get('budgetMax') ? Number(params.get('budgetMax')) : null,
    preset:    params.get('preset'),
  }), [params])

  const key = useMemo(() => JSON.stringify({
    surface, collection, query: query.trim().toLowerCase(), filters,
  }), [surface, collection, query, filters])

  useEffect(() => {
    if (key === lastKeyRef.current) return
    lastKeyRef.current = key
    setPending(true)
    const t = setTimeout(() => {
      fetcher.submit(
        JSON.stringify({ surface, collection, query, filters }),
        { method: 'post', action: '/api/emma-encouragement', encType: 'application/json' },
      )
    }, debounceMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, debounceMs])

  useEffect(() => {
    if (fetcher.data?.message) {
      setMessage(fetcher.data.message)
      setPending(false)
    }
  }, [fetcher.data])

  useEffect(() => {
    if (fetcher.state === 'loading' || fetcher.state === 'submitting') {
      setPending(true)
    }
  }, [fetcher.state])

  return (
    <div
      className={[
        'flex-1 min-w-0 rounded-full bg-paper/70 backdrop-blur-sm border border-line px-4 py-2 flex items-center',
        className ?? '',
      ].join(' ')}
      aria-live="polite"
      aria-busy={pending}
    >
      {pending && !message ? (
        <div className="flex items-center gap-2 w-full">
          <div className="h-2 w-2 rounded-full bg-coral/60 animate-pulse" />
          <div className="h-2 w-2 rounded-full bg-coral/40 animate-pulse [animation-delay:120ms]" />
          <div className="h-2 w-2 rounded-full bg-coral/30 animate-pulse [animation-delay:240ms]" />
          <span className="sr-only">Emma is thinking…</span>
        </div>
      ) : (
        <p className="text-xs text-ink/80 italic leading-snug truncate">
          {message || '✨ Pick a mood or what matters, and I\'ll meet you there.'}
        </p>
      )}
    </div>
  )
}
