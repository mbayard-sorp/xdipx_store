import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { EmmaPreset } from '~/types/cms'

export interface AskEmmaRailProduct {
  moodTags?:     string[]
  audienceTags?: string[]
  mattersTags?:  string[]
  price:         number
}

interface AskEmmaRailProps {
  availableMoods:     string[]
  availableAudiences: string[]
  availableMatters:   string[]
  /** Budget slider bounds derived from current result set. */
  priceMin:  number
  priceMax:  number
  /**
   * Lightweight product set used to detect chips that would lead to a
   * zero-result page so they can be rendered as disabled. Should be the full
   * unfiltered set for the page, not the post-filter result.
   */
  products?: AskEmmaRailProduct[]
  /** Featured Emma presets (already sorted by order). */
  presets?:  EmmaPreset[]
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
  products,
  presets,
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

  const disabledMoods     = useDeadEndChips('mood',     availableMoods,     activeMoods,     params, products)
  const disabledAudiences = useDeadEndChips('audience', availableAudiences, activeAudiences, params, products)
  const disabledMatters   = useDeadEndChips('matters',  availableMatters,   activeMatters,   params, products)

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

  return (
    <>
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
          <Section title="1. Mood">
            <ChipGroup
              values={availableMoods}
              active={activeMoods}
              disabled={disabledMoods}
              onToggle={v => toggle('mood', v)}
            />
          </Section>
        )}

        {availableAudiences.length > 0 && (
          <Section title="2. Who's it for">
            <ChipGroup
              values={availableAudiences}
              labels={audienceLabel}
              active={activeAudiences}
              disabled={disabledAudiences}
              onToggle={v => toggle('audience', v)}
            />
          </Section>
        )}

        {availableMatters.length > 0 && (
          <Section title="3. What matters most">
            <ChipGroup
              values={availableMatters}
              active={activeMatters}
              disabled={disabledMatters}
              onToggle={v => toggle('matters', v)}
            />
          </Section>
        )}

        {priceMax > priceMin && (
          <Section title="4. Budget">
            <div className="text-xs text-muted mb-2">
              Up to <span className="text-ink font-medium">${budgetCap}</span>
            </div>
            <BudgetSlider
              priceMin={priceMin}
              priceMax={priceMax}
              value={budgetCap}
              onChange={setBudget}
            />
          </Section>
        )}

        <button
          type="button"
          onClick={clearAll}
          disabled={!anyActive}
          className="w-full rounded-full border border-line bg-paper py-2 text-sm font-semibold text-ink transition-colors hover:border-coral hover:text-coral disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Clear all
        </button>
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
        className="text-[16px] tracking-wide text-ink mb-2 font-semibold"
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
  disabled,
  onToggle,
  labels,
}: {
  values:    string[]
  active:    Set<string>
  disabled?: Set<string>
  onToggle:  (value: string) => void
  labels?:   (value: string) => string
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map(v => {
        const isOn  = active.has(v)
        const isOff = disabled?.has(v) && !isOn
        return (
          <button
            key={v}
            type="button"
            onClick={() => onToggle(v)}
            aria-pressed={isOn}
            disabled={isOff}
            title={isOff ? 'No products match this combination' : undefined}
            className={[
              'text-xs px-2.5 py-1 rounded-full border transition-colors',
              isOn
                ? 'bg-coral text-white border-coral'
                : isOff
                  ? 'border-line/60 text-ink/30 cursor-not-allowed line-through'
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

/**
 * Co-occurrence guard: returns the set of candidate values in `group` that
 * would produce a zero-result page if toggled on, given currently-active
 * filters in the URL. Active (already-selected) values are never included
 * so the shopper can always deselect their own choices.
 */
function useDeadEndChips(
  group: 'mood' | 'audience' | 'matters',
  values: string[],
  active: Set<string>,
  params: URLSearchParams,
  products: AskEmmaRailProduct[] | undefined,
): Set<string> {
  return useMemo(() => {
    const dead = new Set<string>()
    if (!products || products.length === 0 || values.length === 0) return dead
    for (const v of values) {
      if (active.has(v)) continue
      const sim = new URLSearchParams(params)
      const next = new Set(active)
      next.add(v)
      sim.set(group, setToCsv(next))
      sim.delete('preset')
      const hit = products.some(p => matchesAskEmmaFilters(p, sim))
      if (!hit) dead.add(v)
    }
    return dead
  }, [group, values, active, params, products])
}

function BudgetSlider({
  priceMin,
  priceMax,
  value,
  onChange,
}: {
  priceMin: number
  priceMax: number
  value:    number
  onChange: (v: number) => void
}) {
  const sliderMin = Math.max(10, Math.floor(priceMin))
  const sliderMax = Math.ceil(priceMax)
  const steps     = 6
  const span      = Math.max(1, sliderMax - sliderMin)
  const stepSize  = span / steps
  const stops: number[] = Array.from({ length: steps + 1 }, (_, i) =>
    Math.round(sliderMin + stepSize * i),
  )
  function snap(raw: number) {
    let best = stops[0]!
    let bestDiff = Math.abs(raw - best)
    for (const s of stops) {
      const d = Math.abs(raw - s)
      if (d < bestDiff) { best = s; bestDiff = d }
    }
    return best
  }
  const fillPct = ((value - sliderMin) / span) * 100
  return (
    <div>
      <div className="relative h-6">
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-[3px] border-dashed border-line"
          aria-hidden
        />
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 border-t-[3px] border-dashed border-coral"
          style={{ width: `${fillPct}%` }}
          aria-hidden
        />
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between" aria-hidden>
          {stops.map((s, i) => {
            const reached = s <= value
            return (
              <span
                key={i}
                className={[
                  'block w-3 h-3 rounded-full border-2 border-paper',
                  reached ? 'bg-coral' : 'bg-line',
                ].join(' ')}
              />
            )
          })}
        </div>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={Math.max(1, Math.round(stepSize))}
          value={value}
          onChange={e => onChange(snap(Number(e.target.value)))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label="Maximum price"
        />
      </div>
      <div className="flex justify-between text-[11px] text-muted mt-1">
        <span>${sliderMin}</span>
        <span>${sliderMax}</span>
      </div>
    </div>
  )
}

function audienceLabel(v: string): string {
  const map: Record<string, string> = { me: 'For me', us: 'For us', gift: 'As a gift' }
  return map[v] ?? v
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
