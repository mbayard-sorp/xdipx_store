import { useMemo } from 'react'
import type { ProductVariant } from '~/types'

interface VariantSelectorProps {
  variants:          ProductVariant[]
  options:           { name: string; values: string[] }[]
  selectedOptions:   Record<string, string>
  onSelectionChange: (next: Record<string, string>) => void
  swatches?:         Record<string, string>
}

const COLOR_MAP: Record<string, string> = {
  black:   '#151211',
  white:   '#FFFFFF',
  cream:   '#FAF4EA',
  ivory:   '#F5EFE0',
  rose:    '#E8B4B8',
  pink:    '#FFC0CB',
  coral:   '#FF6A3D',
  red:     '#D93A15',
  lilac:   '#C8A2D9',
  purple:  '#7C3AED',
  sage:    '#7C8F78',
  green:   '#4A7C59',
  navy:    '#1E3A5F',
  blue:    '#3B6BCE',
  gold:    '#D4AF37',
  silver:  '#C0C0C0',
  teal:    '#2BA19F',
  sand:    '#D9C7A7',
  charcoal:'#36332F',
  plum:    '#6B2D5C',
  nude:    '#E3C4A8',
  clear:   'transparent',
}

function isColorOption(name: string): boolean {
  const n = name.toLowerCase()
  return n === 'color' || n === 'colour'
}

function resolveSwatchColor(value: string, swatches?: Record<string, string>): string {
  const full = value.toLowerCase().trim()
  const first = full.split(/\s+/)[0] ?? ''
  return swatches?.[full] ?? COLOR_MAP[first] ?? '#F2EADD'
}

function matches(variant: ProductVariant, selection: Record<string, string>): boolean {
  return Object.entries(selection).every(([name, value]) =>
    variant.selectedOptions.some(o => o.name === name && o.value === value),
  )
}

/**
 * Find the single variant whose selectedOptions exactly match every key in
 * `selection`. Returns undefined for partial selections on multi-axis products.
 */
export function resolveVariant(
  variants: ProductVariant[],
  selection: Record<string, string>,
  optionNames?: string[],
): ProductVariant | undefined {
  const names = optionNames ?? Object.keys(selection)
  // No axes at all, or any axis still unchosen → this is not yet a concrete
  // variant. Without the length guard an empty selection would fall through to
  // `matches(v, {})`, which is vacuously true for EVERY variant and would
  // silently resolve to variants[0] — i.e. add the wrong SKU to the cart.
  if (names.length === 0) return undefined
  if (names.some(n => !selection[n])) return undefined
  // Require an EXACT match, not just a subset: the variant must satisfy every
  // chosen axis (matches) AND the selection must account for every one of the
  // variant's own option axes. This guarantees a loose selection can never
  // point at an arbitrary variant even if `optionNames` fails to list an axis
  // the variants actually carry.
  return variants.find(v =>
    matches(v, selection) &&
    v.selectedOptions.every(o => selection[o.name] === o.value),
  )
}

/**
 * Would flipping `optionName` to `value` point at a variant that exists AND is
 * in stock? Holds the rest of `selection` fixed.
 */
export function isValueAvailable(
  variants: ProductVariant[],
  optionName: string,
  value: string,
  selection: Record<string, string>,
): boolean {
  const next = { ...selection, [optionName]: value }
  return variants.some(
    v => matches(v, next) && v.availableForSale && v.quantityAvailable !== 0,
  )
}

/**
 * Does a variant with this axis value exist at all (regardless of stock)?
 * Used to distinguish "never made" (Sage/XL) from "sold out" (Sage/L).
 */
export function valueExists(
  variants: ProductVariant[],
  optionName: string,
  value: string,
  selection: Record<string, string>,
): boolean {
  const next = { ...selection, [optionName]: value }
  return variants.some(v => matches(v, next))
}

export function VariantSelector({
  variants,
  options,
  selectedOptions,
  onSelectionChange,
  swatches,
}: VariantSelectorProps) {
  const resolved = useMemo(() => resolveVariant(variants, selectedOptions, options.map(o => o.name)), [variants, selectedOptions, options])

  // OOS hint — only when the selection fully resolves to an OOS variant AND a
  // color axis exists with an in-stock alternative.
  const oosFallback = useMemo(() => {
    if (!resolved || resolved.availableForSale) return null
    const colorOpt = options.find(o => isColorOption(o.name))
    if (!colorOpt) return null
    const altColor = colorOpt.values.find(v =>
      v !== selectedOptions[colorOpt.name] &&
      isValueAvailable(variants, colorOpt.name, v, selectedOptions),
    )
    if (!altColor) return null
    return { optionName: colorOpt.name, value: altColor }
  }, [resolved, options, variants, selectedOptions])

  if (variants.length <= 1 || options.length === 0) return null

  return (
    <div className="space-y-4 w-full">
      {options.map(opt => {
        const current  = selectedOptions[opt.name]
        const useSwatch = isColorOption(opt.name)

        return (
          <div key={opt.name}>
            {options.length > 1 && (
              <div
                className="text-[11px] uppercase tracking-wider text-muted mb-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {opt.name}{current ? ': ' : ''}
                {current && <span className="text-ink font-semibold normal-case tracking-normal">{current}</span>}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {opt.values.map(val => {
                const exists    = valueExists(variants, opt.name, val, selectedOptions)
                const available = exists && isValueAvailable(variants, opt.name, val, selectedOptions)
                const isSelected = current === val

                if (useSwatch) {
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => exists && onSelectionChange({ ...selectedOptions, [opt.name]: val })}
                      disabled={!exists}
                      aria-pressed={isSelected}
                      aria-label={`${opt.name}: ${val}${available ? '' : exists ? ' (out of stock)' : ' (unavailable)'}`}
                      title={val}
                      className={[
                        'relative w-10 h-10 rounded-full border-2 transition-all',
                        isSelected
                          ? 'border-coral ring-2 ring-coral/30 ring-offset-2 ring-offset-paper'
                          : 'border-line hover:border-coral/60',
                        !exists && 'opacity-30 cursor-not-allowed',
                        exists && !available && 'opacity-50',
                      ].filter(Boolean).join(' ')}
                      style={{ backgroundColor: resolveSwatchColor(val, swatches) }}
                    >
                      {exists && !available && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 flex items-center justify-center text-ink/60 text-lg"
                        >
                          ⊘
                        </span>
                      )}
                    </button>
                  )
                }

                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => exists && onSelectionChange({ ...selectedOptions, [opt.name]: val })}
                    disabled={!exists}
                    aria-pressed={isSelected}
                    className={[
                      'px-4 py-2 rounded-full text-sm border transition-colors',
                      isSelected
                        ? 'border-coral bg-coral text-white font-bold'
                        : available
                          ? 'border-line bg-white/80 text-ink hover:bg-white hover:border-coral hover:text-coral'
                          : exists
                            ? 'border-line bg-white/80 text-ink/70 line-through cursor-not-allowed'
                            : 'border-line/60 bg-white/40 text-ink/40 cursor-not-allowed',
                    ].join(' ')}
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {val}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {oosFallback && (
        <p className="text-[13px] text-muted italic">
          This one's out of stock —{' '}
          <button
            type="button"
            onClick={() => onSelectionChange({ ...selectedOptions, [oosFallback.optionName]: oosFallback.value })}
            className="text-coral hover:text-coral-deep font-medium underline underline-offset-2"
          >
            try {oosFallback.value} instead →
          </button>
        </p>
      )}
    </div>
  )
}
