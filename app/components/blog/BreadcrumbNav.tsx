import { Link } from 'react-router'

interface BreadcrumbItem {
  label: string
  href?: string
}

export function BreadcrumbNav({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-brand-charcoal/60">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">/</span>}
            {item.href && i < items.length - 1 ? (
              <Link to={item.href} className="hover:text-brand-purple transition-colors">
                {item.label}
              </Link>
            ) : (
              <span className={i === items.length - 1 ? 'font-medium text-brand-charcoal' : ''}>
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
