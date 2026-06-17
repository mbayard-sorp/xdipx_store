/**
 * `/discover` — "The Compass" product-discovery finder.
 *
 * The interactive mood/audience/matters + budget finder that used to live at
 * `/`. Moved to its own route so the new traditional storefront can own the
 * homepage (which indexes far better than a filter tool). Reuses the exact
 * battle-tested assembly (precompute / cold-miss / bot fallback) via
 * `loadVariantAData`, so all the SSR/indexing hardening carries over.
 */

import { Suspense } from 'react'
import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Await, data, useLoaderData } from 'react-router'
import { getAdminUser } from '~/lib/session.server'
import { getHomeConfig } from '~/lib/sanity.server'
import { loadVariantAData } from '~/lib/home-discover.server'
import { HomeA } from '~/components/discovery/HomeA'
import { ContentBlockRenderer } from '~/components/cms/ContentBlockRenderer'
import { buildSocialMeta } from '~/lib/social-meta'

const CANONICAL = 'https://xdipx.com/discover'
const TITLE = 'Find your fit — the xdipx product finder'
const DESCRIPTION =
  'Tell Emma a mood, who it is for, and a budget. She reshapes the shelf around you. Discreet shipping, billed as XDIPX.'

export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const fromLoader = loaderHeaders.get('Cache-Control')
  if (fromLoader) {
    const cdn = loaderHeaders.get('Vercel-CDN-Cache-Control') ?? 'no-store'
    return { 'Cache-Control': fromLoader, 'Vercel-CDN-Cache-Control': cdn }
  }
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
  }
}

const ADMIN_BYPASS_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Vercel-CDN-Cache-Control': 'no-store',
} as const

export async function loader({ request }: LoaderFunctionArgs) {
  const homeConfig = await getHomeConfig().catch(() => null)
  const welcomeBackEnabled = homeConfig?.welcomeBackEnabled ?? true
  const adminUser = await getAdminUser(request).catch(() => null)
  const value = await loadVariantAData(request, { welcomeBackEnabled, isAdmin: !!adminUser })
  return adminUser ? data(value, { headers: ADMIN_BYPASS_HEADERS }) : value
}

export const meta: MetaFunction<typeof loader> = () => [
  { title: TITLE },
  { name: 'description', content: DESCRIPTION },
  { tagName: 'link', rel: 'canonical', href: CANONICAL },
  { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: 'https://xdipx.com/discover.md' },
  ...buildSocialMeta({ title: TITLE, description: DESCRIPTION, url: CANONICAL, image: null, type: 'website' }),
]

export default function DiscoverPage() {
  const loaderData = useLoaderData<typeof loader>()
  return (
    <>
      <HomeA
        rails={loaderData.rails}
        total={loaderData.total}
        welcomeBackEnabled={loaderData.welcomeBackEnabled}
        moods={loaderData.moods}
        audiences={loaderData.audiences}
        matters={loaderData.matters}
        available={loaderData.available}
      />
      <Suspense fallback={null}>
        <Await resolve={loaderData.contentBlocks} errorElement={null}>
          {({ sections, carouselProductMap }) =>
            sections.length > 0 ? (
              <>
                {sections.map(block => (
                  <ContentBlockRenderer
                    key={block._key}
                    block={block}
                    carouselProductMap={carouselProductMap}
                  />
                ))}
              </>
            ) : null
          }
        </Await>
      </Suspense>
    </>
  )
}
