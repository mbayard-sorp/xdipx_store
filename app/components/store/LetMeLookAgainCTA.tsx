import { useMemo } from 'react'
import { useSearchParams } from 'react-router'

/**
 * Small CTA that asks Emma to take a fresh pass at the current discovery
 * context. Dispatches the `xdipx:emma:openWith` event so the AskEmmaWidget
 * opens with a seeded prompt describing the current query + filters.
 */

interface LetMeLookAgainCTAProps {
  query?:      string
  filters?:    {
    moods?:     string[]
    audiences?: string[]
    matters?:   string[]
    budgetMax?: number | null
  }
  collection?: string
  className?:  string
}

function buildPrompt(props: LetMeLookAgainCTAProps): string {
  const parts: string[] = []
  if (props.query) parts.push(`searching "${props.query}"`)
  if (props.collection) parts.push(`in the ${props.collection} collection`)
  const f = props.filters ?? {}
  const chips: string[] = []
  if (f.moods?.length)     chips.push(`mood: ${f.moods.join('/')}`)
  if (f.audiences?.length) chips.push(`audience: ${f.audiences.join('/')}`)
  if (f.matters?.length)   chips.push(`matters: ${f.matters.join('/')}`)
  if (f.budgetMax)         chips.push(`under $${f.budgetMax}`)
  if (chips.length) parts.push(`with ${chips.join(', ')}`)
  const ctx = parts.length ? ` (I'm ${parts.join(' ')})` : ''
  return `Not quite it. Can you look again?${ctx}`
}

const FILTER_KEYS = ['mood', 'audience', 'matters', 'budgetMax', 'preset'] as const

export function LetMeLookAgainCTA(props: LetMeLookAgainCTAProps) {
  const [params, setParams] = useSearchParams()

  const hasFilters = useMemo(
    () => FILTER_KEYS.some(k => params.has(k)),
    [params],
  )

  function onClick() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('xdipx:emma:openWith', { detail: { prompt: buildPrompt(props) } }),
    )
  }

  function onClear() {
    const next = new URLSearchParams(params)
    for (const k of FILTER_KEYS) next.delete(k)
    next.delete('page')
    setParams(next, { preventScrollReset: true })
  }

  return (
    <div className={`flex items-center justify-center gap-4 ${props.className ?? ''}`}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 text-sm text-coral hover:text-coral-deep underline underline-offset-4"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Not quite it? Let me look again →
      </button>
      {hasFilters && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink underline underline-offset-4"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Clear all
        </button>
      )}
    </div>
  )
}
