import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { getVaultDeals } from '~/lib/shopify.server'
import { VaultCard }     from '~/components/store/VaultCard'

export const meta: MetaFunction = () => [
  { title: 'The Vault — Past Deals | xdipx' },
  { name: 'description', content: 'Browse every xdipx deal — missed one? It might be back in stock.' },
  { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/vault' },
]

export async function loader({ request }: LoaderFunctionArgs) {
  const url  = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') ?? '1')
  const { deals, hasNextPage } = await getVaultDeals(page, 20)
  return { deals, hasNextPage, page }
}

const FILTER_TABS = ['All', 'For Him', 'For Her', 'Couples', 'Under $25', 'Under $50'] as const
type FilterTab = typeof FILTER_TABS[number]

export default function VaultPage() {
  const { deals, hasNextPage, page } = useLoaderData<typeof loader>()

  // Client-side filter on loader data
  function filterDeals(tab: FilterTab) {
    if (tab === 'All')      return deals
    if (tab === 'For Him')  return deals.filter(d => d.category === 'for-him')
    if (tab === 'For Her')  return deals.filter(d => d.category === 'for-her')
    if (tab === 'Couples')  return deals.filter(d => d.category === 'couples')
    if (tab === 'Under $25') return deals.filter(d => d.dealPrice < 25)
    if (tab === 'Under $50') return deals.filter(d => d.dealPrice < 50)
    return deals
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1
          className="text-3xl font-bold text-brand-charcoal"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          The Vault ♥
        </h1>
        <p className="text-brand-charcoal/60 mt-1">Every deal we've ever run. Some still available.</p>
      </div>

      {/* Filter tabs — client-side */}
      <VaultGrid deals={deals} filterDeals={filterDeals} />

      {/* Pagination */}
      <div className="flex justify-center gap-4 mt-10">
        {page > 1 && (
          <a
            href={`/vault?page=${page - 1}`}
            className="px-5 py-2 rounded-full border border-brand-mist text-brand-charcoal/70 hover:bg-brand-mist transition-colors text-sm"
          >
            ← Previous
          </a>
        )}
        {hasNextPage && (
          <a
            href={`/vault?page=${page + 1}`}
            className="px-5 py-2 rounded-full bg-brand-gradient text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Next page →
          </a>
        )}
      </div>
    </div>
  )
}

// Client component for filter tabs + grid
import { useState } from 'react'
import type { VaultDeal } from '~/types'

function VaultGrid({
  deals,
  filterDeals,
}: {
  deals: VaultDeal[]
  filterDeals: (tab: FilterTab) => VaultDeal[]
}) {
  const [activeTab, setActiveTab] = useState<FilterTab>('All')
  const filtered = filterDeals(activeTab)

  return (
    <>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-6 pb-1">
        {FILTER_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all',
              activeTab === tab
                ? 'bg-brand-gradient text-white'
                : 'bg-white border border-brand-mist text-brand-charcoal/70 hover:border-brand-purple/30',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>

      {filtered.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {filtered.map(deal => (
            <VaultCard key={deal.id} deal={deal} />
          ))}
        </div>
      ) : (
        <p className="text-center text-brand-charcoal/40 py-16">No deals match this filter.</p>
      )}
    </>
  )
}
