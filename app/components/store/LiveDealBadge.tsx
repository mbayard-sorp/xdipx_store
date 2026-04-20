interface LiveDealBadgeProps {
  className?: string
}

export default function LiveDealBadge({ className = '' }: LiveDealBadgeProps) {
  return (
    <span
      className={`absolute top-2 right-2 z-10 bg-coral text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm ${className}`}
    >
      <span aria-hidden="true">♥</span>
      Today's Deal
    </span>
  )
}
