import { useEffect, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { dispatchSessionUpdated, useSession } from '~/lib/session-context'

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
  const { heartedProductIds, isCustomerLoggedIn, isLoaded: isSessionLoaded } = useSession()
  const heartedFromLoader = heartedProductIds.includes(shopifyProductId)
  const isLoggedIn = isCustomerLoggedIn

  const fetcher = useFetcher<{ ok: boolean; hearted?: boolean; listId?: number; listName?: string }>()
  const [hearted, setHearted] = useState<boolean>(initialHearted ?? heartedFromLoader)
  const [toast, setToast] = useState<{
    type: 'logged-in' | 'logged-out'
    listName?: string
    listId?: number
  } | null>(null)

  // Keep in sync with session state when it resolves / changes (e.g., after login).
  useEffect(() => {
    if (initialHearted === undefined && isSessionLoaded) setHearted(heartedFromLoader)
  }, [heartedFromLoader, initialHearted, isSessionLoaded])

  // For logged-out users, initialize from localStorage once the session
  // resolves (so we don't briefly render the heart "on" before we know the
  // user is actually signed out).
  useEffect(() => {
    if (!isSessionLoaded || isLoggedIn) return
    const local = readLocalHearts()
    setHearted(local.some(h => h.shopifyProductId === shopifyProductId))
  }, [isSessionLoaded, isLoggedIn, shopifyProductId])

  useEffect(() => {
    if (fetcher.data && fetcher.state === 'idle') {
      if (fetcher.data.ok === false) {
        setHearted(prev => !prev)
      } else if (typeof fetcher.data.hearted === 'boolean') {
        setHearted(fetcher.data.hearted)
        if (fetcher.data.hearted && fetcher.data.listId && fetcher.data.listName) {
          setToast({ type: 'logged-in', listName: fetcher.data.listName, listId: fetcher.data.listId })
        }
        // Wishlist count in the session changed — tell the SessionProvider to
        // refetch so the account menu badge stays accurate.
        dispatchSessionUpdated()
      }
    }
  }, [fetcher.data, fetcher.state])

  // Auto-dismiss power-up toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    e.stopPropagation()

    const next = !hearted
    setHearted(next) // optimistic
    if (!next) setToast(null) // dismiss on un-heart

    if (!isLoggedIn) {
      const local = readLocalHearts()
      if (next) {
        const updated = [
          ...local.filter(h => h.shopifyProductId !== shopifyProductId),
          { shopifyProductId, handle, ts: Date.now() },
        ]
        writeLocalHearts(updated)
        setToast({ type: 'logged-out' })
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
      : `inline-flex items-center justify-center ${sizeClasses} rounded-full bg-cream-2 hover:bg-sage hover:text-white transition-colors`

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
          className={hearted ? 'text-sage' : 'text-ink/70'}
          aria-hidden="true"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>
      {/* Power-up toast — centered over the product image */}
      <AnimatePresence>
        {toast && (
          <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
            {/* Expanding ring burst */}
            <motion.div
              className="absolute rounded-full border-2 border-sage/40"
              initial={{ width: 0, height: 0, opacity: 1 }}
              animate={{ width: 180, height: 180, opacity: 0 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            />
            <motion.div
              className="absolute rounded-full border border-coral/30"
              initial={{ width: 0, height: 0, opacity: 1 }}
              animate={{ width: 120, height: 120, opacity: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.08 }}
            />

            {/* Sparkle particles */}
            {Array.from({ length: 8 }).map((_, i) => (
              <motion.div
                key={i}
                className={`absolute w-1.5 h-1.5 rounded-full ${i % 2 === 0 ? 'bg-sage' : 'bg-coral'}`}
                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                animate={{
                  x: Math.cos((i * Math.PI * 2) / 8) * 70,
                  y: Math.sin((i * Math.PI * 2) / 8) * 70,
                  opacity: 0,
                  scale: 0,
                }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: 0.05 }}
              />
            ))}

            {/* Main toast card */}
            <motion.div
              className="pointer-events-auto relative max-w-[260px]"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, y: -30, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15, mass: 0.8 }}
            >
              <motion.div
                className="bg-white/95 backdrop-blur-md rounded-2xl px-4 py-3 border border-sage/20 text-sm text-ink"
                style={{ fontFamily: 'var(--font-display)' }}
                animate={{
                  boxShadow: [
                    '0 0 15px rgba(123,47,190,0.25)',
                    '0 0 35px rgba(123,47,190,0.45)',
                    '0 0 15px rgba(123,47,190,0.25)',
                  ],
                }}
                transition={{ duration: 1.2, repeat: 1, ease: 'easeInOut' }}
              >
                <div className="flex items-center gap-2.5">
                  {/* Wiggling heart icon */}
                  <motion.svg
                    xmlns="http://www.w3.org/2000/svg"
                    width={18}
                    height={18}
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="text-sage shrink-0"
                    aria-hidden="true"
                    animate={{ rotate: [0, -15, 15, -10, 10, 0], scale: [1, 1.3, 1] }}
                    transition={{ duration: 0.5, delay: 0.15 }}
                  >
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </motion.svg>

                  {toast.type === 'logged-in' ? (
                    <span className="font-semibold">
                      Added to{' '}
                      <Link
                        to={`/account/wishlists/${toast.listId}`}
                        className="underline decoration-sage/40 hover:text-sage transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        {toast.listName}
                      </Link>
                    </span>
                  ) : (
                    <span className="font-semibold">
                      Saved &mdash;{' '}
                      <Link
                        to="/account/login"
                        className="underline decoration-sage/40 hover:text-sage transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        sign in
                      </Link>
                      {' '}to keep it
                    </span>
                  )}

                  {/* Close button */}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setToast(null) }}
                    aria-label="Close"
                    className="ml-1 text-ink/30 hover:text-ink transition-colors shrink-0"
                  >
                    <svg aria-hidden="true" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
