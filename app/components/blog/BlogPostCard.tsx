import { Link } from 'react-router'
import type { BlogPostCard as BlogPostCardType } from '~/types/cms'

const CATEGORY_COLORS: Record<string, string> = {
  coral:    'bg-brand-coral text-white',
  orange:   'bg-brand-orange text-white',
  purple:   'bg-brand-purple text-white',
  charcoal: 'bg-brand-charcoal text-white',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function BlogPostCard({ post }: { post: BlogPostCardType }) {
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="group block rounded-2xl bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
    >
      {post.heroImageUrl ? (
        <div className="aspect-[16/9] overflow-hidden">
          <img
            src={post.heroImageUrl}
            alt={post.heroImageAlt ?? post.title}
            loading="lazy"
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      ) : (
        <div className="aspect-[16/9] bg-brand-mist flex items-center justify-center">
          <span className="text-4xl">♥</span>
        </div>
      )}

      <div className="p-4 sm:p-5">
        {post.category && (
          <span
            className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full mb-2 ${
              CATEGORY_COLORS[post.category.color ?? 'purple'] ?? CATEGORY_COLORS.purple
            }`}
          >
            {post.category.name}
          </span>
        )}

        <h3 className="font-display font-semibold text-brand-charcoal text-lg leading-snug mb-1.5 group-hover:text-brand-purple transition-colors line-clamp-2">
          {post.title}
        </h3>

        <p className="text-sm text-brand-charcoal/70 line-clamp-2 mb-3">
          {post.excerpt}
        </p>

        <div className="flex items-center gap-3 text-xs text-brand-charcoal/50">
          {post.author && (
            <div className="flex items-center gap-1.5">
              {post.author.avatarUrl ? (
                <img
                  src={post.author.avatarUrl}
                  alt={post.author.name}
                  className="w-5 h-5 rounded-full object-cover"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-brand-mist flex items-center justify-center text-[10px]">
                  {post.author.name.charAt(0)}
                </div>
              )}
              <span>{post.author.name}</span>
            </div>
          )}
          <span>{formatDate(post.publishedAt)}</span>
          <span>{post.readingTime} min read</span>
        </div>
      </div>
    </Link>
  )
}
