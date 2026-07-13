import { Link } from 'react-router'
import type { BlogPostExtras } from '~/types/cms'
import { Reveal } from '~/components/motion/Reveal'
import { trackNotebookSeriesClick } from '~/lib/analytics.client'

/**
 * "Continue the series" card shown at the end of a post that belongs to a
 * blogSeries (art direction §8). Renders nothing for standalone posts.
 */
export function SeriesNav({ extras }: { extras?: BlogPostExtras | null | undefined }) {
  const series = extras?.series
  if (!series) return null

  const partLine =
    extras?.seriesOrder && series.postCount
      ? `Part ${extras.seriesOrder} of ${series.postCount}`
      : series.postCount
        ? `A series in ${series.postCount} parts`
        : 'A series'

  return (
    <Reveal variant="up" as="aside" className="mt-10 border border-line rounded-lg p-5 md:p-6 relative overflow-hidden">
      <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-coral" aria-hidden="true" />
      <p className="kicker mb-2">
        {(series.kicker ?? series.title).toUpperCase()} · {partLine.toUpperCase()}
      </p>
      <p
        className="text-ink text-lg md:text-xl leading-snug"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
      >
        This piece is part of {series.title}.
      </p>
      <Link
        to={`/notebook/series/${series.slug}`}
        onClick={() => trackNotebookSeriesClick({ seriesSlug: series.slug, from: 'post' })}
        className="link-coral text-coral text-sm font-medium inline-block mt-3"
      >
        Continue the series →
      </Link>
    </Reveal>
  )
}
