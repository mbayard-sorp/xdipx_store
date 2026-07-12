import { Link } from 'react-router'
import type { BlogPostCard as BlogPostCardType } from '~/types/cms'
import { BlogPostCard } from './BlogPostCard'
import { Reveal } from '~/components/motion/Reveal'

export function NotebookTeaser({ posts }: { posts: BlogPostCardType[] }) {
  if (!posts.length) return null

  return (
    <section className="max-w-6xl mx-auto px-4 py-10 sm:py-14">
      <Reveal variant="fade">
        <div className="flex items-end justify-between mb-6 pb-4 border-b border-line-2">
          <div>
            <p className="kicker mb-1.5">The Notebook</p>
            <h2
              className="text-ink text-3xl sm:text-4xl leading-none"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
            >
              Things worth reading
            </h2>
          </div>
          <Link to="/notebook" className="hidden sm:inline link-coral text-coral text-sm font-medium shrink-0">
            See all →
          </Link>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {posts.slice(0, 3).map((post, i) => (
          <Reveal key={post._id} variant="up" index={i}>
            <BlogPostCard post={post} />
          </Reveal>
        ))}
      </div>

      <div className="sm:hidden mt-6 text-center">
        <Link to="/notebook" className="link-coral text-coral text-sm font-medium">
          See all →
        </Link>
      </div>
    </section>
  )
}
