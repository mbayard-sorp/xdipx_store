import type { BlogPost } from '~/types/cms'

const CATEGORY_COLORS: Record<string, string> = {
  coral:    'bg-brand-coral text-white',
  orange:   'bg-brand-orange text-white',
  purple:   'bg-brand-purple text-white',
  charcoal: 'bg-brand-charcoal text-white',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function BlogHero({ post, readingTime }: { post: BlogPost; readingTime: number }) {
  return (
    <header className="relative overflow-hidden rounded-2xl mb-8">
      {post.heroImageUrl ? (
        <>
          <img
            src={post.heroImageUrl}
            alt={post.heroImageAlt ?? post.title}
            className="w-full aspect-[21/9] sm:aspect-[3/1] object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-brand-charcoal/80 via-brand-charcoal/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-8">
            <HeroMeta post={post} readingTime={readingTime} light />
          </div>
        </>
      ) : (
        <div className="bg-brand-mist p-5 sm:p-8">
          <HeroMeta post={post} readingTime={readingTime} light={false} />
        </div>
      )}
    </header>
  )
}

function HeroMeta({ post, readingTime, light }: { post: BlogPost; readingTime: number; light: boolean }) {
  const textColor = light ? 'text-white' : 'text-brand-charcoal'
  const mutedColor = light ? 'text-white/70' : 'text-brand-charcoal/60'

  return (
    <div>
      {post.category && (
        <span
          className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full mb-3 ${
            CATEGORY_COLORS[post.category.color ?? 'purple'] ?? CATEGORY_COLORS.purple
          }`}
        >
          {post.category.name}
        </span>
      )}

      <h1 className={`font-display font-bold text-2xl sm:text-4xl lg:text-5xl leading-tight mb-3 ${textColor}`}>
        {post.title}
      </h1>

      <div className={`flex flex-wrap items-center gap-3 text-sm ${mutedColor}`}>
        {post.author && (
          <div className="flex items-center gap-2">
            {post.author.avatarUrl ? (
              <img
                src={post.author.avatarUrl}
                alt={post.author.name}
                className="w-7 h-7 rounded-full object-cover"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-semibold">
                {post.author.name.charAt(0)}
              </div>
            )}
            <span className="font-medium">{post.author.name}</span>
          </div>
        )}
        <span>·</span>
        <span>{formatDate(post.publishedAt)}</span>
        <span>·</span>
        <span>{readingTime} min read</span>
      </div>
    </div>
  )
}
