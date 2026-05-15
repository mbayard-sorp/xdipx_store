/**
 * Single chip toggle button.
 * role="switch" + aria-checked per the spec.
 * 44px min-height for mobile hit target.
 */

interface ChipProps {
  label: string
  on: boolean
  onToggle: () => void
  size?: 'sm' | 'md'
}

export function Chip({ label, on, onToggle, size = 'md' }: ChipProps) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={[
        'inline-flex items-center justify-center rounded-full border transition-colors',
        'min-h-[44px] cursor-pointer select-none',
        size === 'sm'
          ? 'px-3 py-1 text-xs'
          : 'px-4 py-2 text-sm',
        on
          ? 'bg-ink text-paper border-ink font-semibold'
          : 'bg-cream-2 text-ink border-line hover:border-ink/40 hover:bg-cream',
      ].join(' ')}
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {label}
    </button>
  )
}
