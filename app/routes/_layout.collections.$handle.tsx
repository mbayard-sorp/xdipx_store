import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { getCollectionDeals } from '~/lib/shopify.server'
import { VaultCard } from '~/components/store/VaultCard'

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = data?.title ?? 'Collection'
  return [
    { title: `${title} | xdipx` },
    { name: 'description', content: `Shop ${title.toLowerCase()} at xdipx — curated daily deals on intimate wellness products.` },
  ]
}

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
  }
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const handle = params.handle!
  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') ?? '1')

  const { deals, hasNextPage } = await getCollectionDeals(handle, page, 24)

  // Build a readable title from the handle
  const title = handle
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  return { deals, hasNextPage, page, handle, title }
}

export default function CollectionPage() {
  const { deals, hasNextPage, page, handle, title } = useLoaderData<typeof loader>()

  function pageHref(p: number) {
    return p === 1 ? `/collections/${handle}` : `/collections/${handle}?page=${p}`
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1
          className="text-3xl font-bold text-brand-charcoal"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h1>
      </div>

      {deals.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {deals.map(deal => (
            <VaultCard key={deal.id} deal={deal} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <p className="text-brand-charcoal/40 text-lg mb-4">No products in this collection yet.</p>
          <Link
            to="/"
            className="inline-block px-6 py-2.5 rounded-full bg-brand-gradient text-white text-sm font-semibold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Check today's deal
          </Link>
        </div>
      )}

      {/* Pagination */}
      <div className="flex justify-center gap-4 mt-10">
        {page > 1 && (
          <Link
            to={pageHref(page - 1)}
            className="px-5 py-2 rounded-full border border-brand-mist text-brand-charcoal/70 hover:bg-brand-mist transition-colors text-sm"
          >
            &larr; Previous
          </Link>
        )}
        {hasNextPage && (
          <Link
            to={pageHref(page + 1)}
            className="px-5 py-2 rounded-full bg-brand-gradient text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Next page &rarr;
          </Link>
        )}
      </div>
    </div>
  )
}
