/**
 * Recommendation pill plus the plain-words rule line (wires 8.1). The sentence
 * comes from the ad_rule_events row when one exists, else the metric-derived
 * hint ("Healthy ..."). Glyph plus word, never colour alone. Numbers in the
 * sentence render in mono.
 */
import type { ReactNode } from 'react'
import { AlertIcon, CheckIcon, MinusIcon, PauseIcon, PlusIcon, RefreshIcon, UndoIcon } from '~/components/admin/social/icons'
import { RECOMMENDATION_LABEL, type LiveRow, type Recommendation } from '~/lib/ad-metrics-core'

const PILL: Record<Recommendation, { cls: string; Icon: (p: { size?: number }) => React.JSX.Element }> = {
  pause:   { cls: 'border-red-300 bg-red-50 text-red-800', Icon: AlertIcon },
  paused:  { cls: 'border-line bg-paper-3 text-ink-3', Icon: PauseIcon },
  scale:   { cls: 'border-sage bg-sage text-white', Icon: PlusIcon },
  brake:   { cls: 'border-amber-300 bg-amber-50 text-amber-800', Icon: MinusIcon },
  refresh: { cls: 'border-plum/20 bg-plum-soft text-plum-2', Icon: RefreshIcon },
  revive:  { cls: 'border-sage bg-paper text-[#4F6150]', Icon: UndoIcon },
  healthy: { cls: 'border-line bg-paper text-ink-3', Icon: CheckIcon },
}

export function RecommendationPill({ value, className = '' }: { value: Recommendation; className?: string }) {
  const p = PILL[value]
  const Icon = p.Icon
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-semibold leading-none whitespace-nowrap ${p.cls} ${className}`}>
      <Icon size={12} />
      {RECOMMENDATION_LABEL[value]}
    </span>
  )
}

/** Wrap each run of digits, dollars and percent in mono so figures read as data. */
export function monoNumbers(text: string): ReactNode[] {
  return text.split(/(\$[\d,]+(?:\.\d+)?|\d[\d,]*(?:\.\d+)?(?:x|%|d)?)/g).map((part, i) =>
    i % 2 === 1 ? <span key={i} className="font-mono tabular-nums">{part}</span> : part)
}

export function RuleSentence({ row, className = '' }: { row: LiveRow; className?: string }) {
  return <p className={`text-sm text-ink-2 ${className}`}>{monoNumbers(row.hint)}</p>
}
