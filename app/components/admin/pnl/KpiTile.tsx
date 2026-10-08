import { Delta } from './Card'

/** Twelve-ish points of trend in the de-emphasis gray, the latest point in the accent. */
export function Sparkline({ values, accent = '#C2350F', label }: { values: number[]; accent?: string | undefined; label: string }) {
  if (values.length < 2) return null
  const w = 96
  const h = 28
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const span = max - min || 1
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6)
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = values.length - 1
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="shrink-0 overflow-visible">
      {min < 0 && <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="rgba(26,20,24,0.12)" strokeWidth={1} />}
      <polyline points={pts} fill="none" stroke="#B9AFB6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last]!)} r={4} fill={accent} stroke="#FFFFFF" strokeWidth={2} />
    </svg>
  )
}

export function KpiTile({
  label, value, delta, goodWhenUp = true, sub, trend, accent, emphasis = false, caveat,
}: {
  label: string
  value: string
  delta: number | null
  goodWhenUp?: boolean
  sub?: string | undefined
  trend?: number[] | undefined
  accent?: string | undefined
  emphasis?: boolean
  caveat?: string | undefined
}) {
  return (
    <div className={`rounded-[14px] border p-4 flex flex-col gap-2 min-w-0 ${emphasis ? 'border-plum/25 bg-plum-soft/50' : 'border-line bg-paper'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-3 truncate">{label}</p>
        {caveat && (
          <span title={caveat} className="text-[10px] font-semibold uppercase tracking-wide text-ink-3 bg-paper-3 rounded px-1.5 py-0.5 cursor-help">
            partial
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-[22px] md:text-[26px] leading-none font-semibold text-ink font-body">{value}</p>
        {trend && <Sparkline values={trend} accent={accent} label={`${label} trend`} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-h-[20px]">
        <Delta value={delta} goodWhenUp={goodWhenUp} />
        {sub && <span className="text-[11px] text-ink-3">{sub}</span>}
      </div>
    </div>
  )
}
