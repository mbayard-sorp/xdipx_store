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
  onToggle: (value: string) => void
}

export function ChipGroup({ label, group, values, selected, onToggle }: ChipGroupProps) {
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
        {values.map(value => (
          <Chip
            key={value}
            label={displayLabel(value)}
            on={selected.includes(value)}
            onToggle={() => handleToggle(value)}
          />
        ))}
      </div>
    </div>
  )
}
