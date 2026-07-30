/**
 * `/new` — New Arrivals. Indexable browse surface for products tagged
 * `new-arrival` (set in publishEnrichedProducts, app/lib/import-enrich.server.ts,
 * when the product-import queue publishes a draft to live). These products
 * already surface in category rails and Discover; this page is the dedicated
 * SEO destination for "new products" intent.
 *
 * Not backed by a Shopify Collection object (it's a tag, not a collection),
 * so there's no Sanity collectionPage doc, hero image, or FAQ block here yet
 * — those would be a follow-up if this page needs more editorial dressing.
 * `/products/{slug}` stays the canonical URL for every product; this page is
 * a browse surface only.
 */

import type { LoaderFunctionArgs, MetaDescriptor, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { getProductsByTagPaged } from '~/lib/shopify.server'
import { getDropPage } from '~/lib/category-page.server'
import { CategoryBlockRenderer } from '~/components/category/CategoryBlockRenderer'
import { canonicalUrl, pageTitle, robotsContent, truncateForMeta } from '~/lib/seo'
import { buildSocialMeta, SITE_ORIGIN } from '~/lib/social-meta'
import { VaultCard } from '~/components/store/VaultCard'
import { Breadcrumbs } from '~/components/seo/Breadcrumbs'
import { CollectionStructuredData } from '~/components/seo/CollectionStructuredData'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { FREE_SHIPPING_THRESHOLD } from '~/lib/shipping'

const TAG = 'new-arrival'
const PAGE_SIZE = 24

const H1 = 'New Arrivals'
const SEO_TITLE = 'New Arrivals'
const SEO_DESCRIPTION =
  `The newest picks on xdipx.com, hand-checked before they join Emma's regular rotation. Discreet shipping, ships free over $${FREE_SHIPPING_THRESHOLD}.`
const INTRO =
  "The newest additions to the shelf, hand-checked the same as everything else here. Each one eventually settles into its own category page. This is just where it lands first."

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: pageTitle([SEO_TITLE]) }]
  const { canonical, page, hasProducts } = data

  const titleSuffix = page > 1 ? ` (Page ${page})` : ''
  const finalTitle = pageTitle([`${SEO_TITLE}${titleSuffix}`])
  const finalDescription = truncateForMeta(SEO_DESCRIPTION)

  const tags: MetaDescriptor[] = [
    { title: finalTitle },
    { name: 'description', content: finalDescription },
    { tagName: 'link', rel: 'canonical', href: canonical },
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: 'https://xdipx.com/new.md' },
  ]

  // Ship-of-Theseus content: a page with zero new arrivals is thin content
  // and shouldn't be indexed. `follow` keeps PDP discovery flowing even so.
  if (!hasProducts) {
    tags.push({ name: 'robots', content: robotsContent({ index: false, follow: true }) })
  }

  tags.push(
    ...buildSocialMeta({
      title: finalTitle,
      description: finalDescription,
      url: canonical,
      image: null,
      type: 'website',
      imageAlt: H1,
    }),
  )

  return tags
}

export function headers() {
  // Matches /collections/$handle's cache posture — products only change when
  // Shopify webhooks fire or the import queue publishes a new arrival.
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))

  const [{ deals, hasNextPage }, dropPage] = await Promise.all([
    getProductsByTagPaged(TAG, page, PAGE_SIZE),
    // Merchandised layer (dropPage doc, status live). Canonical page-1 only;
    // null keeps today's rendering byte for byte.
    page === 1 ? getDropPage('new').catch(() => null) : Promise.resolve(null),
  ])
  const hasProducts = deals.length > 0

  // Canonical: page 1 is the bare URL; deeper pages self-canonicalize at
  // ?page=N (each page is its own document, same rule as /collections/$handle).
  const canonical =
    page > 1
      ? canonicalUrl({
          path: '/new',
          searchParams: new URLSearchParams({ page: String(page) }),
          allowedParams: ['page'],
        })
      : canonicalUrl({ path: '/new' })

  return {
    deals,
    hasNextPage,
    page,
    canonical,
    hasProducts,
    dropBlocks: dropPage?.blocks ?? null,
  }
}

/** Blocks that belong above the product grid; everything else (email capture,
    trust strip, FAQ, learn strip) closes the page below it. The newest-product
    page's second beat must be the products, not a form. */
const PRE_GRID_BLOCK_TYPES = new Set(['dropMasthead', 'justLanded', 'dropTimeline'])

export default function NewArrivalsPage() {
  const { deals, hasNextPage, page, canonical, hasProducts, dropBlocks } = useLoaderData<typeof loader>()
  const isCanonicalPage = page === 1
  const merchandised = !!dropBlocks?.length
  const preGridBlocks = dropBlocks?.filter(b => PRE_GRID_BLOCK_TYPES.has(b._type)) ?? []
  const postGridBlocks = dropBlocks?.filter(b => !PRE_GRID_BLOCK_TYPES.has(b._type)) ?? []

  const breadcrumbItems = [
    { name: 'Home', href: '/' },
    { name: H1 },
  ]

  function pageHref(p: number) {
    return p === 1 ? '/new' : `/new?page=${p}`
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <BreadcrumbStructuredData
        items={[
          { name: 'Home', url: `${SITE_ORIGIN}/` },
          { name: H1, url: canonical },
        ]}
      />
      {/* ItemList only on the canonical page 1 with a populated shelf — an
          empty or deeper-page ItemList either fails Google's validator or
          misrepresents the page as a full-catalog document. */}
      {isCanonicalPage && hasProducts && (
        <CollectionStructuredData
          name={H1}
          description={SEO_DESCRIPTION}
          url={canonical}
          items={deals.map(d => ({
            handle: d.handle,
            title: d.seoTitle,
            image: d.images[0]?.url ?? null,
            price: d.dealPrice,
            currency: 'USD',
            availability: d.qty > 0 ? 'InStock' : 'OutOfStock',
            brand: d.brand ?? null,
          }))}
        />
      )}

      <Breadcrumbs items={breadcrumbItems} className="mb-4" />

      {/* The drop masthead carries the H1 when the merchandised layer is
          live; rendering both would put two h1 elements on the page. */}
      {merchandised ? (
        <div className="mb-8">
          <CategoryBlockRenderer blocks={preGridBlocks} />
        </div>
      ) : (
        <header className="mb-6">
          <p className="kicker text-coral mb-2">Just added</p>
          <h1 className="text-3xl md:text-4xl font-bold text-ink font-display">
            {H1}{page > 1 ? ` (Page ${page})` : ''}
          </h1>
          {isCanonicalPage && (
            <p className="mt-3 max-w-2xl text-ink-3">{INTRO}</p>
          )}
        </header>
      )}

      {/* The grid gets a name of its own on the merchandised page — every set
          on the aisle pages is labeled, and an unlabeled wall of product reads
          unfinished next to them. */}
      {merchandised && hasProducts && (
        <header className="mb-6">
          <p className="kicker mb-2 text-ink-4">Just landed</p>
          <h2
            className="text-[1.6rem] leading-[1.15] tracking-[-0.01em] text-ink md:text-[2.1rem]"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 450 }}
          >
            The newest picks on the shelf.
          </h2>
        </header>
      )}

      {hasProducts ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {deals.map(deal => (
            <VaultCard key={deal.id} deal={deal} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <p className="text-ink-3 text-lg mb-4">
            Nothing new on the shelf right this moment.
          </p>
          <Link
            to="/collections"
            className="inline-block px-6 py-2.5 rounded-full bg-coral text-paper text-sm font-semibold font-display"
          >
            Browse collections
          </Link>
        </div>
      )}

      <nav aria-label="Pagination" className="flex justify-center gap-4 mt-10">
        {page > 1 && (
          <Link
            to={pageHref(page - 1)}
            rel="prev"
            className="px-5 py-2 rounded-full border border-line text-ink/70 hover:bg-paper-2 transition-colors text-sm"
          >
            &larr; Previous
          </Link>
        )}
        {hasNextPage && (
          <Link
            to={pageHref(page + 1)}
            rel="next"
            className="px-5 py-2 rounded-full bg-coral text-paper text-sm font-semibold hover:opacity-90 transition-opacity font-display"
          >
            Next page &rarr;
          </Link>
        )}
      </nav>

      {/* Closers (email capture, trust, FAQ) belong after the products. */}
      {merchandised && postGridBlocks.length > 0 && (
        <div className="mt-12">
          <CategoryBlockRenderer blocks={postGridBlocks} />
        </div>
      )}
    </div>
  )
}
