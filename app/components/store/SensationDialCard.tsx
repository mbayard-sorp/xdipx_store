/**
 * 1d — Sensation dial card.
 *
 * Shared primitive: lives inside 1c's rail and inside grids. Renders a
 * product's `sensationDialV2` values as mono endpoint-label pairs over a
 * coral fill bar (1–5 scale -> 0–100% width). Falls back to a plain product
 * card treatment when dial data is missing (never renders empty tracks).
 *
 * Bars animate 0 -> value on scroll reveal (420ms, ease-entrance, 60ms stagger
 * per bar). SSR always renders the FINAL value — JS only adds the width
 * transition on reveal, and reduced-motion / no-JS render identical to
 * default (final value). This mirrors the Reveal primitive's SSR-safe
 * contract but is implemented locally because the animated property here is
 * `width`, not transform/opacity, and only applies to the three thin bars,
 * not the whole card.
 */

import { Link } from 'react-router'
import { useReveal } from '~/lib/use-reveal'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import type { Product, SensationDialItem } from '~/types'

const DISPLAY_MED = { fontFamily: 'var(--font-display)', fontWeight: 500 } as const
const MONO = { fontFamily: 'var(--font-mono)' } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

function fmt(n: number): string {
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

/**
 * Endpoint label pairs for known catalog dial labels (left = low end, right =
 * high end). The dial registry (Sanity, per product-type) is free-form text,
 * so unknown labels fall back to a generic "less {label} / more {label}" pair
 * rather than dropping the row — every dial value the catalog provides still
 * renders.
 */
const ENDPOINT_PAIRS: Record<string, [string, string]> = {
  volume:      ['quiet', 'loud'],
  loudness:    ['quiet', 'loud'],
  intensity:   ['gentle', 'intense'],
  power:       ['gentle', 'intense'],
  vibration:   ['subtle', 'rumbly'],
  buzz:        ['subtle', 'rumbly'],
  texture:     ['subtle', 'rumbly'],
  suction:     ['soft', 'strong'],
  girth:       ['slim', 'full'],
  length:      ['compact', 'long'],
  flexibility: ['firm', 'flexible'],
  speed:       ['slow', 'fast'],
}

function endpointsFor(label: string): [string, string] {
  const key = label.trim().toLowerCase()
  return ENDPOINT_PAIRS[key] ?? [`less ${label}`, `more ${label}`]
}

function valueToPercent(value: number): number {
  // 1-5 scale -> 0-100%, clamped.
  return Math.max(0, Math.min(100, ((value - 1) / 4) * 100))
}

interface SensationDialCardProps {
  product: Product
  /** One-line honest translation sentence, e.g. "Deep and slow, more purr than buzz." */
  translation?: string
  /** Stagger index for the bar-reveal delay when this card sits in a grid/rail. */
  index?: number
  priority?: boolean
}

/** True when a product has enough dial data to render this card (2-4 items). */
export function hasSensationDial(product: Product): boolean {
  const items = product.sensationDialV2?.items ?? []
  return items.length >= 2
}

export function SensationDialCard({ product, translation, index = 0, priority = false }: SensationDialCardProps) {
  const items: SensationDialItem[] = (product.sensationDialV2?.items ?? []).slice(0, 4)
  if (items.length < 2) return null // never render empty tracks

  const { ref, inView, mounted, reduced } = useReveal({ once: true })
  // Bars animate only after mount + reveal + motion allowed; SSR and reduced
  // motion both render the plain, non-transitioned final-value bar.
  const animate = mounted && !reduced

  const image = product.images[0]

  return (
    <Link
      ref={ref as never}
      to={`/products/${product.handle}`}
      className="group block w-[280px] shrink-0 overflow-hidden rounded-[var(--radius)] border border-line bg-paper transition-all duration-[var(--duration-base)] hover:-translate-y-1 hover:border-line-3"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-coral-soft">
        <div className="absolute inset-0 flex items-end justify-center p-2">
          {image ? (
            <OptimizedImage
              src={image.url}
              alt={image.altText || product.title}
              priority={priority}
              sizes="280px"
              className="h-full w-full rounded-[var(--radius-sm)] object-contain transition-transform duration-[var(--duration-base)] group-hover:scale-[1.04]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-4xl text-coral/40" aria-hidden="true">♥</div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3
            className="line-clamp-1 text-[18px] leading-tight text-ink transition-colors group-hover:text-coral"
            style={DISPLAY_MED}
          >
            {product.title}
          </h3>
          <span className="shrink-0 whitespace-nowrap text-[13.5px] font-semibold text-ink" style={BODY}>
            {fmt(product.price)}
          </span>
        </div>

        <div className="flex flex-col gap-[9px]">
          {items.map((item, i) => {
            const [left, right] = endpointsFor(item.label)
            const pct = valueToPercent(item.value)
            // Bar stagger (60ms/row) plus a small card-level offset so cards
            // later in a rail/grid don't all animate in lockstep.
            const staggerMs = i * 60 + Math.min(index, 4) * 40
            return (
              <div key={item.label}>
                <div
                  className="mb-1 flex items-center justify-between text-[8.5px] uppercase tracking-[0.12em] text-ink-4"
                  style={MONO}
                >
                  <span>{left}</span>
                  <span>{right}</span>
                </div>
                <div className="h-[3px] w-full rounded-full bg-line">
                  <div
                    className="h-[3px] rounded-full bg-coral"
                    style={{
                      // SSR / no-JS / reduced-motion: final value, no transition.
                      // Client, pre-reveal: held at 0 so the transition below
                      // actually plays once when it scrolls into view.
                      width: animate && !inView ? '0%' : `${pct}%`,
                      ...(animate
                        ? { transition: `width 420ms var(--ease-entrance) ${staggerMs}ms` }
                        : {}),
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {translation && (
          <p className="text-[11px] leading-snug text-ink-4" style={BODY}>
            {translation}
          </p>
        )}
      </div>
    </Link>
  )
}
