import type { MetaFunction } from 'react-router'
import { Link, useLoaderData } from 'react-router'
import { getCollectionList } from '~/lib/shopify.server'
import { canonicalUrl, pageTitle, truncateForMeta } from '~/lib/seo'
import { buildSocialMeta, SITE_ORIGIN } from '~/lib/social-meta'
import { Breadcrumbs } from '~/components/seo/Breadcrumbs'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'

const HUB_TITLE = 'Browse Collections — Editorially Curated by Emma'
const HUB_DESCRIPTION =
  "Every category xdipx covers — wands, vibrators, lubes, wear, couples picks. Editorially curated by Emma, ships discreet."

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const canonical = data?.canonical ?? `${SITE_ORIGIN}/collections`
  const ogImage = data?.collections[0]?.image?.url ?? null
  return [
    { title: pageTitle([HUB_TITLE]) },
    { name: 'description', content: truncateForMeta(HUB_DESCRIPTION) },
    { tagName: 'link', rel: 'canonical', href: canonical },
    ...buildSocialMeta({
      title: HUB_TITLE,
      description: HUB_DESCRIPTION,
      url: canonical,
      image: ogImage,
      type: 'website',
      imageAlt: 'xdipx collections',
    }),
  ]
}

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
  }
}

export async function loader() {
  const collections = await getCollectionList()
  const canonical = canonicalUrl({ path: '/collections' })
  return { collections, canonical }
}

export default function CollectionsHub() {
  const { collections, canonical } = useLoaderData<typeof loader>()

  const breadcrumbItems = [
    { name: 'Home', href: '/' },
    { name: 'Collections' },
  ]

  // CollectionPage with ItemList of every category — emit before paint.
  const itemListSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: HUB_TITLE,
    description: HUB_DESCRIPTION,
    url: canonical,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: collections.length,
      itemListElement: collections.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.title,
        url: `${SITE_ORIGIN}/collections/${c.handle}`,
      })),
    },
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <BreadcrumbStructuredData
        items={[
          { name: 'Home', url: `${SITE_ORIGIN}/` },
          { name: 'Collections', url: canonical },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }}
      />

      <Breadcrumbs items={breadcrumbItems} className="mb-4" />

      <header className="mb-10">
        <h1
          className="text-3xl md:text-4xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Browse collections
        </h1>
        <p className="mt-3 max-w-2xl text-ink/80">
          Every category Emma covers — wands, vibrators, lubes, wear, couples picks. Pick a shelf and start browsing, or let Emma's pick guide you on the home page.
        </p>
      </header>

      {collections.length === 0 ? (
        <p className="text-ink/60">No collections yet — Emma's stocking the shelves.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          {collections.map(c => (
            <li key={c.handle}>
              <Link
                to={`/collections/${c.handle}`}
                className="group block rounded-2xl overflow-hidden border border-line bg-paper hover:shadow-md transition-shadow"
              >
                <div className="aspect-[4/3] bg-cream-2 overflow-hidden">
                  {c.image?.url ? (
                    <picture>
                      <source
                        type="image/avif"
                        srcSet={[
                          `${c.image.url}${c.image.url.includes('?') ? '&' : '?'}width=480&format=avif 480w`,
                          `${c.image.url}${c.image.url.includes('?') ? '&' : '?'}width=768&format=avif 768w`,
                          `${c.image.url}${c.image.url.includes('?') ? '&' : '?'}width=1024&format=avif 1024w`,
                        ].join(', ')}
                        sizes="(max-width: 768px) 100vw, 33vw"
                      />
                      <source
                        type="image/webp"
                        srcSet={[
                          `${c.image.url}${c.image.url.includes('?') ? '&' : '?'}width=480&format=webp 480w`,
                          `${c.image.url}${c.image.url.includes('?') ? '&' : '?'}width=768&format=webp 768w`,
                          `${c.image.url}${c.image.url.includes('?') ? '&' : '?'}width=1024&format=webp 1024w`,
                        ].join(', ')}
                        sizes="(max-width: 768px) 100vw, 33vw"
                      />
                      <img
                        src={`${c.image.url}${c.image.url.includes('?') ? '&' : '?'}width=1024`}
                        alt={c.image.altText ?? c.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </picture>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted text-sm">
                      {c.title}
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h2
                    className="text-lg font-semibold text-ink"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {c.title}
                  </h2>
                  {c.description && (
                    <p className="mt-1 text-sm text-ink/70 line-clamp-2">
                      {c.description}
                    </p>
                  )}
                  {typeof c.productsCount === 'number' && c.productsCount > 0 && (
                    <p className="mt-2 text-xs text-muted">
                      {c.productsCount}+ picks
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
