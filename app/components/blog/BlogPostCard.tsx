import { Link } from 'react-router'
import type { BlogPostCard as BlogPostCardType } from '~/types/cms'
import { SanityImage } from '~/components/common/SanityImage'
import { categoryAccent } from '~/lib/blog-style'
import { CategoryChip } from './CategoryChip'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function BlogPostCard({ post }: { post: BlogPostCardType }) {
  const accent = categoryAccent(post.category?.slug, post.category?.color)

  return (
    <Link
      to={`/notebook/${post.slug}`}
      className="group block bg-paper border border-line rounded-lg overflow-hidden card-lift press"
    >
      {post.heroImageUrl ? (
        <div className="aspect-[4/3] overflow-hidden">
          <SanityImage
            src={post.heroImageUrl}
            alt={post.heroImageAlt ?? post.title}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            widths={[400, 640, 828]}
            fallbackWidth={640}
            {...(post.heroWidth ? { width: post.heroWidth } : {})}
            {...(post.heroHeight ? { height: post.heroHeight } : {})}
            {...(post.heroLqip ? { lqip: post.heroLqip } : {})}
            className="h-full w-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
          />
        </div>
      ) : (
        <div className="aspect-[4/3] bg-paper-2 flex items-center justify-center">
          <span className="text-4xl text-ink/15">♥</span>
        </div>
      )}

      <div className="p-4 sm:p-5">
        <span className={`block w-8 h-0.5 mb-3 ${accent.tick}`} aria-hidden="true" />

        <div className="flex items-center gap-2 mb-2.5">
          {post.category && (
            <CategoryChip
              name={post.category.name}
              slug={post.category.slug}
              color={post.category.color}
              linked={false}
            />
          )}
          {post.readingTime > 0 && (
            <span className="kicker">{post.readingTime} min</span>
          )}
        </div>

        <h3
          className="text-ink text-xl xl:text-2xl leading-[1.12] mb-2 group-hover:text-coral transition-colors line-clamp-3"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          {post.title}
        </h3>

        <p className="text-sm text-ink-3 leading-[1.55] line-clamp-2 mb-3">
          {post.excerpt}
        </p>

        <div className="flex items-center gap-2 text-[13px] text-ink-4">
          {post.author && <span>{post.author.name}</span>}
          {post.author && <span aria-hidden="true">·</span>}
          <span>{formatDate(post.publishedAt)}</span>
        </div>
      </div>
    </Link>
  )
}
