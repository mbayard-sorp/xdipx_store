/**
 * Thin ink strip above the fold: "Today's pick: {title}" → /products/{handle}.
 * A × button hides it for the session via sessionStorage.
 * Renders nothing when deal is null or the user has dismissed it.
 */

import { Link } from 'react-router'
import { useEffect, useState } from 'react'

const SESSION_KEY = 'xdipx.dealStrip.dismissed'

interface DailyDealStripProps {
  deal: { title: string; handle: string } | null
}

export function DailyDealStrip({ deal }: DailyDealStripProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!deal) return
    const dismissed = sessionStorage.getItem(SESSION_KEY) === '1'
    if (!dismissed) setVisible(true)
  }, [deal])

  if (!visible || !deal) return null

  function handleDismiss() {
    sessionStorage.setItem(SESSION_KEY, '1')
    setVisible(false)
  }

  return (
    <div className="bg-ink text-paper flex items-center justify-center gap-3 px-4 py-2 relative">
      <span
        className="text-xs uppercase tracking-widest text-paper/60 hidden sm:inline"
        style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.14em' }}
      >
        Today's pick
      </span>
      <span className="text-paper/30 hidden sm:inline" aria-hidden="true">·</span>
      <Link
        to={`/products/${deal.handle}`}
        className="text-xs sm:text-sm font-semibold text-coral-2 hover:text-coral underline underline-offset-2 truncate max-w-[60vw]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {deal.title} →
      </Link>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-paper/50 hover:text-paper text-lg leading-none px-1"
      >
        ×
      </button>
    </div>
  )
}
