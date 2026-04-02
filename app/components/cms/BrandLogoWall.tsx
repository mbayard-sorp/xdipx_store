import type { BrandLogoWallBlock } from '~/types/cms'

interface BrandLogoWallProps {
  block: BrandLogoWallBlock
}

export function BrandLogoWall({ block }: BrandLogoWallProps) {
  const { heading, logos } = block

  if (!logos.length) return null

  return (
    <section className="py-10 px-4 bg-white border-t border-brand-mist">
      <div className="max-w-5xl mx-auto">
        {heading && (
          <p className="text-center text-brand-charcoal/40 text-xs font-semibold uppercase tracking-widest mb-6">
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
                  className="h-7 md:h-8 w-auto object-contain"
                  loading="lazy"
                />
              </a>
            ) : (
              <span
                key={i}
                className="text-brand-charcoal/30 text-sm font-bold tracking-wide uppercase"
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
