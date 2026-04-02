import { Link } from 'react-router'
import type { EditorialTilesBlock } from '~/types/cms'

interface EditorialTilesProps {
  block: EditorialTilesBlock
}

export function EditorialTiles({ block }: EditorialTilesProps) {
  const { eyebrow, heading, tiles } = block

  if (!tiles.length) return null

  return (
    <section className="py-12 px-4 bg-brand-cream">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          {eyebrow && (
            <p className="text-brand-purple text-xs font-semibold uppercase tracking-widest mb-2">
              {eyebrow}
            </p>
          )}
          <h2
            className="text-2xl md:text-3xl font-bold text-brand-charcoal"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {heading}
          </h2>
        </div>

        {/* Tile grid */}
        <div
          className={[
            'grid gap-6',
            tiles.length === 2 ? 'md:grid-cols-2' :
            tiles.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' :
            'sm:grid-cols-2 lg:grid-cols-3',
          ].join(' ')}
        >
          {tiles.map((tile, i) => (
            <Link key={i} to={tile.link} className="group block">
              <article className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:shadow-brand-purple/10 transition-all duration-300 card-lift">
                {tile.image?.url ? (
                  <div className="aspect-[4/3] overflow-hidden bg-brand-mist">
                    <img
                      src={tile.image.url}
                      alt={tile.image.alt ?? tile.label}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="aspect-[4/3] bg-brand-mist flex items-center justify-center text-5xl">
                    {tile.emoji ?? '♥'}
                  </div>
                )}
                <div className="p-5">
                  <p
                    className="font-bold text-brand-charcoal group-hover:text-brand-coral transition-colors"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {tile.label}
                  </p>
                  {tile.body && (
                    <p className="text-brand-charcoal/60 text-sm mt-1 line-clamp-2">{tile.body}</p>
                  )}
                  {tile.linkLabel && (
                    <p className="text-brand-purple text-sm font-semibold mt-3">
                      {tile.linkLabel} →
                    </p>
                  )}
                </div>
              </article>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
