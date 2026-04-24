import { useMemo } from 'react'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useSearchParams, Link } from 'react-router'
import { getCollectionDeals } from '~/lib/shopify.server'
import { getEmmaPresets } from '~/lib/sanity.server'
import { VaultCard } from '~/components/store/VaultCard'
import { AskEmmaRail, matchesAskEmmaFilters } from '~/components/store/AskEmmaRail'

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = data?.title ?? 'Collection'
  return [
    { title: `${title} | xdipx` },
    { name: 'description', content: `Shop ${title.toLowerCase()} at xdipx — curated picks on intimate wellness products.` },
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

  const [{ deals, hasNextPage }, presets] = await Promise.all([
    getCollectionDeals(handle, page, 24),
    getEmmaPresets(),
  ])

  const title = handle
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  return { deals, hasNextPage, page, handle, title, presets }
}

export default function CollectionPage() {
  const { deals, hasNextPage, page, handle, title, presets } = useLoaderData<typeof loader>()
  const [params] = useSearchParams()

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

  const { moods, audiences, matters, priceMin, priceMax } = useMemo(
    () => deriveFacets(deals.map(d => ({
      ...(d.moodTags     ? { moodTags:     d.moodTags     } : {}),
      ...(d.audienceTags ? { audienceTags: d.audienceTags } : {}),
      ...(d.mattersTags  ? { mattersTags:  d.mattersTags  } : {}),
      price: d.dealPrice,
    }))),
    [deals],
  )

  function pageHref(p: number) {
    const q = new URLSearchParams(params)
    if (p === 1) q.delete('page')
    else q.set('page', String(p))
    const suffix = q.toString()
    return suffix ? `/collections/${handle}?${suffix}` : `/collections/${handle}`
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1
          className="text-3xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h1>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        <AskEmmaRail
          availableMoods={moods}
          availableAudiences={audiences}
          availableMatters={matters}
          priceMin={priceMin}
          priceMax={priceMax}
          presets={presets}
        />

        <div className="flex-1 min-w-0">
          {filtered.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {filtered.map(deal => (
                <VaultCard key={deal.id} deal={deal} />
              ))}
            </div>
          ) : deals.length > 0 ? (
            <div className="text-center py-20">
              <p className="text-ink/60 text-sm mb-3">Nothing matches those filters in {title}.</p>
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

          <div className="flex justify-center gap-4 mt-10">
            {page > 1 && (
              <Link
                to={pageHref(page - 1)}
                className="px-5 py-2 rounded-full border border-line text-ink/70 hover:bg-cream-2 transition-colors text-sm"
              >
                &larr; Previous
              </Link>
            )}
            {hasNextPage && (
              <Link
                to={pageHref(page + 1)}
                className="px-5 py-2 rounded-full bg-coral text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Next page &rarr;
              </Link>
            )}
          </div>
        </div>
      </div>
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
