import type { ReactNode } from 'react'

/** The one card shell every P&L section sits in. */
export function Card({
  title, kicker, action, children, className = '', bodyClassName = 'p-4 md:p-5',
}: {
  title?: ReactNode
  kicker?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`bg-paper rounded-[14px] border border-line shadow-[0_1px_2px_rgba(26,20,24,0.04)] ${className}`}>
      {(title || kicker || action) && (
        <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 md:px-5 md:pt-5">
          <div className="min-w-0">
            {kicker && <p className="kicker mb-1">{kicker}</p>}
            {title && <h2 className="font-display text-lg text-ink leading-tight">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

/** Up/down chip. `goodWhenUp` decides the color; the arrow always shows the direction. */
export function Delta({ value, goodWhenUp = true, label }: { value: number | null; goodWhenUp?: boolean; label?: string }) {
  if (value == null) return <span className="text-xs text-ink-4">{label ?? 'no prior data'}</span>
  const flat = Math.abs(value) < 0.05
  const up = value > 0
  const good = flat ? null : up === goodWhenUp
  const tone = good == null ? 'text-ink-3 bg-paper-3' : good ? 'text-[#1F6B3A] bg-[#E6F2EA]' : 'text-[#A3261B] bg-[#FBE9E7]'
  const arrow = flat ? '→' : up ? '↑' : '↓'
  const n = Math.abs(value)
  const text = flat ? '0%' : `${n >= 100 ? Math.round(n) : n.toFixed(1)}%`
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}>
      <span aria-hidden="true">{arrow}</span>
      <span className="sr-only">{flat ? 'flat' : up ? 'up' : 'down'}</span>
      {text}
      {label && <span className="font-normal text-ink-4 ml-1">{label}</span>}
    </span>
  )
}
