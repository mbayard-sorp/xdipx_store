import { useEffect, useState } from 'react'
import { useFetcher, useRouteLoaderData } from 'react-router'

type LocalHeart = { shopifyProductId: string; handle: string; ts: number }

const LOCAL_KEY = 'xdipx:hearts'

export type HeartButtonProps = {
  shopifyProductId: string
  handle: string
  productTitle?: string
  price?: string | number
  variant?: 'overlay' | 'inline'
  size?: 'sm' | 'md' | 'lg'
  initialHearted?: boolean
}

function readLocalHearts(): LocalHeart[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocalHearts(items: LocalHeart[]): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(items))
  } catch {
    /* quota exceeded, etc — best effort */
  }
}

export function HeartButton({
  shopifyProductId,
  handle,
  productTitle,
  price,
  variant = 'overlay',
  size = 'md',
  initialHearted,
}: HeartButtonProps) {
  const layoutData = useRouteLoaderData('routes/_layout') as
    | { heartedProductIds?: string[]; isCustomerLoggedIn?: boolean }
    | undefined
  const heartedFromLoader = layoutData?.heartedProductIds?.includes(shopifyProductId) ?? false
  const isLoggedIn = layoutData?.isCustomerLoggedIn ?? false

  const fetcher = useFetcher<{ ok: boolean; hearted?: boolean }>()
  const [hearted, setHearted] = useState<boolean>(initialHearted ?? heartedFromLoader)
  const [toast, setToast] = useState<string | null>(null)

  // Keep in sync with loader state when it changes (e.g., after navigation / revalidate)
  useEffect(() => {
    if (initialHearted === undefined) setHearted(heartedFromLoader)
  }, [heartedFromLoader, initialHearted])

  // For logged-out users, initialize from localStorage on mount.
  useEffect(() => {
    if (isLoggedIn) return
    const local = readLocalHearts()
    setHearted(local.some(h => h.shopifyProductId === shopifyProductId))
  }, [isLoggedIn, shopifyProductId])

  useEffect(() => {
    if (fetcher.data && fetcher.state === 'idle') {
      if (fetcher.data.ok === false) {
        // Revert optimistic toggle if the server rejected.
        setHearted(prev => !prev)
      } else if (typeof fetcher.data.hearted === 'boolean') {
        setHearted(fetcher.data.hearted)
      }
    }
  }, [fetcher.data, fetcher.state])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    e.stopPropagation()

    const next = !hearted
    setHearted(next) // optimistic

    if (!isLoggedIn) {
      const local = readLocalHearts()
      if (next) {
        const updated = [
          ...local.filter(h => h.shopifyProductId !== shopifyProductId),
          { shopifyProductId, handle, ts: Date.now() },
        ]
        writeLocalHearts(updated)
        setToast('Saved — create an account to keep it')
      } else {
        writeLocalHearts(local.filter(h => h.shopifyProductId !== shopifyProductId))
      }
      return
    }

    const fd = new FormData()
    fd.set('intent', next ? 'add' : 'remove')
    fd.set('shopifyProductId', shopifyProductId)
    fd.set('handle', handle)
    if (productTitle) fd.set('productTitle', productTitle)
    if (price !== undefined) fd.set('price', String(price))
    fetcher.submit(fd, { method: 'post', action: '/api/wishlist' })
  }

  const isPending = fetcher.state !== 'idle'

  const sizeClasses =
    size === 'lg' ? 'w-11 h-11' : size === 'sm' ? 'w-8 h-8' : 'w-10 h-10'
  const iconSize = size === 'lg' ? 22 : size === 'sm' ? 16 : 20

  const baseClasses =
    variant === 'overlay'
      ? `absolute top-2 right-2 z-10 flex items-center justify-center ${sizeClasses} rounded-full bg-white/90 backdrop-blur-sm shadow-md hover:bg-white transition-colors`
      : `inline-flex items-center justify-center ${sizeClasses} rounded-full bg-brand-mist hover:bg-brand-purple hover:text-white transition-colors`

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={hearted}
        aria-label={hearted ? 'Remove from wishlist' : 'Save to wishlist'}
        disabled={isPending}
        className={`${baseClasses} ${isPending ? 'opacity-60' : ''}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill={hearted ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={hearted ? 0 : 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={hearted ? 'text-brand-purple' : 'text-brand-charcoal/70'}
          aria-hidden="true"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-brand-charcoal text-white text-sm font-medium px-4 py-2 rounded-full shadow-xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {toast}
        </div>
      )}
    </>
  )
}
