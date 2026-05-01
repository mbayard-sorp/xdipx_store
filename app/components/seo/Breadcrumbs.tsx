import { Link } from 'react-router'

export interface BreadcrumbCrumb {
  name: string
  href?: string
}

// Display-only title case: capitalize the first letter of each word, but
// leave any word that already contains an uppercase letter alone so
// brand-cased terms (BANG!, iPhone, ANR) survive intact.
function toTitleCase(name: string): string {
  return name.replace(/\b[a-z][a-z'’-]*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1))
}

export function Breadcrumbs({ items, className = '' }: { items: BreadcrumbCrumb[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className={`text-xs text-muted ${className}`.trim()}>
      <ol className="flex items-center gap-1.5 flex-wrap">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          const display = toTitleCase(item.name)
          return (
            <li key={`${item.name}-${i}`} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link
                  to={item.href}
                  className="hover:text-ink transition-colors"
                >
                  {display}
                </Link>
              ) : (
                <span className={isLast ? 'text-ink/80' : ''} aria-current={isLast ? 'page' : undefined}>
                  {display}
                </span>
              )}
              {!isLast && <span className="text-muted/50" aria-hidden="true">/</span>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
