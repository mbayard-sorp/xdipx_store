/**
 * Floating bottom-right pill for the daily deal in Variant B.
 * Fixed position, dismissible via sessionStorage.
 * Renders nothing when deal is null or already dismissed.
 */

import { Link } from 'react-router'
import { useEffect, useState } from 'react'

const SESSION_KEY = 'xdipx.dealPill.dismissed'

interface DailyDealPillProps {
  deal: { title: string; handle: string } | null
}

export function DailyDealPill({ deal }: DailyDealPillProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!deal) return
    const dismissed = sessionStorage.getItem(SESSION_KEY) === '1'
    if (!dismissed) setVisible(true)
  }, [deal])

  if (!visible || !deal) return null

  function handleDismiss(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    sessionStorage.setItem(SESSION_KEY, '1')
    setVisible(false)
  }

  // Truncate long titles to keep the pill compact
  const short = deal.title.length > 32 ? deal.title.slice(0, 30) + '…' : deal.title

  return (
    <div
      className="fixed bottom-4 right-4 z-30"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center gap-2 bg-paper border border-line rounded-full shadow-md pl-3 pr-1.5 py-1.5 max-w-[240px]">
        <span
          className="text-[10px] font-bold uppercase tracking-widest text-coral flex-none"
          style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.14em' }}
        >
          Today
        </span>
        <Link
          to={`/products/${deal.handle}`}
          className="text-xs font-semibold text-ink hover:text-coral transition-colors truncate flex-1 leading-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {short} →
        </Link>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss today's deal"
          className="flex-none text-muted hover:text-ink text-base leading-none px-1.5 py-0.5 rounded-full hover:bg-cream-2 transition-colors"
        >
          ×
        </button>
      </div>
    </div>
  )
}
