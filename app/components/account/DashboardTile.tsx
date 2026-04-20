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
    ? 'bg-white border border-dashed border-ink/20 hover:border-sage/40 hover:bg-cream-2/30'
    : 'bg-white shadow-sm hover:shadow-md hover:bg-cream-2/30'

  return (
    <Link to={to} className={`${base} ${skin}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink/50">
          {label}
        </p>
      </div>
      <div
        className={`mt-3 text-2xl md:text-3xl font-bold ${
          isSetup ? 'text-ink/40' : 'text-ink'
        }`}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </div>
    </Link>
  )
}
