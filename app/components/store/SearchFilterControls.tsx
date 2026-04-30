import { useState } from 'react'

export function FilterSection({
  title,
  children,
  collapsible = false,
  defaultExpanded = true,
}: {
  title: string
  children: React.ReactNode
  collapsible?: boolean
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div>
      {collapsible ? (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full mb-3 group"
        >
          <h3 className="text-xs font-bold text-ink uppercase tracking-wider group-hover:text-sage transition-colors">
            {title}
          </h3>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`text-ink/30 group-hover:text-sage transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      ) : (
        <h3 className="text-xs font-bold text-ink uppercase tracking-wider mb-3">{title}</h3>
      )}
      {(!collapsible || expanded) && children}
    </div>
  )
}

export function DrawerPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      aria-label={`Remove filter: ${label}`}
      className="inline-flex items-center gap-1.5 bg-sage/10 text-sage text-sm font-medium pl-3 pr-2 py-1.5 rounded-full hover:bg-coral/10 hover:text-coral active:scale-95 transition-all"
    >
      <span className="capitalize">{label}</span>
      <span
        className="w-4 h-4 inline-flex items-center justify-center rounded-full bg-sage/20 text-[11px] leading-none"
        aria-hidden="true"
      >
        ×
      </span>
    </button>
  )
}

export function FilterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  )
}

export function SortIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h13M3 12h9M3 18h5" />
      <path d="M17 14l4 4-4 4M21 18H9" transform="translate(0 -10)" />
    </svg>
  )
}
