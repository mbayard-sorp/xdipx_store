import { Link } from 'react-router'
import type { BlogPostCard } from '~/types/cms'
import { sanityImageUrl, sanityImageSrcSet } from '~/lib/sanity-image'

/**
 * "From Emma's notebook" rail — a compact grid of post cards linking to
 * /notebook/{slug}. Used on the collections index, individual collection pages,
 * the PDP, and the homepage. Renders nothing when there are no posts, so callers
 * can drop it in unconditionally.
 *
 * `seeAllLabel` and `showProductChips` are OPTIONAL and off by default, so the
 * three non-homepage call sites keep their exact current markup. Only the
 * homepage opts in: the Notebook is ~21% of sessions with long dwell and, until
 * now, no path out of it to a product or to the rest of the archive.
 */
export function NotebookRail({
  posts,
  heading = "From Emma's notebook",
  className = 'mt-16',
  seeAllHref = '/notebook',
  seeAllLabel,
  showProductChips = false,
}: {
  posts: BlogPostCard[]
  heading?: string
  className?: string
  /** Target for the trailing see-all link. Only rendered when `seeAllLabel` is set. */
  seeAllHref?: string
  /** Set to render a trailing link to the wider Notebook. Unset = no link (default). */
  seeAllLabel?: string
  /**
   * Render a "Take a peek →" chip on any card whose post embeds a product
   * (`post.productHandle`). The chip is a SIBLING of the post link, never nested
   * inside it (nested anchors are invalid HTML).
   */
  showProductChips?: boolean
}) {
  if (!posts.length) return null

  return (
    <section className={className} aria-labelledby="notebook-rail-heading">
      <h2
        id="notebook-rail-heading"
        className="text-xl font-bold text-ink mb-4"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {heading}
      </h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {posts.map(post => (
          <li key={post._id}>
            <div className="flex h-full flex-col rounded-2xl overflow-hidden border border-line bg-paper hover:shadow-md transition-shadow">
              <Link to={`/notebook/${post.slug}`} className="group block">
                {post.heroImageUrl && (
                  <div className="aspect-[4/3] bg-cream-2 overflow-hidden">
                    <img
                      src={sanityImageUrl(post.heroImageUrl, { w: 600 })}
                      srcSet={sanityImageSrcSet(post.heroImageUrl, [400, 600, 800]) || undefined}
                      sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, 25vw"
                      alt={post.heroImageAlt ?? post.title}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                )}
                <div className="p-3">
                  <h3 className="text-sm font-semibold text-ink line-clamp-2 group-hover:text-coral transition-colors">
                    {post.title}
                  </h3>
                  {post.excerpt && (
                    <p className="mt-1 text-xs text-ink/60 line-clamp-2">{post.excerpt}</p>
                  )}
                </div>
              </Link>
              {showProductChips && post.productHandle && (
                <Link
                  to={`/products/${post.productHandle}`}
                  className="mt-auto flex items-center gap-1 border-t border-line px-3 py-2 text-xs font-medium text-ink-3 transition-colors hover:text-coral"
                >
                  Take a peek <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      {seeAllLabel && (
        <Link
          to={seeAllHref}
          className="mt-6 inline-block text-[15px] font-medium text-ink link-coral"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {seeAllLabel}
        </Link>
      )}
    </section>
  )
}
