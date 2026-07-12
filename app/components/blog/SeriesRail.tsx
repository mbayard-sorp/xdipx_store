import { Link } from 'react-router'
import type { BlogSeries } from '~/types/cms'
import { SanityImage } from '~/components/common/SanityImage'
import { Reveal } from '~/components/motion/Reveal'

/**
 * Horizontal rail of series covers for the index and category pages
 * (art direction §8): each series is a portrait cover + kicker + title,
 * scrolling sideways inside its own container.
 */
export function SeriesRail({ series }: { series: BlogSeries[] }) {
  if (!series.length) return null

  return (
    <section aria-label="Series">
      <Reveal variant="fade">
        <div className="flex items-baseline justify-between mb-5 pb-3 border-b border-line-2">
          <h2
            className="text-ink text-2xl md:text-3xl leading-none"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
          >
            Series worth following
          </h2>
          <span className="kicker hidden sm:inline">Read in order, or don't</span>
        </div>
      </Reveal>
      <div className="flex gap-4 md:gap-6 overflow-x-auto pb-2 scrollbar-hide">
        {series.map((s, i) => (
          <Reveal key={s.slug} variant="up" index={i} className="shrink-0 w-44 md:w-52">
            <Link to={`/notebook/series/${s.slug}`} className="group block press">
              {s.coverImageUrl ? (
                <div className="aspect-[4/5] rounded-lg overflow-hidden bg-paper-3">
                  <SanityImage
                    src={s.coverImageUrl}
                    alt={s.coverImageAlt ?? s.title}
                    sizes="208px"
                    widths={[400, 640]}
                    fallbackWidth={400}
                    {...(s.coverLqip ? { lqip: s.coverLqip } : {})}
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                  />
                </div>
              ) : (
                <div className="aspect-[4/5] rounded-lg bg-paper-3 flex items-center justify-center">
                  <span
                    className="text-ink-4 text-2xl px-4 text-center leading-tight"
                    style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                  >
                    {s.title}
                  </span>
                </div>
              )}
              <p className="kicker mt-3">
                {(s.kicker ?? 'A series').toUpperCase()}
                {s.posts.length > 0 ? ` · ${s.posts.length} PARTS` : ''}
              </p>
              <p
                className="text-ink text-lg leading-snug mt-1 group-hover:text-coral transition-colors"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
              >
                {s.title}
              </p>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
