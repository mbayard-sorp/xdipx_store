import type { BrandLogoWallBlock } from '~/types/cms'
import { bgClass, isDarkBg } from './bgStyle'

interface BrandLogoWallProps {
  block: BrandLogoWallBlock
}

export function BrandLogoWall({ block }: BrandLogoWallProps) {
  const { heading, logos } = block

  if (!logos.length) return null

  const style = block.bgStyle ?? 'white'
  const dark  = isDarkBg(style)

  return (
    <section className={`py-10 px-4 border-t border-cream-2 ${bgClass(style)}`}>
      <div className="max-w-5xl mx-auto">
        {heading && (
          <p className={`text-center text-xs font-semibold uppercase tracking-widest mb-6 ${dark ? 'text-white/50' : 'text-ink/40'}`}>
            {heading}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10">
          {logos.map((logo, i) => (
            logo.logo?.url ? (
              <a
                key={i}
                href={logo.link ?? '#'}
                target={logo.link ? '_blank' : undefined}
                rel="noopener noreferrer"
                className="opacity-40 hover:opacity-70 transition-opacity grayscale hover:grayscale-0"
              >
                <img
                  src={logo.logo.url}
                  alt={logo.brand}
                  className="w-[130px] h-[130px] object-contain"
                  loading="lazy"
                />
              </a>
            ) : (
              <span
                key={i}
                className="text-ink/30 text-sm font-bold tracking-wide uppercase"
              >
                {logo.emoji ?? logo.brand}
              </span>
            )
          ))}
        </div>
      </div>
    </section>
  )
}
