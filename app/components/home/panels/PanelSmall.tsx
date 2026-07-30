import { Link } from 'react-router'
import { Reveal } from '~/components/motion/Reveal'
import type { PanelDeckTheme, ResolvedPanelSmall } from '~/types/cms'
import { PanelMark, isMarkName } from './marks'
import { panelDataAttr, panelInteractionClasses, surfaceStyle } from './surfaces'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

/**
 * The deck's utilities (Notebook, Sale): one line, a trailing figure or mark,
 * no imagery.
 *
 * Sale stays the quietest panel in the deck by design: paper or ink ground, a
 * mono figure, never coral. A discount door with the same visual weight as the
 * category doors trains discount-shopping on a brand positioned on curation.
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
                'flex h-16 items-center justify-between gap-3 px-4 md:h-[88px] md:px-5',
                'rounded-[14px] md:rounded-2xl',
                ruled ? 'border border-line bg-paper-2' : s.bg,
                panelInteractionClasses(!ruled && s.darkGround),
              ].join(' ')}
            >
              <span className="min-w-0">
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
            </Link>
          </Reveal>
        )
      })}
    </div>
  )
}
