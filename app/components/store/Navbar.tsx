import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { AnimatePresence } from 'motion/react'
import { CartDrawer } from '~/components/store/CartDrawer'
import { DesktopMegaMenu, MobileMegaMenu } from '~/components/store/MegaMenu'
import type { Cart } from '~/types'
import type { MegaMenuBanner } from '~/types/cms'
import type { ShopifyMenuItem } from '~/lib/shopify.server'

interface NavbarProps {
  cart?: Cart | null
  cartCount?: number
  logoUrl?: string
  logoAlt?: string
  isCustomerLoggedIn?: boolean
  menuItems?: ShopifyMenuItem[]
  megaMenuBanners?: MegaMenuBanner[]
}


export function Navbar({ cart = null, cartCount = 0, logoUrl, logoAlt = 'xdipx', isCustomerLoggedIn = false, menuItems = [], megaMenuBanners = [] }: NavbarProps) {
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [cartOpen,   setCartOpen]   = useState(false)
  const closeTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cartZoneRef      = useRef<HTMLDivElement>(null)
  const cartDrawerRef    = useRef<HTMLDivElement>(null)

  // Open cart drawer whenever any part of the site signals an item was added,
  // then auto-close after 3 seconds if the user hasn't hovered into it.
  useEffect(() => {
    const handler = () => {
      openCart()
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current)
      autoCloseTimerRef.current = setTimeout(() => setCartOpen(false), 3000)
    }
    window.addEventListener('xdipx:cart-added', handler)
    return () => window.removeEventListener('xdipx:cart-added', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    closeTimerRef.current = setTimeout(() => setCartOpen(false), 150)
  }

  // Cancel auto-close when the user hovers into the cart zone or drawer
  const cancelAutoClose = () => {
    if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current)
  }

  return (
    <>
      <header className="sticky top-0 z-50 bg-brand-cream/95 backdrop-blur-sm border-b border-brand-mist">
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

          {/* Desktop mega menu */}
          <DesktopMegaMenu items={menuItems} banners={megaMenuBanners} />

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Account icon */}
            <Link
              to={isCustomerLoggedIn ? '/account' : '/account/login'}
              className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-brand-mist transition-colors"
              aria-label={isCustomerLoggedIn ? 'My account' : 'Sign in'}
            >
              {isCustomerLoggedIn ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-brand-purple" aria-hidden="true">
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-brand-charcoal/60" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              )}
            </Link>

            {/* Cart icon — hover zone wraps button + drawer trigger */}
            <div
              ref={cartZoneRef}
              className="relative"
              onMouseEnter={() => { cancelAutoClose(); openCart() }}
              onMouseLeave={scheduleClose}
            >
              <button
                onClick={() => setCartOpen(o => !o)}
                className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-brand-mist transition-colors"
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
              className="md:hidden flex flex-col items-center justify-center w-9 h-9 rounded-full hover:bg-brand-mist transition-colors gap-1.5"
              aria-label="Open menu"
            >
              <span className="w-4.5 h-0.5 bg-brand-charcoal rounded-full" />
              <span className="w-4.5 h-0.5 bg-brand-charcoal rounded-full" />
              <span className="w-3 h-0.5 bg-brand-charcoal rounded-full self-end" />
            </button>
          </div>
        </nav>
      </header>

      {/* ── Cart drawer ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {cartOpen && (
          <CartDrawer
            cart={cart}
            panelRef={cartDrawerRef}
            onClose={() => setCartOpen(false)}
            onMouseEnter={() => { cancelAutoClose(); openCart() }}
            onMouseLeave={scheduleClose}
          />
        )}
      </AnimatePresence>

      {/* ── Mobile nav drawer ───────────────────────────────────────── */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-brand-charcoal/40 backdrop-blur-sm md:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer panel */}
          <div
            className="fixed top-0 right-0 bottom-0 z-50 w-72 bg-brand-cream shadow-2xl flex flex-col md:hidden"
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
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-brand-mist transition-colors text-brand-charcoal/60"
                aria-label="Close menu"
              >
                ✕
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
          </div>
        </>
      )}
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
