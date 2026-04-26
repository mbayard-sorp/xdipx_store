import { useEffect, useState } from 'react'

const STORAGE_KEY    = 'xdipx_age_verified'
const EXPIRY_DAYS    = 30
const POLICY_VERSION = '1.0'
const SYNC_EVENT     = 'xdipx:age-verified'

function readVerified(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const data = JSON.parse(raw) as { verified: boolean; timestamp: number; version: string }
    const age  = Date.now() - data.timestamp
    return data.verified && age < EXPIRY_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

function writeVerified(): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ verified: true, timestamp: Date.now(), version: POLICY_VERSION }),
  )
}

export function useAgeVerified(): { verified: boolean; confirm: () => void } {
  const [verified, setVerifiedState] = useState(false)

  useEffect(() => {
    setVerifiedState(readVerified())
    const onSync = () => setVerifiedState(readVerified())
    window.addEventListener(SYNC_EVENT, onSync)
    return () => window.removeEventListener(SYNC_EVENT, onSync)
  }, [])

  function confirm() {
    writeVerified()
    setVerifiedState(true)
    window.dispatchEvent(new Event(SYNC_EVENT))
  }

  return { verified, confirm }
}
