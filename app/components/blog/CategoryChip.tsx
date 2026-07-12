import { Link } from 'react-router'
import { categoryAccent } from '~/lib/blog-style'

interface CategoryChipProps {
  name: string
  slug?: string | undefined
  color?: string | undefined
  /** Render as a link to the category archive. Default true when slug is set. */
  linked?: boolean
  className?: string
}

/**
 * Category identity chip (art direction §5): soft-tint pill, DM Sans,
 * uppercase, accent text. Replaces the old solid bg-coral chip so the
 * four-category color system reads instead of one flat coral.
 */
export function CategoryChip({ name, slug, color, linked = true, className = '' }: CategoryChipProps) {
  const accent = categoryAccent(slug, color)
  const classes = `inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.06em] ${accent.chip} ${className}`

  if (linked && slug) {
    return (
      <Link to={`/notebook/category/${slug}`} className={`${classes} press`}>
        {name}
      </Link>
    )
  }
  return <span className={classes}>{name}</span>
}
