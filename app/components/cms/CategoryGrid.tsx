import { Link } from 'react-router'
import type { CategoryGridBlock } from '~/types/cms'
import { bgClass, isDarkBg } from './bgStyle'

interface CategoryGridProps {
  block: CategoryGridBlock
}

export function CategoryGrid({ block }: CategoryGridProps) {
  const { heading, items, columns = 4 } = block

  if (!items.length) return null

  const colClass =
    columns === 3 ? 'grid-cols-3' :
    columns === 6 ? 'grid-cols-3 sm:grid-cols-6' :
    'grid-cols-2 sm:grid-cols-4'

  const style = block.bgStyle ?? 'white'
  const dark  = isDarkBg(style)

  return (
    <section className={`py-12 px-4 ${bgClass(style)}`}>
      <div className="max-w-6xl mx-auto">
        <h2
          className={`text-2xl font-bold mb-6 text-center ${dark ? 'text-white' : 'text-ink'}`}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {heading}
        </h2>

        <div className={`grid ${colClass} gap-3 md:gap-4`}>
          {items.map((item, i) => (
            <Link key={i} to={item.link} className="group">
              <div className="bg-cream-2 rounded-2xl overflow-hidden aspect-square relative hover:shadow-md transition-shadow">
                {item.image?.url ? (
                  <img
                    src={item.image.url}
                    alt={item.image.alt ?? item.label}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl">
                    {item.emoji ?? '♥'}
                  </div>
                )}
                {/* Gradient overlay + label */}
                <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent" />
                <p
                  className="absolute bottom-0 left-0 right-0 text-white text-xs sm:text-sm font-bold p-3 text-center"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {item.label}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
