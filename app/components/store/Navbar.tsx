import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher, useLocation } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { CartDrawer } from '~/components/store/CartDrawer'
import { DesktopMegaMenu, MobileMegaMenu } from '~/components/store/MegaMenu'
import { SearchBar } from '~/components/store/SearchBar'
import { useSession } from '~/lib/session-context'
import type { Cart, Product } from '~/types'
import type { MegaMenuBanner } from '~/types/cms'
import type { ShopifyMenuItem } from '~/lib/shopify.server'

interface NavbarProps {
  logoUrl?: string | undefined
  logoAlt?: string
  menuItems?: ShopifyMenuItem[]
  megaMenuBanners?: MegaMenuBanner[]
  upsells?: Product[]
}


export function Navbar({ logoUrl, logoAlt = 'xdipx', menuItems = [], megaMenuBanners = [], upsells = [] }: NavbarProps) {
  const { isCustomerLoggedIn, customerFirstName, wishlistCount, isLoaded: isSessionLoaded } = useSession()
  // Cart is loaded per-user via fetcher (keeps parent HTML/data edge-cacheable).
  const cartFetcher = useFetcher<{ cart: Cart | null }>()
  const cart: Cart | null = cartFetcher.data?.cart ?? null
  const cartCount = cart?.totalQuantity ?? 0
  useEffect(() => {
    if (cartFetcher.state === 'idle' && cartFetcher.data === undefined) {
      cartFetcher.load('/api/cart')
    }
  }, [cartFetcher])
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [cartOpen,   setCartOpen]   = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const closeTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cartZoneRef      = useRef<HTMLDivElement>(null)
  const cartDrawerRef    = useRef<HTMLDivElement>(null)
  const accountMenuRef   = useRef<HTMLDivElement>(null)

  // Open cart drawer whenever any part of the site signals an item was added,
  // then auto-close after 3 seconds if the user hasn't hovered into it.
  useEffect(() => {
    const onAdded = () => {
      cartFetcher.load('/api/cart')
      openCart()
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current)
      autoCloseTimerRef.current = setTimeout(() => setCartOpen(false), 3000)
    }
    const onUpdated = () => {
      cartFetcher.load('/api/cart')
    }
    window.addEventListener('xdipx:cart-added',   onAdded)
    window.addEventListener('xdipx:cart-updated', onUpdated)
    return () => {
      window.removeEventListener('xdipx:cart-added',   onAdded)
      window.removeEventListener('xdipx:cart-updated', onUpdated)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close account dropdown on click outside
  useEffect(() => {
    if (!accountMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (accountMenuRef.current?.contains(target)) return
      setAccountMenuOpen(false)
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAccountMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [accountMenuOpen])

  // Close account dropdown on route change
  useEffect(() => {
    setAccountMenuOpen(false)
  }, [location.pathname])

  // Focus first menu item when account dropdown opens
  useEffect(() => {
    if (!accountMenuOpen) return
    const firstItem = accountMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
    firstItem?.focus()
  }, [accountMenuOpen])

  // Close cart on click outside both the trigger button and the drawer panel
  useEffect(() => {
    if (!cartOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        cartZoneRef.current?.contains(target) ||
        cartDrawerRef.current?.contains(target)
      ) return
      setCartOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [cartOpen])

  const openCart = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setCartOpen(true)
  }

  const scheduleClose = () => {
    closeTimerRef.current = setTimeout(() => setCartOpen(false), 400)
  }

  // Cancel auto-close when the user hovers into the cart zone or drawer
  const cancelAutoClose = () => {
    if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current)
  }

  return (
    <>
      <header className="sticky top-0 z-[60] bg-brand-cream/95 backdrop-blur-sm border-b border-brand-mist">
        <nav className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">

          {/* Logo */}
          <Link
            to="/"
            className="flex items-center gap-1 group shrink-0"
            aria-label="xdipx home"
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={logoAlt}
                width={140}
                height={32}
                className="h-8 w-auto max-w-[140px] object-contain"
              />
            ) : (
              <>
                <span
                  className="text-2xl font-black text-brand-gradient select-none"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  xdipx
                </span>
                <span className="text-brand-purple text-xs font-medium opacity-70 group-hover:opacity-100 transition-opacity hidden sm:block">
                  ♥
                </span>
              </>
            )}
          </Link>

          {/* Desktop mega menu — flex-1 so SearchBar expansion compresses it left */}
          <div className="hidden md:flex flex-1 min-w-0 overflow-hidden">
            <DesktopMegaMenu items={menuItems} banners={megaMenuBanners} />
          </div>

          {/* Search */}
          <SearchBar />


          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Desktop account — neutral placeholder until session resolves, then
                dropdown when logged in or sign-in link when not. */}
            {!isSessionLoaded ? (
              <div
                className="hidden md:flex items-center justify-center w-11 h-11 rounded-full"
                aria-hidden="true"
              />
            ) : isCustomerLoggedIn ? (
              <div ref={accountMenuRef} className="relative hidden md:block">
                <button
                  onClick={() => setAccountMenuOpen(o => !o)}
                  className="relative flex items-center justify-center w-11 h-11 rounded-full hover:bg-brand-mist transition-colors"
                  aria-label="My account"
                  aria-expanded={accountMenuOpen}
                  aria-haspopup="menu"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-brand-purple" aria-hidden="true">
                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                  </svg>
                </button>
                <AnimatePresence>
                  {accountMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-2 w-56 bg-white border border-brand-mist rounded-2xl shadow-lg overflow-hidden z-[70]"
                      role="menu"
                    >
                      <div className="px-4 pt-3 pb-2">
                        <p
                          className="text-sm font-bold text-brand-charcoal"
                          style={{ fontFamily: 'var(--font-display)' }}
                        >
                          {customerFirstName ? <>Hi, {customerFirstName} <span aria-hidden="true">♥</span></> : <>My Account <span aria-hidden="true">♥</span></>}
                        </p>
                      </div>
                      <div className="py-1">
                        {([
                          ['/account', 'Overview'],
                          ['/account/orders', 'Orders'],
                          ['/account/subscriptions', 'Subscriptions'],
                          ['/account/wishlists', 'Wishlists'],
                          ['/account/addresses', 'Addresses'],
                          ['/account/profile', 'Profile'],
                          ['/account/preferences', 'Preferences'],
                        ] as const).map(([to, label]) => (
                          <Link key={to} to={to} onClick={() => setAccountMenuOpen(false)} className="flex items-center justify-between px-4 py-2 text-sm text-brand-charcoal hover:bg-brand-mist/60 hover:text-brand-purple transition-colors" role="menuitem">
                            <span>{label}</span>
                            {label === 'Wishlists' && wishlistCount > 0 && (
                              <span className="ml-2 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-brand-purple text-white text-[11px] font-bold">{wishlistCount}</span>
                            )}
                          </Link>
                        ))}
                      </div>
                      <div className="border-t border-brand-mist my-1" />
                      <div className="py-1 pb-2">
                        <Link to="/account/logout" onClick={() => setAccountMenuOpen(false)} className="block px-4 py-2 text-sm text-brand-charcoal/50 hover:bg-brand-mist/60 hover:text-brand-purple transition-colors" role="menuitem">Sign out</Link>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <Link
                to="/account/login"
                className="hidden md:flex relative items-center justify-center w-11 h-11 rounded-full hover:bg-brand-mist transition-colors"
                aria-label="Sign in"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-brand-charcoal/60" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </Link>
            )}

            {/* Cart icon — hover zone wraps button + bridge to drawer */}
            <div
              ref={cartZoneRef}
              className="relative"
              onMouseEnter={() => { cancelAutoClose(); openCart() }}
              onMouseLeave={scheduleClose}
            >
              <button
                onClick={() => setCartOpen(o => !o)}
                className="relative flex items-center justify-center w-11 h-11 rounded-full hover:bg-brand-mist transition-colors"
                aria-label={`Cart${cartCount > 0 ? ` — ${cartCount} item${cartCount > 1 ? 's' : ''}` : ''}`}
                aria-expanded={cartOpen}
                aria-controls="cart-drawer"
              >
                <CartIcon />
                {cartCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 bg-brand-gradient text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center"
                    aria-hidden="true"
                  >
                    {cartCount > 9 ? '9+' : cartCount}
                  </span>
                )}
              </button>
            </div>

            {/* Hamburger — mobile only */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="md:hidden flex flex-col items-center justify-center w-11 h-11 rounded-full hover:bg-brand-mist transition-colors gap-[5px]"
              aria-label="Open menu"
            >
              <span className="block w-[18px] h-[2px] bg-brand-charcoal rounded-full" />
              <span className="block w-[18px] h-[2px] bg-brand-charcoal rounded-full" />
              <span className="block w-[18px] h-[2px] bg-brand-charcoal rounded-full" />
            </button>
          </div>
        </nav>
      </header>

      {/* ── Cart drawer ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {cartOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-[59] bg-brand-charcoal/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setCartOpen(false)}
              aria-hidden="true"
            />
            <CartDrawer
              cart={cart}
              upsells={upsells}
              panelRef={cartDrawerRef}
              onClose={() => setCartOpen(false)}
              onMouseEnter={() => { cancelAutoClose(); openCart() }}
              onMouseLeave={scheduleClose}
            />
          </>
        )}
      </AnimatePresence>

      {/* ── Mobile nav drawer ───────────────────────────────────────── */}
      <AnimatePresence>
        {drawerOpen && (
        <>
          {/* Backdrop — z-[65] sits above sticky navbar (z-[60]) */}
          <motion.div
            className="fixed inset-0 z-[65] bg-brand-charcoal/50 backdrop-blur-sm md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer panel — slides in from right */}
          <motion.div
            className="fixed top-0 right-0 bottom-0 z-[66] w-[85vw] max-w-xs bg-brand-cream shadow-2xl flex flex-col md:hidden"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-brand-mist">
              {logoUrl ? (
                <img src={logoUrl} alt={logoAlt} className="h-7 w-auto object-contain" />
              ) : (
                <span
                  className="text-xl font-black text-brand-gradient"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  xdipx ♥
                </span>
              )}
              <button
                onClick={() => setDrawerOpen(false)}
                className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-brand-mist transition-colors text-brand-charcoal/60"
                aria-label="Close menu"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </div>

            {/* Drawer links */}
            <nav className="flex-1 overflow-y-auto py-4">
              {/* Today's Deal link */}
              <ul className="space-y-0.5 px-3 mb-2">
                <li>
                  <Link
                    to="/"
                    onClick={() => setDrawerOpen(false)}
                    className={[
                      'flex items-center px-4 py-3 rounded-xl text-base font-medium transition-all',
                      location.pathname === '/'
                        ? 'bg-brand-mist text-brand-purple font-semibold'
                        : 'text-brand-charcoal hover:bg-brand-mist hover:text-brand-purple',
                    ].join(' ')}
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    Today's Deal
                  </Link>
                </li>
              </ul>
              {/* Category mega menu accordion */}
              <MobileMegaMenu items={menuItems} onNavigate={() => setDrawerOpen(false)} />

              {/* Search link (mobile drawer) */}
              <ul className="px-5">
                <li>
                  <Link
                    to="/search"
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-2 py-3 text-base font-medium text-brand-charcoal/80 hover:text-brand-purple transition-colors"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    Search
                  </Link>
                </li>
              </ul>
            </nav>

            {/* Account link in drawer */}
            <div className="px-5 pt-2 pb-1 border-t border-brand-mist">
              <Link
                to={isCustomerLoggedIn ? '/account' : '/account/login'}
                onClick={() => setDrawerOpen(false)}
                className="flex items-center gap-2 text-sm font-medium text-brand-charcoal/60 hover:text-brand-charcoal py-2 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                {isCustomerLoggedIn ? 'My Account' : 'Sign in'}
              </Link>
            </div>

            {/* Drawer footer */}
            <div className="px-5 py-4 border-t border-brand-mist">
              <p className="text-xs text-brand-charcoal/40 text-center">
                One deal. Every day. Ships discreet. ♥
              </p>
            </div>
          </motion.div>
        </>
        )}
      </AnimatePresence>
    </>
  )
}

function CartIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-brand-charcoal"
      aria-hidden="true"
    >
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  )
}
