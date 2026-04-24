import { Link } from 'react-router'
import type { BlogPostCard as BlogPostCardType } from '~/types/cms'
import { BlogPostCard } from './BlogPostCard'

export function NotebookTeaser({ posts }: { posts: BlogPostCardType[] }) {
  if (!posts.length) return null

  return (
    <section className="max-w-6xl mx-auto px-4 py-10 sm:py-14">
      <div className="flex items-end justify-between mb-6 pb-4 border-b-2 border-ink">
        <div>
          <p className="text-xs font-mono text-muted uppercase tracking-wider mb-1">The Notebook</p>
          <h2
            className="text-ink text-3xl sm:text-4xl leading-none"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}
          >
            Things worth reading
          </h2>
        </div>
        <Link
          to="/notebook"
          className="hidden sm:inline text-xs font-mono text-coral uppercase tracking-wider hover:underline shrink-0"
        >
          See all →
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {posts.slice(0, 3).map(post => (
          <BlogPostCard key={post._id} post={post} />
        ))}
      </div>

      <div className="sm:hidden mt-6 text-center">
        <Link
          to="/notebook"
          className="inline-block text-xs font-mono text-coral uppercase tracking-wider hover:underline"
        >
          See all →
        </Link>
      </div>
    </section>
  )
}
