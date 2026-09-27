interface InviteFunnelProps {
  sent: number
  opened: number
  clicked: number
  completed: number
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

export function InviteFunnel({ sent, opened, clicked, completed }: InviteFunnelProps) {
  // Sequential brand-token ramp (ticket #11069): the retired sage/orange hexes
  // this funnel shipped with are replaced with a quiet-to-emphasis read of the
  // v3 palette — sage for the top-of-funnel base state, warming through coral,
  // and plum (the brand's emphasis color) for the completed stage — rather
  // than a literal find-and-replace of the old ramp's hues, since two of the
  // four (#FF6A3D, #FF4B1F) are orange, which CLAUDE.md bans reintroducing.
  const stages = [
    { label: 'Sent',      count: sent,      pctOf: sent,      color: 'var(--color-sage)' },
    { label: 'Opened',    count: opened,    pctOf: sent,      color: 'var(--color-coral-2)' },
    { label: 'Clicked',   count: clicked,   pctOf: opened,    color: 'var(--color-coral)' },
    { label: 'Reviewed',  count: completed, pctOf: clicked,   color: 'var(--color-plum)' },
  ]

  const maxCount = sent || 1

  return (
    <div className="bg-white rounded-2xl border border-cream-2 p-5">
      <p
        className="text-xs font-semibold text-ink/50 uppercase tracking-widest mb-4"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Invite Funnel
      </p>

      <div className="space-y-3">
        {stages.map((stage, i) => {
          const width = maxCount > 0 ? `${Math.round((stage.count / maxCount) * 100)}%` : '0%'
          const conversion = pct(stage.count, stage.pctOf)

          return (
            <div key={stage.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-ink">
                  {stage.label}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink/50">
                    {i > 0 && `${conversion} → `}
                  </span>
                  <span
                    className="text-sm font-bold"
                    style={{ color: stage.color, fontFamily: 'var(--font-display)' }}
                  >
                    {stage.count.toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="h-2 bg-cream-2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width, background: stage.color }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-cream-2 flex justify-between text-xs text-ink/50">
        <span>Overall conversion</span>
        <span className="font-semibold text-ink">{pct(completed, sent)}</span>
      </div>
    </div>
  )
}
