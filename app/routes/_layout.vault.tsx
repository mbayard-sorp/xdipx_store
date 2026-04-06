import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { getVaultDeals, getCollectionDeals } from '~/lib/shopify.server'
import { getVaultFilterTabs } from '~/lib/kv.server'
import { VaultCard } from '~/components/store/VaultCard'

export const meta: MetaFunction = () => [
  { title: 'The Vault — Past Deals | xdipx' },
  { name: 'description', content: 'Browse every xdipx deal — missed one? It might be back in stock.' },
  { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/vault' },
]

export async function loader({ request }: LoaderFunctionArgs) {
  const url     = new URL(request.url)
  const page    = parseInt(url.searchParams.get('page') ?? '1')
  const tabSlug = url.searchParams.get('tab') ?? 'all'

  const tabs      = await getVaultFilterTabs()
  const activeTab = tabs.find(t => t.slug === tabSlug) ?? tabs[0]!

  let deals: Awaited<ReturnType<typeof getVaultDeals>>['deals']
  let hasNextPage: boolean

  if (activeTab.filter.type === 'collection') {
    const result = await getCollectionDeals(activeTab.filter.handle, page, 20)
    deals       = result.deals
    hasNextPage  = result.hasNextPage
  } else {
    const result = await getVaultDeals(page, 20)
    deals       = result.deals
    hasNextPage  = result.hasNextPage
    if (activeTab.filter.type === 'price') {
      const max = activeTab.filter.max
      deals = deals.filter(d => d.dealPrice < max)
    }
  }

  return { deals, hasNextPage, page, tabs, activeTabId: activeTab.id, activeTabSlug: activeTab.slug }
}

export default function VaultPage() {
  const { deals, hasNextPage, page, tabs, activeTabId, activeTabSlug } = useLoaderData<typeof loader>()

  function tabHref(slug: string) {
    return slug === 'all' ? '/vault' : `/vault?tab=${slug}`
  }

  function pageHref(p: number) {
    const base = activeTabSlug === 'all' ? '/vault' : `/vault?tab=${activeTabSlug}`
    return p === 1 ? base : `${base}${activeTabSlug === 'all' ? '?' : '&'}page=${p}`
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

      {/* Filter tabs — URL-driven, linkable */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-6 pb-1">
        {tabs.map(tab => (
          <Link
            key={tab.id}
            to={tabHref(tab.slug)}
            className={[
              'shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all',
              activeTabId === tab.id
                ? 'bg-brand-gradient text-white'
                : 'bg-white border border-brand-mist text-brand-charcoal/70 hover:border-brand-purple/30',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {deals.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {deals.map(deal => (
            <VaultCard key={deal.id} deal={deal} />
          ))}
        </div>
      ) : (
        <p className="text-center text-brand-charcoal/40 py-16">No deals match this filter.</p>
      )}

      {/* Pagination */}
      <div className="flex justify-center gap-4 mt-10">
        {page > 1 && (
          <Link
            to={pageHref(page - 1)}
            className="px-5 py-2 rounded-full border border-brand-mist text-brand-charcoal/70 hover:bg-brand-mist transition-colors text-sm"
          >
            ← Previous
          </Link>
        )}
        {hasNextPage && (
          <Link
            to={pageHref(page + 1)}
            className="px-5 py-2 rounded-full bg-brand-gradient text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Next page →
          </Link>
        )}
      </div>
    </div>
  )
}

