import { Link } from 'react-router'
import type { EditorialTilesBlock } from '~/types/cms'
import { bgClass, isDarkBg } from './bgStyle'

interface EditorialTilesProps {
  block: EditorialTilesBlock
}

export function EditorialTiles({ block }: EditorialTilesProps) {
  const { eyebrow, heading, tiles } = block

  if (!tiles.length) return null

  const style = block.bgStyle ?? 'cream'
  const dark  = isDarkBg(style)

  return (
    <section className={`py-12 px-4 ${bgClass(style)}`}>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          {eyebrow && (
            <p className={`text-xs font-semibold uppercase tracking-widest mb-2 ${dark ? 'text-sage/80' : 'text-sage'}`}>
              {eyebrow}
            </p>
          )}
          <h2
            className={`text-2xl md:text-3xl font-bold ${dark ? 'text-white' : 'text-ink'}`}
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
              <article className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:shadow-sage/10 transition-all duration-300 card-lift">
                {tile.image?.url ? (
                  <div className="aspect-[4/3] overflow-hidden bg-cream-2">
                    <img
                      src={tile.image.url}
                      alt={tile.image.alt ?? tile.label}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="aspect-[4/3] bg-cream-2 flex items-center justify-center text-5xl">
                    {tile.emoji ?? '♥'}
                  </div>
                )}
                <div className="p-5">
                  <p
                    className="font-bold text-ink group-hover:text-coral transition-colors"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {tile.label}
                  </p>
                  {tile.body && (
                    <p className="text-ink/60 text-sm mt-1 line-clamp-2">{tile.body}</p>
                  )}
                  {tile.linkLabel && (
                    <p className="text-sage text-sm font-semibold mt-3">
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
