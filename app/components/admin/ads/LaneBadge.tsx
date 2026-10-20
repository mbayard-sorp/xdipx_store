/**
 * Lane plus register badge (wires 6.1). One neutral style for every lane:
 * seven colours would read as a legend nobody learns. The adult-network lane
 * used to read ADULT 9 with a dashed amber border while register 10 waited on
 * the owner's codify. Register 10 was codified on 2026-10-03 (docs/emma-voice.md,
 * docs/ads-policy.md) and the hold came off in code on 2026-10-20, so an adult
 * idea shows the tier it was written at.
 */

/** Register 10 on vetted adult ad networks: codified 2026-10-03, live in code 2026-10-20. */
export const REGISTER_10_CODIFIED = true

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
  const base = 'inline-flex items-center h-6 px-2 rounded-full border font-mono text-[11px] uppercase tracking-wide whitespace-nowrap'
  return (
    <span className={`${base} border-line bg-paper text-ink-2 ${className}`}>
      {laneLabel(lane)} {registerTier}
    </span>
  )
}
