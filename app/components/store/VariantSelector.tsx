import { useMemo } from 'react'
import type { ProductVariant } from '~/types'

interface VariantSelectorProps {
  variants:          ProductVariant[]
  options:           { name: string; values: string[] }[]
  selectedVariantId: string
  onVariantSelect:   (variantId: string) => void
}

/**
 * Color-name → hex map for common Shopify swatch values.
 * Anything unmatched falls back to neutral cream-2 with initial letter.
 */
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

function isSwatchy(name: string): boolean {
  // Use circles for color; pills for everything else.
  return isColorOption(name)
}

function swatchColor(value: string): string {
  const key = value.toLowerCase().trim().split(/\s+/)[0] ?? ''
  return COLOR_MAP[key] ?? '#F2EADD'
}

export function VariantSelector({
  variants,
  options,
  selectedVariantId,
  onVariantSelect,
}: VariantSelectorProps) {
  const selectedVariant = variants.find(v => v.id === selectedVariantId) ?? variants[0]

  // Build helper: for a given (optionName, value), find the variant that would
  // result if user flipped this one axis while keeping the other axes the same.
  const findVariantForChange = useMemo(() => {
    return (optionName: string, value: string): ProductVariant | undefined => {
      if (!selectedVariant) return undefined
      const targetOptions = selectedVariant.selectedOptions.map(o =>
        o.name === optionName ? { name: o.name, value } : o,
      )
      // Prefer exact match
      const exact = variants.find(v =>
        targetOptions.every(t =>
          v.selectedOptions.some(o => o.name === t.name && o.value === t.value),
        ),
      )
      if (exact) return exact
      // Fallback: any variant matching just this axis = value
      return variants.find(v =>
        v.selectedOptions.some(o => o.name === optionName && o.value === value),
      )
    }
  }, [variants, selectedVariant])

  // For OOS hint: find any in-stock color when the current selection is OOS.
  const oosFallback = useMemo(() => {
    if (!selectedVariant || selectedVariant.availableForSale) return null
    const colorOpt = options.find(o => isColorOption(o.name))
    if (!colorOpt) return null
    const alt = variants.find(v =>
      v.availableForSale &&
      v.selectedOptions.some(o => o.name === colorOpt.name),
    )
    if (!alt) return null
    const altColor = alt.selectedOptions.find(o => o.name === colorOpt.name)?.value
    if (!altColor) return null
    return { optionName: colorOpt.name, value: altColor, variant: alt }
  }, [selectedVariant, options, variants])

  if (variants.length <= 1 || options.length === 0) return null

  return (
    <div className="space-y-4">
      {options.map(opt => {
        const current = selectedVariant?.selectedOptions.find(o => o.name === opt.name)?.value
        const useSwatch = isSwatchy(opt.name)

        return (
          <div key={opt.name}>
            <p
              className="text-[13px] font-bold text-ink mb-2 uppercase tracking-wide"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {opt.name}
              {current && (
                <span className="ml-2 font-medium normal-case tracking-normal text-muted">
                  {current}
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {opt.values.map(val => {
                const match       = findVariantForChange(opt.name, val)
                const isSelected  = match?.id === selectedVariant?.id && current === val
                const isAvailable = match?.availableForSale ?? false

                if (useSwatch) {
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => match && onVariantSelect(match.id)}
                      disabled={!match}
                      aria-label={`${opt.name}: ${val}${isAvailable ? '' : ' (out of stock)'}`}
                      title={val}
                      className={[
                        'relative w-10 h-10 rounded-full border-2 transition-all',
                        isSelected
                          ? 'border-coral ring-2 ring-coral/30 ring-offset-2 ring-offset-paper'
                          : 'border-line hover:border-coral/60',
                        !isAvailable && 'opacity-40',
                      ].filter(Boolean).join(' ')}
                      style={{ backgroundColor: swatchColor(val) }}
                    >
                      {!isAvailable && (
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
                    onClick={() => match && onVariantSelect(match.id)}
                    disabled={!match}
                    className={[
                      'px-4 py-2 rounded-full text-sm border transition-colors',
                      isSelected
                        ? 'border-coral bg-coral text-white font-bold'
                        : isAvailable
                          ? 'border-line text-ink hover:border-coral hover:text-coral'
                          : 'border-line text-ink/30 line-through cursor-not-allowed',
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
            onClick={() => onVariantSelect(oosFallback.variant.id)}
            className="text-coral hover:text-coral-deep font-medium underline underline-offset-2"
          >
            try {oosFallback.value} instead →
          </button>
        </p>
      )}
    </div>
  )
}
