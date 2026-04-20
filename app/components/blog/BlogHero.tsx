import { Link } from 'react-router'
import type { BlogPost } from '~/types/cms'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function BlogHero({ post, readingTime }: { post: BlogPost; readingTime: number }) {
  return (
    <header className="max-w-3xl mx-auto">
      {post.category && (
        <Link
          to={`/notebook/category/${post.category.slug}`}
          className="inline-block text-[10px] font-mono uppercase tracking-wider bg-coral text-white px-2.5 py-1 rounded-full mb-4 hover:bg-coral-deep transition-colors"
        >
          {post.category.name}
        </Link>
      )}

      <h1
        className="text-ink text-3xl sm:text-5xl leading-[1.05] mb-4"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}
      >
        {post.title}
      </h1>

      {post.excerpt && (
        <p className="text-ink/70 text-base sm:text-lg leading-snug mb-6 max-w-2xl">
          {post.excerpt}
        </p>
      )}

      <div className="flex items-center gap-3 pb-6 border-b border-line">
        {post.author && (
          <Link to={`/notebook/by/${post.author.slug}`} className="flex items-center gap-2 hover:text-coral transition-colors">
            {post.author.avatarUrl ? (
              <img
                src={post.author.avatarUrl}
                alt={post.author.name}
                className="w-8 h-8 rounded-full object-cover border border-line"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full bg-coral text-white flex items-center justify-center font-bold"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {post.author.name.charAt(0)}
              </div>
            )}
            <div className="text-xs">
              <div className="font-mono text-ink">{post.author.name}</div>
              {post.author.role && (
                <div className="font-mono text-muted">{post.author.role}</div>
              )}
            </div>
          </Link>
        )}
        <span className="text-muted">·</span>
        <span className="text-xs font-mono text-muted">{formatDate(post.publishedAt)}</span>
        <span className="text-muted">·</span>
        <span className="text-xs font-mono text-muted">{readingTime} min read</span>
      </div>

      {post.heroImageUrl && (
        <img
          src={post.heroImageUrl}
          alt={post.heroImageAlt ?? post.title}
          className="w-full aspect-[16/9] object-cover mt-8 rounded-lg"
        />
      )}
    </header>
  )
}
