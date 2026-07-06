/**
 * 1g — Category quick-nav grid.
 *
 * The seeker's fast lane, lives high on the page. No images. Tint rotation
 * (never two alike adjacent): coral-soft / plum-soft / paper-3. Same links as
 * the nav menu — this grid is redundancy by design, never the sole path.
 */

import { Link } from 'react-router'
import type { QuickNavGridBlock, QuickNavTintHint } from '~/types/cms'

const BODY = { fontFamily: 'var(--font-body)' } as const

const TINT_ROTATION: QuickNavTintHint[] = ['coral-soft', 'plum-soft', 'paper-3']

const TINT_CLASS: Record<QuickNavTintHint, string> = {
  'coral-soft': 'bg-coral-soft',
  'plum-soft': 'bg-plum-soft',
  'paper-3': 'bg-paper-3',
}

// Static class lookup — Tailwind's build-time scanner needs literal class
// strings, so a template-literal-interpolated `md:grid-cols-[repeat(${n},1fr)]`
// would never be picked up. desktopCols is one of 1..6 (count<=4 uses count,
// otherwise 6), so this table covers every case the component can produce.
const DESKTOP_COLS_CLASS: Record<number, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  6: 'md:grid-cols-6',
}

interface QuickNavGridProps {
  block: QuickNavGridBlock
}

export function QuickNavGrid({ block }: QuickNavGridProps) {
  const tiles = block.navTiles ?? []
  if (tiles.length === 0) return null

  const count = tiles.length
  // Odd tile count on mobile: last tile spans both columns.
  const lastSpansBoth = count % 2 !== 0
  // 4 tiles: desktop becomes one row of 4, tiles widen. Otherwise one row of 6.
  const desktopCols = count <= 4 ? count : 6

  return (
    <section className="bg-paper px-5 py-5 md:px-6 md:py-6">
      <div
        className={`mx-auto grid max-w-[1320px] grid-cols-2 gap-2.5 ${DESKTOP_COLS_CLASS[desktopCols] ?? 'md:grid-cols-6'}`}
      >
        {tiles.map((tile, i) => {
          const tint = tile.tintHint ?? TINT_ROTATION[i % TINT_ROTATION.length]!
          const isLast = i === count - 1
          return (
            <Link
              key={tile._key}
              to={tile.link}
              className={[
                'group flex min-h-[88px] flex-col justify-between rounded-[var(--radius)] p-4 transition-all duration-[var(--duration-fast)] hover:-translate-y-[3px] hover:outline hover:outline-1 hover:outline-coral md:min-h-[96px]',
                TINT_CLASS[tint],
                isLast && lastSpansBoth ? 'col-span-2 md:col-span-1' : '',
              ].join(' ')}
            >
              <span
                className="line-clamp-2 text-[15px] font-semibold text-ink md:text-[14px]"
                style={BODY}
              >
                {tile.label}
              </span>
              <span
                className="self-end text-ink transition-colors group-hover:text-coral"
                aria-hidden="true"
              >
                →
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
