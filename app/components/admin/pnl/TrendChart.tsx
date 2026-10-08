import { useMemo, useRef, useState } from 'react'
import type { Granularity, SeriesPoint } from '~/lib/pnl-core'
import { dayLabel, money, moneyTick, monthLabel } from './format'

const REVENUE = '#C2350F'
const PROFIT = '#7A2BB8'
const GRID = 'rgba(26,20,24,0.08)'
const AXIS = 'rgba(26,20,24,0.20)'

/** Clean ticks (0, 50, 100...) spanning [min, max], always including zero. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  const lo = Math.min(0, min)
  const hi = Math.max(0, max)
  const span = hi - lo || 1
  const raw = span / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= target + 0.5) ?? 10 * mag
  const start = Math.floor(lo / step) * step
  const end = Math.ceil(hi / step) * step
  const out: number[] = []
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

export function bucketLabel(p: SeriesPoint, g: Granularity, long = false): string {
  if (g === 'month') return monthLabel(p.bucket)
  if (g === 'week') return long ? `Week of ${dayLabel(p.from)}` : dayLabel(p.from)
  return dayLabel(p.bucket)
}

/**
 * Net revenue as columns, net profit as a line, one dollar axis with zero
 * marked. Hover or focus any period for the full readout; the same numbers are
 * in the table under the chart.
 */
export function TrendChart({ series, granularity }: { series: SeriesPoint[]; granularity: Granularity }) {
  const [hover, setHover] = useState<number | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  const W = 720
  const H = 260
  const pad = { l: 52, r: 12, t: 12, b: 28 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b

  const { ticks, y, x, band } = useMemo(() => {
    const vals = series.flatMap(p => [p.netRevenue, p.netProfit])
    const t = niceTicks(Math.min(0, ...vals), Math.max(1, ...vals))
    const lo = t[0]!
    const hi = t[t.length - 1]!
    const yf = (v: number) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih
    const b = iw / Math.max(1, series.length)
    const xf = (i: number) => pad.l + b * i + b / 2
    return { ticks: t, y: yf, x: xf, band: b }
  }, [series, ih, iw, pad.l, pad.t])

  if (series.length === 0) return null
  const barW = Math.max(2, Math.min(24, band * 0.6))
  const zero = y(0)
  const labelEvery = Math.max(1, Math.ceil(series.length / 8))
  const line = series.map((p, i) => `${x(i).toFixed(1)},${y(p.netProfit).toFixed(1)}`).join(' ')
  const h = hover != null ? series[hover] : null

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.floor((px - pad.l) / band)
    setHover(i >= 0 && i < series.length ? i : null)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-2 text-xs text-ink-3" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: REVENUE }} />Net revenue</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-[2px] rounded" style={{ background: PROFIT }} />Net profit</span>
      </div>
      <div ref={wrap} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto select-none touch-pan-y"
          role="img"
          aria-label="Net revenue and net profit by period. The table below has every value."
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map(t => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="#6B5F68" className="tabular-nums">{moneyTick(t)}</text>
            </g>
          ))}
          {hover != null && (
            <rect x={pad.l + band * hover} y={pad.t} width={band} height={ih} fill="rgba(26,20,24,0.04)" />
          )}
          {series.map((p, i) => {
            const v = p.netRevenue
            if (v <= 0) return null
            const top = y(v)
            const hgt = Math.max(0, zero - top)
            const r = Math.min(4, barW / 2, hgt)
            const bx = x(i) - barW / 2
            // Rounded data end, square at the baseline.
            const d = `M${bx},${zero} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${zero} Z`
            return <path key={p.bucket} d={d} fill={REVENUE} opacity={hover == null || hover === i ? 1 : 0.55} />
          })}
          <polyline points={line} fill="none" stroke={PROFIT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {series.length <= 60 && series.map((p, i) => (
            <circle key={p.bucket} cx={x(i)} cy={y(p.netProfit)} r={hover === i ? 5 : 3} fill={PROFIT} stroke="#FFFFFF" strokeWidth={2} />
          ))}
          {series.map((p, i) => (i % labelEvery === 0 || i === series.length - 1) && (
            <text key={p.bucket} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#6B5F68">{bucketLabel(p, granularity)}</text>
          ))}
          {/* Keyboard access: one focusable hit area per period. */}
          {series.map((p, i) => (
            <rect
              key={`hit-${p.bucket}`}
              x={pad.l + band * i}
              y={pad.t}
              width={band}
              height={ih}
              fill="transparent"
              tabIndex={0}
              aria-label={`${bucketLabel(p, granularity, true)}: net revenue ${money(p.netRevenue)}, net profit ${money(p.netProfit)}, ${p.orders} orders`}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="outline-none"
            />
          ))}
        </svg>
        {h && hover != null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[180px] rounded-[10px] border border-line bg-paper px-3 py-2 shadow-[0_8px_24px_rgba(26,20,24,0.12)] text-xs"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              transform: x(hover) / W > 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
            }}
          >
            <p className="text-ink-3 mb-1.5">{bucketLabel(h, granularity, true)}</p>
            <TipRow color={REVENUE} shape="box" label="Net revenue" value={money(h.netRevenue)} />
            <TipRow color={PROFIT} shape="line" label="Net profit" value={money(h.netProfit)} />
            <p className="mt-1.5 pt-1.5 border-t border-line text-ink-3 tabular-nums">
              {h.orders} order{h.orders === 1 ? '' : 's'} · ads {money(h.adSpend)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function TipRow({ color, shape, label, value }: { color: string; shape: 'box' | 'line'; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="inline-flex items-center gap-1.5 text-ink-3">
        <span className={shape === 'box' ? 'inline-block w-2 h-2 rounded-[2px]' : 'inline-block w-3 h-[2px] rounded'} style={{ background: color }} />
        {label}
      </span>
      <span className="font-semibold text-ink tabular-nums">{value}</span>
    </div>
  )
}
