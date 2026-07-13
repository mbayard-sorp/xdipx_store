import { Link } from 'react-router'
import type { BlogPostCard } from '~/types/cms'

/**
 * "From Emma's notebook" rail — a compact grid of post cards linking to
 * /notebook/{slug}. Used on the collections index, individual collection pages,
 * and anywhere a lightweight inbound link into the Notebook is wanted. Renders
 * nothing when there are no posts, so callers can drop it in unconditionally.
 */
export function NotebookRail({
  posts,
  heading = "From Emma's notebook",
  className = 'mt-16',
}: {
  posts: BlogPostCard[]
  heading?: string
  className?: string
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
            <Link
              to={`/notebook/${post.slug}`}
              className="group block rounded-2xl overflow-hidden border border-line bg-paper hover:shadow-md transition-shadow"
            >
              {post.heroImageUrl && (
                <div className="aspect-[4/3] bg-cream-2 overflow-hidden">
                  <img
                    src={`${post.heroImageUrl}${post.heroImageUrl.includes('?') ? '&' : '?'}w=600`}
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
          </li>
        ))}
      </ul>
    </section>
  )
}
