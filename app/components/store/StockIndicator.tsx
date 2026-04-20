interface StockIndicatorProps {
  qty: number
  isDigital?: boolean
  className?: string
}

export function StockIndicator({ qty, isDigital = false, className = '' }: StockIndicatorProps) {
  if (isDigital) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-sm text-ink/60 ${className}`}>
        <span className="w-2 h-2 rounded-full bg-green-400" aria-hidden="true" />
        Delivered instantly by email
      </span>
    )
  }

  if (qty <= 0) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-sm font-medium text-red-500 ${className}`}>
        <span className="w-2 h-2 rounded-full bg-red-500" aria-hidden="true" />
        Sold out
      </span>
    )
  }

  if (qty <= 20) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-sm font-medium text-coral ${className}`}>
        <span className="w-2 h-2 rounded-full bg-coral animate-pulse" aria-hidden="true" />
        Only {qty} left — going fast
      </span>
    )
  }

  if (qty <= 50) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-sm font-medium text-coral-2 ${className}`}>
        <span className="w-2 h-2 rounded-full bg-coral-2" aria-hidden="true" />
        {qty} remaining
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-sm text-ink/60 ${className}`}>
      <span className="w-2 h-2 rounded-full bg-green-400" aria-hidden="true" />
      In stock
    </span>
  )
}
