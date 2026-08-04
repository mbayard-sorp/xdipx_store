import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import type { PanelDeckTheme, ResolvedPanelLarge } from '~/types/cms'
import { PanelMark, isMarkName } from './marks'
import { panelDataAttr, panelInteractionClasses, surfaceStyle } from './surfaces'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 450 } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

// The art zone is w-[42%] of a large panel: ~42vw of the viewport at 1-up
// (below sm) and ~21vw at 2-up (from sm). Left on the hero defaults it would
// fetch a 768w image for a box that is ~268px at 412px and ~277px at desktop.
// A real sizes plus a ladder that tops out at 640w right-sizes the request.
const ART_WIDTHS = [200, 280, 360, 480, 640]
const ART_SIZES = '(min-width: 640px) 21vw, 42vw'

/**
 * The deck's merchandising drivers (Discover, New): the two panels with room
 * for a kicker, a blurb, and richer photography.
 *
 * Text never overlays the image. The panel splits into a copy zone and an art
 * zone, so a photograph can fill its half edge to edge without the label ever
 * depending on it for contrast — the pattern that replaced the text-over-
 * packshot overlay the owner rejected on 2026-07-20.
 *
 * The art zone always bleeds to the card edge — never an inset plate inside the
 * rectangle (owner direction 2026-07-30). What makes a bleed work on any ground
 * is the image itself: these are abstract compositions built out of a real
 * product, filling the frame edge to edge with form and tint, so there is no
 * backdrop to butt against the card and no seam to hide. On a light ground the
 * composition is built on the panel's own tint and the seam simply dissolves;
 * on ink, the composition carries its own dark passages, so the boundary reads
 * as a crop rather than as a pale rectangle laid on top.
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
                'rounded-[22px]',
                ruled ? 'border border-line bg-paper-2' : s.bg,
                panelInteractionClasses(!ruled && s.darkGround),
              ].join(' ')}
            >
              {/* Copy zone */}
              <div className="flex flex-1 flex-col justify-between p-4 md:p-6">
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
                  // The deck's ONE coral spend (§3 budget): the dark panel's CTA.
                  // Light grounds keep ink so coral stays a single primary.
                  <span
                    className={`inline-flex items-center gap-1.5 text-[13px] font-semibold md:text-[14px] ${ruled ? 'text-ink' : s.darkGround ? 'text-coral' : s.text}`}
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
                    sizes={ART_SIZES}
                    widths={ART_WIDTHS}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
              ) : panel.mark && isMarkName(panel.mark) ? (
                // Empty state: no reserved art column (which read as an
                // unfinished plate) — the copy zone keeps the full width and
                // the mark sits anchored to the CTA baseline, scaled to a real
                // graphic element (design-critic cold start).
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
