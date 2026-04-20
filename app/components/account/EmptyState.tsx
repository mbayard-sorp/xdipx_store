import type { ReactNode } from 'react'
import { Link } from 'react-router'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  cta?: { label: string; to: string }
}

export function EmptyState({ icon, title, description, cta }: EmptyStateProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm flex flex-col items-center justify-center text-center px-6 py-12 gap-4">
      <div
        className="w-16 h-16 rounded-full bg-cream-2 flex items-center justify-center text-ink/30"
        aria-hidden="true"
      >
        {icon ?? (
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        )}
      </div>
      <div>
        <p
          className="text-lg font-semibold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </p>
        {description && (
          <p className="text-sm text-ink/60 mt-1">{description}</p>
        )}
      </div>
      {cta && (
        <Link
          to={cta.to}
          className="mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white transition-opacity hover:opacity-90 bg-coral"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {cta.label}
        </Link>
      )}
    </div>
  )
}
