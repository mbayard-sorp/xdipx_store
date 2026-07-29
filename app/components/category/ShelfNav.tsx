/**
 * Horizontal jump-to-shelf nav. Sticky via CSS only (`sticky top-0`) when
 * `block.sticky`, no scroll-listener JS. Not wrapped in Reveal: a nav bar
 * that fades in after scroll is a nav bar you can miss.
 */

import type { ResolvedCategoryBlock } from '~/types/cms'
import { MONO, BODY } from './consts'

type Block = Extract<ResolvedCategoryBlock, { _type: 'shelfNav' }>

export function ShelfNav({ block }: { block: Block }) {
  return (
    <nav
      id={block.anchorId}
      data-block={block._type}
      aria-label={block.label}
      className={
        block.sticky
          ? 'sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur'
          : 'border-b border-line bg-paper'
      }
    >
      <div className="mx-auto flex max-w-[1320px] items-center gap-1 overflow-x-auto px-6 py-3 [scrollbar-width:none] md:px-16 [&::-webkit-scrollbar]:hidden">
        <span className="mr-2 shrink-0 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
          {block.label}
        </span>
        {block.tiles.map(tile => (
          <a
            key={tile.anchorId}
            href={`#${tile.anchorId}`}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-4 py-2 text-[13.5px] text-ink transition-colors hover:bg-paper-2"
            style={BODY}
          >
            {tile.label}
            {tile.count != null && (
              <span className="text-[11px] text-ink-4" style={MONO}>
                {tile.count}
              </span>
            )}
          </a>
        ))}
      </div>
    </nav>
  )
}
