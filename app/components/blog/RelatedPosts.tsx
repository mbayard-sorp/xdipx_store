import type { BlogPostCard as BlogPostCardType } from '~/types/cms'
import { BlogPostCard } from './BlogPostCard'

export function RelatedPosts({ posts }: { posts: BlogPostCardType[] }) {
  if (!posts.length) return null

  return (
    <section className="mt-12 pt-10 border-t border-brand-mist">
      <h2 className="font-display font-bold text-2xl text-brand-charcoal mb-6">
        Keep Reading ♥
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {posts.map(post => (
          <BlogPostCard key={post._id} post={post} />
        ))}
      </div>
    </section>
  )
}
