import { useState } from 'react'
import { Link, useLocation } from 'react-router'

interface NavbarProps {
  cartCount?: number
  logoUrl?: string
  logoAlt?: string
}

// Desktop links (exclude Today's Deal — that's the logo)
const desktopLinks = [
  { to: '/vault',   label: 'The Vault' },
  { to: '/for-him', label: 'For Him'   },
  { to: '/for-her', label: 'For Her'   },
]

// All links shown in the mobile drawer
const drawerLinks = [
  { to: '/',        label: "Today's Deal" },
  { to: '/vault',   label: 'The Vault'    },
  { to: '/for-him', label: 'For Him'      },
  { to: '/for-her', label: 'For Her'      },
  { to: '/for-him', label: 'Couples'      },
]

export function Navbar({ cartCount = 0, logoUrl, logoAlt = 'xdipx' }: NavbarProps) {
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

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

          {/* Desktop nav links */}
          <ul className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {desktopLinks.map(({ to, label }) => {
              const active = to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(to)
              return (
                <li key={label}>
                  <Link
                    to={to}
                    className={[
                      'px-4 py-1.5 rounded-full text-sm font-medium transition-all',
                      active
                        ? 'bg-brand-mist text-brand-purple font-semibold'
                        : 'text-brand-charcoal/70 hover:text-brand-purple hover:bg-brand-mist',
                    ].join(' ')}
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {label}
                  </Link>
                </li>
              )
            })}
          </ul>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Cart icon */}
            <Link
              to="/cart"
              className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-brand-mist transition-colors"
              aria-label={`Cart${cartCount > 0 ? ` — ${cartCount} item${cartCount > 1 ? 's' : ''}` : ''}`}
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
            </Link>

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

      {/* ── Mobile drawer ──────────────────────────────────────────── */}
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
              <ul className="space-y-1 px-3">
                {drawerLinks.map(({ to, label }) => {
                  const active = to === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(to)
                  return (
                    <li key={label}>
                      <Link
                        to={to}
                        onClick={() => setDrawerOpen(false)}
                        className={[
                          'flex items-center px-4 py-3 rounded-xl text-base font-medium transition-all',
                          active
                            ? 'bg-brand-mist text-brand-purple font-semibold'
                            : 'text-brand-charcoal hover:bg-brand-mist hover:text-brand-purple',
                        ].join(' ')}
                        style={{ fontFamily: 'var(--font-display)' }}
                      >
                        {label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>

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
