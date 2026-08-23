/**
 * "Edit prompt, regenerate" modal, the ImageManager improvement-modal pattern
 * pointed at /api/admin/social-image (social budget, never admin-images).
 * Single mode returns one image; cast mode composes an approved cast member
 * with the product photo and returns 2 candidates. Every result is also a
 * Library row once Phase 2's ingest is in; until then it is a URL.
 */
import { useState } from 'react'
import { useFetcher } from 'react-router'
import type { CastOption } from './CastPicker'
import { CloseIcon, RefreshIcon, CheckIcon } from './icons'

interface ImageResponse {
  ok?: boolean
  urls?: string[]
  assetIds?: number[]
  error?: string
  message?: string
  reason?: string
}

export function RegenerateModal({
  initialPrompt,
  sourceUrl,
  productHandle,
  productImageUrl,
  roster,
  defaultAspect,
  onUse,
  onClose,
}: {
  initialPrompt: string
  /** The image being redone, shown for reference. */
  sourceUrl: string | null
  productHandle: string | null
  productImageUrl: string | null
  roster: CastOption[]
  defaultAspect: '4:5' | '16:9' | '9:16' | '1:1'
  onUse: (picked: { url: string; assetId: number | null }) => void
  onClose: () => void
}) {
  const fetcher = useFetcher<ImageResponse>()
  const [prompt, setPrompt] = useState(initialPrompt)
  const [mode, setMode] = useState<'single' | 'cast'>('single')
  const [castSlug, setCastSlug] = useState(roster[0]?.slug ?? '')
  const [aspect, setAspect] = useState<'4:5' | '16:9' | '9:16' | '1:1'>(defaultAspect)
  const [refImageUrl, setRefImageUrl] = useState(productImageUrl ?? '')
  const busy = fetcher.state !== 'idle'
  const urls = fetcher.data?.ok ? fetcher.data.urls ?? [] : []
  const assetIds = fetcher.data?.assetIds ?? []
  const failure = fetcher.data && !fetcher.data.ok ? (fetcher.data.message ?? fetcher.data.error ?? 'Generation failed') : null

  function generate() {
    if (!prompt.trim()) return
    fetcher.submit(
      {
        mode,
        prompt: prompt.trim(),
        aspect,
        ...(productHandle ? { productHandle } : {}),
        ...(refImageUrl.trim() ? { refImageUrl: refImageUrl.trim() } : {}),
        ...(mode === 'cast' ? { castSlug } : {}),
      },
      { method: 'post', action: '/api/admin/social-image', encType: 'application/json' },
    )
  }

  return (
    <div className="fixed inset-0 z-[100] bg-ink/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4" role="dialog" aria-modal="true" aria-labelledby="regen-title">
      <div className="w-full md:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl md:rounded-2xl bg-paper border border-line">
        <div className="sticky top-0 bg-paper border-b border-line px-4 py-3 flex items-center justify-between">
          <h2 id="regen-title" className="font-display text-lg text-ink">Edit prompt, regenerate</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-ink-3 hover:bg-paper-2">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="p-4 grid gap-4 md:grid-cols-[200px_1fr]">
          <div className="space-y-2">
            {sourceUrl ? (
              <img src={sourceUrl} alt="Current image" className="w-full aspect-[4/5] object-cover rounded-xl border border-line bg-paper-3" />
            ) : (
              <div className="w-full aspect-[4/5] rounded-xl border border-dashed border-line bg-paper-2" aria-hidden="true" />
            )}
            <p className="font-mono text-[11px] text-ink-4">{sourceUrl ? 'current' : 'new image'}</p>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Prompt</span>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={6}
                className="mt-1 w-full rounded-xl border border-line bg-paper p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-coral/30"
                placeholder="Describe the scene. No text in the image. Name the product's real scale."
              />
              <span className="block text-right font-mono text-[11px] text-ink-4 tabular-nums">{prompt.length}/4000</span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Mode</span>
                <select value={mode} onChange={e => setMode(e.target.value as 'single' | 'cast')} className="mt-1 w-full min-h-11 rounded-xl border border-line bg-paper px-3 text-sm">
                  <option value="single">Single image</option>
                  <option value="cast" disabled={roster.length === 0}>Cast composite (2 candidates)</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Shape</span>
                <select value={aspect} onChange={e => setAspect(e.target.value as typeof aspect)} className="mt-1 w-full min-h-11 rounded-xl border border-line bg-paper px-3 text-sm font-mono">
                  <option value="4:5">4:5 Instagram</option>
                  <option value="16:9">16:9 X</option>
                  <option value="1:1">1:1</option>
                  <option value="9:16">9:16</option>
                </select>
              </label>
            </div>

            {mode === 'cast' && (
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Cast member</span>
                <select value={castSlug} onChange={e => setCastSlug(e.target.value)} className="mt-1 w-full min-h-11 rounded-xl border border-line bg-paper px-3 text-sm">
                  {roster.map(m => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                </select>
              </label>
            )}

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                Product photo URL {mode === 'cast' ? '(required)' : '(optional, keeps the real SKU)'}
              </span>
              <input
                value={refImageUrl}
                onChange={e => setRefImageUrl(e.target.value)}
                placeholder="https://cdn.shopify.com/..."
                className="mt-1 w-full min-h-11 rounded-xl border border-line bg-paper px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-coral/30"
              />
            </label>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-ink-3">
                Bills the social team's daily budget (about $0.04 single, $0.07 cast).
              </p>
              <button
                type="button"
                onClick={generate}
                disabled={busy || !prompt.trim() || (mode === 'cast' && (!castSlug || !refImageUrl.trim()))}
                className="inline-flex items-center gap-2 min-h-11 px-5 rounded-full bg-coral text-white text-sm font-semibold hover:bg-coral-2 disabled:opacity-50"
              >
                <RefreshIcon size={14} className={busy ? 'animate-spin' : ''} />
                {busy ? 'Generating' : 'Generate'}
              </button>
            </div>

            {failure && (
              <p className="text-xs text-red-700 rounded-xl border border-red-200 bg-red-50 p-3">{failure}</p>
            )}

            {urls.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">Results</p>
                <ul className="grid grid-cols-2 gap-3" role="list">
                  {urls.map((u, i) => (
                    <li key={u} className="space-y-1.5">
                      <img src={u} alt={`Candidate ${i + 1}`} className={`w-full object-cover rounded-xl border border-line bg-paper-3 ${aspect === '16:9' ? 'aspect-[16/9]' : aspect === '1:1' ? 'aspect-square' : aspect === '9:16' ? 'aspect-[9/16]' : 'aspect-[4/5]'}`} />
                      <button
                        type="button"
                        onClick={() => onUse({ url: u, assetId: assetIds[i] ?? null })}
                        className="w-full inline-flex items-center justify-center gap-1 min-h-11 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4"
                      >
                        <CheckIcon size={14} /> Use this one
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
