import type { ResolvedPanelDeck } from '~/types/cms'
import { trackPanelClick } from '~/lib/analytics.client'
import { PanelSquareRow } from './PanelSquareRow'
import { PanelLargeRow } from './PanelLarge'
import { PanelSmallRow } from './PanelSmall'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 450 } as const

/**
 * The eight-door deck — the homepage's discovery layer, rendered directly
 * below the headliner (never above it: the hero owns the H1 and the LCP
 * image, so the deck's entrance animation can never touch the largest paint).
 *
 * All three themes render from these same components; `theme` only changes
 * grounds and chrome. Content, order, and theme all come resolved on the
 * payload blob, so this component does no fetching and renders SSR-final.
 * An empty deck renders nothing at all — no placeholder, no empty band.
 */
export function PanelDeck({ deck }: { deck: ResolvedPanelDeck }) {
  const rows = deck.rows.filter(r => r.items.length > 0)
  if (rows.length === 0) return null

  const onPanelClick = (dataAttr: string, href: string) => trackPanelClick(dataAttr, href)

  return (
    <section className="bg-paper-2 py-16 md:py-20" aria-label="Browse by category">
      <div className="mx-auto max-w-[1320px] px-6 md:px-16">
        {deck.eyebrow ? (
          <span
            className="mb-3 block text-[11px] uppercase tracking-[0.18em] text-ink-4"
            style={MONO}
          >
            {deck.eyebrow}
          </span>
        ) : null}
        <h2
          className="mb-9 text-[1.9rem] leading-[1.08] tracking-[-0.01em] text-ink md:text-[2.9rem]"
          style={DISPLAY}
        >
          Pick your <em className="brand">door</em>.
        </h2>

        <div className="flex flex-col gap-2 md:gap-3.5">
          {rows.map((row, rowIndex) => {
            switch (row.kind) {
              case 'square':
                return (
                  <PanelSquareRow
                    key={row.key}
                    items={row.items}
                    theme={deck.theme}
                    rowIndex={rowIndex}
                    showOrdinals={deck.showOrdinals && deck.theme === 'ruled'}
                    onPanelClick={onPanelClick}
                  />
                )
              case 'large':
                return (
                  <PanelLargeRow
                    key={row.key}
                    items={row.items}
                    theme={deck.theme}
                    rowIndex={rowIndex}
                    onPanelClick={onPanelClick}
                  />
                )
              case 'small':
                return (
                  <PanelSmallRow
                    key={row.key}
                    items={row.items}
                    theme={deck.theme}
                    rowIndex={rowIndex}
                    onPanelClick={onPanelClick}
                  />
                )
              default:
                return null
            }
          })}
        </div>
      </div>
    </section>
  )
}
