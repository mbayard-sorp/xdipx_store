import type { ResolvedPanelDeck } from '~/types/cms'
import { trackPanelClick } from '~/lib/analytics.client'
import { PanelSquareRow } from './PanelSquareRow'
import { PanelLargeRow } from './PanelLarge'
import { PanelSmallRow } from './PanelSmall'

const MONO = { fontFamily: 'var(--font-mono)' } as const

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
    <section className="bg-paper py-8 md:py-12" aria-label="Browse by category">
      <div className="mx-auto max-w-[1120px] px-[18px] md:px-7">
        {deck.eyebrow ? (
          <span
            className="mb-4 block text-[10px] uppercase tracking-[0.18em] text-ink-4 md:mb-5 md:text-[11px]"
            style={MONO}
          >
            {deck.eyebrow}
          </span>
        ) : null}

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
