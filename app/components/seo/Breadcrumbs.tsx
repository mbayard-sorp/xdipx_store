import { Link } from 'react-router'

export interface BreadcrumbCrumb {
  name: string
  href?: string
}

export function Breadcrumbs({ items, className = '' }: { items: BreadcrumbCrumb[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className={`text-xs text-muted ${className}`.trim()}>
      <ol className="flex items-center gap-1.5 flex-wrap">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <li key={`${item.name}-${i}`} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link
                  to={item.href}
                  className="hover:text-ink transition-colors"
                >
                  {item.name}
                </Link>
              ) : (
                <span className={isLast ? 'text-ink/80' : ''} aria-current={isLast ? 'page' : undefined}>
                  {item.name}
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
