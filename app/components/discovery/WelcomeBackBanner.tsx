/**
 * Welcome-back banner for returning sessions.
 * Only renders when:
 *   - getWelcomeBackLine(state) returns non-null
 *   - welcomeBackEnabled (from Sanity HomeConfig) is true
 *   - sessionStorage does NOT have xdipx.welcomeBack.dismissed
 * Dismissal sets sessionStorage so it doesn't reappear within the session.
 */

import { useEffect, useState } from 'react'
import { getWelcomeBackLine } from '~/lib/discovery-emma'
import { useDiscovery } from '~/stores/discovery.client'

const SESSION_KEY = 'xdipx.welcomeBack.dismissed'

interface WelcomeBackBannerProps {
  welcomeBackEnabled: boolean
}

export function WelcomeBackBanner({ welcomeBackEnabled }: WelcomeBackBannerProps) {
  const { state, hasPriorSession } = useDiscovery()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!welcomeBackEnabled) return
    if (!hasPriorSession) return
    const dismissed = sessionStorage.getItem(SESSION_KEY) === '1'
    if (dismissed) return
    const line = getWelcomeBackLine(state)
    if (line) setVisible(true)
  }, [welcomeBackEnabled, hasPriorSession])

  if (!visible) return null

  const line = getWelcomeBackLine(state)
  if (!line) return null

  function handleDismiss() {
    sessionStorage.setItem(SESSION_KEY, '1')
    setVisible(false)
  }

  return (
    <div className="bg-cream-2 border-b border-line px-4 py-3 flex items-center justify-between gap-3">
      <p
        className="text-sm text-ink/80 leading-snug"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {line}
      </p>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss welcome back message"
        className="text-muted hover:text-ink text-xl leading-none flex-none px-1"
      >
        ×
      </button>
    </div>
  )
}
