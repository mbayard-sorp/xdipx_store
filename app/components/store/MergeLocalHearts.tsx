import { useEffect, useRef } from 'react'
import { useFetcher, useRevalidator } from 'react-router'

const LOCAL_KEY = 'xdipx:hearts'
const MERGE_FLAG = 'xdipx:hearts:merged'

type LocalHeart = { shopifyProductId: string; handle: string; ts?: number }

function readLocalHearts(): LocalHeart[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is LocalHeart =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as Record<string, unknown>).shopifyProductId === 'string' &&
        typeof (x as Record<string, unknown>).handle === 'string',
    )
  } catch {
    return []
  }
}

/**
 * Fires once (per session) after login/register: pushes localStorage hearts
 * into the signed-in customer's default list, clears localStorage, and
 * revalidates so the navbar badge + tile counts update.
 */
export function MergeLocalHearts() {
  const fetcher = useFetcher<{ ok: boolean; merged?: number }>()
  const revalidator = useRevalidator()
  const hasSubmittedRef = useRef(false)

  useEffect(() => {
    if (hasSubmittedRef.current) return
    if (typeof window === 'undefined') return
    if (window.sessionStorage.getItem(MERGE_FLAG) === '1') return

    const items = readLocalHearts()
    if (items.length === 0) return

    hasSubmittedRef.current = true
    const fd = new FormData()
    fd.set('intent', 'merge-local')
    fd.set('items', JSON.stringify(items))
    fetcher.submit(fd, { method: 'post', action: '/api/wishlist' })
  }, [fetcher])

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.ok) {
      try {
        window.localStorage.removeItem(LOCAL_KEY)
        window.sessionStorage.setItem(MERGE_FLAG, '1')
      } catch {
        /* ignore */
      }
      if ((fetcher.data.merged ?? 0) > 0) revalidator.revalidate()
    }
  }, [fetcher.state, fetcher.data, revalidator])

  return null
}
