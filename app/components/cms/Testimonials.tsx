import type { TestimonialsBlock } from '~/types/cms'

interface TestimonialsProps {
  block: TestimonialsBlock
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={i < rating ? 'text-coral-2' : 'text-ink/20'}
          aria-hidden="true"
        >
          ★
        </span>
      ))}
    </div>
  )
}

export function Testimonials({ block }: TestimonialsProps) {
  const { heading, items } = block

  if (!items.length) return null

  return (
    <section className="py-12 px-4 bg-cream-2">
      <div className="max-w-6xl mx-auto">
        <h2
          className="text-2xl font-bold text-ink mb-8 text-center"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {heading}
        </h2>

        <div
          className={[
            'grid gap-5',
            items.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3',
          ].join(' ')}
        >
          {items.map((item, i) => (
            <article key={i} className="bg-white rounded-2xl p-6 shadow-sm">
              <StarRating rating={item.rating} />
              <blockquote className="mt-4 text-ink/80 text-sm leading-relaxed italic">
                "{item.quote}"
              </blockquote>
              <footer className="mt-4 flex items-center gap-2">
                <p
                  className="text-ink font-semibold text-sm"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {item.author}
                </p>
                {item.verified && (
                  <span className="text-xs text-green-600 font-medium">✓ Verified</span>
                )}
              </footer>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
