/**
 * Single chip toggle button.
 * role="switch" + aria-checked per the spec.
 * 44px min-height for mobile hit target.
 */

interface ChipProps {
  label: string
  on: boolean
  /**
   * When true, the chip is rendered struck-through and dimmed to signal
   * "selecting this under your current filters would yield zero results."
   * Still clickable — the user might be loosening other selections next.
   */
  unavailable?: boolean
  onToggle: () => void
  size?: 'sm' | 'md'
}

export function Chip({ label, on, unavailable = false, onToggle, size = 'md' }: ChipProps) {
  const base = [
    'inline-flex items-center justify-center rounded-full border transition-colors',
    'min-h-[44px] cursor-pointer select-none',
    size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-2 text-sm',
  ]

  // Style-guide off-state: paper bg + 16% ink border + ink text.
  // On-state: ink fill + paper text + coral dot prefix (rendered as a ::before
  // pseudo via the `before:` utility, matching the .chip-pill.is-on spec).
  let stateClasses: string
  if (on) {
    stateClasses =
      'bg-ink text-paper border-ink font-medium ' +
      'before:content-[""] before:w-1.5 before:h-1.5 before:rounded-full before:bg-coral before:mr-2 before:inline-block'
  } else if (unavailable) {
    stateClasses = 'bg-paper text-ink-3 border-line-2 line-through opacity-50 hover:opacity-80'
  } else {
    stateClasses = 'bg-paper text-ink border-line-2 hover:border-ink/60'
  }

  return (
    <button
      role="switch"
      aria-checked={on}
      aria-disabled={unavailable || undefined}
      onClick={onToggle}
      className={[...base, stateClasses].join(' ')}
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {label}
    </button>
  )
}
