import { useEffect, useState } from 'react'

/**
 * Ticking "Xs" readout for the in-place image-regeneration progress slab.
 * Client-only visual polish (not data fetching, so the useEffect rule doesn't
 * apply), the fetcher submission itself drives real state.
 */
export function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000))
  return <span className="tabular-nums font-mono">{seconds}s</span>
}
