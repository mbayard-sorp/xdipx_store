import { Link } from 'react-router'

export interface DashboardTileProps {
  label: string
  value: string | number
  to: string
  accent?: 'default' | 'setup'
}

export function DashboardTile({
  label,
  value,
  to,
  accent = 'default',
}: DashboardTileProps) {
  const isSetup = accent === 'setup'
  const base =
    'group relative block rounded-2xl p-4 min-h-[104px] transition-all'
  const skin = isSetup
    ? 'bg-white border border-dashed border-brand-charcoal/20 hover:border-brand-purple/40 hover:bg-brand-mist/30'
    : 'bg-white shadow-sm hover:shadow-md hover:bg-brand-mist/30'

  return (
    <Link to={to} className={`${base} ${skin}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-charcoal/50">
          {label}
        </p>
      </div>
      <div
        className={`mt-3 text-2xl md:text-3xl font-bold ${
          isSetup ? 'text-brand-charcoal/40' : 'text-brand-charcoal'
        }`}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </div>
    </Link>
  )
}
