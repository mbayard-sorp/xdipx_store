/**
 * User's answer echoed back as a coral-tinted editable pill.
 * The × clears the answer and resets to that question so the user can revise.
 */

interface SaidPillProps {
  label: string
  onClear: () => void
}

export function SaidPill({ label, onClear }: SaidPillProps) {
  return (
    <span
      className="inline-flex items-center gap-1.5 bg-coral/10 text-coral border border-coral/25 rounded-full px-3 py-1 text-sm leading-none"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Edit your answer: ${label}`}
        className="text-coral/60 hover:text-coral transition-colors text-base leading-none -mr-0.5"
      >
        ×
      </button>
    </span>
  )
}
