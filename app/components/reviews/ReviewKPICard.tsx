import { Link } from 'react-router'

interface ReviewKPICardProps {
  title: string
  value: string | number
  subtitle?: string
  cta?: { label: string; to: string }
}

export function ReviewKPICard({ title, value, subtitle, cta }: ReviewKPICardProps) {
  return (
    <div className="bg-white rounded-2xl border border-cream-2 p-5 flex flex-col gap-2">
      <p className="text-xs font-semibold text-ink/50 uppercase tracking-widest">
        {title}
      </p>
      <p
        className="text-3xl font-black text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </p>
      {subtitle && (
        <p className="text-xs text-ink/40">{subtitle}</p>
      )}
      {cta && (
        <Link
          to={cta.to}
          className="mt-auto text-xs font-semibold text-sage hover:text-sun transition-colors"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {cta.label} →
        </Link>
      )}
    </div>
  )
}
