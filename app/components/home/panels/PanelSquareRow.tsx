import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import type { PanelDeckTheme, ResolvedPanelTile } from '~/types/cms'
import { PanelMark, isMarkName } from './marks'
import { panelDataAttr, panelInteractionClasses, surfaceStyle } from './surfaces'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

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
 * Grid per the handoff: 4-up at every width, 1:1 at 375 → 1.24:1 from md,
 * 2-up below 320px. Fixed aspect boxes mean an image can never shift layout.
 */
export function PanelSquareRow({
  items,
  theme,
  rowIndex,
  showOrdinals,
  onPanelClick,
}: {
  items: ResolvedPanelTile[]
  theme: PanelDeckTheme
  rowIndex: number
  showOrdinals: boolean
  onPanelClick?: (dataAttr: string, href: string) => void
}) {
  if (items.length === 0) return null

  return (
    <div className="grid grid-cols-2 gap-2 min-[320px]:grid-cols-4 md:gap-3.5">
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
                'rounded-xl md:rounded-[20px]',
                ruled ? 'border border-line bg-paper-2' : s.bg,
                panelInteractionClasses(!ruled && s.darkGround),
              ].join(' ')}
            >
              {showOrdinals && ruled ? (
                <span className={`text-[10px] tracking-[0.16em] ${s.muted}`} style={MONO} aria-hidden="true">
                  {String(rowIndex * 4 + i + 1).padStart(2, '0')}
                </span>
              ) : null}

              {/* Art zone. Cutout still when the team shipped one; mark as the
                  empty state. The image is decorative next to the label, so it
                  carries empty alt unless the editor wrote one. */}
              <div className="pointer-events-none flex flex-1 items-center justify-center">
                {tile.imageUrl ? (
                  <OptimizedImage
                    src={tile.imageUrl}
                    alt={tile.imageAlt ?? ''}
                    width={280}
                    height={280}
                    className="max-h-full w-auto max-w-[78%] object-contain transition-transform duration-150 ease-out group-hover:translate-x-0.5"
                  />
                ) : tile.mark && isMarkName(tile.mark) ? (
                  <span className={`${ruled ? 'text-ink-4' : s.accent} transition-transform duration-150 ease-out group-hover:translate-x-0.5`}>
                    <PanelMark name={tile.mark} size={30} />
                  </span>
                ) : null}
              </div>

              <span
                className={`text-[13px] font-semibold leading-none md:text-[15px] ${ruled ? 'text-ink' : s.text}`}
                style={BODY}
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
