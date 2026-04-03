import { Link } from 'react-router'

interface ReviewKPICardProps {
  title: string
  value: string | number
  subtitle?: string
  cta?: { label: string; to: string }
}

export function ReviewKPICard({ title, value, subtitle, cta }: ReviewKPICardProps) {
  return (
    <div className="bg-white rounded-2xl border border-brand-mist p-5 flex flex-col gap-2">
      <p className="text-xs font-semibold text-brand-charcoal/50 uppercase tracking-widest">
        {title}
      </p>
      <p
        className="text-3xl font-black text-brand-charcoal"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </p>
      {subtitle && (
        <p className="text-xs text-brand-charcoal/40">{subtitle}</p>
      )}
      {cta && (
        <Link
          to={cta.to}
          className="mt-auto text-xs font-semibold text-brand-purple hover:text-brand-purple-light transition-colors"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {cta.label} →
        </Link>
      )}
    </div>
  )
}
