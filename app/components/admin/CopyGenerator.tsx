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

interface CopyGeneratorProps {
  product: {
    title: string
    brand: string
    description: string
    categories: string[]
    dealPrice?: number
    msrp?: number
  }
  onUse?: (field: string, value: string) => void
}

export function CopyGenerator({ product, onUse }: CopyGeneratorProps) {
  const fetcher  = useFetcher()
  const [results, setResults] = useState<Record<string, string>>({})
  const [active,  setActive]  = useState<string | null>(null)

  const isPending = fetcher.state !== 'idle'

  function generate(field: CopyField) {
    setActive(field.key)
    fetcher.submit(
      {
        type:    field.type,
        product: JSON.stringify(product),
      },
      { method: 'post', action: '/api/generate-copy' },
    )
  }

  // Capture result when fetcher settles
  if (fetcher.state === 'idle' && fetcher.data && active) {
    const d = fetcher.data as { result?: { content: unknown } }
    if (d.result) {
      const content = Array.isArray(d.result.content)
        ? (d.result.content as string[]).join('\n')
        : String(d.result.content)
      if (results[active] !== content) {
        setResults(prev => ({ ...prev, [active]: content }))
      }
    }
  }

  return (
    <div className="space-y-4">
      {COPY_FIELDS.map(field => (
        <div key={field.key} className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3
              className="font-semibold text-ink"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {field.label}
            </h3>
            <button
              onClick={() => generate(field)}
              disabled={isPending && active === field.key}
              className="text-xs font-bold px-3 py-1.5 bg-coral text-white rounded-full hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {isPending && active === field.key ? '✨ Generating...' : '✨ Generate'}
            </button>
          </div>

          {results[field.key] ? (
            <div>
              <pre className="text-sm text-ink/80 whitespace-pre-wrap bg-cream-2 rounded-xl p-4 leading-relaxed">
                {results[field.key]}
              </pre>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => onUse?.(field.key, results[field.key]!)}
                  className="text-xs font-semibold px-3 py-1.5 bg-sage text-white rounded-full hover:opacity-90 transition-opacity"
                >
                  Use this ♥
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(results[field.key]!) }}
                  className="text-xs text-ink/50 hover:text-ink transition-colors"
                >
                  Copy
                </button>
                <button
                  onClick={() => generate(field)}
                  className="text-xs text-ink/50 hover:text-ink transition-colors"
                >
                  Regenerate
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink/40 italic">
              Click Generate to create copy for this field.
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
