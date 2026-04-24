import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ActiveVideoContextValue {
  activeId: string | null
  /** Claim the active slot. If another video is playing, it will be paused by its own listener. */
  claim: (id: string) => void
  /** Release the active slot if this id currently holds it. */
  release: (id: string) => void
  /** Toggle global muted state for card videos. Persisted per-session in memory. */
  muted: boolean
  setMuted: (muted: boolean) => void
}

const ActiveVideoContext = createContext<ActiveVideoContextValue | null>(null)

export function ActiveVideoProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [muted, setMuted] = useState(true)
  const activeRef = useRef<string | null>(null)

  const claim = useCallback((id: string) => {
    activeRef.current = id
    setActiveId(id)
  }, [])

  const release = useCallback((id: string) => {
    if (activeRef.current === id) {
      activeRef.current = null
      setActiveId(null)
    }
  }, [])

  return (
    <ActiveVideoContext.Provider value={{ activeId, claim, release, muted, setMuted }}>
      {children}
    </ActiveVideoContext.Provider>
  )
}

export function useActiveVideo() {
  return useContext(ActiveVideoContext)
}
