import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import type { PanelDeckTheme, ResolvedPanelLarge } from '~/types/cms'
import { PanelMark, isMarkName } from './marks'
import { panelDataAttr, panelInteractionClasses, surfaceStyle } from './surfaces'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 450 } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

/**
 * The deck's merchandising drivers (Discover, New): the two panels with room
 * for a kicker, a blurb, and richer photography.
 *
 * Text never overlays the image. The panel splits into a copy zone and an art
 * zone, so a photograph can fill its half edge to edge without the label ever
 * depending on it for contrast — the pattern that replaced the text-over-
 * packshot overlay the owner rejected on 2026-07-20.
 */
export function PanelLargeRow({
  items,
  theme,
  rowIndex,
  onPanelClick,
}: {
  items: ResolvedPanelLarge[]
  theme: PanelDeckTheme
  rowIndex: number
  onPanelClick?: (dataAttr: string, href: string) => void
}) {
  if (items.length === 0) return null
  const single = items.length === 1

  return (
    <div className={`grid gap-2 md:gap-3.5 ${single ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
      {items.map((panel, i) => {
        const s = surfaceStyle(panel.surface)
        const ruled = theme === 'ruled'
        const dataAttr = panelDataAttr(theme, rowIndex, i, panel.label)
        const arrowText = panel.ctaLabel?.endsWith('→')
          ? panel.ctaLabel.slice(0, -1).trimEnd()
          : panel.ctaLabel
        return (
          <Reveal key={panel.key} variant="up" index={i} as="div">
            <Link
              to={panel.href}
              data-panel={dataAttr}
              onClick={() => onPanelClick?.(dataAttr, panel.href)}
              className={[
                'relative flex min-h-[154px] overflow-hidden md:h-[240px]',
                'rounded-2xl md:rounded-[22px]',
                ruled ? 'border border-line bg-paper-2' : s.bg,
                panelInteractionClasses(!ruled && s.darkGround),
              ].join(' ')}
            >
              {/* Copy zone */}
              <div className="flex flex-1 flex-col justify-between p-4 md:p-6">
                <div>
                  {panel.kicker ? (
                    <span
                      className={`mb-2 block text-[9px] uppercase tracking-[0.16em] md:text-[11px] ${ruled ? 'text-ink-4' : s.accent}`}
                      style={MONO}
                    >
                      {panel.kicker}
                    </span>
                  ) : null}
                  <span
                    className={`block text-[20px] leading-[1.05] tracking-[-0.01em] md:text-[34px] ${ruled ? 'text-ink' : s.text}`}
                    style={DISPLAY}
                  >
                    {panel.label}
                  </span>
                  {panel.blurb ? (
                    <span
                      className={`mt-2 hidden max-w-[36ch] text-[13px] leading-snug md:block ${ruled ? 'text-ink-3' : s.muted}`}
                      style={BODY}
                    >
                      {panel.blurb}
                    </span>
                  ) : null}
                </div>
                {arrowText ? (
                  <span
                    className={`inline-flex items-center gap-1.5 text-[13px] font-semibold md:text-[14px] ${ruled ? 'text-ink' : s.text}`}
                    style={BODY}
                  >
                    {arrowText}
                    <span
                      aria-hidden="true"
                      className="transition-transform duration-150 ease-out group-hover:translate-x-0.5"
                    >
                      →
                    </span>
                  </span>
                ) : null}
              </div>

              {/* Art zone — image fills its half edge to edge; mark is the
                  empty state, sized up for the wide box. */}
              {panel.imageUrl ? (
                <div className="pointer-events-none relative w-[42%] shrink-0">
                  <OptimizedImage
                    src={panel.imageUrl}
                    alt={panel.imageAlt ?? ''}
                    width={480}
                    height={480}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
              ) : panel.mark && isMarkName(panel.mark) ? (
                <div
                  className={`pointer-events-none flex w-[34%] shrink-0 items-center justify-center ${ruled ? 'text-ink-4' : s.accent}`}
                >
                  <span className="transition-transform duration-150 ease-out group-hover:translate-x-0.5">
                    <PanelMark name={panel.mark} size={44} strokeWidth={1.4} />
                  </span>
                </div>
              ) : null}
            </Link>
          </Reveal>
        )
      })}
    </div>
  )
}
