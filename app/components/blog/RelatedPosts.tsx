import type { BlogPostCard as BlogPostCardType } from '~/types/cms'
import { BlogPostCard } from './BlogPostCard'
import { Reveal } from '~/components/motion/Reveal'

export function RelatedPosts({ posts }: { posts: BlogPostCardType[] }) {
  if (!posts.length) return null

  return (
    <section className="mt-12 pt-10 border-t border-line">
      <Reveal variant="fade" as="h2">
        <span
          className="text-ink text-2xl md:text-3xl"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
        >
          Keep reading
        </span>
      </Reveal>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-7 xl:gap-8 mt-6">
        {posts.map((post, i) => (
          <Reveal key={post._id} variant="up" index={i}>
            <BlogPostCard post={post} />
          </Reveal>
        ))}
      </div>
    </section>
  )
}
