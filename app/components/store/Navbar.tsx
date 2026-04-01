import { Link, useLocation } from 'react-router'

interface NavbarProps {
  cartCount?: number
}

const navLinks = [
  { to: '/vault',   label: 'The Vault' },
  { to: '/for-him', label: 'For Him'   },
  { to: '/for-her', label: 'For Her'   },
]

export function Navbar({ cartCount = 0 }: NavbarProps) {
  const location = useLocation()

  return (
    <header className="sticky top-0 z-50 bg-brand-cream/95 backdrop-blur-sm border-b border-brand-mist">
      <nav className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link
          to="/"
          className="flex items-center gap-1 group shrink-0"
          aria-label="xdipx home"
        >
          <span
            className="text-2xl font-black text-brand-gradient select-none"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            xdipx
          </span>
          <span className="text-brand-purple text-xs font-medium opacity-70 group-hover:opacity-100 transition-opacity hidden sm:block">
            ♥
          </span>
        </Link>

        {/* Nav links — hidden on small mobile, shown md+ */}
        <ul className="hidden md:flex items-center gap-1">
          {navLinks.map(({ to, label }) => {
            const active = location.pathname.startsWith(to)
            return (
              <li key={to}>
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

        {/* Right side: cart */}
        <div className="flex items-center gap-2">
          {/* Mobile nav links condensed */}
          <ul className="flex md:hidden items-center gap-0.5">
            {navLinks.map(({ to, label }) => {
              const active = location.pathname.startsWith(to)
              return (
                <li key={to}>
                  <Link
                    to={to}
                    className={[
                      'px-2 py-1 rounded-full text-xs font-medium transition-all',
                      active
                        ? 'bg-brand-mist text-brand-purple'
                        : 'text-brand-charcoal/60 hover:text-brand-purple',
                    ].join(' ')}
                  >
                    {label}
                  </Link>
                </li>
              )
            })}
          </ul>

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
        </div>
      </nav>
    </header>
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
