/**
 * Segmented status control plus select chips plus active chips (wires 4.2).
 * Pattern lifted from the Social library route. Every change is a URL change
 * through the callbacks (setSearchParams with preventScrollReset), never local
 * state, so back works. Chips are min-h-11 on phones.
 */
import { ArchiveIcon, CloseIcon } from '~/components/admin/social/icons'

export interface SegmentOption { value: string; label: string }

export interface SelectSpec {
  key: string
  label: string
  value: string | null
  options: string[]
  labels?: Record<string, string>
}

export function FilterBar({
  segments,
  segmentValue,
  onSegment,
  selects,
  onSelect,
  archived,
  onArchived,
  toggles,
  chips,
  onClearAll,
}: {
  segments: SegmentOption[]
  segmentValue: string
  onSegment: (value: string) => void
  selects: SelectSpec[]
  onSelect: (key: string, value: string | null) => void
  archived?: boolean
  onArchived?: (on: boolean) => void
  /** Extra on/off chips beside the selects (Creatives: Group by idea, Blocked). */
  toggles?: Array<{ key: string; label: string; on: boolean; onToggle: (on: boolean) => void }>
  /** Extra removable active chips (Creatives: the idea filter). */
  chips?: Array<{ key: string; label: string; onClear: () => void }>
  onClearAll?: () => void
}) {
  const active = selects.filter(s => s.value)
  return (
    <div className="space-y-2">
      <div role="group" aria-label="Show" className="grid grid-cols-4 gap-1 rounded-2xl border border-line bg-paper p-1">
        {segments.map(s => {
          const on = s.value === segmentValue
          return (
            <button
              key={s.value}
              type="button"
              aria-pressed={on}
              onClick={() => onSegment(s.value)}
              className={`min-h-11 rounded-xl px-1 text-sm touch-manipulation ${on ? 'bg-ink text-white font-semibold' : 'text-ink-3 hover:bg-paper-3'}`}
            >
              {s.label}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 md:mx-0 md:px-0 pb-1">
        {selects.map(sel => sel.options.length > 0 && (
          <label key={sel.key} className="relative shrink-0 inline-flex items-center text-xs text-ink-3">
            <span className="sr-only">{sel.label}</span>
            <select
              value={sel.value ?? ''}
              onChange={e => onSelect(sel.key, e.target.value || null)}
              className={`min-h-11 md:min-h-9 max-w-44 rounded-full border bg-paper px-3 text-xs ${sel.value ? 'border-coral text-ink' : 'border-line text-ink-3'}`}
            >
              <option value="">{sel.label}</option>
              {sel.options.map(o => <option key={o} value={o}>{sel.labels?.[o] ?? o}</option>)}
            </select>
          </label>
        ))}
        {onArchived && (
          <button
            type="button"
            onClick={() => onArchived(!archived)}
            aria-pressed={!!archived}
            className={`shrink-0 inline-flex items-center gap-1 min-h-11 md:min-h-9 px-3 rounded-full border text-xs font-mono touch-manipulation ${archived ? 'border-coral bg-coral-soft text-ink' : 'border-line bg-paper text-ink-3 hover:border-ink-4'}`}
          >
            <ArchiveIcon size={10} /> Archived
          </button>
        )}
        {toggles?.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => t.onToggle(!t.on)}
            aria-pressed={t.on}
            className={`shrink-0 inline-flex items-center gap-1 min-h-11 md:min-h-9 px-3 rounded-full border text-xs font-mono touch-manipulation ${t.on ? 'border-coral bg-coral-soft text-ink' : 'border-line bg-paper text-ink-3 hover:border-ink-4'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {(active.length > 0 || (chips?.length ?? 0) > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {active.map(sel => (
            <button
              key={sel.key}
              type="button"
              onClick={() => onSelect(sel.key, null)}
              className="inline-flex items-center gap-1 min-h-11 md:min-h-9 px-3 rounded-full bg-ink text-white text-xs font-mono touch-manipulation"
            >
              {sel.label.toLowerCase()}: {sel.labels?.[sel.value ?? ''] ?? sel.value} <CloseIcon size={10} />
            </button>
          ))}
          {chips?.map(c => (
            <button
              key={c.key}
              type="button"
              onClick={c.onClear}
              className="inline-flex items-center gap-1 min-h-11 md:min-h-9 px-3 rounded-full bg-ink text-white text-xs font-mono touch-manipulation"
            >
              {c.label} <CloseIcon size={10} />
            </button>
          ))}
          {onClearAll && (
            <button type="button" onClick={onClearAll} className="min-h-11 md:min-h-9 px-2 text-xs text-ink-3 hover:text-ink">
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  )
}
