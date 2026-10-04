/**
 * Phone Live row (wires 8.2): 48px thumb, label and slogan, lane badge and
 * recommendation pill, one data line with a lookback on every figure, the rule
 * sentence, then the three actions. Cards, not a table, under md.
 */
import { motion, useReducedMotion } from 'motion/react'
import { formatMoney, roasLabel, type LiveRow } from '~/lib/ad-metrics-core'
import { LaneBadge } from './LaneBadge'
import { LiveActions, useLiveRowActions } from './LiveActions'
import { RecommendationPill, RuleSentence } from './RuleSentence'

const FIRE_FROM = { amber: '#fffbeb', sage: 'rgba(89, 103, 86, 0.1)' } as const

/** One-time background fade for rows that fired a rule today (wires 11). Colour only, no movement. */
export function FireFade({ row, children, className, as = 'div' }: { row: LiveRow; children: React.ReactNode; className: string; as?: 'div' | 'tr' }) {
  const reduce = useReducedMotion()
  const tone = row.recommendation === 'scale' ? FIRE_FROM.sage : FIRE_FROM.amber
  const Comp = as === 'tr' ? motion.tr : motion.div
  if (!row.firedToday || reduce) return as === 'tr' ? <tr className={className}>{children}</tr> : <div className={className}>{children}</div>
  return (
    <Comp className={className} initial={{ backgroundColor: tone }} animate={{ backgroundColor: '#ffffff' }} transition={{ duration: 0.42, ease: [0.2, 0, 0, 1] }}>
      {children}
    </Comp>
  )
}

export function Thumb({ row }: { row: LiveRow }) {
  if (row.thumbUrl) {
    return <img src={row.thumbUrl} alt="" width={48} height={48} loading="lazy" className="h-12 w-12 shrink-0 rounded-lg bg-paper-3 object-cover" />
  }
  return (
    <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-paper-3 font-mono text-[11px] text-ink-3">
      {row.sample ? row.key.replace('sample:', '') : row.label}
    </span>
  )
}

export function LiveRowCard({ row }: { row: LiveRow }) {
  const act = useLiveRowActions(row)
  const w = `${row.lookbackDays}d`
  const shown = act.displayed
  return (
    <FireFade row={row} className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-start gap-3">
        <Thumb row={row} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            <span className="font-mono text-xs text-ink-3">{row.label}</span>
            {row.slogan && <span className="ml-1.5">{row.slogan}</span>}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <LaneBadge lane={row.lane} registerTier={row.registerTier} />
            <RecommendationPill value={shown} />
            {row.sample && <span className="font-mono text-[11px] text-ink-3">sample data</span>}
          </div>
        </div>
      </div>
      <p className="mt-3 font-mono text-[11px] tabular-nums text-ink-3">
        {formatMoney(row.spendCents)} {w} · {row.impressions.toLocaleString('en-US')} impr {w} · {row.ctrPct == null ? 'n/a' : `${row.ctrPct.toFixed(1)}%`} CTR
      </p>
      <p className="font-mono text-[11px] tabular-nums text-ink-3">
        {row.orders} orders {w} · ROAS {roasLabel(row)}
      </p>
      <RuleSentence row={row} className="mt-2" />
      <LiveActions row={row} act={act} className="mt-3" />
    </FireFade>
  )
}
