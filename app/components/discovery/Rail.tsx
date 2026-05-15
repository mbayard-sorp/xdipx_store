/**
 * Discovery rail — one top-level category.
 * Mobile: horizontal scroll with snap.
 * >= md: 3-col or 4-col grid based on cards prop.
 * Empty state: shows getRailEmptyLine() copy.
 */

import { getRailEmptyLine, railTitleSegments } from '~/lib/discovery-emma'
import type { DiscoveryState, Rail as RailType } from '~/types/discovery'
import { EMPTY_STATE } from '~/types/discovery'
import { ProductCard } from './ProductCard'

interface RailProps {
  rail: RailType
  state?: DiscoveryState
  cards?: 3 | 4
}

export function Rail({ rail, state = EMPTY_STATE, cards = 4 }: RailProps) {
  const segments = railTitleSegments(rail.category, state)
  const listId   = `discovery_${rail.category.toLowerCase()}`
  const listName = segments.map(s => s.text).join('')

  return (
    <section aria-label={listName}>
      {/* Rail header */}
      <div className="flex items-baseline justify-between mb-3">
        <h2
          className="text-xl font-bold text-ink leading-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {segments.map((seg, i) =>
            seg.emphasized
              ? <em key={i} className="italic not-italic" style={{ fontStyle: 'italic' }}>{seg.text}</em>
              : <span key={i}>{seg.text}</span>
          )}
        </h2>
        {rail.total > rail.items.length && (
          <span className="text-xs text-muted" style={{ fontFamily: 'var(--font-body)' }}>
            {rail.total} total
          </span>
        )}
      </div>

      {rail.items.length === 0 ? (
        <p className="text-sm text-muted italic py-6" style={{ fontFamily: 'var(--font-body)' }}>
          {getRailEmptyLine(rail.category)}
        </p>
      ) : (
        <>
          {/* Mobile: snap scroll */}
          <div
            className={`
              md:hidden
              flex gap-3 overflow-x-auto snap-x snap-mandatory
              pb-2 -mx-4 px-4
              scrollbar-none
            `}
            style={{ scrollbarWidth: 'none' }}
          >
            {rail.items.map(({ product }, i) => (
              <div key={product.id} className="snap-start flex-none w-44">
                <ProductCard
                  product={product}
                  index={i}
                  listId={listId}
                  listName={listName}
                />
              </div>
            ))}
          </div>

          {/* Desktop: grid */}
          <div
            className={`
              hidden md:grid gap-4
              ${cards === 3 ? 'grid-cols-3' : 'grid-cols-4'}
            `}
          >
            {rail.items.map(({ product }, i) => (
              <ProductCard
                key={product.id}
                product={product}
                index={i}
                listId={listId}
                listName={listName}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
