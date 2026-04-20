import type { ProductTypeDial, SensationDial as SensationDialValues } from '~/types'

/**
 * Dial dimensions per product type. Order here = render order.
 * Keys match the keys Emma enters in the `sensation_dial` JSON metafield.
 */
const DIMENSIONS_BY_TYPE: Record<ProductTypeDial, ReadonlyArray<{ key: keyof SensationDialValues; label: string }>> = {
  'air-pulsation': [
    { key: 'intensity',      label: 'Intensity'       },
    { key: 'quietness',      label: 'Quietness'       },
    { key: 'softness',       label: 'Softness'        },
    { key: 'suction',        label: 'Suction'         },
    { key: 'buildup',        label: 'Build-up'        },
    { key: 'learningCurve',  label: 'Learning curve'  },
  ],
  vibrator: [
    { key: 'intensity',      label: 'Intensity'       },
    { key: 'quietness',      label: 'Quietness'       },
    { key: 'softness',       label: 'Softness'        },
    { key: 'patternVariety', label: 'Pattern variety' },
    { key: 'buildup',        label: 'Build-up'        },
    { key: 'learningCurve',  label: 'Learning curve'  },
  ],
  wand: [
    { key: 'intensity',      label: 'Intensity'       },
    { key: 'quietness',      label: 'Quietness'       },
    { key: 'reach',          label: 'Reach'           },
    { key: 'softness',       label: 'Softness'        },
    { key: 'patternVariety', label: 'Pattern variety' },
    { key: 'learningCurve',  label: 'Learning curve'  },
  ],
  lube: [
    { key: 'slipperiness',   label: 'Slipperiness'    },
    { key: 'longevity',      label: 'Longevity'       },
    { key: 'softness',       label: 'Softness'        },
  ],
  wear: [
    { key: 'fit',            label: 'Fit'             },
    { key: 'softness',       label: 'Softness'        },
    { key: 'intensity',      label: 'Intensity'       },
  ],
}

interface SensationDialProps {
  type:   ProductTypeDial
  values: SensationDialValues
  /** Optional vote aggregates keyed by dimension. */
  agreeByDimension?: Record<string, { agreePct: number; votes: number }>
  /** Click handler — receives the dimension key for inline voting UI. */
  onVote?: (dimension: string, vote: 1 | -1) => void
  /** Whether voting is gated (user not signed in). */
  votingLocked?: boolean
}

export function SensationDial({ type, values, agreeByDimension, onVote, votingLocked }: SensationDialProps) {
  const dims = DIMENSIONS_BY_TYPE[type]
  return (
    <section className="bg-paper rounded-[var(--radius-lg)] border border-line p-5 md:p-6">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h3
          className="text-base md:text-lg font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Sensation dial
        </h3>
        <span className="text-[11px] uppercase tracking-wide text-muted">
          Emma's read · 1–5
        </span>
      </header>

      <ul className="space-y-3">
        {dims.map(({ key, label }) => {
          const value = Math.max(0, Math.min(5, Math.round(values[key] ?? 0)))
          if (!value) return null
          const agree = agreeByDimension?.[key as string]
          return (
            <li key={key as string} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
              <span
                className="text-sm font-medium text-ink"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {label}
              </span>
              <div
                className="flex gap-1.5"
                aria-label={`${label}: ${value} of 5`}
                role="img"
              >
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className={[
                      'h-2.5 flex-1 rounded-full transition-colors',
                      i < value ? 'bg-coral' : 'bg-cream-2',
                    ].join(' ')}
                    aria-hidden="true"
                  />
                ))}
              </div>
              {onVote ? (
                <DialVotePair
                  dimension={key as string}
                  onVote={onVote}
                  {...(votingLocked !== undefined ? { locked: votingLocked } : {})}
                  {...(agree?.agreePct !== undefined ? { agreePct: agree.agreePct } : {})}
                  {...(agree?.votes !== undefined ? { votes: agree.votes } : {})}
                />
              ) : (
                agree && agree.votes > 0 ? (
                  <span className="text-[11px] text-muted whitespace-nowrap">
                    {agree.agreePct}% agree · {agree.votes}
                  </span>
                ) : <span aria-hidden="true" className="w-0" />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function DialVotePair({
  dimension,
  onVote,
  locked,
  agreePct,
  votes,
}: {
  dimension: string
  onVote:    (dimension: string, vote: 1 | -1) => void
  locked?:   boolean
  agreePct?: number
  votes?:    number
}) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted whitespace-nowrap">
      {votes !== undefined && votes > 0 && (
        <span aria-label={`${agreePct}% agree`}>
          {agreePct}%
        </span>
      )}
      <button
        type="button"
        onClick={() => onVote(dimension, 1)}
        disabled={locked}
        className="w-7 h-7 rounded-full border border-line hover:border-coral hover:text-coral transition-colors disabled:opacity-40 disabled:hover:border-line disabled:hover:text-muted"
        aria-label={`Agree with ${dimension} rating`}
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => onVote(dimension, -1)}
        disabled={locked}
        className="w-7 h-7 rounded-full border border-line hover:border-coral hover:text-coral transition-colors disabled:opacity-40 disabled:hover:border-line disabled:hover:text-muted"
        aria-label={`Disagree with ${dimension} rating`}
      >
        👎
      </button>
    </div>
  )
}
