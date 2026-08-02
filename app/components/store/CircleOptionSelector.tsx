import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ProductVariant } from '~/types'
import { isValueAvailable, valueExists } from '~/components/store/VariantSelector'

const COLOR_MAP: Record<string, string> = {
  black:     '#151211',
  white:     '#FFFFFF',
  cream:     '#FAF4EA',
  ivory:     '#F5EFE0',
  rose:      '#E8B4B8',
  pink:      '#FFC0CB',
  fuchsia:   '#D81B60',
  magenta:   '#C2185B',
  hotpink:   '#E94B8A',
  coral:     '#FF6A3D',
  red:       '#D93A15',
  crimson:   '#A01432',
  burgundy:  '#6E1423',
  wine:      '#722F37',
  maroon:    '#7A1D1D',
  scarlet:   '#C0322B',
  cherry:    '#B51F2A',
  ruby:      '#9B1B30',
  brown:     '#5D3A1A',
  tan:       '#C9A26B',
  copper:    '#B87333',
  bronze:    '#8C6A2B',
  caramel:   '#A6651E',
  beige:     '#E3D5B8',
  orange:    '#F0792E',
  amber:     '#E2A03F',
  yellow:    '#F2C94C',
  lilac:     '#C8A2D9',
  lavender:  '#B68FCE',
  violet:    '#7C3AED',
  purple:    '#7C3AED',
  plum:      '#6B2D5C',
  sage:      '#7C8F78',
  mint:      '#A8D8B0',
  olive:     '#7F7C32',
  green:     '#4A7C59',
  emerald:   '#2E7D5C',
  forest:    '#2A4D3A',
  navy:      '#1E3A5F',
  blue:      '#3B6BCE',
  cobalt:    '#2A4FB1',
  sky:       '#7CB7E8',
  turquoise: '#2BB1B5',
  teal:      '#2BA19F',
  aqua:      '#5FCBC9',
  gold:      '#D4AF37',
  silver:    '#C0C0C0',
  grey:      '#8B8786',
  gray:      '#8B8786',
  charcoal:  '#36332F',
  graphite:  '#3D3A37',
  sand:      '#D9C7A7',
  nude:      '#E3C4A8',
  clear:     'transparent',
}

export function resolveColor(value: string, swatches?: Record<string, string>): string {
  const full = value.toLowerCase().trim()
  const first = full.split(/\s+/)[0] ?? ''
  return swatches?.[full] ?? COLOR_MAP[first] ?? '#F2EADD'
}

export function abbreviate(value: string): string {
  const v = value.trim()
  // Volume/length values like "4 fl oz", "100ml", "8 in." — keep the number
  // with a compact unit so the pill reads "4OZ" / "100ML" instead of "4 ".
  const volumeMatch = v.match(/^(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|oz|ml|l|cl|in\.?|cm|mm)\b/i)
  if (volumeMatch) {
    const [, n, rawUnit] = volumeMatch
    const unit = rawUnit!.toLowerCase().replace(/[\s.]/g, '').replace(/^floz$/, 'oz')
    return `${n} ${unit.toUpperCase()}`
  }
  if (v.length <= 4) return v.toUpperCase()
  // Prefer well-known size abbreviations
  const map: Record<string, string> = {
    'extra small':       'XS',
    'small':             'S',
    'medium':            'M',
    'large':             'L',
    'extra large':       'XL',
    'extra extra large': 'XXL',
    'one size':          'OS',
  }
  const lower = v.toLowerCase()
  if (map[lower]) return map[lower]
  // Otherwise grab first 2 chars
  return v.slice(0, 2).toUpperCase()
}

export function buildPieGradient(values: string[], swatches?: Record<string, string>): string {
  if (values.length === 0) return '#F2EADD'
  if (values.length === 1) return resolveColor(values[0]!, swatches)
  const slice = 100 / values.length
  const stops = values
    .map((v, i) => {
      const color = resolveColor(v, swatches)
      const start = (i * slice).toFixed(2)
      const end   = ((i + 1) * slice).toFixed(2)
      return `${color} ${start}% ${end}%`
    })
    .join(', ')
  return `conic-gradient(from 0deg, ${stops})`
}

/**
 * Build a subtle alternating cream/cream-2 conic gradient so size segments
 * are visually distinct without being loud.
 */
function buildSizeSegmentGradient(values: string[]): string {
  if (values.length <= 1) return '#FAF4EA'
  const slice = 100 / values.length
  const stops = values
    .map((_, i) => {
      const fill  = i % 2 === 0 ? '#FAF4EA' : '#F2EADD'
      const start = (i * slice).toFixed(2)
      const end   = ((i + 1) * slice).toFixed(2)
      return `${fill} ${start}% ${end}%`
    })
    .join(', ')
  // Rotate so first segment starts at top (12 o'clock) instead of 3 o'clock,
  // and is centered under the first label.
  const startOffset = -90 - (360 / values.length) / 2
  return `conic-gradient(from ${startOffset}deg, ${stops})`
}

interface CircleOptionSelectorProps {
  optionName:        string
  values:            string[]
  selected?:         string
  onSelect:          (value: string) => void
  onClear?:          () => void
  kind:              'color' | 'size'
  swatches?:         Record<string, string>
  variants:          ProductVariant[]
  selectedOptions:   Record<string, string>
  /**
   * When this number changes to a non-zero value the selector opens and scrolls
   * itself into view. The PDP bumps it (only on the first still-unselected axis)
   * when a shopper taps the buy CTA before choosing, so the tap guides them to
   * the control instead of doing nothing. Undefined/0 = no request.
   */
  openRequestNonce?: number
}

export function CircleOptionSelector({
  optionName,
  values,
  selected,
  onSelect,
  onClear,
  kind,
  swatches,
  variants,
  selectedOptions,
  openRequestNonce,
}: CircleOptionSelectorProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Open + reveal on an external request (buy-CTA tapped before a choice was
  // made). Guarded on a non-zero nonce so it never fires on mount.
  useEffect(() => {
    if (!openRequestNonce) return
    setOpen(true)
    wrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [openRequestNonce])

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('touchstart', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('touchstart', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  if (values.length <= 1) return null

  const isColor = kind === 'color'

  // Trigger background:
  //   color → solid swatch once selected, otherwise the full pie of all swatches
  //   size  → subtle alternating cream segments (selection shown by center label)
  const triggerStyle: React.CSSProperties = isColor
    ? selected
      ? { background: resolveColor(selected, swatches) }
      : { background: buildPieGradient(values, swatches) }
    : { background: buildSizeSegmentGradient(values) }

  // Visible axis label ("Size" / "Volume" / "Color") shown above the trigger.
  // Replaces the old 9px in-circle clock faces, which were illegible and below
  // both the 12px type floor and AA contrast. The circle now carries only a
  // legible glyph (size) or the colour pie (colour); identity lives in this
  // label.
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <span
        className="text-[12px] font-semibold uppercase leading-none tracking-wide text-ink/70"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {optionName}
      </span>
      <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${optionName}: ${selected ?? 'choose'}`}
        title={`${optionName}: ${selected ?? 'choose'}`}
        className={[
          'relative h-14 w-14 rounded-full border-2 transition-all flex items-center justify-center overflow-hidden',
          'focus:outline-none focus:ring-2 focus:ring-coral/40 focus:ring-offset-2 focus:ring-offset-paper',
          selected
            ? 'border-coral shadow-md shadow-coral/20'
            : 'border-line hover:border-coral/60',
        ].join(' ')}
        style={triggerStyle}
      >
        {isColor ? null : (
          <>
            {/* Nothing selected: a single legible chevron glyph signals the
                circle opens a chooser. The old 9px per-size clock faces are
                gone; the axis name now reads from the label above the trigger. */}
            {!selected && (
              <span
                aria-hidden="true"
                className="relative z-10 text-base leading-none text-ink/60 pointer-events-none select-none"
              >
                ▾
              </span>
            )}

            {/* Big center label once a size is selected. Shrinks 1pt when the
                abbreviation is 4+ chars (e.g. XXXL) so it still fits the circle. */}
            {selected && (() => {
              const label = abbreviate(selected)
              const sizeClass = label.length >= 4 ? 'text-[15px]' : 'text-base'
              return (
                <span
                  className={`relative z-20 ${sizeClass} font-black uppercase leading-none text-coral pointer-events-none select-none`}
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {label}
                </span>
              )
            })()}
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -4 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            role="listbox"
            aria-label={optionName}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-30 origin-bottom bg-paper rounded-2xl border border-line shadow-xl p-3 flex flex-wrap gap-2 max-w-[260px]"
            style={{ transformOrigin: 'bottom center' }}
          >
            <div
              className="w-full text-xs uppercase tracking-wider text-muted px-1 mb-0.5"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Select {optionName}
            </div>
            {values.map(val => {
              const exists    = valueExists(variants, optionName, val, selectedOptions)
              const available = exists && isValueAvailable(variants, optionName, val, selectedOptions)
              const isActive  = selected === val

              if (isColor) {
                return (
                  <button
                    key={val}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    disabled={!exists}
                    onClick={() => {
                      if (!exists) return
                      if (isActive && onClear) onClear()
                      else onSelect(val)
                      setOpen(false)
                    }}
                    title={val}
                    aria-label={`${val}${available ? '' : exists ? ' (out of stock)' : ' (unavailable)'}`}
                    className={[
                      'relative w-11 h-11 rounded-full border-2 transition-all',
                      isActive
                        ? 'border-coral ring-2 ring-coral/30'
                        : 'border-line hover:border-coral/60',
                      !exists && 'opacity-30 cursor-not-allowed',
                      exists && !available && 'opacity-50',
                    ].filter(Boolean).join(' ')}
                    style={{ backgroundColor: resolveColor(val, swatches) }}
                  >
                    {exists && !available && (
                      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-ink/60 text-base">⊘</span>
                    )}
                  </button>
                )
              }

              return (
                <button
                  key={val}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={!exists}
                  onClick={() => {
                    if (!exists) return
                    if (isActive && onClear) onClear()
                    else onSelect(val)
                    setOpen(false)
                  }}
                  title={val}
                  className={[
                    'min-w-[44px] min-h-[44px] px-2 rounded-full border text-xs font-bold transition-colors flex items-center justify-center',
                    isActive
                      ? 'border-coral bg-coral text-white'
                      : available
                        ? 'border-line bg-white/80 text-ink hover:border-coral hover:text-coral'
                        : exists
                          ? 'border-line bg-white/80 text-ink/60 line-through cursor-not-allowed'
                          : 'border-line/60 bg-white/40 text-ink/40 cursor-not-allowed',
                  ].join(' ')}
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {abbreviate(val)}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  )
}
