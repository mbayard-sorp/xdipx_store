interface SocialProofBarProps {
  viewers?: number
  soldToday?: number
}

export function SocialProofBar({ viewers = 0, soldToday = 0 }: SocialProofBarProps) {
  if (viewers === 0 && soldToday === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-ink/60">
      {viewers > 0 && (
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" aria-hidden="true" />
          {viewers} {viewers === 1 ? 'person' : 'people'} looking right now
        </span>
      )}
      {viewers > 0 && soldToday > 0 && (
        <span className="text-ink/30" aria-hidden="true">·</span>
      )}
      {soldToday > 0 && (
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-coral" aria-hidden="true" />
          {soldToday} sold today
        </span>
      )}
    </div>
  )
}
