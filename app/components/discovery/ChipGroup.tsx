/**
 * Labeled row of chip toggles for one filter dimension.
 * Calls trackChipToggle on every toggle.
 */

import { trackChipToggle } from '~/lib/analytics.client'
import { displayLabel } from '~/lib/discovery-tags'
import { Chip } from './Chip'

interface ChipGroupProps {
  label: string
  group: 'mood' | 'audience' | 'matters' | 'category'
  values: readonly string[]
  selected: readonly string[]
  /**
   * Optional whitelist of chip values that still yield ≥1 result under
   * the current cross-group filter. Chips not in this set render
   * struck-through to signal "selecting this would zero the rail set."
   * Still clickable — toggling restores them when the conflict clears.
   */
  available?: readonly string[]
  onToggle: (value: string) => void
}

export function ChipGroup({ label, group, values, selected, available, onToggle }: ChipGroupProps) {
  const availableSet = available ? new Set(available) : null

  function handleToggle(value: string) {
    const on = !selected.includes(value)
    trackChipToggle({ group, value, on })
    onToggle(value)
  }

  return (
    <div className="flex flex-col gap-2">
      <p
        className="text-xs uppercase tracking-widest text-muted"
        style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.14em' }}
      >
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {values.map(value => {
          const isSelected = selected.includes(value)
          // Selected chips never render as unavailable — the user already
          // chose them. Without an `available` list, treat every chip as
          // available (no faceting signal).
          const isUnavailable = !isSelected && availableSet !== null && !availableSet.has(value)
          return (
            <Chip
              key={value}
              label={displayLabel(value)}
              on={isSelected}
              unavailable={isUnavailable}
              onToggle={() => handleToggle(value)}
            />
          )
        })}
      </div>
    </div>
  )
}
