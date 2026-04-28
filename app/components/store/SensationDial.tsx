import type { ProductTypeDial, SensationDial as SensationDialValues, SensationDialV2 } from '~/types'

/**
 * Dial dimensions per product type. Order here = render order.
 * Keys match the keys Emma enters in the legacy `sensation_dial` JSON metafield.
 *
 * Phase 1 rebuild — only the legacy `vibrator`, `lube`, and `wear` keys have
 * curated dimensions (the legacy `air-pulsation` and `wand` are now subtypes
 * of `vibrator` and merged into that entry). For new top-level types
 * (dildo, anal, bondage, etc.) the orchestrator writes `sensation_dial_v2`
 * with self-describing { label, value } items — this component renders v2
 * directly when present, so new types don't need a legacy dim map.
 */
const DIMENSIONS_BY_TYPE: Partial<Record<ProductTypeDial, ReadonlyArray<{ key: keyof SensationDialValues; label: string }>>> = {
  vibrator: [
    { key: 'intensity',      label: 'Intensity'       },
    { key: 'quietness',      label: 'Quietness'       },
    { key: 'softness',       label: 'Softness'        },
    { key: 'patternVariety', label: 'Pattern variety' },
    { key: 'buildup',        label: 'Build-up'        },
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

export interface SensationDialAggregate {
  agrees:    number
  disagrees: number
  agreePct:  number
}

interface SensationDialProps {
  type:   ProductTypeDial
  /** Legacy `sensation_dial` shape (key-based). Optional when valuesV2 is provided. */
  values?: SensationDialValues
  /** New `sensation_dial_v2` shape (self-describing label+value items). Preferred when present. */
  valuesV2?: SensationDialV2
  /** Product-level aggregate vote totals. */
  aggregate?: SensationDialAggregate
  /** Current customer's own vote, for sticky-pressed state. */
  customerVote?: 1 | -1 | null
  /** Click handler — receives +1 or -1 for the whole product. */
  onAggregateVote?: (vote: 1 | -1) => void
  /** Whether voting is actively posting (disable buttons). */
  voting?: boolean
}

interface RenderItem { label: string; value: number }

export function SensationDial({
  type,
  values,
  valuesV2,
  aggregate: _aggregate,
  customerVote: _customerVote,
  onAggregateVote: _onAggregateVote,
  voting: _voting,
}: SensationDialProps) {
  // Prefer v2 — it's self-describing and covers the full taxonomy. Fall back
  // to the legacy key-based map for older `sensation_dial` data.
  const items: RenderItem[] = (() => {
    if (valuesV2?.items?.length) {
      return valuesV2.items
        .filter(it => it && typeof it.label === 'string' && it.label.trim())
        .map(it => ({
          label: it.label,
          value: Math.max(0, Math.min(5, Math.round(it.value ?? 0))),
        }))
        .filter(it => it.value > 0)
    }
    const dims = DIMENSIONS_BY_TYPE[type]
    if (!dims || !values) return []
    return dims
      .map(({ key, label }) => ({
        label,
        value: Math.max(0, Math.min(5, Math.round((values[key] ?? 0) as number))),
      }))
      .filter(it => it.value > 0)
  })()

  if (items.length === 0) return null

  return (
    <section className="bg-paper/90 rounded-[var(--radius-lg)] border border-line p-4 md:p-5">
      <header className="mb-3">
        <h3
          className="text-base md:text-lg font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          How it feels
        </h3>
      </header>

      <ul className="space-y-2">
        {items.map(({ label, value }) => (
          <li key={label} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-1.5">
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
                    'h-2.5 rounded-full transition-colors',
                    // Mobile: stretch to fill the row's extra space.
                    // lg+: fixed w-5 so bars left-justify next to the
                    // impulse cross-sell column (which sits beside the dial).
                    'flex-1 lg:flex-none lg:w-5',
                    i < value ? 'bg-coral' : 'bg-cream-2',
                  ].join(' ')}
                  aria-hidden="true"
                />
              ))}
            </div>
          </li>
        ))}
      </ul>

      {/* Aggregate vote footer hidden — uncomment to restore.
      {onAggregateVote && (
        <footer className="mt-5 pt-4 border-t border-line">
          <p
            className="text-xs uppercase tracking-wide text-muted"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Does this feel right to you?
          </p>
          <p className="mt-1 text-sm text-ink/80">
            <span className="text-sage mr-1" aria-hidden="true">♥</span>
            If you've tried it, tell me — I read every vote.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AggregateVoteChip
              direction={1}
              label="Agrees"
              count={agrees}
              active={customerVote === 1}
              disabled={!!voting}
              onClick={() => onAggregateVote(1)}
            />
            <AggregateVoteChip
              direction={-1}
              label="Disagrees"
              count={disagrees}
              active={customerVote === -1}
              disabled={!!voting}
              onClick={() => onAggregateVote(-1)}
            />
            {total > 0 && (
              <span className="ml-1 text-[11px] text-muted">
                {agreePct}% agree overall
              </span>
            )}
          </div>
        </footer>
      )}
      */}
    </section>
  )
}

// @ts-expect-error — kept for future restore of vote footer
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AggregateVoteChip({
  direction,
  label,
  count,
  active,
  disabled,
  onClick,
}: {
  direction: 1 | -1
  label:     string
  count:     number
  active:    boolean
  disabled:  boolean
  onClick:   () => void
}) {
  const emoji = direction === 1 ? '👍' : '👎'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={`${label}: ${count} ${direction === 1 ? 'thumbs up' : 'thumbs down'}`}
      className={[
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors',
        active
          ? 'border-coral bg-coral/10 text-coral'
          : 'border-line text-ink hover:border-coral hover:text-coral',
        disabled ? 'opacity-50 cursor-not-allowed hover:border-line hover:text-ink' : '',
      ].join(' ')}
    >
      <span aria-hidden="true">{emoji}</span>
      <span className="font-medium">{label}</span>
      <span className="text-muted">· {count}</span>
    </button>
  )
}
