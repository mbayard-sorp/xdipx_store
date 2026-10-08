import type { WaterfallStep } from '~/lib/pnl-core'
import { cost, money, pct } from './format'

const START = '#C2350F'
const COST = '#B9AFB6'
const GOOD = '#7A2BB8'
const BAD = '#A3261B'

/**
 * Where each dollar of net revenue went. A horizontal waterfall: revenue at
 * full width, each cost a floating bar eating into it, net profit what is left.
 * Labels sit outside the bars so nothing is clipped.
 */
export function Waterfall({ steps }: { steps: WaterfallStep[] }) {
  const start = steps.find(s => s.kind === 'start')?.amount ?? 0
  const end = steps.find(s => s.kind === 'end')?.amount ?? 0
  // Scale to the widest point the running total reaches, including below zero.
  let running = start
  let lo = Math.min(0, end)
  let hi = Math.max(start, 0)
  for (const s of steps) if (s.kind === 'cost') { running -= s.amount; lo = Math.min(lo, running); hi = Math.max(hi, running) }
  const span = hi - lo || 1
  const pos = (v: number) => ((v - lo) / span) * 100

  if (start <= 0 && steps.length <= 2) {
    return <p className="text-sm text-ink-3">No revenue in this window yet.</p>
  }

  running = start
  return (
    <ul className="space-y-2" aria-label="Where net revenue went">
      {steps.map(s => {
        let left: number
        let right: number
        let color: string
        if (s.kind === 'start') { left = pos(0); right = pos(s.amount); color = START }
        else if (s.kind === 'cost') { const before = running; running -= s.amount; left = pos(running); right = pos(before); color = COST }
        else { left = pos(Math.min(0, s.amount)); right = pos(Math.max(0, s.amount)); color = s.amount >= 0 ? GOOD : BAD }
        const share = start > 0 ? (s.amount / start) * 100 : null
        return (
          <li key={s.key} className="grid grid-cols-[96px_1fr] sm:grid-cols-[104px_1fr_auto] items-center gap-x-3 gap-y-0.5">
            <span className={`text-xs ${s.kind === 'cost' ? 'text-ink-3' : 'text-ink font-semibold'}`}>{s.label}</span>
            <div className="relative h-4">
              <div
                className="absolute top-0 h-full rounded-[3px]"
                style={{ left: `${left}%`, width: `${Math.max(0.5, right - left)}%`, background: color }}
                title={`${s.label}: ${s.kind === 'cost' ? cost(s.amount) : money(s.amount)}`}
              />
              {lo < 0 && <div className="absolute top-[-3px] bottom-[-3px] w-px bg-ink/30" style={{ left: `${pos(0)}%` }} aria-hidden="true" />}
            </div>
            <span className="col-start-2 sm:col-start-3 text-xs tabular-nums text-ink sm:text-right">
              <span className={s.kind === 'end' ? 'font-semibold' : ''}>{s.kind === 'cost' ? cost(s.amount) : money(s.amount)}</span>
              {share != null && s.kind !== 'start' && <span className="text-ink-4 ml-1.5">{pct(share, 0)}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
