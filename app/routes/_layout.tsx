import type { LoaderFunctionArgs } from 'react-router'
import { Link, Outlet, useLoaderData, useRouteLoaderData } from 'react-router'
import { VisualEditing } from '@sanity/visual-editing/react-router'
import { Navbar }          from '~/components/store/Navbar'
import { TrustBar }        from '~/components/store/TrustBar'
import { Footer }          from '~/components/store/Footer'
import { CookieConsent }   from '~/components/store/CookieConsent'
import { AnnouncementBar } from '~/components/cms/AnnouncementBar'
import { getHomepageSections, getSiteSettings, isPreviewRequest } from '~/lib/sanity.server'
import type { AnnouncementBarBlock, SocialLink } from '~/types/cms'
import type { Cart } from '~/types'

export async function loader({ request }: LoaderFunctionArgs) {
  const preview = isPreviewRequest(request)
  const [cms, settings] = await Promise.all([
    getHomepageSections(preview),
    getSiteSettings(),
  ])
  const announcementBar = cms?.sections.find(
    (s): s is AnnouncementBarBlock => s._type === 'announcementBar' && s.active,
  ) ?? null
  const socialLinks: SocialLink[] = settings?.socialLinks ?? []
  const logoUrl  = settings?.logoUrl  ?? null
  const logoAlt  = settings?.logoAlt  ?? 'xdipx'
  return { announcementBar, socialLinks, logoUrl, logoAlt, preview }
}

export default function StoreLayout() {
  const root = useRouteLoaderData('root') as { cart?: Cart } | undefined
  const { announcementBar, socialLinks, logoUrl, logoAlt, preview } = useLoaderData<typeof loader>()
  const cartCount = root?.cart?.totalQuantity ?? 0

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
      <Navbar cartCount={cartCount} logoUrl={logoUrl ?? undefined} logoAlt={logoAlt} />
      <TrustBar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer socialLinks={socialLinks} logoUrl={logoUrl ?? undefined} logoAlt={logoAlt} />
      <CookieConsent />

      {/* Visual editing overlays — only active when Sanity studio is open */}
      {preview && <VisualEditing />}
    </div>
  )
}
