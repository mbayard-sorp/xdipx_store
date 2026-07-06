import { Link, useSearchParams } from 'react-router'
import type { EmmaPreset } from '~/types/cms'

export interface PlpMerchHeaderProps {
  mastheadKicker?: string
  themeLine?: string
  emphasisWord?: string
  /** Curated preset pills, already capped at 5 by the Sanity schema. */
  presets?: EmmaPreset[]
}

/**
 * 1k — PLP merch header. Masthead (plum hairlines, kicker + theme line with
 * italic-plum emphasis word, no image/no button) + up to 5 preset pills.
 *
 * Pills are real `<a>` links to `?preset={slug}` so the whole thing is
 * SSR-correct and works with zero JS — the active pill is derived straight
 * from the URL (same mechanism AskEmmaRail uses for `applyPreset`/
 * `activePreset`), just rendered as links instead of buttons here so an
 * unhydrated page still lets a shopper pick a preset.
 *
 * Binding-rule correction (see docs/merch-build-plan.md): the comp's
 * "+N more" overflow pill is intentionally NOT implemented — the Sanity
 * schema caps `presets` at 5 via `Rule.max(5)`, so the row can never
 * overflow and the dashed overflow chip has nothing to render.
 */
export function PlpMerchHeader({ mastheadKicker, themeLine, emphasisWord, presets }: PlpMerchHeaderProps) {
  const [params] = useSearchParams()
  const activePreset = params.get('preset') ?? ''
  const cappedPresets = (presets ?? []).slice(0, 5)
  const active = cappedPresets.find(p => p.slug === activePreset)

  if (!themeLine && cappedPresets.length === 0) return null

  return (
    <header className="border-t border-b border-plum">
      {themeLine && (
        <div className="px-5 py-[22px] text-center flex flex-col gap-1.5 md:px-10 md:py-[26px] md:gap-[7px]">
          {mastheadKicker && <p className="kicker">{mastheadKicker}</p>}
          <h1
            className="text-ink font-[450] text-2xl leading-[1.15] md:text-[30px]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <EmphasizedThemeLine text={themeLine} {...(emphasisWord ? { emphasisWord } : {})} />
          </h1>
        </div>
      )}

      {cappedPresets.length > 0 && (
        <>
          <nav
            aria-label="Curated shelves"
            className="flex gap-2 overflow-x-auto px-5 pt-4 pb-0 md:flex-wrap md:justify-center md:gap-[9px] md:px-10"
          >
            {cappedPresets.map(preset => (
              <PresetPill
                key={preset.slug}
                preset={preset}
                isActive={preset.slug === activePreset}
                params={params}
              />
            ))}
          </nav>

          {/* Height-reserved narrator row — always rendered (even with no
              active preset) so switching pills never shifts layout. */}
          <p
            className="px-5 pt-3 text-center text-[14px] italic text-ink-3 md:px-10 md:pt-[13px] md:text-[14.5px] min-h-[1.4em]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {active?.narratorCopy ?? ' '}
          </p>
        </>
      )}
    </header>
  )
}

function EmphasizedThemeLine({ text, emphasisWord }: { text: string; emphasisWord?: string }) {
  if (!emphasisWord) return <>{text}</>
  const idx = text.toLowerCase().lastIndexOf(emphasisWord.toLowerCase())
  if (idx < 0) return <>{text}</>
  const before = text.slice(0, idx)
  const match = text.slice(idx, idx + emphasisWord.length)
  const after = text.slice(idx + emphasisWord.length)
  return (
    <>
      {before}
      <em className="em">{match}</em>
      {after}
    </>
  )
}

function PresetPill({
  preset,
  isActive,
  params,
}: {
  preset:   EmmaPreset
  isActive: boolean
  params:   URLSearchParams
}) {
  const next = new URLSearchParams(params)
  if (isActive) {
    // Selected pill clears the preset back to the unfiltered shelf.
    next.delete('preset')
    next.delete('mood')
    next.delete('audience')
    next.delete('matters')
    next.delete('budgetMax')
  } else {
    if (preset.moodTags?.length)     next.set('mood',     preset.moodTags.join(','))
    if (preset.audienceTags?.length) next.set('audience', preset.audienceTags.join(','))
    if (preset.mattersTags?.length)  next.set('matters',  preset.mattersTags.join(','))
    if (preset.priceMax)             next.set('budgetMax', String(preset.priceMax))
    next.set('preset', preset.slug)
  }
  next.delete('page')
  const href = `?${next.toString()}`

  return (
    <Link
      to={href}
      preventScrollReset
      aria-current={isActive ? 'true' : undefined}
      className={[
        'flex-none rounded-full border px-3.5 py-[9px] text-[12.5px] font-medium transition-colors md:px-4 md:text-[13px]',
        isActive
          ? 'border-plum bg-plum text-paper'
          : 'border-line-2 text-ink hover:border-coral hover:text-coral',
      ].join(' ')}
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {preset.label}
    </Link>
  )
}
