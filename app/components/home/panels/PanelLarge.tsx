import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import type { PanelDeckTheme, ResolvedPanelLarge } from '~/types/cms'
import { PanelMark, isMarkName } from './marks'
import { panelDataAttr, panelInteractionClasses, surfaceStyle } from './surfaces'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 450 } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

// The art zone now spans the full card width: ~92vw at 1-up (below sm) and
// ~46vw at 2-up (from sm, deck capped at 1320px so ~630px max). A single-item
// row stays full container width (~1190px max). The ladders keep the browser
// from requesting a rendition wider than the box it fills.
const ART_WIDTHS_PAIR = [320, 480, 640, 768, 960]
const ART_SIZES_PAIR = '(min-width: 640px) 46vw, 92vw'
const ART_WIDTHS_SINGLE = [320, 480, 640, 768, 1024, 1280]
const ART_SIZES_SINGLE = '(min-width: 1320px) 1190px, 92vw'

/**
 * The deck's merchandising drivers (Discover, New): the two panels with room
 * for a kicker, a blurb, and richer photography.
 *
 * Layout is the door-tile pattern the square tiles established: image on top,
 * copy below on the panel's own solid ground (paper / coral-soft / plum-soft
 * per the doctrine ground lock). Owner feedback 2026-08-15 (ticket #3529):
 * the old side-by-side split read as copy competing with the artwork, and the
 * "Discover" banner's text was hard to read. Text never sits on photography.
 *
 * The art zone holds ONE fixed aspect, 2:1, at every breakpoint (ticket #352,
 * doctrine 8.4: fixed aspect ratios on all media frames). The old split gave
 * the art zone a fluid ratio that swung roughly 0.55 to 1.03 across 375/768/
 * 1024/1320, so one image brief could not compose for all four crops. With a
 * constant 2:1 box, object-cover always shows the same framing and the prompt
 * library can stop hedging with mid-range safe areas.
 *
 * The image still bleeds to the card edges (top and sides), never an inset
 * plate inside the rectangle (owner direction 2026-07-30). Fixed aspect also
 * means zero CLS: the box reserves its height before the image arrives.
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
                'relative flex flex-col overflow-hidden',
                panel.imageUrl ? '' : 'min-h-[154px] justify-end',
                'rounded-[22px]',
                ruled ? 'border border-line bg-paper-2' : s.bg,
                panelInteractionClasses(!ruled && s.darkGround),
              ].join(' ')}
            >
              {/* Art zone. Fixed 2:1 at every breakpoint (ticket #352), image
                  bleeding to the top and side edges with the copy zone below on
                  the flat tint, exactly like the square door tiles. */}
              {panel.imageUrl ? (
                <div className="pointer-events-none relative aspect-[2/1] w-full overflow-hidden">
                  <OptimizedImage
                    src={panel.imageUrl}
                    alt={panel.imageAlt ?? ''}
                    width={960}
                    height={480}
                    sizes={single ? ART_SIZES_SINGLE : ART_SIZES_PAIR}
                    widths={single ? ART_WIDTHS_SINGLE : ART_WIDTHS_PAIR}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
              ) : null}

              {/* Copy zone: solid panel ground, never over the photograph. */}
              <div className="flex flex-1 flex-col p-4 md:p-6">
                <div>
                  {panel.kicker ? (
                    <span
                      className={`mb-2 block text-[11px] uppercase tracking-[0.18em] ${ruled ? 'text-ink-4' : s.accent}`}
                      style={MONO}
                    >
                      {panel.kicker}
                    </span>
                  ) : null}
                  <span
                    className={`block text-[20px] leading-[1.05] tracking-[-0.01em] md:text-[28px] ${ruled ? 'text-ink' : s.text}`}
                    style={DISPLAY}
                  >
                    {panel.label}
                  </span>
                  {panel.blurb ? (
                    <span
                      className={`mt-2 hidden max-w-[44ch] text-[13px] leading-snug md:block ${ruled ? 'text-ink-3' : s.muted}`}
                      style={BODY}
                    >
                      {panel.blurb}
                    </span>
                  ) : null}
                </div>
                {arrowText ? (
                  // The deck's ONE coral spend (§3 budget): the dark panel's CTA.
                  // Light grounds keep ink so coral stays a single primary.
                  // coral-2, not coral: the base token was darkened for AA on
                  // paper grounds (ticket #3789) and only reads 3.29:1 on a
                  // dark panel; coral-2 stays light enough to clear 7:1 on ink.
                  <span
                    className={`mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold md:mt-4 md:text-[14px] ${ruled ? 'text-ink' : s.darkGround ? 'text-coral-2' : s.text}`}
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

              {/* Empty state: no reserved art zone (which read as an unfinished
                  plate). The copy zone keeps the full card and the mark sits
                  anchored bottom-right, scaled to a real graphic element
                  (design-critic cold start). */}
              {!panel.imageUrl && panel.mark && isMarkName(panel.mark) ? (
                <div
                  className={`pointer-events-none absolute bottom-4 right-4 md:bottom-6 md:right-6 ${ruled ? 'text-ink-4' : s.accent}`}
                >
                  <span className="block transition-transform duration-150 ease-out group-hover:translate-x-0.5">
                    <PanelMark name={panel.mark} size={72} strokeWidth={1.2} />
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
