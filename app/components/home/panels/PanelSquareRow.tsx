import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import type { PanelDeckTheme, ResolvedPanelTile } from '~/types/cms'
import { PanelMark, isMarkName } from './marks'
import { panelDataAttr, panelInteractionClasses, surfaceStyle } from './surfaces'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 450 } as const

// Square tiles render ~178 CSS px wide at 375-412px (2-up) and ~307px from md
// (4-up, deck capped at 1320px). Without an override OptimizedImage applies the
// hero defaults (sizes 100vw/50vw, smallest rendition 480w), so a browser asks
// the CDN for a 768w image for a box that never exceeds ~310px. A real sizes
// plus a tile-scale ladder lets it pick a rendition sized to the box instead.
const SQUARE_WIDTHS = [200, 260, 320, 400, 520]
const SQUARE_SIZES = '(min-width: 768px) 23vw, 44vw'

/**
 * The evergreen aisle doors: Pleasure / Play / Body / Wear.
 *
 * Art direction (owner decision 2026-07-29): a square carries a product cutout
 * still sitting ON its tinted ground. The label never sits on photography —
 * on the tint theme the ground IS the flat tint, so the label zone stays
 * legible whatever the image does. The mark renders only when no image is set
 * (the empty state), so an unfilled deck still has rhythm instead of grey
 * plates.
 *
 * Grid: 2-up below md (a 4-up at 375px renders ~78px tiles whose art is
 * unreadable — design-critic cold start), 4-up from md at 1.24:1. Fixed
 * aspect boxes mean an image can never shift layout.
 */
export function PanelSquareRow({
  items,
  theme,
  rowIndex,
  ordinalStart = 0,
  showOrdinals,
  onPanelClick,
}: {
  items: ResolvedPanelTile[]
  theme: PanelDeckTheme
  rowIndex: number
  /** How many square panels precede this row in the deck. Ordinals continue from it. */
  ordinalStart?: number
  showOrdinals: boolean
  onPanelClick?: (dataAttr: string, href: string) => void
}) {
  if (items.length === 0) return null

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3.5">
      {items.map((tile, i) => {
        const s = surfaceStyle(tile.surface)
        const ruled = theme === 'ruled'
        const dataAttr = panelDataAttr(theme, rowIndex, i, tile.label)
        return (
          <Reveal key={tile.key} variant="up" index={i} as="div">
            <Link
              to={tile.href}
              data-panel={dataAttr}
              onClick={() => onPanelClick?.(dataAttr, tile.href)}
              className={[
                'relative flex aspect-square flex-col justify-between overflow-hidden p-3 md:aspect-[1.24/1] md:p-4',
                'rounded-[22px]',
                ruled ? 'border border-line bg-paper-2' : s.bg,
                panelInteractionClasses(!ruled && s.darkGround),
              ].join(' ')}
            >
              {showOrdinals && ruled ? (
                <span className={`text-[10px] tracking-[0.16em] ${s.muted}`} style={MONO} aria-hidden="true">
                  {String(ordinalStart + i + 1).padStart(2, '0')}
                </span>
              ) : null}

              {/* Art zone. The still is generated ON the tile's own tint, so it
                  bleeds edge to edge (top + sides) with the label zone below on
                  the flat tint — one ground per tile, no inner photo plate
                  (design-critic cold start). Mark is the empty state. The image
                  is decorative next to the label, so it carries empty alt
                  unless the editor wrote one. */}
              {tile.imageUrl ? (
                <div className="pointer-events-none relative -mx-3 -mt-3 flex-1 overflow-hidden md:-mx-4 md:-mt-4">
                  <OptimizedImage
                    src={tile.imageUrl}
                    alt={tile.imageAlt ?? ''}
                    width={480}
                    height={480}
                    sizes={SQUARE_SIZES}
                    widths={SQUARE_WIDTHS}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="pointer-events-none flex flex-1 items-center justify-center">
                  {tile.mark && isMarkName(tile.mark) ? (
                    <span className={`${ruled ? 'text-ink-4' : s.accent} transition-transform duration-150 ease-out group-hover:translate-x-0.5`}>
                      <PanelMark name={tile.mark} size={30} />
                    </span>
                  ) : null}
                </div>
              )}

              <span
                className={`pt-2 text-[22px] leading-none tracking-[-0.01em] md:text-[24px] ${ruled ? 'text-ink' : s.text}`}
                style={DISPLAY}
              >
                {tile.label}
              </span>
            </Link>
          </Reveal>
        )
      })}
    </div>
  )
}
