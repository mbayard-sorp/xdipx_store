import { useMemo, useState } from 'react'
import type { LoaderFunctionArgs, MetaDescriptor, MetaFunction } from 'react-router'
import { useLoaderData, useSearchParams, Link } from 'react-router'
import { getCollection, getCollectionDeals, getMainMenu, type CollectionSort } from '~/lib/shopify.server'
import { getCollectionPage, getEmmaPresets } from '~/lib/sanity.server'
import { canonicalUrl, pageTitle, robotsContent, truncateForMeta } from '~/lib/seo'
import { buildSocialMeta, SITE_ORIGIN } from '~/lib/social-meta'
import { VaultCard } from '~/components/store/VaultCard'
import { AskEmmaRail, matchesAskEmmaFilters } from '~/components/store/AskEmmaRail'
import { EmmaDiscoveryRail } from '~/components/store/EmmaDiscoveryRail'
import { EmmaEncouragementStrip } from '~/components/store/EmmaEncouragementStrip'
import { LetMeLookAgainCTA } from '~/components/store/LetMeLookAgainCTA'
import { Breadcrumbs } from '~/components/seo/Breadcrumbs'
import { CollectionStructuredData } from '~/components/seo/CollectionStructuredData'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { FAQStructuredData } from '~/components/seo/FAQStructuredData'
import { readRecentHandles } from '~/lib/recent-views.server'

const FACET_PARAMS = ['mood', 'audience', 'matters', 'budgetMax'] as const
const PAGE_SIZE = 24

function preloadHeroImageTag(imageUrl: string | undefined | null) {
  if (!imageUrl) return null
  const sep = imageUrl.includes('?') ? '&' : '?'
  return {
    tagName: 'link',
    rel: 'preload',
    as: 'image',
    href: `${imageUrl}${sep}width=1600`,
    imagesrcset: [
      `${imageUrl}${sep}width=768 768w`,
      `${imageUrl}${sep}width=1200 1200w`,
      `${imageUrl}${sep}width=1600 1600w`,
      `${imageUrl}${sep}width=2000 2000w`,
    ].join(', '),
    imagesizes: '100vw',
    fetchpriority: 'high',
  } as const
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: pageTitle(['Collection not found']) }]
  const {
    seoTitle,
    seoDescription,
    canonical,
    ogImageUrl: image,
    ogImageAlt,
    filtersApplied,
    page,
    h1,
  } = data

  const titleSuffix = page > 1 ? ` — Page ${page}` : ''
  const finalTitle = pageTitle([`${seoTitle}${titleSuffix}`])
  const finalDescription = truncateForMeta(seoDescription)
  const heroPreload = preloadHeroImageTag(image)

  const tags: MetaDescriptor[] = [
    { title: finalTitle },
    { name: 'description', content: finalDescription },
    { tagName: 'link', rel: 'canonical', href: canonical },
  ]

  // Faceted variants are explicitly noindex,follow — Google retains link
  // equity flowing to PDPs but doesn't index near-duplicate filter combos.
  if (filtersApplied) {
    tags.push({ name: 'robots', content: robotsContent({ index: false, follow: true }) })
  }

  if (heroPreload) tags.push(heroPreload)

  tags.push(
    ...buildSocialMeta({
      title: finalTitle,
      description: finalDescription,
      url: canonical,
      image: image ?? null,
      type: 'website',
      imageAlt: ogImageAlt ?? h1,
    }),
  )

  return tags
}

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
  }
}

const SORT_VALUES = ['manual', 'newest', 'price-asc', 'price-desc'] as const
function parseSort(raw: string | null): CollectionSort {
  return (SORT_VALUES as readonly string[]).includes(raw ?? '')
    ? (raw as CollectionSort)
    : 'manual'
}

function titleCase(handle: string): string {
  return handle
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const handle = params.handle!
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const sort = parseSort(url.searchParams.get('sort'))

  const filtersApplied = FACET_PARAMS.some(p => {
    const vals = url.searchParams.getAll(p)
    return vals.some(v => v && v.length > 0)
  })

  const [collection, sanity, { deals, hasNextPage }, presets, menu] = await Promise.all([
    getCollection(handle),
    getCollectionPage(handle),
    getCollectionDeals(handle, page, PAGE_SIZE, sort),
    getEmmaPresets(),
    getMainMenu(),
  ])

  // 404 — no Shopify collection at this handle.
  if (!collection) {
    throw new Response('Collection not found', { status: 404 })
  }

  // Resolve display + SEO with Sanity > Shopify SEO > Shopify title fallback.
  const fallbackTitle = collection.title || titleCase(handle)
  const h1 = sanity?.h1 || fallbackTitle
  const seoTitle =
    sanity?.seoTitle
    || collection.seoTitle
    || `${fallbackTitle} — Editorially curated picks`
  const seoDescription =
    sanity?.seoDescription
    || collection.seoDescription
    || collection.description
    || `Shop ${fallbackTitle.toLowerCase()} at xdipx — curated picks on intimate-wellness products, hand-picked by Emma.`

  const introHtml = sanity?.introHtml || (collection.descriptionHtml || null)

  const heroImageUrl = sanity?.heroImageUrl || collection.image?.url || null
  const heroImageAlt = sanity?.heroImageAlt || collection.image?.altText || h1

  // Canonical strategy:
  //  - Page > 1: self-canonical at ?page=N (each page is its own document).
  //  - Page 1, with sort: canonical to the bare /collections/$handle (sort is
  //    a faceting param, not a new document).
  //  - Filters applied: canonical still points to the bare URL — combined
  //    with `noindex,follow` above this consolidates faceted variants.
  const canonical =
    page > 1
      ? canonicalUrl({
          path: `/collections/${handle}`,
          searchParams: new URLSearchParams({ page: String(page) }),
          allowedParams: ['page'],
        })
      : canonicalUrl({ path: `/collections/${handle}` })

  const recentViews = readRecentHandles(request)

  // Top-level menu collections for "Browse other categories" rail.
  const sibling = menu
    .flatMap(m => [m, ...m.items])
    .filter(m => /\/collections\//.test(m.url))
    .map(m => {
      const slug = m.url.split('/collections/')[1]?.split('?')[0]?.split('/')[0]
      return slug ? { handle: slug, label: m.title } : null
    })
    .filter((m): m is { handle: string; label: string } => !!m && m.handle !== handle)

  // Sanity-curated related collections take priority; fall back to siblings.
  const relatedCollections = (sanity?.related?.length ? sanity.related : sibling).slice(0, 8)

  return {
    deals,
    hasNextPage,
    page,
    handle,
    h1,
    seoTitle,
    seoDescription,
    canonical,
    introHtml,
    heroImageUrl,
    heroImageAlt,
    ogImageUrl: heroImageUrl,
    ogImageAlt: heroImageAlt,
    filtersApplied,
    sort,
    presets,
    recentViews,
    faqs: sanity?.faqs ?? [],
    relatedCollections,
    productsCount: collection.productsCount,
  }
}

export default function CollectionPage() {
  const {
    deals,
    hasNextPage,
    page,
    handle,
    h1,
    canonical,
    introHtml,
    heroImageUrl,
    heroImageAlt,
    seoDescription,
    sort,
    presets,
    recentViews,
    faqs,
    relatedCollections,
  } = useLoaderData<typeof loader>()
  const [params, setParams] = useSearchParams()
  const [starred, setStarred] = useState<Record<string, string>>({})

  const filtered = useMemo(
    () => deals.filter(d => matchesAskEmmaFilters(
      {
        ...(d.moodTags     ? { moodTags:     d.moodTags     } : {}),
        ...(d.audienceTags ? { audienceTags: d.audienceTags } : {}),
        ...(d.mattersTags  ? { mattersTags:  d.mattersTags  } : {}),
        price: d.dealPrice,
      },
      params,
    )),
    [deals, params],
  )

  const candidates = useMemo(
    () => filtered.slice(0, 20).map(d => ({
      handle:      d.handle,
      title:       d.seoTitle,
      vendor:      d.brand ?? null,
      price:       d.dealPrice,
      tags:        [],
      moodTags:    d.moodTags ?? [],
      mattersTags: d.mattersTags ?? [],
    })),
    [filtered],
  )

  const activeFilters = useMemo(() => ({
    moods:     params.getAll('mood'),
    audiences: params.getAll('audience'),
    matters:   params.getAll('matters'),
    budgetMax: params.get('budgetMax') ? Number(params.get('budgetMax')) : null,
  }), [params])

  const facetProducts = useMemo(
    () => deals.map(d => ({
      ...(d.moodTags     ? { moodTags:     d.moodTags     } : {}),
      ...(d.audienceTags ? { audienceTags: d.audienceTags } : {}),
      ...(d.mattersTags  ? { mattersTags:  d.mattersTags  } : {}),
      price: d.dealPrice,
    })),
    [deals],
  )

  const { moods, audiences, matters, priceMin, priceMax } = useMemo(
    () => deriveFacets(facetProducts),
    [facetProducts],
  )

  function pageHref(p: number) {
    const q = new URLSearchParams(params)
    if (p === 1) q.delete('page')
    else q.set('page', String(p))
    const suffix = q.toString()
    return suffix ? `/collections/${handle}?${suffix}` : `/collections/${handle}`
  }

  const breadcrumbItems = [
    { name: 'Home', href: '/' },
    { name: 'Collections', href: '/collections' },
    { name: h1 },
  ]
  const breadcrumbSchema = breadcrumbItems.map((c, i) => ({
    name: c.name,
    url:
      i === breadcrumbItems.length - 1
        ? canonical
        : `${SITE_ORIGIN}${c.href}`,
  }))

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Structured data — emit before paint. */}
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      <CollectionStructuredData
        name={h1}
        description={seoDescription}
        url={canonical}
        items={deals.map(d => ({ handle: d.handle, title: d.seoTitle }))}
      />
      {faqs.length > 0 && <FAQStructuredData faqs={faqs} />}

      <Breadcrumbs items={breadcrumbItems} className="mb-4" />

      {heroImageUrl && (
        <div className="mb-6 overflow-hidden rounded-2xl border border-line bg-cream-2">
          <picture>
            <source
              type="image/avif"
              srcSet={[
                `${heroImageUrl}${heroImageUrl.includes('?') ? '&' : '?'}width=768&format=avif 768w`,
                `${heroImageUrl}${heroImageUrl.includes('?') ? '&' : '?'}width=1200&format=avif 1200w`,
                `${heroImageUrl}${heroImageUrl.includes('?') ? '&' : '?'}width=1600&format=avif 1600w`,
                `${heroImageUrl}${heroImageUrl.includes('?') ? '&' : '?'}width=2000&format=avif 2000w`,
              ].join(', ')}
              sizes="100vw"
            />
            <source
              type="image/webp"
              srcSet={[
                `${heroImageUrl}${heroImageUrl.includes('?') ? '&' : '?'}width=768&format=webp 768w`,
                `${heroImageUrl}${heroImageUrl.includes('?') ? '&' : '?'}width=1200&format=webp 1200w`,
                `${heroImageUrl}${heroImageUrl.includes('?') ? '&' : '?'}width=1600&format=webp 1600w`,
              ].join(', ')}
              sizes="100vw"
            />
            <img
              src={`${heroImageUrl}${heroImageUrl.includes('?') ? '&' : '?'}width=1600`}
              alt={heroImageAlt ?? h1}
              width={1600}
              height={600}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="w-full h-auto object-cover aspect-[16/6]"
            />
          </picture>
        </div>
      )}

      <header className="mb-8">
        <h1
          className="text-3xl md:text-4xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {h1}
        </h1>
        {introHtml && (
          <div
            className="prose prose-sm md:prose-base max-w-3xl mt-3 text-ink/80"
            dangerouslySetInnerHTML={{ __html: introHtml }}
          />
        )}
      </header>

      <div className="flex flex-col md:flex-row gap-8">
        <div className="flex flex-col gap-4 md:w-[260px] md:shrink-0">
          <EmmaDiscoveryRail
            surface="collection"
            collection={handle}
            candidates={candidates}
            recentViews={recentViews}
            onStarredChange={setStarred}
          />
          <AskEmmaRail
            availableMoods={moods}
            availableAudiences={audiences}
            availableMatters={matters}
            priceMin={priceMin}
            priceMax={priceMax}
            products={facetProducts}
            presets={presets}
          />
        </div>

        <div className="flex-1 min-w-0">
          {deals.length > 0 && (
            <div className="flex items-center gap-3 mb-3">
              <EmmaEncouragementStrip
                surface="collection"
                collection={handle}
              />
              <div className="flex items-center gap-2 shrink-0">
                <label htmlFor="collection-sort" className="text-xs text-muted">
                  Sort:
                </label>
                <select
                  id="collection-sort"
                  value={sort}
                  onChange={e => {
                    const next = new URLSearchParams(params)
                    const v = e.target.value
                    if (v === 'manual') next.delete('sort')
                    else next.set('sort', v)
                    next.delete('page')
                    setParams(next, { preventScrollReset: true })
                  }}
                  className="text-xs bg-paper border border-line rounded-full px-3 py-1.5 text-ink focus:outline-none focus:border-coral"
                >
                  <option value="manual">Relevance</option>
                  <option value="newest">Newest</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                </select>
              </div>
            </div>
          )}
          {filtered.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {filtered.map(deal => (
                <VaultCard
                  key={deal.id}
                  deal={deal}
                  {...(starred[deal.handle] ? { starred: { reason: starred[deal.handle]! } } : {})}
                />
              ))}
            </div>
          ) : deals.length > 0 ? (
            <div className="text-center py-20">
              <p className="text-ink/60 text-sm mb-3">Nothing matches those filters in {h1}.</p>
              <p className="text-muted text-xs">Try loosening a chip above — or ask Emma for a different preset.</p>
            </div>
          ) : (
            <div className="text-center py-20">
              <p className="text-ink/40 text-lg mb-4">No products in this collection yet.</p>
              <Link
                to="/"
                className="inline-block px-6 py-2.5 rounded-full bg-coral text-white text-sm font-semibold"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                See Emma's pick
              </Link>
            </div>
          )}

          <nav aria-label="Pagination" className="flex justify-center gap-4 mt-10">
            {page > 1 && (
              <Link
                to={pageHref(page - 1)}
                rel="prev"
                className="px-5 py-2 rounded-full border border-line text-ink/70 hover:bg-cream-2 transition-colors text-sm"
              >
                &larr; Previous
              </Link>
            )}
            {hasNextPage && (
              <Link
                to={pageHref(page + 1)}
                rel="next"
                className="px-5 py-2 rounded-full bg-coral text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Next page &rarr;
              </Link>
            )}
          </nav>

          {deals.length > 0 && (
            <LetMeLookAgainCTA
              collection={h1}
              filters={activeFilters}
              className="mt-8"
            />
          )}
        </div>
      </div>

      {faqs.length > 0 && (
        <section className="mt-16 max-w-3xl mx-auto" aria-labelledby="collection-faq-heading">
          <h2
            id="collection-faq-heading"
            className="text-2xl font-bold text-ink mb-6"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            FAQs about {h1.toLowerCase()}
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

      {relatedCollections.length > 0 && (
        <section className="mt-16" aria-labelledby="related-collections-heading">
          <h2
            id="related-collections-heading"
            className="text-xl font-bold text-ink mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Browse other categories
          </h2>
          <ul className="flex flex-wrap gap-2">
            {relatedCollections.map(rc => (
              <li key={rc.handle}>
                <Link
                  to={`/collections/${rc.handle}`}
                  className="inline-block px-4 py-2 rounded-full border border-line bg-paper text-sm text-ink hover:bg-cream-2 transition-colors"
                >
                  {rc.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function deriveFacets(deals: Array<{ moodTags?: string[]; audienceTags?: string[]; mattersTags?: string[]; price: number }>) {
  const moods     = new Set<string>()
  const audiences = new Set<string>()
  const matters   = new Set<string>()
  let priceMin = Infinity
  let priceMax = 0
  for (const d of deals) {
    d.moodTags?.forEach(t => moods.add(t))
    d.audienceTags?.forEach(t => audiences.add(t))
    d.mattersTags?.forEach(t => matters.add(t))
    if (d.price < priceMin) priceMin = d.price
    if (d.price > priceMax) priceMax = d.price
  }
  return {
    moods:     Array.from(moods).sort(),
    audiences: Array.from(audiences).sort(),
    matters:   Array.from(matters).sort(),
    priceMin:  Number.isFinite(priceMin) ? priceMin : 0,
    priceMax:  Math.max(priceMax, 50),
  }
}
