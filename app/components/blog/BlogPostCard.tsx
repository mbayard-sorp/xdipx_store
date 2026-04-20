import { Link } from 'react-router'
import type { BlogPostCard as BlogPostCardType } from '~/types/cms'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function BlogPostCard({ post }: { post: BlogPostCardType }) {
  return (
    <Link
      to={`/notebook/${post.slug}`}
      className="group block bg-paper border border-line overflow-hidden hover:border-coral transition-colors"
    >
      {post.heroImageUrl ? (
        <div className="aspect-[16/10] overflow-hidden border-b-2 border-ink">
          <img
            src={post.heroImageUrl}
            alt={post.heroImageAlt ?? post.title}
            loading="lazy"
            className="h-full w-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
          />
        </div>
      ) : (
        <div className="aspect-[16/10] bg-cream-2 flex items-center justify-center border-b-2 border-ink">
          <span className="text-4xl text-ink/20">♥</span>
        </div>
      )}

      <div className="p-4">
        {post.category && (
          <span className="inline-block text-[10px] font-mono uppercase tracking-wider text-muted border border-line px-2 py-0.5 rounded-full mb-2">
            {post.category.name}
          </span>
        )}

        <h3
          className="text-ink text-lg leading-tight mb-1.5 group-hover:text-coral transition-colors line-clamp-2"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}
        >
          {post.title}
        </h3>

        <p className="text-sm text-ink/70 line-clamp-2 mb-3">
          {post.excerpt}
        </p>

        <div className="flex items-center gap-2 text-[11px] font-mono text-muted uppercase tracking-wider">
          {post.author && <span>— {post.author.name}</span>}
          <span>·</span>
          <span>{formatDate(post.publishedAt)}</span>
          <span>·</span>
          <span>{post.readingTime} min</span>
        </div>
      </div>
    </Link>
  )
}
