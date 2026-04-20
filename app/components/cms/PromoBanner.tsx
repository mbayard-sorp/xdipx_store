import { Link } from 'react-router'
import type { PromoBannerBlock } from '~/types/cms'

interface PromoBannerProps {
  block: PromoBannerBlock
}

export function PromoBanner({ block }: PromoBannerProps) {
  const { headline, subtext, ctaLabel, ctaLink, layout, bgStyle, image } = block

  const bgClass =
    bgStyle === 'gradient' ? 'bg-coral text-white' :
    bgStyle === 'purple'   ? 'bg-sage text-white' :
    bgStyle === 'mist'     ? 'bg-cream-2 text-ink' :
    bgStyle === 'cream'    ? 'bg-cream text-ink' :
    'bg-ink text-white'                                // charcoal default

  const isLight = bgStyle === 'mist' || bgStyle === 'cream'

  const ctaClass = isLight
    ? 'bg-coral text-white hover:opacity-90'
    : 'bg-white text-ink hover:bg-cream'

  if (layout === 'full-bleed' && image?.url) {
    return (
      <section className="relative overflow-hidden py-16 px-4">
        <img
          src={image.url}
          alt={image.alt ?? ''}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-ink/60" />
        <div className="relative z-10 max-w-3xl mx-auto text-center text-white">
          <h2
            className="text-3xl md:text-4xl font-bold mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {headline}
          </h2>
          {subtext && <p className="text-white/80 mb-6">{subtext}</p>}
          <Link
            to={ctaLink}
            className="inline-block bg-coral text-white font-bold px-8 py-3 rounded-full hover:opacity-90 transition-opacity shadow-lg"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {ctaLabel}
          </Link>
        </div>
      </section>
    )
  }

  const hasImage = image?.url && (layout === 'image-left' || layout === 'image-right')

  return (
    <section className={`py-12 px-4 ${bgClass}`}>
      <div
        className={[
          'max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-8',
          layout === 'image-right' ? 'md:flex-row-reverse' : '',
        ].join(' ')}
      >
        {hasImage && (
          <div className="w-full md:w-2/5 shrink-0">
            <img
              src={image!.url!}
              alt={image!.alt ?? ''}
              className="w-full rounded-2xl object-cover max-h-64"
              loading="lazy"
            />
          </div>
        )}
        <div className={hasImage ? 'flex-1' : 'text-center w-full'}>
          <h2
            className="text-2xl md:text-3xl font-bold mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {headline}
          </h2>
          {subtext && <p className="opacity-80 mb-6">{subtext}</p>}
          <Link
            to={ctaLink}
            className={`inline-block font-bold px-7 py-3 rounded-full transition-all hover:scale-[1.02] shadow-sm ${ctaClass}`}
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </section>
  )
}
