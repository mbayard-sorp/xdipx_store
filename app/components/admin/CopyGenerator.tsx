import { useFetcher } from 'react-router'
import { useState } from 'react'

interface CopyField {
  key:   string
  label: string
  type:  'tagline' | 'full_story' | 'both_ways' | 'bullets' | 'email_subjects' | 'seo_meta'
}

const COPY_FIELDS: CopyField[] = [
  { key: 'tagline',       label: 'Taglines (3 options)',  type: 'tagline'       },
  { key: 'full_story',    label: 'Full Story',            type: 'full_story'    },
  { key: 'both_ways',     label: 'Both Ways (Him / Her)', type: 'both_ways'     },
  { key: 'bullets',       label: 'Feature Bullets',       type: 'bullets'       },
  { key: 'email_subjects',label: 'Email Subjects',        type: 'email_subjects'},
  { key: 'seo_meta',      label: 'SEO Meta Description',  type: 'seo_meta'      },
]

// Types that go through the batch path when productId is available.
const BATCHABLE = new Set(['tagline', 'full_story', 'both_ways', 'bullets', 'seo_meta'])

interface CopyGeneratorProps {
  product: {
    title: string
    brand: string
    description: string
    categories: string[]
    dealPrice?: number
    msrp?: number
  }
  /** Shopify product GID. When provided, batchable fields are enqueued via
   *  the Batch API and return a jobId instead of inline content. */
  productId?: string
  sku?: string
  onUse?: (field: string, value: string) => void
}

type FetcherData =
  | { result: { content: unknown } }
  | { ok: true; jobId: string; status: 'queued' }
  | { error: string }

export function CopyGenerator({ product, productId, sku, onUse }: CopyGeneratorProps) {
  const fetcher  = useFetcher<FetcherData>()
  const [results, setResults] = useState<Record<string, string>>({})
  const [jobIds,  setJobIds]  = useState<Record<string, string>>({})
  const [active,  setActive]  = useState<string | null>(null)

  const isPending = fetcher.state !== 'idle'

  function generate(field: CopyField) {
    setActive(field.key)
    const fd = new FormData()
    fd.set('type',    field.type)
    fd.set('product', JSON.stringify(product))
    if (productId) {
      fd.set('productId', productId)
      fd.set('sku', sku ?? productId)
    }
    fetcher.submit(fd, { method: 'post', action: '/api/generate-copy' })
  }

  // Capture result when fetcher settles
  if (fetcher.state === 'idle' && fetcher.data && active) {
    const d = fetcher.data
    if ('result' in d && d.result) {
      const content = Array.isArray(d.result.content)
        ? (d.result.content as string[]).join('\n')
        : String(d.result.content)
      if (results[active] !== content) {
        setResults(prev => ({ ...prev, [active]: content }))
      }
    } else if ('jobId' in d && d.jobId) {
      if (jobIds[active] !== d.jobId) {
        setJobIds(prev => ({ ...prev, [active]: d.jobId }))
      }
    }
  }

  return (
    <div className="space-y-4">
      {COPY_FIELDS.map(field => {
        const isBatched = BATCHABLE.has(field.type) && Boolean(productId)
        const jobId     = jobIds[field.key]

        return (
          <div key={field.key} className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3
                className="font-semibold text-ink"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {field.label}
              </h3>
              <button
                type="button"
                onClick={() => generate(field)}
                disabled={isPending && active === field.key}
                className="text-xs font-bold px-3 py-1.5 bg-coral text-white rounded-full hover:opacity-90 disabled:opacity-60 transition-opacity"
              >
                {isPending && active === field.key ? '✨ Generating...' : '✨ Generate'}
              </button>
            </div>

            {jobId ? (
              <div className="text-xs text-ink/60 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 space-y-1">
                <p className="font-semibold text-green-700">Queued via Batch API.</p>
                <p>
                  Fields apply automatically when the batch completes.{' '}
                  <a
                    href={`/admin/async-jobs?jobId=${jobId}`}
                    className="underline text-coral hover:text-coral-2"
                  >
                    Track progress
                  </a>
                </p>
              </div>
            ) : results[field.key] ? (
              <div>
                <pre className="text-sm text-ink/80 whitespace-pre-wrap bg-cream-2 rounded-xl p-4 leading-relaxed">
                  {results[field.key]}
                </pre>
                <div className="flex gap-2 mt-2">
                  {!isBatched && (
                    <button
                      type="button"
                      onClick={() => onUse?.(field.key, results[field.key]!)}
                      className="text-xs font-semibold px-3 py-1.5 bg-sage text-white rounded-full hover:opacity-90 transition-opacity"
                    >
                      Use this ♥
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(results[field.key]!) }}
                    className="text-xs text-ink/50 hover:text-ink transition-colors"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => generate(field)}
                    className="text-xs text-ink/50 hover:text-ink transition-colors"
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink/40 italic">
                {isBatched
                  ? 'Click Generate to queue via Batch API — results apply automatically.'
                  : 'Click Generate to create copy for this field.'}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
