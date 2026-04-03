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
  const stages = [
    { label: 'Sent',      count: sent,      pctOf: sent,      color: '#7B2FBE' },
    { label: 'Opened',    count: opened,    pctOf: sent,      color: '#A855F7' },
    { label: 'Clicked',   count: clicked,   pctOf: opened,    color: '#FF8C38' },
    { label: 'Reviewed',  count: completed, pctOf: clicked,   color: '#F04E37' },
  ]

  const maxCount = sent || 1

  return (
    <div className="bg-white rounded-2xl border border-brand-mist p-5">
      <p
        className="text-xs font-semibold text-brand-charcoal/50 uppercase tracking-widest mb-4"
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
                <span className="text-xs font-medium text-brand-charcoal">
                  {stage.label}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-brand-charcoal/50">
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
              <div className="h-2 bg-brand-mist rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width, background: stage.color }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-brand-mist flex justify-between text-xs text-brand-charcoal/50">
        <span>Overall conversion</span>
        <span className="font-semibold text-brand-charcoal">{pct(completed, sent)}</span>
      </div>
    </div>
  )
}
