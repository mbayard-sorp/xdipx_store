import type { LoaderFunctionArgs } from 'react-router'
import { Link, Outlet, useLoaderData, useRevalidator } from 'react-router'
import { VisualEditing } from '@sanity/visual-editing/react-router'
import { Navbar }          from '~/components/store/Navbar'
import { TrustBar }        from '~/components/store/TrustBar'
import { Footer }          from '~/components/store/Footer'
import { CookieConsent }   from '~/components/store/CookieConsent'
import { AnnouncementBar } from '~/components/cms/AnnouncementBar'
import { getHomepageSections, getSiteSettings, isPreviewRequest } from '~/lib/sanity.server'
import { getCustomerToken } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { getCartIdFromCookie } from '~/lib/cart.server'
import { getAccessoryProducts, getCart, getMainMenu } from '~/lib/shopify.server'
import { kvGet, KV_KEYS } from '~/lib/kv.server'
import type { Product } from '~/types'
import type { AnnouncementBarBlock, MegaMenuBanner, SocialLink, FooterColumn } from '~/types/cms'

export async function loader({ request }: LoaderFunctionArgs) {
  const preview  = isPreviewRequest(request)
  const cartId   = getCartIdFromCookie(request)
  const [cms, settings, customerToken, cart, menuItems, pinnedIds] = await Promise.all([
    getHomepageSections(preview),
    getSiteSettings(),
    getCustomerToken(request),
    cartId ? getCart(cartId) : Promise.resolve(null),
    getMainMenu(),
    kvGet<string[]>(KV_KEYS.pinnedAccessoryIds),
  ])
  const upsells: Product[] = pinnedIds?.length ? await getAccessoryProducts(pinnedIds.slice(0, 4)) : []

  // Fetch customer first name for the Navbar greeting (only when logged in)
  let loggedIn = !!customerToken
  let customerFirstName: string | null = null
  if (customerToken) {
    try {
      const profile = await customerAPI(customerToken).getProfile()
      customerFirstName = profile?.firstName ?? null
    } catch {
      // Token likely expired — treat as logged-out for this render
      loggedIn = false
    }
  }
  const announcementBar = cms?.sections.find(
    (s): s is AnnouncementBarBlock => s._type === 'announcementBar' && s.active,
  ) ?? null
  const socialLinks: SocialLink[] = settings?.socialLinks ?? []
  const megaMenuBanners: MegaMenuBanner[] = settings?.megaMenuBanners ?? []
  const logoUrl  = settings?.logoUrl  ?? null
  const logoAlt  = settings?.logoAlt  ?? 'xdipx'
  const footerColumns: FooterColumn[] = settings?.footerColumns ?? []
  const footerTagline = settings?.footerTagline ?? null
  const footerDiscreetHeading = settings?.footerDiscreetHeading ?? null
  const footerDiscreetBody = settings?.footerDiscreetBody ?? null
  const footerCopyright = settings?.footerCopyright ?? null
  const footerDisclaimer = settings?.footerDisclaimer ?? null
  const buyButtonText = settings?.buyButtonText || 'I Want It ❤️'
  return { announcementBar, socialLinks, megaMenuBanners, logoUrl, logoAlt, footerColumns, footerTagline, footerDiscreetHeading, footerDiscreetBody, footerCopyright, footerDisclaimer, buyButtonText, preview, isCustomerLoggedIn: loggedIn, customerFirstName, cart, menuItems, upsells }
}

export default function StoreLayout() {
  const { announcementBar, socialLinks, megaMenuBanners, logoUrl, logoAlt, footerColumns, footerTagline, footerDiscreetHeading, footerDiscreetBody, footerCopyright, footerDisclaimer, buyButtonText, preview, isCustomerLoggedIn, customerFirstName, cart, menuItems, upsells } = useLoaderData<typeof loader>()
  const cartCount = cart?.totalQuantity ?? 0

  return (
    <div className="flex flex-col min-h-screen">
      {/* Preview mode banner */}
      {preview && (
        <div className="bg-brand-purple text-white text-xs font-semibold text-center py-2 px-4 flex items-center justify-center gap-4">
          <span>⚡ Preview mode — viewing unpublished drafts</span>
          <Link
            to="/api/sanity-exit-preview"
            className="underline underline-offset-2 opacity-80 hover:opacity-100"
          >
            Exit preview
          </Link>
        </div>
      )}

      {announcementBar && <AnnouncementBar block={announcementBar} />}
      <Navbar cart={cart ?? null} cartCount={cartCount} logoUrl={logoUrl ?? undefined} logoAlt={logoAlt} isCustomerLoggedIn={isCustomerLoggedIn} customerFirstName={customerFirstName} menuItems={menuItems} megaMenuBanners={megaMenuBanners} upsells={upsells} />
      <TrustBar />
      <main className="flex-1">
        <Outlet context={{ buyButtonText }} />
      </main>
      <Footer socialLinks={socialLinks} footerColumns={footerColumns} logoUrl={logoUrl ?? undefined} logoAlt={logoAlt} tagline={footerTagline} discreetHeading={footerDiscreetHeading} discreetBody={footerDiscreetBody} copyright={footerCopyright} disclaimer={footerDisclaimer} />
      <CookieConsent />

      {/* Visual editing overlays — only active when Sanity studio is open */}
      {preview && <LivePreview />}
    </div>
  )
}

function LivePreview() {
  const { revalidate } = useRevalidator()
  return (
    <VisualEditing
      refresh={async () => { revalidate() }}
    />
  )
}
