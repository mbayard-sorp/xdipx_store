import type { MetaFunction } from 'react-router'
import { Link, useLoaderData } from 'react-router'
import { getCollectionList } from '~/lib/shopify.server'
import { getCollectionsHub, getCollectionTypeMap, getBlogPosts, type CollectionType } from '~/lib/sanity.server'
import { canonicalUrl, pageTitle, truncateForMeta } from '~/lib/seo'
import { buildSocialMeta, SITE_ORIGIN } from '~/lib/social-meta'
import { Breadcrumbs } from '~/components/seo/Breadcrumbs'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { CollectionStructuredData } from '~/components/seo/CollectionStructuredData'
import { FAQStructuredData } from '~/components/seo/FAQStructuredData'

const HUB_TITLE_DEFAULT = 'Shop Intimate-Wellness Collections — Curated by Emma'
const HUB_DESCRIPTION_DEFAULT =
  "Every category xdipx covers — wands, vibrators, lubes, wear, couples picks. Editorially curated by Emma, ships discreet, free US shipping over $59."
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
  const [collections, hub, notebook, typeMap] = await Promise.all([
    getCollectionList(),
    getCollectionsHub().catch(() => null),
    getBlogPosts({ perPage: 4 }).catch(() => ({ posts: [], total: 0 })),
    getCollectionTypeMap().catch(() => new Map<string, CollectionType>()),
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

  return {
    collections,
    canonical,
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
    featured, faqs, grouped, notebookPosts,
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
                    <div className="aspect-[4/3] bg-cream-2 overflow-hidden">
                      <img
                        src={`${c.image.url}${c.image.url.includes('?') ? '&' : '?'}width=600`}
                        alt={c.image.altText ?? c.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
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

      {/* Type-grouped grids — one H2 section per non-empty Sanity-tagged
          collectionType. Renders all on one page so Google crawls every
          link in one fetch (good for internal-linking density). */}
      {collections.length === 0 ? (
        <p className="text-ink/60">No collections yet — Emma's stocking the shelves.</p>
      ) : (
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
                  </li>
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

      {notebookPosts.length > 0 && (
        <section className="mt-16" aria-labelledby="notebook-rail-heading">
          <h2
            id="notebook-rail-heading"
            className="text-xl font-bold text-ink mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            From Emma's notebook
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {notebookPosts.map(post => (
              <li key={post._id}>
                <Link
                  to={`/notebook/${post.slug}`}
                  className="group block rounded-2xl overflow-hidden border border-line bg-paper hover:shadow-md transition-shadow"
                >
                  {post.heroImageUrl && (
                    <div className="aspect-[4/3] bg-cream-2 overflow-hidden">
                      <img
                        src={`${post.heroImageUrl}${post.heroImageUrl.includes('?') ? '&' : '?'}w=600`}
                        alt={post.heroImageAlt ?? post.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                  )}
                  <div className="p-3">
                    <h3 className="text-sm font-semibold text-ink line-clamp-2 group-hover:text-coral transition-colors">
                      {post.title}
                    </h3>
                    {post.excerpt && (
                      <p className="mt-1 text-xs text-ink/60 line-clamp-2">{post.excerpt}</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
