import { Link } from 'react-router'
import type { PlayTogetherBannerBlock } from '~/types/cms'

interface PlayTogetherBannerProps {
  block: PlayTogetherBannerBlock
}

export function PlayTogetherBanner({ block }: PlayTogetherBannerProps) {
  const { heading, body, ctaLabel, ctaLink, image, imagePosition = 'right' } = block

  return (
    <section className="py-12 px-4 bg-brand-mist">
      <div
        className={[
          'max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-10',
          imagePosition === 'left' ? 'md:flex-row-reverse' : '',
        ].join(' ')}
      >
        {/* Copy */}
        <div className="flex-1 text-center md:text-left">
          <p className="text-brand-purple text-xs font-semibold uppercase tracking-widest mb-2">
            ♥ For Couples
          </p>
          <h2
            className="text-2xl md:text-3xl font-bold text-brand-charcoal mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {heading}
          </h2>
          <p className="text-brand-charcoal/70 mb-6 leading-relaxed">{body}</p>
          <Link
            to={ctaLink}
            className="inline-block bg-brand-gradient text-white font-bold px-7 py-3 rounded-full hover:opacity-90 hover:scale-[1.02] transition-all shadow-md shadow-brand-coral/20"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {ctaLabel}
          </Link>
        </div>

        {/* Image */}
        {image?.url ? (
          <div className="w-full md:w-2/5 shrink-0">
            <img
              src={image.url}
              alt={image.alt ?? heading}
              className="w-full rounded-3xl object-cover aspect-[4/3]"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="w-full md:w-2/5 shrink-0 aspect-[4/3] bg-white rounded-3xl flex items-center justify-center text-8xl">
            🫶
          </div>
        )}
      </div>
    </section>
  )
}
