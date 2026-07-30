import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import type { PanelDeckTheme, ResolvedPanelSmall } from '~/types/cms'
import { PanelMark, isMarkName } from './marks'
import { panelDataAttr, panelInteractionClasses, surfaceStyle } from './surfaces'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

/**
 * The deck's utilities (Notebook, Sale): one line, and either a trailing figure
 * or mark or a full-bleed art zone.
 *
 * Imagery here is owner direction (2026-07-30), replacing the earlier
 * "no imagery" rule. It follows the `PanelLarge` split exactly: the art bleeds
 * to the card edge in its own zone and the label keeps the flat ground, so text
 * never sits on photography even in a 64px row. What the old rule was really
 * protecting is visual WEIGHT, not imagery as such — "Sale stays the quietest
 * panel in the deck, because a discount door with the same visual weight as the
 * category doors trains discount-shopping on a brand positioned on curation" —
 * and that still holds: the art zone is a third of a 64px row, the squares get a
 * full tile, and Sale keeps its paper ground and its no-coral rule.
 *
 * At this size an image is a silhouette and a colour and nothing else, so the
 * briefs for these two slots are abstract product macros, not packshots.
 */
export function PanelSmallRow({
  items,
  theme,
  rowIndex,
  onPanelClick,
}: {
  items: ResolvedPanelSmall[]
  theme: PanelDeckTheme
  rowIndex: number
  onPanelClick?: (dataAttr: string, href: string) => void
}) {
  if (items.length === 0) return null
  const single = items.length === 1

  return (
    <div className={`grid grid-cols-2 gap-2 md:gap-3.5 ${single ? 'md:w-1/2' : ''}`}>
      {items.map((panel, i) => {
        const s = surfaceStyle(panel.surface)
        const ruled = theme === 'ruled'
        const dataAttr = panelDataAttr(theme, rowIndex, i, panel.label)
        return (
          <Reveal key={panel.key} variant="up" index={i} as="div">
            <Link
              to={panel.href}
              data-panel={dataAttr}
              onClick={() => onPanelClick?.(dataAttr, panel.href)}
              className={[
                'flex h-16 items-center overflow-hidden md:h-[88px]',
                // The art zone bleeds to the card edge, so the row's right
                // padding belongs to the copy zone rather than the Link.
                panel.imageUrl ? 'pl-4 md:pl-5' : 'gap-3 px-4 md:px-5',
                'rounded-[8px]',
                ruled ? 'border border-line bg-paper-2' : s.bg,
                panelInteractionClasses(!ruled && s.darkGround),
              ].join(' ')}
            >
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[14px] font-semibold md:text-[16px] ${ruled ? 'text-ink' : s.text}`}
                  style={BODY}
                >
                  {panel.label}
                </span>
                {panel.meta ? (
                  <span
                    className={`hidden truncate text-[12px] md:block ${ruled ? 'text-ink-3' : s.muted}`}
                    style={BODY}
                  >
                    {panel.meta}
                  </span>
                ) : null}
              </span>

              {/* Art zone — full bleed to the card edge, never an inset plate
                  (owner direction 2026-07-30). Fixed width against the row's
                  fixed height, so an image can never shift layout. Decorative
                  next to the label, so empty alt unless the editor wrote one. */}
              {panel.imageUrl ? (
                <span className="pointer-events-none relative block h-full w-[38%] shrink-0 md:w-[34%]">
                  <OptimizedImage
                    src={panel.imageUrl}
                    alt={panel.imageAlt ?? ''}
                    width={320}
                    height={320}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </span>
              ) : (
                <span
                  className={`shrink-0 transition-transform duration-150 ease-out group-hover:translate-x-0.5 ${ruled ? 'text-ink-4' : s.accent}`}
                >
                  {panel.figure ? (
                    <span className="text-[12px] tracking-[0.08em] md:text-[13px]" style={MONO}>
                      {panel.figure}
                    </span>
                  ) : panel.mark && isMarkName(panel.mark) ? (
                    <PanelMark name={panel.mark} size={22} />
                  ) : (
                    <span aria-hidden="true">→</span>
                  )}
                </span>
              )}
            </Link>
          </Reveal>
        )
      })}
    </div>
  )
}
