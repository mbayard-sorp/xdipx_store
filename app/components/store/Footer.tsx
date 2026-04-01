import { Link } from 'react-router'

const SHOP_LINKS = [
  { to: '/',         label: "Today's Deal" },
  { to: '/vault',    label: 'The Vault'    },
  { to: '/for-him',  label: 'For Him'      },
  { to: '/for-her',  label: 'For Her'      },
]

const INFO_LINKS = [
  { to: '/about',  label: 'About xdipx' },
  { to: '/faq',    label: 'FAQ'          },
  { to: '/privacy', label: 'Privacy'     },
  { to: '/terms',   label: 'Terms'       },
]

const currentYear = new Date().getFullYear()

export function Footer() {
  return (
    <footer className="bg-brand-charcoal text-white/80 pt-12 pb-8 px-4 mt-20">
      <div className="max-w-6xl mx-auto">

        {/* Top: logo + columns */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">

          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link to="/" aria-label="xdipx home">
              <span
                className="text-3xl font-black text-brand-gradient select-none"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                xdipx
              </span>
            </Link>
            <p className="text-white/50 text-sm mt-2 leading-relaxed max-w-[200px]">
              One deal. Every day. For everyone. ♥
            </p>

            {/* Discretion statement */}
            <div className="mt-4 bg-white/5 rounded-xl px-4 py-3 text-xs text-white/60 leading-relaxed">
              <strong className="text-white/80">Plain packaging, always.</strong>
              <br />
              Orders ship in unmarked boxes. Billing appears as&nbsp;XD&nbsp;Inc.
            </div>
          </div>

          {/* Shop */}
          <div>
            <h3
              className="text-white font-semibold text-sm mb-4 uppercase tracking-widest"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Shop
            </h3>
            <ul className="space-y-2">
              {SHOP_LINKS.map(({ to, label }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="text-sm text-white/60 hover:text-white transition-colors"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Info */}
          <div>
            <h3
              className="text-white font-semibold text-sm mb-4 uppercase tracking-widest"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Info
            </h3>
            <ul className="space-y-2">
              {INFO_LINKS.map(({ to, label }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="text-sm text-white/60 hover:text-white transition-colors"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3
              className="text-white font-semibold text-sm mb-4 uppercase tracking-widest"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Say hi
            </h3>
            <a
              href="mailto:hello@xdipx.com"
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              hello@xdipx.com
            </a>
            <p className="text-xs text-white/40 mt-2 leading-relaxed">
              We're a small team. We respond fast. ♥
            </p>
          </div>

        </div>

        {/* Divider */}
        <div className="border-t border-white/10 pt-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-white/40">

            <p>
              © {currentYear} XD Inc. All rights reserved.
            </p>

            <p className="text-center sm:text-right max-w-sm leading-relaxed">
              xdipx.com is an adult-oriented site. You must be 18 or older to purchase.
              All products ship discreetly. We do not sell to minors.
            </p>

          </div>
        </div>

      </div>
    </footer>
  )
}
