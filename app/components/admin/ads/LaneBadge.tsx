/**
 * Lane plus register badge (wires 6.1). One neutral style for every lane:
 * seven colours would read as a legend nobody learns. The one exception is the
 * adult-network lane while register 10 is uncodified (plan decision 1): it
 * reads ADULT 9 with a dashed amber border and a note.
 */

/** Flip to true when the owner says "codify" for register 10 on adult networks. */
export const REGISTER_10_CODIFIED = false

const LANE_LABEL: Record<string, string> = {
  meta: 'META',
  google: 'GOOGLE',
  microsoft: 'MSFT',
  snap: 'SNAP',
  adult: 'ADULT',
  newsletter: 'NEWSLETTER',
  owned: 'OWNED',
}

export function laneLabel(lane: string): string {
  return LANE_LABEL[lane] ?? lane.toUpperCase()
}

export function LaneBadge({ lane, registerTier, className = '' }: { lane: string; registerTier: string; className?: string }) {
  const heldAtNine = lane === 'adult' && !REGISTER_10_CODIFIED && (registerTier === '10' || registerTier === '9')
  const tier = heldAtNine ? '9' : registerTier
  const base = 'inline-flex items-center h-6 px-2 rounded-full border font-mono text-[11px] uppercase tracking-wide whitespace-nowrap'
  if (heldAtNine) {
    return (
      <span
        title="Register 10 on adult networks is pending codify. Held at 9."
        className={`${base} border-dashed border-amber-400 bg-paper text-ink-2 ${className}`}
      >
        {laneLabel(lane)} {tier}
      </span>
    )
  }
  return (
    <span className={`${base} border-line bg-paper text-ink-2 ${className}`}>
      {laneLabel(lane)} {tier}
    </span>
  )
}
