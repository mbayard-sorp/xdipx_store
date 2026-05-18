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
  /**
   * When true, suppress the built-in mono label — the parent renders its
   * own header (e.g. HomeA's "01 / A *mood* or sensation / Tap any" row).
   * Aria-label still falls back to `label` for screen readers.
   */
  hideLabel?: boolean
  /**
   * True when the user has selected at least one chip in ANY group. Drives
   * whether to surface the unavailable strike-through. At the empty state
   * the indicator is noise — the user hasn't built a brief yet — so we
   * render every vocab chip as clickable until they start choosing.
   */
  showAvailability?: boolean
  onToggle: (value: string) => void
}

export function ChipGroup({ label, group, values, selected, available, hideLabel, showAvailability, onToggle }: ChipGroupProps) {
  const availabilityActive = showAvailability && available !== undefined
  const availableSet = availabilityActive ? new Set(available) : null

  function handleToggle(value: string) {
    const on = !selected.includes(value)
    trackChipToggle({ group, value, on })
    onToggle(value)
  }

  return (
    <div className="flex flex-col gap-3" role="group" aria-label={label}>
      {!hideLabel && (
        <p
          className="text-[10px] uppercase tracking-[0.18em] text-ink-3"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {label}
        </p>
      )}
      <div className="flex flex-wrap gap-2.5">
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
