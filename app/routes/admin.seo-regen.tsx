import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useFetcher } from 'react-router'
import { useState } from 'react'
import { requireAdmin } from '~/lib/session.server'

export const meta: MetaFunction = () => [{ title: 'SEO Regen — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return null
}

const COPY_TYPES = [
  { value: 'tagline',      label: 'Tagline' },
  { value: 'full_story',   label: 'Full story' },
  { value: 'both_ways',    label: 'Both ways (For Him / For Her)' },
  { value: 'seo_meta',     label: 'SEO meta description' },
  { value: 'bullets',      label: 'Feature bullets' },
  { value: 'box_contents', label: 'Box contents' },
] as const

type CopyType = (typeof COPY_TYPES)[number]['value']

interface RegenResponse {
  ok: boolean
  handle?: string
  error?: string
  types?: Record<string, { ok: true; content: unknown } | { ok: false; error: string }>
}

function renderContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(c => typeof c === 'string' ? c : JSON.stringify(c, null, 2)).join('\n• ')
  if (content && typeof content === 'object') return JSON.stringify(content, null, 2)
  return String(content)
}

export default function AdminSeoRegen() {
  const fetcher = useFetcher<RegenResponse>()
  const [handle, setHandle] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<Set<CopyType>>(
    () => new Set<CopyType>(['tagline', 'full_story', 'both_ways', 'seo_meta', 'bullets']),
  )
  const [authorSlug, setAuthorSlug] = useState('')

  const submitting = fetcher.state !== 'idle'
  const result = fetcher.data

  function toggleType(t: CopyType) {
    const next = new Set(selectedTypes)
    if (next.has(t)) next.delete(t); else next.add(t)
    setSelectedTypes(next)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!handle.trim()) return
    const fd = new FormData()
    fd.set('handle', handle.trim())
    fd.set('types', Array.from(selectedTypes).join(','))
    if (authorSlug.trim()) fd.set('authorSlug', authorSlug.trim())
    fetcher.submit(fd, { method: 'post', action: '/api/regenerate-with-keywords' })
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-ink mb-2" style={{ fontFamily: 'var(--font-display)' }}>
        SEO Regen
      </h1>
      <p className="text-muted mb-6 text-sm">
        Regenerate product copy with full keyword targeting. Pulls
        productTypeDial + mood/audience/matters tags so the keyword bank can
        match by tag overlap. Output below is preview-only — copy values into
        their fields in the Deals editor to save.
      </p>

      <form onSubmit={submit} className="bg-paper border border-line rounded p-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-ink">Product handle</span>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="e.g. tracys-dog-pro-2"
            className="mt-1 w-full border border-line rounded px-3 py-2 font-body"
            required
          />
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-ink mb-2">Copy types</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {COPY_TYPES.map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedTypes.has(value)}
                  onChange={() => toggleType(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="text-sm font-medium text-ink">Editorial author slug (optional)</span>
          <input
            type="text"
            value={authorSlug}
            onChange={(e) => setAuthorSlug(e.target.value)}
            placeholder="e.g. emma — leave blank for default brand voice"
            className="mt-1 w-full border border-line rounded px-3 py-2 font-body"
          />
        </label>

        <button
          type="submit"
          disabled={submitting || !handle.trim() || selectedTypes.size === 0}
          className="w-full sm:w-auto bg-coral hover:bg-coral-2 disabled:bg-muted text-paper font-display font-bold px-6 py-2 rounded transition"
        >
          {submitting ? 'Regenerating…' : 'Regenerate with SEO targets'}
        </button>
      </form>

      {result && (
        <section className="mt-8">
          {!result.ok && result.error ? (
            <div className="bg-coral-deep/10 border border-coral-deep text-coral-deep rounded p-4 text-sm">
              {result.error}
            </div>
          ) : null}

          {result.types && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
                Results for <code className="text-base bg-cream-2 px-2 py-0.5 rounded">{result.handle}</code>
              </h2>
              {Object.entries(result.types).map(([type, r]) => (
                <article key={type} className="bg-paper border border-line rounded p-4">
                  <header className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <h3 className="font-display font-bold text-ink">{type}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded ${r.ok ? 'bg-sage/20 text-sage' : 'bg-coral-deep/20 text-coral-deep'}`}>
                      {r.ok ? 'ok' : 'failed'}
                    </span>
                  </header>
                  {r.ok ? (
                    <pre className="text-sm whitespace-pre-wrap font-body text-ink-2 max-h-96 overflow-auto">
                      {renderContent(r.content)}
                    </pre>
                  ) : (
                    <p className="text-sm text-coral-deep">{r.error}</p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
