import type { KeyboardEvent } from 'react'

interface ToggleProps {
  /** Current on/off state */
  checked: boolean
  /** Called with the next value when the user toggles */
  onChange: (next: boolean) => void
  /** id of a separate label element; wired to aria-labelledby */
  labelId: string
  /** Optional disabled state — greyed out and non-interactive */
  disabled?: boolean
}

/**
 * Accessible switch component.
 *
 * - role="switch", aria-checked, aria-labelledby (paired with an external label id)
 * - Space / Enter toggles via the native <button> default keyboard behavior
 *   (we still include an explicit handler for belt-and-suspenders)
 * - 44x24 track + 20x20 thumb; smooth 150ms translate transition
 * - sage when on, cream-2 when off
 * - Wrapped in a 44px minimum touch target (p-2.5 around the visual track)
 */
export function Toggle({ checked, onChange, labelId, disabled = false }: ToggleProps) {
  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      onChange(!checked)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked) }}
      onKeyDown={handleKeyDown}
      className={`
        inline-flex items-center justify-center p-2.5 rounded-full shrink-0
        focus:outline-none focus:ring-2 focus:ring-sage/50
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span
        aria-hidden="true"
        className={`
          relative inline-block w-11 h-6 rounded-full transition-colors duration-150
          ${checked ? 'bg-sage' : 'bg-cream-2'}
        `}
      >
        <span
          className={`
            absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm
            transition-transform duration-150 ease-out
            ${checked ? 'translate-x-5' : 'translate-x-0'}
          `}
        />
      </span>
    </button>
  )
}
