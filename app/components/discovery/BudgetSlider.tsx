/**
 * Stepped budget slider.
 * Steps: 40 / 60 / 80 / 120 / null ("Any budget").
 * Native <input type="range"> styled with Tailwind.
 */

const STEPS = [40, 60, 80, 120, null] as const
type Step = (typeof STEPS)[number]

// Map slider index (0–4) to step value
function indexToStep(i: number): Step {
  return STEPS[Math.max(0, Math.min(STEPS.length - 1, i))] ?? null
}

function stepToIndex(v: number | null): number {
  if (v === null) return STEPS.length - 1
  const idx = STEPS.findIndex(s => s === v)
  return idx === -1 ? STEPS.length - 1 : idx
}

function stepLabel(v: number | null): string {
  return v === null ? 'Any budget' : `$${v}`
}

interface BudgetSliderProps {
  value: number | null
  onChange: (v: number | null) => void
}

export function BudgetSlider({ value, onChange }: BudgetSliderProps) {
  const idx = stepToIndex(value)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newIdx = Number(e.target.value)
    onChange(indexToStep(newIdx))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p
          className="text-xs uppercase tracking-widest text-muted"
          style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.14em' }}
        >
          Budget
        </p>
        <span
          className="text-sm font-semibold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {stepLabel(value)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={STEPS.length - 1}
        step={1}
        value={idx}
        onChange={handleChange}
        className="w-full accent-coral"
        aria-label="Budget filter"
        aria-valuetext={stepLabel(value)}
      />
      <div className="flex justify-between text-xs text-muted" style={{ fontFamily: 'var(--font-body)' }}>
        {STEPS.map((s, i) => (
          <span key={i}>{stepLabel(s)}</span>
        ))}
      </div>
    </div>
  )
}
