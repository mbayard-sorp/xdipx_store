import { lazy, Suspense } from 'react'
import type { LoaderFunctionArgs } from 'react-router'
import { Link, Outlet, useLoaderData, useLocation, useRevalidator, useRouteLoaderData } from 'react-router'

// Lazy-load Sanity visual editing — only shipped to users in preview mode.
const VisualEditing = lazy(() =>
  import('@sanity/visual-editing/react-router').then(m => ({ default: m.VisualEditing })),
)
import { ActiveVideoProvider } from '~/components/store/ActiveVideoContext'
import { Navbar }          from '~/components/store/Navbar'
import { SiteBanner }      from '~/components/store/SiteBanner'
import { Footer }          from '~/components/store/Footer'
import { CookieConsent }   from '~/components/store/CookieConsent'
import { Analytics }       from '~/components/store/Analytics'
import { MobileTabBar }    from '~/components/store/MobileTabBar'
import { AskEmmaWidget }   from '~/components/store/AskEmmaWidget'
import { AnnouncementBar } from '~/components/cms/AnnouncementBar'
import { getHomepageSections, getSiteSettings, isPreviewRequest } from '~/lib/sanity.server'
import { getAccessoryProducts, getMainMenu } from '~/lib/shopify.server'
import { getPinnedAccessoryIds } from '~/lib/kv.server'
import { SessionProvider } from '~/lib/session-context'
import type { Product } from '~/types'
import type { AnnouncementBarBlock, MegaMenuBanner, SocialLink, FooterColumn, SiteBanner as SiteBannerData } from '~/types/cms'

export async function loader({ request }: LoaderFunctionArgs) {
  const preview  = isPreviewRequest(request)
  // pinnedIds live in KV and resolve in ~1–5ms — fetch them outside the main
  // Promise.all so we can fan accessories in parallel with everything else.
  const pinnedIds = (await getPinnedAccessoryIds()) ?? []
  const [cms, settings, menuItems, upsells] = await Promise.all([
    getHomepageSections(preview),
    getSiteSettings(),
    getMainMenu(),
    pinnedIds.length ? getAccessoryProducts(pinnedIds.slice(0, 4)) : Promise.resolve<Product[]>([]),
  ])

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
  const buyButtonText = settings?.buyButtonText || "I'll take it ♥"
  const siteBanner: SiteBannerData | null = settings?.siteBanner ?? null
  return { announcementBar, socialLinks, megaMenuBanners, logoUrl, logoAlt, footerColumns, footerTagline, footerDiscreetHeading, footerDiscreetBody, footerCopyright, footerDisclaimer, buyButtonText, siteBanner, preview, menuItems, upsells }
}

export default function StoreLayout() {
  const { announcementBar, socialLinks, megaMenuBanners, logoUrl, logoAlt, footerColumns, footerTagline, footerDiscreetHeading, footerDiscreetBody, footerCopyright, footerDisclaimer, buyButtonText, siteBanner, preview, menuItems, upsells } = useLoaderData<typeof loader>()
  const { pathname } = useLocation()
  const rootData = useRouteLoaderData<{ ENV?: { GA4_ID?: string } }>('root')
  const ga4Id = rootData?.ENV?.GA4_ID ?? ''

  // Hide the mobile tab bar on PDP (pinned "Dip In" CTA owns the bottom) and on
  // the checkout flow. The AskEmmaWidget renders on every page.
  const isPdp        = pathname.startsWith('/products/')
  const isCheckout   = pathname.startsWith('/checkout-extras')
  const showMobileShell = !isPdp && !isCheckout

  return (
    <SessionProvider>
      <ActiveVideoProvider>
        <div className="flex flex-col min-h-screen">
          {/* Preview mode banner */}
          {preview && (
            <div className="bg-sage text-white text-xs font-semibold text-center py-2 px-4 flex items-center justify-center gap-4">
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
          <Navbar logoUrl={logoUrl ?? undefined} logoAlt={logoAlt} menuItems={menuItems} megaMenuBanners={megaMenuBanners} upsells={upsells} />
          <SiteBanner banner={siteBanner} />
          <main className={`flex-1 ${showMobileShell ? 'pb-20 md:pb-0' : ''}`}>
            <Outlet context={{ buyButtonText }} />
          </main>
          <Footer socialLinks={socialLinks} footerColumns={footerColumns} logoUrl={logoUrl ?? undefined} logoAlt={logoAlt} tagline={footerTagline} discreetHeading={footerDiscreetHeading} discreetBody={footerDiscreetBody} copyright={footerCopyright} disclaimer={footerDisclaimer} />
          {showMobileShell && <MobileTabBar />}
          <AskEmmaWidget />
          <CookieConsent />
          <Analytics ga4Id={ga4Id} />

          {/* Visual editing overlays — only active when Sanity studio is open */}
          {preview && <LivePreview />}
        </div>
      </ActiveVideoProvider>
    </SessionProvider>
  )
}

function LivePreview() {
  const { revalidate } = useRevalidator()
  return (
    <Suspense fallback={null}>
      <VisualEditing refresh={async () => { revalidate() }} />
    </Suspense>
  )
}
