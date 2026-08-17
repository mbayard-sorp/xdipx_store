import { useEffect, useMemo, useRef, useState } from 'react'
import type { LoaderFunctionArgs, MetaDescriptor, MetaFunction } from 'react-router'
import { useLoaderData, useSearchParams, Link } from 'react-router'
import { getCollection, getCollectionDeals, getMainMenu, type CollectionSort } from '~/lib/shopify.server'
import { getCollectionPage, getEmmaPresets, getBlogPosts, getNotebookPostsForProductHandles } from '~/lib/sanity.server'
import { getCategoryPage, getDropPage } from '~/lib/category-page.server'
import { CategoryBlockRenderer } from '~/components/category/CategoryBlockRenderer'
import { canonicalUrl, pageTitle, robotsContent, truncateForMeta } from '~/lib/seo'
import { COLLECTION_CANONICAL_ALIASES } from '~/lib/collection-canonical-aliases'
import { buildSocialMeta, SITE_ORIGIN } from '~/lib/social-meta'
import { VaultCard } from '~/components/store/VaultCard'
import { AskEmmaRail, matchesAskEmmaFilters } from '~/components/store/AskEmmaRail'
import { EmmaDiscoveryRail } from '~/components/store/EmmaDiscoveryRail'
import { EmmaEncouragementStrip } from '~/components/store/EmmaEncouragementStrip'
import { LetMeLookAgainCTA } from '~/components/store/LetMeLookAgainCTA'
import { trackViewItemList, trackSelectItem, type GA4Item } from '~/lib/analytics.client'
import { Breadcrumbs } from '~/components/seo/Breadcrumbs'
import { CollectionStructuredData } from '~/components/seo/CollectionStructuredData'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { FAQStructuredData } from '~/components/seo/FAQStructuredData'
import { readRecentHandles } from '~/lib/recent-views.server'
import { NotebookRail } from '~/components/blog/NotebookRail'
import { TrustStrip } from '~/components/store/TrustStrip'
import { FREE_SHIPPING_THRESHOLD } from '~/lib/shipping'

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
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: `https://xdipx.com/collections/${data.handle}.md` },
  ]

  // Non-canonical variants get `noindex, follow`. Filters AND non-default
  // sort orders both qualify — canonical points at the bare URL either way,
  // but the meta tag stops Google wasting crawl budget on N×4 sort variants
  // and consolidates link equity. `follow` keeps PDP discovery intact.
  if ((data as { nonCanonicalVariant?: boolean }).nonCanonicalVariant ?? filtersApplied) {
    tags.push({ name: 'robots', content: robotsContent({ index: false, follow: true }) })
  }

  // Suppress the hero preload on page > 1 — the deeper page no longer
  // renders the hero image (P1 #7), so preloading it just wastes bytes.
  if (heroPreload && page === 1) tags.push(heroPreload)

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
  // PLPs are content-stable — products only change when Shopify webhooks fire
  // (handled by route revalidation) or when an editor updates the Sanity
  // collectionPage doc. 10-min CDN with 1-hour SWR keeps LCP fast on cold
  // hits without staling content meaningfully.
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
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
  // Sort variants are also non-canonical (canonical points at the bare URL).
  // Treat them like filters for indexing purposes — see meta() above.
  const nonCanonicalVariant = filtersApplied || sort !== 'manual'

  const [collection, sanity, { deals, hasNextPage }, presets, menu, notebook, categoryPage] = await Promise.all([
    getCollection(handle),
    getCollectionPage(handle),
    getCollectionDeals(handle, page, PAGE_SIZE, sort),
    getEmmaPresets(),
    getMainMenu(),
    // Notebook rail — only loaded for page 1 (it's hidden on deeper pages
    // per the duplicate-content suppression rules).
    page === 1
      ? getBlogPosts({ perPage: 3 }).catch(() => ({ posts: [], total: 0 }))
      : Promise.resolve({ posts: [], total: 0 }),
    // Merchandised layer, canonical page-1 only; deeper pages and sort/filter
    // variants keep the plain grid. Null = no doc = today's rendering, byte
    // for byte. Sale is a merchandising moment rather than an aisle (owner
    // decision 2026-07-29), so on-sale reads the dropPage doc; the block
    // union and renderer are shared either way.
    page !== 1
      ? Promise.resolve(null)
      : handle === 'on-sale'
        ? getDropPage('on-sale').catch(() => null)
        : getCategoryPage(handle).catch(() => null),
  ])

  // 404 — no Shopify collection at this handle.
  if (!collection) {
    throw new Response('Collection not found', { status: 404 })
  }

  // Notebook rail relevance: prefer posts that feature a product from this
  // collection (reverse lookup on blogProductEmbed.productHandle), falling back
  // to the latest posts fetched above so a valid collection is never left with
  // an empty rail. Page-1 only, matching the notebook fetch above.
  let notebookPosts = notebook.posts
  if (page === 1) {
    const collectionHandles = deals.map(d => d.handle).filter(Boolean)
    const relevant = await getNotebookPostsForProductHandles(collectionHandles, 4)
    if (relevant.length > 0) notebookPosts = relevant
  }

  // Resolve display + SEO with Sanity > Shopify SEO > Shopify title fallback.
  // Title fallbacks use the live productsCount when available so each
  // collection has a unique, keyword-led title — Google's title rewriter
  // is far less likely to overwrite "Wand Vibrators — Shop 24 Picks" than
  // it is the previous "{X} — Editorially curated picks" boilerplate.
  const fallbackTitle = collection.title || titleCase(handle)
  const lcTitle = fallbackTitle.toLowerCase()
  const productsCount = collection.productsCount ?? 0
  const titleFallback = productsCount > 0
    ? `${fallbackTitle} — Shop ${productsCount} Curated Picks`
    : `${fallbackTitle} — Curated Picks`
  const descriptionFallback = productsCount > 0
    ? `Shop ${productsCount} hand-picked ${lcTitle} at xdipx. Emma's editorial picks on intimate-wellness products. Discreet shipping, US ships free over $${FREE_SHIPPING_THRESHOLD}.`
    : `Shop ${lcTitle} at xdipx. Emma's editorial picks on intimate-wellness products. Discreet shipping, US ships free over $${FREE_SHIPPING_THRESHOLD}.`

  const h1 = sanity?.h1 || fallbackTitle
  const seoTitle =
    sanity?.seoTitle
    || collection.seoTitle
    || titleFallback
  const seoDescription =
    sanity?.seoDescription
    || collection.seoDescription
    || collection.description
    || descriptionFallback

  const introHtml = sanity?.introHtml || (collection.descriptionHtml || null)

  const heroImageUrl = sanity?.heroImageUrl || collection.image?.url || null
  const heroImageAlt = sanity?.heroImageAlt || collection.image?.altText || h1

  // Canonical strategy:
  //  - Aliased handle: this collection is a near-duplicate of another browse
  //    surface (e.g. just-dropped → /new). Every page/variant canonicalizes to
  //    that surface so Google indexes one page, not a duplicate pair. The URL
  //    keeps working — only the canonical points away.
  //  - Page > 1: self-canonical at ?page=N (each page is its own document).
  //  - Page 1, with sort: canonical to the bare /collections/$handle (sort is
  //    a faceting param, not a new document).
  //  - Filters applied: canonical still points to the bare URL — combined
  //    with `noindex,follow` above this consolidates faceted variants.
  const canonicalAlias = COLLECTION_CANONICAL_ALIASES[handle]
  const canonical = canonicalAlias
    ? canonicalUrl({ path: canonicalAlias })
    : page > 1
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
    nonCanonicalVariant,
    sort,
    presets,
    recentViews,
    faqs: sanity?.faqs ?? [],
    relatedCollections,
    categoryBlocks: categoryPage?.blocks ?? null,
    productsCount: collection.productsCount,
    notebookPosts,
  }
}

function toCollectionGA4Item(
  deal: { handle: string; seoTitle: string; brand?: string | null; dealPrice: number },
  index: number,
): GA4Item {
  return {
    item_id: deal.handle,
    item_name: deal.seoTitle,
    ...(deal.brand ? { item_brand: deal.brand } : {}),
    price: deal.dealPrice,
    index,
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
    categoryBlocks,
    filtersApplied,
    productsCount,
    notebookPosts,
  } = useLoaderData<typeof loader>()
  // Page 1 is the canonical document — render the full editorial frame
  // (hero, intro, FAQs, notebook rail). Pages > 1 are pagination-only and
  // strip those sections to avoid near-duplicate-content signals.
  const isCanonicalPage = page === 1
  // Merchandised frame: present only when a live categoryPage doc resolved
  // (the loader already restricts that to page 1).
  const merchandised = !!categoryBlocks?.length
  const merchandisedFaq = merchandised
    ? (categoryBlocks!.find(b => b._type === 'faqBlock') ?? null)
    : null
  const [params, setParams] = useSearchParams()

  // GA4: this route sold products with zero analytics while it was a plain
  // grid. Now it is the panel deck's landing surface, so the middle hop gets
  // measured: one view_item_list per page view, select_item per card click.
  // The ref dedupes StrictMode double-effects and client-side param churn.
  const listId = `collection:${handle}`
  const firedListKey = useRef('')
  useEffect(() => {
    const key = `${handle}:${page}`
    if (firedListKey.current === key || deals.length === 0) return
    firedListKey.current = key
    trackViewItemList(listId, listId, deals.slice(0, 24).map((d, i) => toCollectionGA4Item(d, i)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, page])
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
      {/* Structured data — emit before paint. Skip ItemList entirely on
          filtered/non-canonical variants and on empty collections; an empty
          ItemList is invalid per Google's rich-results validator and a
          filter-narrowed list misrepresents the collection. */}
      <BreadcrumbStructuredData items={breadcrumbSchema} />
      {isCanonicalPage && !filtersApplied && deals.length > 0 && (
        <CollectionStructuredData
          name={h1}
          description={seoDescription}
          url={canonical}
          numberOfItems={productsCount ?? deals.length}
          items={deals.map(d => ({
            handle: d.handle,
            title:  d.seoTitle,
            image:  d.images[0]?.url ?? null,
            price:  d.dealPrice,
            currency: 'USD',
            availability: d.qty > 0 ? 'InStock' : 'OutOfStock',
            brand:  d.brand ?? null,
          }))}
        />
      )}
      {/* One FAQPage node per document: the merchandised faqBlock wins over
          the collectionPage faqs, never both. */}
      {isCanonicalPage && !merchandisedFaq && faqs.length > 0 && <FAQStructuredData faqs={faqs} />}
      {isCanonicalPage && merchandisedFaq && merchandisedFaq._type === 'faqBlock' && (
        <FAQStructuredData faqs={merchandisedFaq.items} />
      )}

      <Breadcrumbs items={breadcrumbItems} className="mb-4" />

      {merchandised && categoryBlocks ? (
        <div className="mb-8">
          {/* Sale is a merchandising moment with a quiet mandate: its
              dropMasthead renders on paper, not the tinted band New uses. */}
          <CategoryBlockRenderer
            blocks={categoryBlocks}
            dropTone={handle === 'on-sale' ? 'quiet' : 'tinted'}
          />
        </div>
      ) : null}

      {isCanonicalPage && !merchandised && heroImageUrl && (
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

      {/* The merchandised masthead carries the H1; rendering both would put
          two h1 elements on the page. */}
      {!merchandised && (
        <header className="mb-6">
          <h1
            className="text-3xl md:text-4xl font-bold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {h1}{page > 1 ? ` — Page ${page}` : ''}
          </h1>
        </header>
      )}

      {/* Trust content hoisted directly under the masthead (ticket #3424):
          plain packaging, the XDIPX billing descriptor, and the shipping
          promise previously rendered below ~74% page depth, invisible to a
          cold paid click. Same shared strip the storefront hero band uses. */}
      <TrustStrip variant="card" className="mb-8" />

      <div className="flex flex-col md:flex-row gap-8">
        {/* The Emma rails are short; in a stretched flex row they left the left
            third empty for a full screen beside a tall product grid (design-critic
            spot check, 2026-07-29). Pinning the column sticky and capping it to the
            viewport keeps Emma present as the grid scrolls instead of a dead
            column. Desktop-only: the mobile stack is untouched. */}
        <div className="flex flex-col gap-4 md:w-[260px] md:shrink-0 md:self-start md:sticky md:top-4 md:max-h-[calc(100dvh-2rem)] md:overflow-y-auto">
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
            relatedCategories={relatedCollections}
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
              {filtered.map((deal, i) => (
                <div
                  key={deal.id}
                  onClickCapture={() => trackSelectItem(listId, listId, toCollectionGA4Item(deal, i), i)}
                >
                  <VaultCard
                    deal={deal}
                    quiet={handle === 'on-sale'}
                    {...(starred[deal.handle] ? { starred: { reason: starred[deal.handle]! } } : {})}
                  />
                </div>
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

      {/* Notebook section renders only on page 1 to keep deeper paginated
          pages clearly secondary documents. Posts featuring a product from this
          collection are preferred, falling back to the latest posts. */}
      {isCanonicalPage && <NotebookRail posts={notebookPosts} />}

      {/* Side-by-side info boxes (description + FAQ accordion) — page 1 only.
          Both blocks live in the SSR'd DOM so Google reads everything; the
          "more" toggle is a CSS class swap, and the FAQ uses native <details>
          which keeps every answer in DOM regardless of open state. */}
      {/* The merchandised blocks carry their own editorial layer and FAQ
          accordion; doubling the collectionPage boxes under them would repeat
          the same content on one page. */}
      {isCanonicalPage && !merchandised && (introHtml || faqs.length > 0) && (
        <div className="mt-16">
          <CollectionInfoBoxes introHtml={introHtml} faqs={faqs} />
        </div>
      )}
    </div>
  )
}

// PDP-style two-box editorial header: description on the left (with a
// CSS-clamp + "more" toggle so all copy stays in the SSR DOM for Google),
// FAQ accordion on the right (native <details>, every answer in DOM).
function CollectionInfoBoxes({
  introHtml,
  faqs,
}: {
  introHtml: string | null
  faqs: Array<{ question: string; answer: string }>
}) {
  const [expanded, setExpanded] = useState(false)
  const [needsExpand, setNeedsExpand] = useState(false)
  const introRef = useRef<HTMLDivElement>(null)

  // Measure once after first paint to decide whether the "more" toggle is
  // worth showing. Re-runs if the intro HTML changes.
  useEffect(() => {
    const el = introRef.current
    if (!el) return
    setNeedsExpand(el.scrollHeight > el.clientHeight + 1)
  }, [introHtml])

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
      {introHtml && (
        <section
          aria-labelledby="collection-info-heading"
          className="rounded-2xl border border-line bg-paper p-5"
        >
          <h2
            id="collection-info-heading"
            className="text-xs font-bold text-coral uppercase tracking-wider mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            On this shelf
          </h2>
          <div
            ref={introRef}
            className={`prose prose-sm max-w-none text-ink/80 transition-[max-height] ${expanded ? '' : 'line-clamp-[6]'}`}
            dangerouslySetInnerHTML={{ __html: introHtml }}
          />
          {needsExpand && (
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="mt-3 text-sm font-semibold text-coral hover:opacity-80 transition-opacity"
              aria-expanded={expanded}
            >
              {expanded ? 'close' : 'more...'}
            </button>
          )}
        </section>
      )}

      {faqs.length > 0 && (
        <section
          aria-labelledby="collection-faq-heading"
          className="rounded-2xl border border-line bg-paper p-5"
        >
          <h2
            id="collection-faq-heading"
            className="text-xs font-bold text-coral uppercase tracking-wider mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            FAQs / Q&amp;A
          </h2>
          <ul className="divide-y divide-line">
            {faqs.map((faq, i) => (
              <li key={i}>
                <details className="group">
                  <summary className="flex items-start gap-2 py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <span
                      aria-hidden="true"
                      className="text-coral text-xs mt-1 transition-transform group-open:rotate-90 shrink-0"
                    >
                      ▶
                    </span>
                    <h3 className="font-semibold text-ink text-sm flex-1 m-0">
                      {faq.question}
                    </h3>
                  </summary>
                  <p className="pb-3 pl-5 text-ink/80 text-sm leading-relaxed whitespace-pre-line">
                    {faq.answer}
                  </p>
                </details>
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
