import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { EmmaPreset } from '~/types/cms'

interface AskEmmaRailProps {
  availableMoods:     string[]
  availableAudiences: string[]
  availableMatters:   string[]
  /** Budget slider bounds derived from current result set. */
  priceMin:  number
  priceMax:  number
  /** Featured Emma presets (already sorted by order). */
  presets?:  EmmaPreset[]
  /** Shown above the grid when filters are active; optional override. */
  narrator?: string
}

const csvToSet = (csv: string | null): Set<string> =>
  new Set((csv ?? '').split(',').map(s => s.trim()).filter(Boolean))
const setToCsv = (set: Set<string>): string => Array.from(set).join(',')

/**
 * Ask Emma rail — left sidebar (desktop) / bottom sheet (mobile).
 * All state lives in the URL so links and back/forward work. Parent routes
 * read the same search params to filter their product grid.
 */
export function AskEmmaRail({
  availableMoods,
  availableAudiences,
  availableMatters,
  priceMin,
  priceMax,
  presets,
  narrator,
}: AskEmmaRailProps) {
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false) // mobile sheet

  const activeMoods     = useMemo(() => csvToSet(params.get('mood')),     [params])
  const activeAudiences = useMemo(() => csvToSet(params.get('audience')), [params])
  const activeMatters   = useMemo(() => csvToSet(params.get('matters')),  [params])
  const activePreset    = params.get('preset') ?? ''
  const budgetCap       = Number(params.get('budgetMax') ?? priceMax)

  const anyActive =
    activeMoods.size > 0 ||
    activeAudiences.size > 0 ||
    activeMatters.size > 0 ||
    !!activePreset ||
    budgetCap < priceMax

  function updateParams(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params)
    mutate(next)
    setParams(next, { preventScrollReset: true })
  }

  function toggle(group: 'mood' | 'audience' | 'matters', value: string) {
    updateParams(next => {
      const current = csvToSet(next.get(group))
      if (current.has(value)) current.delete(value)
      else current.add(value)
      if (current.size === 0) next.delete(group)
      else next.set(group, setToCsv(current))
      next.delete('preset') // manual edits clear preset
    })
  }

  function setBudget(value: number) {
    updateParams(next => {
      if (value >= priceMax) next.delete('budgetMax')
      else next.set('budgetMax', String(value))
      next.delete('preset')
    })
  }

  function applyPreset(preset: EmmaPreset) {
    updateParams(next => {
      if (preset.moodTags?.length)     next.set('mood',     preset.moodTags.join(','))     ; else next.delete('mood')
      if (preset.audienceTags?.length) next.set('audience', preset.audienceTags.join(',')) ; else next.delete('audience')
      if (preset.mattersTags?.length)  next.set('matters',  preset.mattersTags.join(','))  ; else next.delete('matters')
      if (preset.priceMax)             next.set('budgetMax', String(preset.priceMax))      ; else next.delete('budgetMax')
      next.set('preset', preset.slug)
    })
  }

  function clearAll() {
    updateParams(next => {
      next.delete('mood')
      next.delete('audience')
      next.delete('matters')
      next.delete('budgetMax')
      next.delete('preset')
    })
  }

  const activePresetObj = presets?.find(p => p.slug === activePreset)
  const narratorLine = narrator
    ?? activePresetObj?.narratorCopy
    ?? (anyActive ? buildNarratorLine({ activeMoods, activeAudiences, activeMatters, budgetCap, priceMax }) : null)

  return (
    <>
      {narratorLine && (
        <p className="mb-4 text-sm text-ink/75 italic" style={{ fontFamily: 'var(--font-display)' }}>
          {narratorLine}
        </p>
      )}

      {anyActive && (
        <div className="mb-5 flex flex-wrap gap-2" role="region" aria-label="Active filters">
          {Array.from(activeMoods).map(v => (
            <Chip key={`m-${v}`} label={v} onRemove={() => toggle('mood', v)} />
          ))}
          {Array.from(activeAudiences).map(v => (
            <Chip key={`a-${v}`} label={audienceLabel(v)} onRemove={() => toggle('audience', v)} />
          ))}
          {Array.from(activeMatters).map(v => (
            <Chip key={`w-${v}`} label={v} onRemove={() => toggle('matters', v)} />
          ))}
          {budgetCap < priceMax && (
            <Chip label={`under $${budgetCap}`} onRemove={() => setBudget(priceMax)} />
          )}
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-muted underline underline-offset-2 hover:text-coral ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden w-full mb-4 rounded-full border border-line bg-paper py-2.5 text-sm font-medium text-ink"
        aria-expanded={open}
      >
        Ask Emma {anyActive ? '· filters on' : ''}
      </button>

      <aside
        className={[
          'md:w-[200px] md:shrink-0 md:block',
          open ? 'block fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-[var(--radius-xl)] bg-paper p-5 shadow-2xl' : 'hidden',
        ].join(' ')}
        aria-label="Ask Emma"
      >
        <div className="md:hidden flex items-center justify-between mb-4">
          <h2 className="font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>Ask Emma</h2>
          <button type="button" onClick={() => setOpen(false)} className="text-muted text-sm" aria-label="Close">
            Done
          </button>
        </div>

        {presets && presets.length > 0 && (
          <Section title="Emma's picks">
            <ul className="space-y-1.5">
              {presets.filter(p => p.featured !== false).map(p => (
                <li key={p.slug}>
                  <button
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={[
                      'w-full text-left text-sm py-1.5 px-2 rounded-md transition-colors',
                      activePreset === p.slug
                        ? 'bg-coral/10 text-coral font-medium'
                        : 'text-ink/75 hover:bg-cream-2',
                    ].join(' ')}
                  >
                    {p.label}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {availableMoods.length > 0 && (
          <Section title="Mood">
            <ChipGroup
              values={availableMoods}
              active={activeMoods}
              onToggle={v => toggle('mood', v)}
            />
          </Section>
        )}

        {availableAudiences.length > 0 && (
          <Section title="Who">
            <ChipGroup
              values={availableAudiences}
              labels={audienceLabel}
              active={activeAudiences}
              onToggle={v => toggle('audience', v)}
            />
          </Section>
        )}

        {availableMatters.length > 0 && (
          <Section title="What matters">
            <ChipGroup
              values={availableMatters}
              active={activeMatters}
              onToggle={v => toggle('matters', v)}
            />
          </Section>
        )}

        {priceMax > priceMin && (
          <Section title="Budget">
            <div className="text-xs text-muted mb-2">
              Up to <span className="text-ink font-medium">${budgetCap}</span>
            </div>
            <input
              type="range"
              min={Math.max(10, Math.floor(priceMin))}
              max={Math.ceil(priceMax)}
              value={budgetCap}
              onChange={e => setBudget(Number(e.target.value))}
              className="w-full accent-coral"
              aria-label="Maximum price"
            />
            <div className="flex justify-between text-[11px] text-muted mt-1">
              <span>${Math.max(10, Math.floor(priceMin))}</span>
              <span>${Math.ceil(priceMax)}</span>
            </div>
          </Section>
        )}
      </aside>

      {open && (
        <button
          type="button"
          aria-label="Close filters"
          onClick={() => setOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-ink/40"
        />
      )}
    </>
  )
}

// ─── helpers ────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3
        className="text-[11px] uppercase tracking-wide text-muted mb-2 font-semibold"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {title}
      </h3>
      {children}
    </div>
  )
}

function ChipGroup({
  values,
  active,
  onToggle,
  labels,
}: {
  values:  string[]
  active:  Set<string>
  onToggle: (value: string) => void
  labels?: (value: string) => string
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map(v => {
        const isOn = active.has(v)
        return (
          <button
            key={v}
            type="button"
            onClick={() => onToggle(v)}
            aria-pressed={isOn}
            className={[
              'text-xs px-2.5 py-1 rounded-full border transition-colors',
              isOn
                ? 'bg-coral text-white border-coral'
                : 'border-line text-ink/70 hover:border-coral hover:text-coral',
            ].join(' ')}
          >
            {labels ? labels(v) : v}
          </button>
        )
      })}
    </div>
  )
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-coral text-white px-2.5 py-1 rounded-full">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="hover:opacity-80"
        aria-label={`Remove ${label} filter`}
      >
        ✕
      </button>
    </span>
  )
}

function audienceLabel(v: string): string {
  const map: Record<string, string> = { me: 'For me', us: 'For us', gift: 'As a gift' }
  return map[v] ?? v
}

function buildNarratorLine({
  activeMoods, activeAudiences, activeMatters, budgetCap, priceMax,
}: {
  activeMoods:     Set<string>
  activeAudiences: Set<string>
  activeMatters:   Set<string>
  budgetCap:       number
  priceMax:        number
}): string {
  const parts: string[] = []
  if (activeMoods.size)     parts.push(Array.from(activeMoods).join(' · '))
  if (activeAudiences.size) parts.push(Array.from(activeAudiences).map(audienceLabel).join(' or '))
  if (activeMatters.size)   parts.push(Array.from(activeMatters).join(', '))
  if (budgetCap < priceMax) parts.push(`under $${budgetCap}`)
  return `Okay — ${parts.join(', ')}. Here's what I'd try first.`
}

/**
 * Pure filter predicate — routes call this on each product after loading.
 * Kept out of the component so loaders (and tests) can use it too.
 */
export function matchesAskEmmaFilters(
  product: { moodTags?: string[]; audienceTags?: string[]; mattersTags?: string[]; price: number },
  params: URLSearchParams,
): boolean {
  const wantMoods     = csvToSet(params.get('mood'))
  const wantAudiences = csvToSet(params.get('audience'))
  const wantMatters   = csvToSet(params.get('matters'))
  const budgetMax     = Number(params.get('budgetMax') ?? Infinity)

  if (wantMoods.size     && !(product.moodTags     ?? []).some(t => wantMoods.has(t)))     return false
  if (wantAudiences.size && !(product.audienceTags ?? []).some(t => wantAudiences.has(t))) return false
  if (wantMatters.size   && !(product.mattersTags  ?? []).some(t => wantMatters.has(t)))   return false
  if (product.price > budgetMax) return false
  return true
}
