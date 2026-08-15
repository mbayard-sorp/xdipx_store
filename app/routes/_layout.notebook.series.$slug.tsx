import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { data } from 'react-router'
import { getBlogSeries, getNotebookSettings } from '~/lib/sanity.server'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { CategoryChip } from '~/components/blog/CategoryChip'
import { NotebookSubscribe } from '~/components/blog/NotebookSubscribe'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { SanityImage } from '~/components/common/SanityImage'
import { Reveal } from '~/components/motion/Reveal'
import { canonicalUrl } from '~/lib/seo'
import { buildSocialMeta } from '~/lib/social-meta'
import { categoryAccent } from '~/lib/blog-style'

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=1800',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
  }
}

export async function loader({ params }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const [series, notebookSettings] = await Promise.all([
    getBlogSeries(slug),
    getNotebookSettings(),
  ])
  if (!series) throw data('Series not found', { status: 404 })

  return {
    series,
    notebookSettings,
    canonical: canonicalUrl({ path: `/notebook/series/${slug}` }),
  }
}

export const meta: MetaFunction<typeof loader> = ({ data: loaderData }) => {
  if (!loaderData) return [{ title: 'Series not found | xdipx' }]
  const { series, canonical } = loaderData
  const title = `${series.title} | The Notebook | xdipx`
  const description = series.description ?? `${series.title}, a Notebook series from xdipx.`

  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    ...buildSocialMeta({
      title,
      description,
      url: canonical,
      image: series.coverImageUrl ?? null,
      type: 'website',
    }),
  ]
}

export default function NotebookSeriesPage() {
  const { series, notebookSettings } = useLoaderData<typeof loader>()

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Notebook', href: '/notebook' },
    { label: series.title },
  ]

  const breadcrumbSchema = [
    { name: 'Home', url: 'https://xdipx.com/' },
    { name: 'Notebook', url: 'https://xdipx.com/notebook' },
    { name: series.title, url: `https://xdipx.com/notebook/series/${series.slug}` },
  ]

  // CollectionPage + ordered ItemList — the series is a ranked reading order,
  // which is exactly the shape answer engines lift.
  const collectionSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `https://xdipx.com/notebook/series/${series.slug}`,
    name: series.title,
    url: `https://xdipx.com/notebook/series/${series.slug}`,
    ...(series.description ? { description: series.description } : {}),
    mainEntity: {
      '@type': 'ItemList',
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      numberOfItems: series.posts.length,
      itemListElement: series.posts.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: p.title,
        url: `https://xdipx.com/notebook/${p.slug}`,
      })),
    },
  }

  // Series wash follows the dominant category of its posts.
  const firstCat = series.posts[0]?.category
  const accent = categoryAccent(firstCat?.slug, firstCat?.color)

  return (
    <div className="max-w-[75rem] mx-auto px-4 md:px-6 xl:px-8 py-6 sm:py-10">
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema) }}
      />
      <BreadcrumbNav items={breadcrumbs} />

      {/* Series header — franchise wash + portrait cover */}
      <div className={`mt-6 mb-10 rounded-lg ${accent.wash} overflow-hidden`}>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.6fr] items-stretch">
          {series.coverImageUrl && (
            <SanityImage
              src={series.coverImageUrl}
              alt={series.coverImageAlt ?? series.title}
              priority
              sizes="(max-width: 768px) 100vw, 35vw"
              widths={[640, 828, 1200]}
              fallbackWidth={828}
              {...(series.coverLqip ? { lqip: series.coverLqip } : {})}
              className="w-full h-full max-h-72 md:max-h-[420px] object-cover"
            />
          )}
          <div className="p-6 md:p-10 flex flex-col justify-center">
            <p className="kicker mb-2">
              {(series.kicker ?? 'A series').toUpperCase()}
              {series.posts.length > 0 ? ` · ${series.posts.length} PARTS` : ''}
            </p>
            <h1
              className={`text-[2rem] md:text-[2.75rem] xl:text-[3.375rem] leading-[1.04] ${accent.heading}`}
              style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
            >
              {series.title}
            </h1>
            {series.description && (
              <p
                className="text-ink-2 text-base md:text-lg mt-3 max-w-xl leading-[1.55]"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
              >
                {series.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Numbered spine list — reading order is the point */}
      {series.posts.length > 0 ? (
        <ol className="mb-12 md:mb-16">
          {series.posts.map((post, i) => (
            <Reveal key={post._id} variant="up" index={i} as="li" className="border-t border-line first:border-t-0">
              <Link to={`/notebook/${post.slug}`} className="group flex items-start gap-5 py-6">
                <span className={`kicker mt-1.5 shrink-0 ${accent.kicker}`}>Part {i + 1}</span>
                {post.heroImageUrl && (
                  <div className="hidden sm:block w-28 h-20 rounded-[14px] overflow-hidden bg-paper-3 shrink-0">
                    <SanityImage
                      src={post.heroImageUrl}
                      alt={post.heroImageAlt ?? post.title}
                      sizes="112px"
                      widths={[224, 336]}
                      fallbackWidth={224}
                      {...(post.heroLqip ? { lqip: post.heroLqip } : {})}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className="text-ink text-xl md:text-2xl leading-snug group-hover:text-coral transition-colors"
                    style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
                  >
                    {post.title}
                  </p>
                  <p className="text-sm text-ink-3 leading-[1.55] line-clamp-2 mt-1.5">{post.excerpt}</p>
                  <div className="flex items-center gap-3 mt-2.5">
                    {post.category && (
                      <CategoryChip
                        name={post.category.name}
                        slug={post.category.slug}
                        color={post.category.color}
                        linked={false}
                      />
                    )}
                    <span className="link-coral text-coral text-sm font-medium">Take a peek →</span>
                  </div>
                </div>
              </Link>
            </Reveal>
          ))}
        </ol>
      ) : (
        <p className="text-center text-ink-3 py-16">This series is still being written. Check back soon.</p>
      )}

      <NotebookSubscribe variant="index" settings={notebookSettings} />
    </div>
  )
}
