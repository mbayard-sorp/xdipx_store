import { Link } from 'react-router'
import type { SocialLink, SocialPlatform, FooterColumn, FooterQuickLink } from '~/types/cms'

interface FooterProps {
  socialLinks?: SocialLink[]
  footerColumns?: FooterColumn[]
  brandLinks?: FooterQuickLink[]
  categoryLinks?: FooterQuickLink[]
  logoUrl?: string | undefined
  logoAlt?: string
  tagline?: string | null
  discreetHeading?: string | null
  discreetBody?: string | null
  copyright?: string | null
  disclaimer?: string | null
}

const currentYear = new Date().getFullYear()

/** Shape used by the quick-link rows. `_key` is optional on the fallbacks. */
type QuickLink = { _key?: string; label: string; href: string }

/**
 * Fallback link rows, used when Sanity has nothing configured.
 *
 * Every handle below was verified against the live storefront on 2026-07-27
 * (each /collections/<handle> returned 200). These rows render on every page,
 * so a dead handle here would ship a sitewide 404 link. Verify before editing.
 */
const FALLBACK_BRAND_LINKS: QuickLink[] = [
  { label: 'LELO',       href: '/collections/lelo' },
  { label: 'Tantus',     href: '/collections/tantus' },
  { label: 'Sliquid',    href: '/collections/sliquid' },
  { label: 'System JO',  href: '/collections/system-jo' },
  { label: 'Wicked',     href: '/collections/wicked' },
  { label: 'Pipedream',  href: '/collections/pipedream' },
  { label: 'FemmeFunn',  href: '/collections/femmefunn' },
  { label: 'Vush',       href: '/collections/vush' },
]

const FALLBACK_CATEGORY_LINKS: QuickLink[] = [
  { label: 'Vibrators',  href: '/collections/vibrators' },
  { label: 'Wands',      href: '/collections/wands' },
  { label: 'Lubricants', href: '/collections/lubricants' },
  { label: 'Couples',    href: '/collections/couples' },
  { label: 'Wellness',   href: '/collections/wellness-care' },
  { label: 'Bestsellers', href: '/collections/best-sellers' },
]

/**
 * A quiet, typographic sitewide link row. Deliberately subordinate to the
 * footer columns above it: ink-4 heading, ink-3 links, no logos, no cards.
 * On mobile it wraps to as many lines as it needs rather than scrolling, so
 * nothing is hidden from a crawler.
 */
function QuickLinkRow({ heading, links }: { heading: string; links: QuickLink[] }) {
  if (links.length === 0) return null
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-4">
      <h3 className="shrink-0 text-[11px] uppercase tracking-widest text-white/50 sm:w-32">
        {heading}
      </h3>
      <ul className="flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:gap-x-4 sm:gap-y-1.5">
        {links.map(link => (
          <li key={link._key ?? link.href}>
            <Link
              to={link.href}
              className="text-[11px] sm:text-xs text-white/55 hover:text-white transition-colors"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Footer({ socialLinks = [], footerColumns = [], brandLinks, categoryLinks, logoUrl, logoAlt = 'xdipx', tagline, discreetHeading, discreetBody, copyright, disclaimer }: FooterProps) {
  const brandRow    = brandLinks?.length    ? brandLinks    : FALLBACK_BRAND_LINKS
  const categoryRow = categoryLinks?.length ? categoryLinks : FALLBACK_CATEGORY_LINKS
  return (
    <footer className="bg-ink text-white/80 pt-12 pb-8 px-4">
      <div className="max-w-6xl mx-auto">

        {/* Top: logo + columns */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">

          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link to="/" aria-label="xdipx home">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={logoAlt}
                  width={160}
                  height={36}
                  fetchPriority="low"
                  className="h-9 w-auto max-w-[160px] object-contain brightness-0 invert"
                />
              ) : (
                <span
                  className="text-3xl font-black text-coral select-none"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  xdipx
                </span>
              )}
            </Link>
            <p className="text-white/50 text-sm mt-2 leading-relaxed max-w-[200px]">
              {tagline || 'Curated intimate wellness, for everyone. ♥'}
            </p>

            {/* Social links */}
            {socialLinks.length > 0 && (
              <div className="flex items-center gap-3 mt-4">
                {socialLinks.map(link => (
                  <a
                    key={link._key}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Follow us on ${link.platform}, @${link.handle}`}
                    className="text-white/40 hover:text-white transition-colors"
                  >
                    <SocialIcon platform={link.platform} />
                  </a>
                ))}
              </div>
            )}

            {/* Discretion statement */}
            <div className="mt-4 bg-white/5 rounded-xl px-4 py-3 text-xs text-white/60 leading-relaxed">
              <strong className="text-white/80">{discreetHeading || 'Plain packaging, always.'}</strong>
              <br />
              {discreetBody || 'Orders ship in unmarked boxes. Your statement reads\u00a0XDIPX.'}
            </div>
          </div>

          {footerColumns.map(col => (
            <div key={col._key}>
              <h3
                className="text-white font-semibold text-sm mb-4 uppercase tracking-widest"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {col.heading}
              </h3>
              <ul className="space-y-2">
                {col.links.map(link => (
                  <li key={link._key}>
                    {link.url.startsWith('/') ? (
                      <Link to={link.url} className="text-sm text-white/60 hover:text-white transition-colors">
                        {link.label}
                      </Link>
                    ) : (
                      <a
                        href={link.url}
                        target={link.url.startsWith('mailto:') ? undefined : '_blank'}
                        rel={link.url.startsWith('mailto:') ? undefined : 'noopener noreferrer'}
                        className="text-sm text-white/60 hover:text-white transition-colors"
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

        </div>

        {/* Sitewide internal link rows. These appear on every page, which is
            what gives the catalog crawl demand, so keep them plain <Link>s. */}
        <nav
          aria-label="Browse brands and categories"
          className="border-t border-white/10 pt-6 pb-6 flex flex-col gap-4"
        >
          <QuickLinkRow heading="Brands we carry" links={brandRow} />
          <QuickLinkRow heading="Shop by category" links={categoryRow} />
        </nav>

        {/* Divider */}
        <div className="border-t border-white/10 pt-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-white/50">
            <p>© {currentYear} {copyright || 'XD Inc. All rights reserved.'}</p>
            <p className="text-center sm:text-right max-w-sm leading-relaxed">
              {disclaimer || 'Age restricted. You must be 18 or older to purchase. All orders ship discreetly, and we do not sell to minors.'}
            </p>
          </div>
        </div>

      </div>
    </footer>
  )
}

// ─── Social platform icons (inline SVG, official brand shapes) ───────────────

function SocialIcon({ platform }: { platform: SocialPlatform }) {
  switch (platform) {
    case 'x':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      )
    case 'tiktok':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.32 6.32 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.75a4.85 4.85 0 0 1-1.01-.06z" />
        </svg>
      )
    case 'facebook':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
        </svg>
      )
    case 'youtube':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.4a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58zM9.75 15.02V8.98L15.5 12l-5.75 3.02z" />
        </svg>
      )
    case 'pinterest':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
        </svg>
      )
    default:
      return null
  }
}
