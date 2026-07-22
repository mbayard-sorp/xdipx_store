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
import { MobileExploreMenu } from '~/components/store/MobileExploreMenu'
import { AskEmmaWidget }   from '~/components/store/AskEmmaWidget'
import { AnnouncementBar } from '~/components/cms/AnnouncementBar'
import { OrganizationStructuredData } from '~/components/seo/OrganizationStructuredData'
import { WebsiteStructuredData }      from '~/components/seo/WebsiteStructuredData'
import { getEmmaPersona, getHomepageSections, getSiteSettings, isPreviewRequest } from '~/lib/sanity.server'
import { getAccessoryProducts, getMainMenu } from '~/lib/shopify.server'
import type { ShopifyMenuItem } from '~/lib/shopify.server'
import { getPinnedAccessoryIds } from '~/lib/kv.server'
import { getFeaturedBrandNames } from '~/lib/discovery.server'
import { SessionProvider } from '~/lib/session-context'
import { withTimeout } from '~/lib/with-timeout.server'
import type { Product } from '~/types'
import type { AnnouncementBarBlock, MegaMenuBanner, SocialLink, FooterColumn, SiteBanner as SiteBannerData } from '~/types/cms'

// Every storefront page routes through this layout loader, so a hung upstream
// here sinks every page, not just the homepage. Bound each leg the same way
// the homepage loader does (see `~/lib/with-timeout.server`).
const LAYOUT_TIMEOUT_MS = 8000

export async function loader({ request }: LoaderFunctionArgs) {
  const preview  = isPreviewRequest(request)
  // pinnedIds live in KV and resolve in ~1–5ms — fetch them outside the main
  // Promise.all so we can fan accessories in parallel with everything else.
  const pinnedIds = (await getPinnedAccessoryIds()) ?? []
  const [cms, settings, menuItems, upsells, emmaPersona, footerBrands] = await Promise.all([
    withTimeout(getHomepageSections(preview), LAYOUT_TIMEOUT_MS, null, 'getHomepageSections(layout)'),
    withTimeout(getSiteSettings(), LAYOUT_TIMEOUT_MS, null, 'getSiteSettings'),
    withTimeout(getMainMenu(), LAYOUT_TIMEOUT_MS, [] as ShopifyMenuItem[], 'getMainMenu'),
    pinnedIds.length
      ? withTimeout(getAccessoryProducts(pinnedIds.slice(0, 4)), LAYOUT_TIMEOUT_MS, [] as Product[], 'getAccessoryProducts')
      : Promise.resolve<Product[]>([]),
    withTimeout(getEmmaPersona(), LAYOUT_TIMEOUT_MS, null, 'getEmmaPersona'),
    // Footer "brands we carry" row — reads the already-cached discovery
    // index (no extra Shopify round-trip on a warm instance).
    withTimeout(getFeaturedBrandNames(8), LAYOUT_TIMEOUT_MS, [] as string[], 'getFeaturedBrandNames'),
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
  return { announcementBar, socialLinks, megaMenuBanners, logoUrl, logoAlt, footerColumns, footerTagline, footerDiscreetHeading, footerDiscreetBody, footerCopyright, footerDisclaimer, buyButtonText, siteBanner, preview, menuItems, upsells, emmaPersona, footerBrands }
}

export default function StoreLayout() {
  const { announcementBar, socialLinks, megaMenuBanners, logoUrl, logoAlt, footerColumns, footerTagline, footerDiscreetHeading, footerDiscreetBody, footerCopyright, footerDisclaimer, buyButtonText, siteBanner, preview, menuItems, upsells, emmaPersona, footerBrands } = useLoaderData<typeof loader>()
  const { pathname } = useLocation()
  const rootData = useRouteLoaderData<{ ENV?: { GA4_ID?: string; AGE_GATE_LEVEL?: string } }>('root')
  const ga4Id = rootData?.ENV?.GA4_ID ?? ''
  const ageGateLevel = (rootData?.ENV?.AGE_GATE_LEVEL ?? 'click_through') as 'click_through' | 'dob_entry' | 'id_verify'

  // Mobile explore menu sits at the very bottom of every page except
  // checkout. On PDP the sticky buy CTA is offset upward so it stacks
  // directly above the menu instead of covering it. The AskEmmaWidget
  // renders on every page.
  const isCheckout   = pathname.startsWith('/checkout-extras')
  const showMobileShell = !isCheckout

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
          <Navbar logoUrl={logoUrl ?? undefined} logoAlt={logoAlt} menuItems={menuItems} megaMenuBanners={megaMenuBanners} upsells={upsells} emmaPersona={emmaPersona} ageGateLevel={ageGateLevel} />
          <SiteBanner banner={siteBanner} />
          <main className={`flex-1 ${showMobileShell ? 'pb-20 md:pb-0' : ''}`}>
            <Outlet context={{ buyButtonText }} />
          </main>
          <Footer socialLinks={socialLinks} footerColumns={footerColumns} logoUrl={logoUrl ?? undefined} logoAlt={logoAlt} tagline={footerTagline} discreetHeading={footerDiscreetHeading} discreetBody={footerDiscreetBody} copyright={footerCopyright} disclaimer={footerDisclaimer} brands={footerBrands} />
          {showMobileShell && <MobileExploreMenu menuItems={menuItems} />}
          <AskEmmaWidget />
          <CookieConsent />
          <Analytics ga4Id={ga4Id} />

          {/* Sitewide brand entity + sitelinks search box. */}
          <OrganizationStructuredData sameAs={socialLinks.map(s => s.url).filter(Boolean)} />
          <WebsiteStructuredData />

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
