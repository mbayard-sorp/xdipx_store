/**
 * 1e — Curiosity chooser.
 *
 * Two taps max, filters the already-loaded rail in place, no dead ends. No-JS:
 * tiles are real links to `?preset=` URLs (comma-joined for a combined
 * selection, e.g. `?preset=quieter,hands-free`), so every state is
 * server-renderable — the loader reads `?preset=` and pre-resolves the
 * matching rail server-side. JS then filters in place via search params
 * without a full navigation (progressive enhancement).
 *
 * Binding correction (build plan): implements the combined two-tile-selected
 * state described in the spec's rationale ("a second tap refines... tiles
 * combine where catalog supports") but not drawn — a second compatible tap
 * intersects both tiles' product sets and shows a combined narrator line
 * rather than always swapping. A third tap is refused (two taps max):
 * tapping a tile while two are already selected swaps the newest selection.
 *
 * A tile that would return zero products is not rendered (dead ends
 * prevented at the data level — CuriosityChooserTile.productHandles is
 * non-empty upstream). Rail minimum 2 products enforced by the loader.
 */

import { useSearchParams } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import type { CuriosityChooserBlock, CuriosityChooserTile } from '~/types/cms'
import type { Product } from '~/types'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 450 } as const
const DISPLAY_ITALIC = { fontFamily: 'var(--font-display)', fontStyle: 'italic' } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

function fmt(n: number): string {
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

interface CuriosityChooserProps {
  block: CuriosityChooserBlock
  /** Default (unfiltered) rail — first 3 products, resolved by the loader. */
  defaultProducts: Product[]
  /** Per-tile resolved products, keyed by tile _key. Only tiles with >=2
   *  resolvable products are ever rendered (dead-end tiles are dropped
   *  upstream in the loader, not here). */
  productsByTile: Record<string, Product[]>
}

function parsePresetParam(searchParams: URLSearchParams): string[] {
  const raw = searchParams.get('preset')
  if (!raw) return []
  return raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 2)
}

export function CuriosityChooser({ block, defaultProducts, productsByTile }: CuriosityChooserProps) {
  const [searchParams, setSearchParams] = useSearchParams()

  const tiles = (block.chooserTiles ?? []).filter(t => (productsByTile[t._key]?.length ?? 0) >= 2)
  if (tiles.length === 0 && defaultProducts.length === 0) return null

  const activeSlugs = parsePresetParam(searchParams)
  const activeTiles = activeSlugs
    .map(slug => tiles.find(t => t.presetSlug === slug))
    .filter((t): t is CuriosityChooserTile => !!t)

  // Combined state: intersect both tiles' product sets. Falls back to the
  // union (deduped) when the intersection would be empty, so a second tap
  // never produces a dead rail — "combine where catalog supports" degrades
  // to "show both" rather than "show nothing".
  let products = defaultProducts
  if (activeTiles.length === 1) {
    products = productsByTile[activeTiles[0]!._key] ?? defaultProducts
  } else if (activeTiles.length === 2) {
    const [a, b] = activeTiles
    const setA = productsByTile[a!._key] ?? []
    const setB = productsByTile[b!._key] ?? []
    const idsB = new Set(setB.map(p => p.id))
    const intersection = setA.filter(p => idsB.has(p.id))
    if (intersection.length >= 2) {
      products = intersection
    } else {
      const seen = new Set<string>()
      products = [...setA, ...setB].filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    }
  }

  const heading = block.heading || 'What are you curious about?'
  const emphasis = block.emphasisWord || 'curious'
  const headingParts = heading.includes(emphasis) ? heading.split(emphasis) : [heading, '']

  // Combined narrator: join both tiles' narrator lines when present, else
  // fall back to the single active tile's line.
  const narratorLine =
    activeTiles.length === 2
      ? [activeTiles[0]?.narratorLine, activeTiles[1]?.narratorLine].filter(Boolean).join(' ')
      : activeTiles[0]?.narratorLine

  function commitSelection(nextSlugs: string[]) {
    const next = new URLSearchParams(searchParams)
    if (nextSlugs.length === 0) next.delete('preset')
    else next.set('preset', nextSlugs.join(','))
    setSearchParams(next, { preventScrollReset: true })
  }

  function handleTileClick(e: React.MouseEvent<HTMLAnchorElement>, tile: CuriosityChooserTile) {
    // Progressive enhancement: intercept and filter in place via search
    // params instead of a full navigation, when JS is available.
    e.preventDefault()
    if (!tile.presetSlug) return
    const isActive = activeSlugs.includes(tile.presetSlug)

    if (isActive) {
      // Tapping an active tile clears just that one.
      commitSelection(activeSlugs.filter(s => s !== tile.presetSlug))
      return
    }
    if (activeSlugs.length === 0) {
      commitSelection([tile.presetSlug])
      return
    }
    if (activeSlugs.length === 1) {
      // Second tap refines — combine, don't swap.
      commitSelection([...activeSlugs, tile.presetSlug])
      return
    }
    // Two taps max: a third tap swaps the newest (second) selection.
    commitSelection([activeSlugs[0]!, tile.presetSlug])
  }

  return (
    <section className="bg-paper px-5 pb-7 pt-6 md:px-8 md:pb-9 md:pt-7">
      <div className="mx-auto max-w-[1320px]">
        <div className="pb-4">
          <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
            Start anywhere
          </p>
          <h2 className="text-[26px] leading-[1.1] tracking-[-0.01em] text-ink md:text-[30px]" style={DISPLAY}>
            {headingParts[0]}
            <em className="em">{emphasis}</em>
            {headingParts[1]}
          </h2>
        </div>

        {tiles.length > 0 && (
          <div className={`flex flex-wrap gap-2 ${activeTiles.length > 0 ? 'pb-3' : 'pb-[18px]'}`}>
            {tiles.map(tile => {
              const isSelected = !!tile.presetSlug && activeSlugs.includes(tile.presetSlug)
              // "incompatible": dimmed while a selection is active and this
              // tile is neither selected nor the second available slot —
              // still tappable (swaps in as the newest selection).
              const isDimmed = activeTiles.length > 0 && !isSelected
              const href = tile.presetSlug
                ? `?preset=${[...activeSlugs.filter(s => s !== tile.presetSlug), tile.presetSlug].slice(-2).join(',')}`
                : '#'
              return (
                <a
                  key={tile._key}
                  href={href}
                  onClick={e => handleTileClick(e, tile)}
                  aria-pressed={isSelected}
                  className={[
                    'rounded-full px-4 py-2.5 text-[13.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-coral focus-visible:outline-offset-2',
                    isSelected
                      ? 'border border-plum bg-plum text-white'
                      : isDimmed
                        ? 'border border-line text-ink-4'
                        : 'border border-line-2 text-ink hover:border-coral hover:text-coral',
                  ].join(' ')}
                  style={BODY}
                >
                  {tile.label}
                  {isSelected && <span aria-hidden="true"> ×</span>}
                </a>
              )
            })}
          </div>
        )}

        {narratorLine && (
          <p className="pb-3.5 text-[14.5px] text-ink-3" style={DISPLAY_ITALIC}>
            {narratorLine}
          </p>
        )}

        {products.length > 0 && (
          <div className="grid grid-cols-3 gap-2.5">
            {products.slice(0, 3).map(product => (
              <a
                key={product.id}
                href={`/products/${product.handle}`}
                className="group block"
              >
                <div className="relative flex aspect-[4/5] items-end justify-center overflow-hidden rounded-[var(--radius-sm)] bg-paper-3 p-1.5">
                  {product.images[0]?.url ? (
                    <OptimizedImage
                      src={product.images[0].url}
                      alt={product.images[0].altText || product.title}
                      sizes="(max-width: 768px) 30vw, 200px"
                      className="h-full w-full object-contain transition-transform duration-[var(--duration-base)] group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-2xl text-ink/10" aria-hidden="true">♥</div>
                  )}
                </div>
                <p className="mt-1.5 line-clamp-1 text-[12px] font-medium text-ink" style={BODY}>
                  {product.title}
                </p>
                <p className="text-[11.5px] font-semibold text-ink" style={BODY}>
                  {fmt(product.price)}
                </p>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
