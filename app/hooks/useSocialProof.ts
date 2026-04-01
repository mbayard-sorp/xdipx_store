import { useEffect, useState } from 'react'

interface SocialProof {
  viewers:   number
  soldToday: number
}

/**
 * Polls /api/social-proof every 30s to show real-time viewer + sold counts.
 * Seeds conservatively until real data is available.
 */
export function useSocialProof(productHandle: string): SocialProof {
  const [data, setData] = useState<SocialProof>({ viewers: 0, soldToday: 0 })

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`/api/social-proof?handle=${productHandle}`)
        if (!res.ok || cancelled) return
        const json = await res.json() as SocialProof
        if (!cancelled) setData(json)
      } catch {/* non-critical */}
    }

    poll()
    const id = setInterval(poll, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [productHandle])

  return data
}
