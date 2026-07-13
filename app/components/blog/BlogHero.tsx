import { Link } from 'react-router'
import { motion } from 'motion/react'
import type { BlogPost } from '~/types/cms'
import { SanityImage } from '~/components/common/SanityImage'
import { categoryAccent } from '~/lib/blog-style'
import { CategoryChip } from './CategoryChip'
import { heartbeat } from '~/components/motion/variants'
import { useReveal } from '~/lib/use-reveal'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatReviewed(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/** The page's single ♥ beat (art direction §6, one-heartbeat rule). */
function HeartbeatMark() {
  const { ref, inView, mounted, reduced } = useReveal({ once: true })
  const animate = mounted && !reduced
  return (
    <motion.span
      ref={ref as never}
      className="inline-block text-coral"
      aria-hidden="true"
      initial="hidden"
      animate={animate && inView ? 'visible' : 'hidden'}
      variants={heartbeat}
    >
      ♥
    </motion.span>
  )
}

export function BlogHero({ post, readingTime }: { post: BlogPost; readingTime: number }) {
  const accent = categoryAccent(post.category?.slug, post.category?.color)
  const series = post.extras?.series
  const seriesKicker = series
    ? [
        (series.kicker ?? series.title).toUpperCase(),
        post.extras?.seriesOrder && series.postCount
          ? `Part ${post.extras.seriesOrder} of ${series.postCount}`.toUpperCase()
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null
  const dek = post.extras?.deck ?? post.excerpt
  const isEmma = post.author?.name.toLowerCase().includes('emma') ?? false

  return (
    <header className="max-w-3xl mx-auto">
      {/* Kicker row: category chip + series edition mark */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {post.category && (
          <CategoryChip
            name={post.category.name}
            slug={post.category.slug}
            color={post.category.color}
          />
        )}
        {seriesKicker && series && (
          <Link to={`/notebook/series/${series.slug}`} className={`kicker ${accent.kicker}`}>
            {seriesKicker}
          </Link>
        )}
      </div>

      {/* Post H1 — LCP text, static, never animated */}
      <h1
        className="text-ink text-[2rem] md:text-[2.75rem] xl:text-[3.5rem] leading-[1.04] tracking-[-0.01em] mb-3"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
      >
        {post.title}
      </h1>

      {dek && (
        <p
          className="text-ink-3 text-lg md:text-xl xl:text-[1.375rem] leading-[1.45] mb-6 max-w-2xl"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
        >
          {dek}
        </p>
      )}

      {/* Trust byline block (art direction §7) */}
      <div className="border-y border-line py-4 space-y-2">
        <div className="flex items-center gap-3">
          {post.author && (
            <Link to={`/notebook/by/${post.author.slug}`} className="flex items-center gap-2.5 group shrink-0">
              {post.author.avatarUrl ? (
                <SanityImage
                  src={post.author.avatarUrl}
                  alt={post.author.name}
                  widths={[64, 96]}
                  fallbackWidth={64}
                  width={32}
                  height={32}
                  className="w-8 h-8 rounded-full object-cover bg-paper-3"
                />
              ) : (
                <span
                  className="w-8 h-8 rounded-full bg-paper-3 text-ink flex items-center justify-center font-medium"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {post.author.name.charAt(0)}
                </span>
              )}
              <span className="text-sm font-medium text-ink group-hover:text-coral transition-colors">
                {post.author.name}
              </span>
            </Link>
          )}
          <p className="text-sm text-ink-3 leading-snug">
            {isEmma ? (
              <>
                the xdipx AI guide <HeartbeatMark /> A product expert and a friend to shop with.
              </>
            ) : (
              post.author?.role ?? null
            )}
          </p>
        </div>
        <p className="kicker">
          {[
            post.category?.name,
            readingTime > 0 ? `${readingTime} min` : null,
            post._updatedAt ? `Last reviewed ${formatReviewed(post._updatedAt)}` : formatDate(post.publishedAt),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      {/* Hero image — LCP, static, never wrapped in a motion component */}
      {post.heroImageUrl && (
        <SanityImage
          src={post.heroImageUrl}
          alt={post.heroImageAlt ?? post.title}
          priority
          sizes="(max-width: 768px) 100vw, 768px"
          widths={[640, 828, 1200, 1600]}
          fallbackWidth={1200}
          {...(post.heroWidth ? { width: post.heroWidth } : {})}
          {...(post.heroHeight ? { height: post.heroHeight } : {})}
          {...(post.heroLqip ? { lqip: post.heroLqip } : {})}
          className="w-full aspect-[3/2] object-cover mt-8 rounded-lg"
        />
      )}
    </header>
  )
}
