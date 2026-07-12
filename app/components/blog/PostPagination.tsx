import { Link } from 'react-router'
import type { BlogPostLink } from '~/types/cms'
import { Reveal } from '~/components/motion/Reveal'
import { CategoryChip } from './CategoryChip'

/**
 * Next/prev "keep reading" footer (art direction §4): light text link groups
 * over a hairline, no thumbnails. On mobile the two stack, next first, since
 * forward is the default intent.
 */
export function PostPagination({
  prevPost,
  nextPost,
}: {
  prevPost?: BlogPostLink | null | undefined
  nextPost?: BlogPostLink | null | undefined
}) {
  if (!prevPost && !nextPost) return null

  return (
    <nav
      aria-label="More reading"
      className="mt-12 pt-8 border-t border-line grid grid-cols-1 sm:grid-cols-2 gap-6"
    >
      <div className="order-2 sm:order-1">
        {prevPost && <PaginationSide post={prevPost} label="Previous" index={1} />}
      </div>
      <div className="order-1 sm:order-2 sm:text-right">
        {nextPost && <PaginationSide post={nextPost} label="Next" index={0} align="right" />}
      </div>
    </nav>
  )
}

function PaginationSide({
  post,
  label,
  index,
  align,
}: {
  post: BlogPostLink
  label: string
  index: number
  align?: 'right'
}) {
  return (
    <Reveal variant="up" index={index}>
      <Link to={`/notebook/${post.slug}`} className="group block">
        <p className="kicker mb-2">{label}</p>
        {post.category && (
          <CategoryChip
            name={post.category.name}
            slug={post.category.slug}
            color={post.category.color}
            linked={false}
            className="mb-2"
          />
        )}
        <p
          className={`text-ink text-lg md:text-xl leading-snug line-clamp-2 group-hover:text-coral transition-colors ${align === 'right' ? 'sm:ml-auto' : ''} max-w-md`}
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          {post.title}
        </p>
      </Link>
    </Reveal>
  )
}
