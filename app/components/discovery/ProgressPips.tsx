/**
 * Three small progress pips above the thread showing conversation step.
 * Step 0 = none filled, 1 = first filled, 2 = two filled, 3 = all filled.
 * Coral fill for complete pips, line-color hollow for remaining.
 */

interface ProgressPipsProps {
  step: 0 | 1 | 2 | 3
}

export function ProgressPips({ step }: ProgressPipsProps) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Question ${step} of 3`} role="progressbar" aria-valuenow={step} aria-valuemin={0} aria-valuemax={3}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className={[
            'block h-1 w-7 rounded-full transition-colors duration-300',
            i < step ? 'bg-coral' : 'bg-line',
          ].join(' ')}
        />
      ))}
    </div>
  )
}
