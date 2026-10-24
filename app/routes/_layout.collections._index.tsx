import type { MetaFunction } from 'react-router'
import { Link, useLoaderData } from 'react-router'
import { getCollectionList } from '~/lib/shopify.server'
import { getCollectionsHub, getCollectionTypeMap, getBlogPosts, getBrandIdentityMap, getCollectionsHubLayout, type CollectionType } from '~/lib/sanity.server'
import { canonicalUrl, pageTitle, truncateForMeta } from '~/lib/seo'
import { buildSocialMeta, SITE_ORIGIN } from '~/lib/social-meta'
import { Breadcrumbs } from '~/components/seo/Breadcrumbs'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { CollectionStructuredData } from '~/components/seo/CollectionStructuredData'
import { FAQStructuredData } from '~/components/seo/FAQStructuredData'
import { NotebookRail } from '~/components/blog/NotebookRail'
import { FREE_SHIPPING_THRESHOLD } from '~/lib/shipping'

const HUB_TITLE_DEFAULT = 'Shop Intimate-Wellness Collections — Curated by Emma'
const HUB_DESCRIPTION_DEFAULT =
  `Every category xdipx covers — wands, vibrators, lubes, wear, couples picks. Editorially curated by Emma, ships discreet, free US shipping over $${FREE_SHIPPING_THRESHOLD}.`
const HUB_H1_DEFAULT = 'Browse collections'
const HUB_INTRO_DEFAULT = "Every category Emma covers — wands, vibrators, lubes, wear, couples picks. Pick a shelf and start browsing, or let Emma's pick guide you on the home page."

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const canonical = data?.canonical ?? `${SITE_ORIGIN}/collections`
  const ogImage = data?.collections[0]?.image?.url ?? null
  const title = data?.seoTitle ?? HUB_TITLE_DEFAULT
  const description = data?.seoDescription ?? HUB_DESCRIPTION_DEFAULT
  return [
    { title: pageTitle([title]) },
    { name: 'description', content: truncateForMeta(description) },
    { tagName: 'link', rel: 'canonical', href: canonical },
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: `${SITE_ORIGIN}/collections.md` },
    ...buildSocialMeta({
      title,
      description,
      url: canonical,
      image: ogImage,
      type: 'website',
      imageAlt: 'xdipx collections',
    }),
  ]
}

export function headers() {
  // Hub is content-stable — only changes when collections are added/removed
  // or when the Sanity hub doc is edited. 30-min CDN with 24-hour SWR keeps
  // it fast on cold hits without staling content meaningfully.
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=1800, stale-while-revalidate=86400',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
  }
}

export async function loader() {
  const [collections, hub, notebook, typeMap, layoutDoc, brandIdentities] = await Promise.all([
    getCollectionList(),
    getCollectionsHub().catch(() => null),
    getBlogPosts({ perPage: 4 }).catch(() => ({ posts: [], total: 0 })),
    getCollectionTypeMap().catch(() => new Map<string, CollectionType>()),
    getCollectionsHubLayout().catch(() => null),
    getBrandIdentityMap().catch(() => new Map<string, never>()),
  ])
  const canonical = canonicalUrl({ path: '/collections' })

  // Resolve display + SEO with Sanity > hardcoded defaults.
  const seoTitle       = hub?.seoTitle       || HUB_TITLE_DEFAULT
  const seoDescription = hub?.seoDescription || HUB_DESCRIPTION_DEFAULT
  const h1             = hub?.h1             || HUB_H1_DEFAULT
  const introHtml      = hub?.introHtml      || null
  const faqs           = hub?.faqs           ?? []

  // Featured collections — match Sanity-curated handles to live Shopify
  // collections. Anything missing in Shopify is silently dropped.
  const handleSet = new Map(collections.map(c => [c.handle, c]))
  const featured = (hub?.featured ?? [])
    .map(f => {
      const live = handleSet.get(f.handle)
      return live ? { ...live, blurb: f.blurb } : null
    })
    .filter((f): f is NonNullable<typeof f> => !!f)
    .slice(0, 4)

  // Group collections by Sanity-tagged type. Anything without a
  // collectionPage doc defaults to "category" — same default used in the
  // Sanity schema, so behavior is consistent for un-tagged shelves.
  const grouped: Record<CollectionType, typeof collections> = {
    category: [],
    brand:    [],
    theme:    [],
  }
  for (const c of collections) {
    const type = typeMap.get(c.handle) ?? 'category'
    grouped[type].push(c)
  }

  // Brand logos ride along as a plain object (a Map does not serialize).
  const brandLogos: Record<string, { name: string; url: string }> = {}
  for (const [h, b] of brandIdentities) brandLogos[h] = { name: b.brandName, url: b.logoUrl }

  // Shopper-facing groups from the Sanity hub layout. Handles that are not
  // live (deleted, empty, unlisted) drop out; live shelves no group names land
  // in a closing section so no collection loses its hub link.
  let layout: {
    groups:         Array<{ heading: string; id: string; items: typeof collections }>
    featuredBrands: typeof collections
    azBrands:       typeof collections
  } | null = null
  if (layoutDoc) {
    const placed = new Set<string>()
    const groups = layoutDoc.groups
      .map((g, i) => {
        const items = g.handles
          .map(h => handleSet.get(h))
          .filter((c): c is NonNullable<typeof c> => !!c && !placed.has(c.handle))
        for (const c of items) placed.add(c.handle)
        return { heading: g.heading, id: `collections-group-${i}-heading`, items }
      })
      .filter(g => g.items.length > 0)
    const brands = grouped.brand.filter(c => !placed.has(c.handle))
    const featuredBrands = layoutDoc.featuredBrandHandles
      .map(h => brands.find(c => c.handle === h))
      .filter((c): c is NonNullable<typeof c> => !!c)
    const featuredSet = new Set(featuredBrands.map(c => c.handle))
    const azBrands = brands
      .filter(c => !featuredSet.has(c.handle))
      .sort((a, b) => a.title.localeCompare(b.title))
    const ungrouped = collections.filter(c => !placed.has(c.handle) && (typeMap.get(c.handle) ?? 'category') !== 'brand')
    if (ungrouped.length > 0) groups.push({ heading: 'More to explore', id: 'collections-more-heading', items: ungrouped })
    layout = { groups, featuredBrands, azBrands }
  }

  return {
    collections,
    canonical,
    brandLogos,
    layout,
    seoTitle,
    seoDescription,
    h1,
    introHtml,
    featured,
    faqs,
    grouped,
    notebookPosts: notebook.posts,
  }
}

// Sections rendered in this fixed order — each only emits when it has items.
const TYPE_SECTIONS: ReadonlyArray<{ type: CollectionType; heading: string; id: string }> = [
  { type: 'category', heading: 'Shop by category', id: 'collections-category-heading' },
  { type: 'brand',    heading: 'Shop by brand',    id: 'collections-brand-heading'    },
  { type: 'theme',    heading: 'Shop by theme',    id: 'collections-theme-heading'    },
]

export default function CollectionsHub() {
  const {
    collections, canonical, seoTitle, seoDescription, h1, introHtml,
    featured, faqs, grouped, notebookPosts, brandLogos, layout,
  } = useLoaderData<typeof loader>()

  const breadcrumbItems = [
    { name: 'Home', href: '/' },
    { name: 'Collections' },
  ]

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <BreadcrumbStructuredData
        items={[
          { name: 'Home', url: `${SITE_ORIGIN}/` },
          { name: 'Collections', url: canonical },
        ]}
      />
      {collections.length > 0 && (
        <CollectionStructuredData
          name={seoTitle}
          description={seoDescription}
          url={canonical}
          items={collections.map(c => ({
            handle: c.handle,
            title:  c.title,
            url:    `${SITE_ORIGIN}/collections/${c.handle}`,
            image:  c.image?.url ?? null,
          }))}
        />
      )}
      {faqs.length > 0 && <FAQStructuredData faqs={faqs} />}

      <Breadcrumbs items={breadcrumbItems} className="mb-4" />

      <header className="mb-10">
        <h1
          className="text-3xl md:text-4xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {h1}
        </h1>
        {introHtml ? (
          <div
            className="prose prose-sm md:prose-base max-w-3xl mt-3 text-ink/80"
            dangerouslySetInnerHTML={{ __html: introHtml }}
          />
        ) : (
          <p className="mt-3 max-w-2xl text-ink/80">{HUB_INTRO_DEFAULT}</p>
        )}
      </header>

      {featured.length > 0 && (
        <section className="mb-12" aria-labelledby="featured-collections-heading">
          <h2
            id="featured-collections-heading"
            className="text-xl font-bold text-ink mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Featured this week
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {featured.map(c => (
              <li key={c.handle}>
                <Link
                  to={`/collections/${c.handle}`}
                  className="group block rounded-2xl overflow-hidden border border-line bg-paper hover:shadow-md transition-shadow"
                >
                  {c.image?.url && (
                    <div className="h-[200px] bg-cream-2 overflow-hidden">
                      <img
                        src={`${c.image.url}${c.image.url.includes('?') ? '&' : '?'}width=600`}
                        alt={c.image.altText ?? c.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                  )}
                  <div className="p-3">
                    <h3 className="text-sm font-semibold text-ink group-hover:text-coral transition-colors">
                      {c.title}
                    </h3>
                    {c.blurb && (
                      <p className="mt-1 text-xs text-ink/60 line-clamp-2">{c.blurb}</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {collections.length === 0 ? (
        <p className="text-ink/60">No collections yet. Emma's stocking the shelves.</p>
      ) : layout ? (
        <>
          {layout.groups.map(g => (
            <section key={g.id} className="mb-12 last:mb-0" aria-labelledby={g.id}>
              <h2
                id={g.id}
                className="text-xl font-bold text-ink mb-4"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {g.heading}
              </h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                {g.items.map(c => (
                  <li key={c.handle}><CollectionCard collection={c} logo={brandLogos[c.handle] ?? null} /></li>
                ))}
              </ul>
            </section>
          ))}
          {(layout.featuredBrands.length > 0 || layout.azBrands.length > 0) && (
            <section className="mb-12 last:mb-0" aria-labelledby="collections-brand-heading">
              <h2
                id="collections-brand-heading"
                className="text-xl font-bold text-ink mb-4"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Shop by brand
              </h2>
              {layout.featuredBrands.length > 0 && (
                <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                  {layout.featuredBrands.map(c => (
                    <li key={c.handle}><CollectionCard collection={c} logo={brandLogos[c.handle] ?? null} /></li>
                  ))}
                </ul>
              )}
              {layout.azBrands.length > 0 && (
                <div className="mt-8">
                  <h3 className="kicker mb-3">All brands, A to Z</h3>
                  <ul className="columns-2 sm:columns-3 md:columns-4 gap-6 text-sm">
                    {layout.azBrands.map(c => (
                      <li key={c.handle} className="break-inside-avoid py-1">
                        <Link to={`/collections/${c.handle}`} className="text-ink/80 hover:text-coral transition-colors">
                          {c.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      ) : (
        /* Type-grouped grids: one H2 section per non-empty Sanity-tagged
           collectionType. Renders all on one page so Google crawls every
           link in one fetch (good for internal-linking density). */
        TYPE_SECTIONS.map(({ type, heading, id }) => {
          const items = grouped[type]
          if (items.length === 0) return null
          return (
            <section key={type} className="mb-12 last:mb-0" aria-labelledby={id}>
              <h2
                id={id}
                className="text-xl font-bold text-ink mb-4"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {heading}
              </h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                {items.map(c => (
                  <li key={c.handle}><CollectionCard collection={c} logo={brandLogos[c.handle] ?? null} /></li>
                ))}
              </ul>
            </section>
          )
        })
      )}

      {faqs.length > 0 && (
        <section className="mt-16 max-w-3xl mx-auto" aria-labelledby="hub-faq-heading">
          <h2
            id="hub-faq-heading"
            className="text-2xl font-bold text-ink mb-6"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Common questions
          </h2>
          <ul className="divide-y divide-line">
            {faqs.map((faq, i) => (
              <li key={i} className="py-4">
                <h3 className="font-semibold text-ink">{faq.question}</h3>
                <p className="mt-1 text-ink/80 text-sm leading-relaxed whitespace-pre-line">
                  {faq.answer}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NotebookRail
        posts={notebookPosts}
        seeAllHref="/notebook"
        seeAllLabel="More from the Notebook →"
      />
    </div>
  )
}

type HubCollection = {
  handle: string
  title: string
  description: string
  image: { url: string; altText: string | null } | null
  productsCount: number | null
}

/** One hub card. A brand collection with a sourced logo shows the mark above its name. */
function CollectionCard({ collection: c, logo }: { collection: HubCollection; logo: { name: string; url: string } | null }) {
  return (
    <Link
      to={`/collections/${c.handle}`}
      className="group block rounded-2xl overflow-hidden border border-line bg-paper hover:shadow-md transition-shadow"
    >
      <div className="h-[200px] bg-cream-2 overflow-hidden">
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
              className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
            />
          </picture>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted text-sm">
            {c.title}
          </div>
        )}
      </div>
      <div className="p-4">
        {logo && (
          <img
            src={logo.url}
            alt={logo.name}
            loading="lazy"
            decoding="async"
            className="h-8 w-auto max-w-[160px] object-contain object-left mb-2"
          />
        )}
        <h3
          className="text-lg font-semibold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {c.title}
        </h3>
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
  )
}
