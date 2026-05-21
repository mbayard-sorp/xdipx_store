import { useEffect } from 'react'
import type { LoaderFunctionArgs, MetaFunction, MetaDescriptor } from 'react-router'
import { useLoaderData, Link } from 'react-router'
import { getVaultDeals, getCollectionDeals } from '~/lib/shopify.server'
import { getVaultFilterTabs } from '~/lib/kv.server'
import { VaultCard } from '~/components/store/VaultCard'
import { trackVaultBrowse, trackViewItemList } from '~/lib/analytics.client'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { canonicalUrl, robotsContent } from '~/lib/seo'
import { buildSocialMeta } from '~/lib/social-meta'

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url     = new URL(request.url)
  const page    = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
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

  // Canonical / index strategy:
  //  - `?tab=` (anything other than the default 'all' tab) is a faceted view
  //    of /vault → bare canonical + `noindex,follow` so we don't compete with
  //    the parent vault page for indexation.
  //  - `?page=N` on the default tab is its own document → self-canonical.
  //  - `?tab=X&page=N` is already non-canonical via the tab rule.
  const tabApplied = activeTab.slug !== 'all'
  const canonical = !tabApplied && page > 1
    ? canonicalUrl({
        path: '/vault',
        searchParams: new URLSearchParams({ page: String(page) }),
        allowedParams: ['page'],
      })
    : canonicalUrl({ path: '/vault' })

  return {
    deals, hasNextPage, page, tabs,
    activeTabId: activeTab.id,
    activeTabSlug: activeTab.slug,
    activeTabLabel: activeTab.label,
    canonical, tabApplied,
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) {
    return [
      { title: 'The Shelf — Previous Picks | xdipx' },
      { name: 'description', content: "The shelf — every pick Emma's featured. Some still available." },
      { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/vault' },
    ]
  }

  const tabSuffix  = data.tabApplied ? ` — ${data.activeTabLabel}` : ''
  const pageSuffix = data.page > 1 ? ` — Page ${data.page}` : ''
  const title       = `The Shelf${tabSuffix}${pageSuffix} | xdipx`
  const description = "The shelf — every pick Emma's featured. Some still available."

  const tags: MetaDescriptor[] = [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: data.canonical },
    ...buildSocialMeta({ title, description, url: data.canonical, image: null, type: 'website' }),
  ]

  if (data.tabApplied) {
    tags.push({ name: 'robots', content: robotsContent({ index: false, follow: true }) })
  }

  // rel=prev/next for the indexable, default-tab pagination chain. Tab-filtered
  // variants are noindex, so their pagination doesn't need the hint.
  if (!data.tabApplied) {
    const base = 'https://xdipx.com/vault'
    if (data.page > 1) {
      const prevHref = data.page - 1 === 1 ? base : `${base}?page=${data.page - 1}`
      tags.push({ tagName: 'link', rel: 'prev', href: prevHref })
    }
    if (data.hasNextPage) {
      tags.push({ tagName: 'link', rel: 'next', href: `${base}?page=${data.page + 1}` })
    }
  }

  return tags
}

export default function VaultPage() {
  const { deals, hasNextPage, page, tabs, activeTabId, activeTabSlug } = useLoaderData<typeof loader>()

  // ── GA4: vault_browse + view_item_list ────────────────────────────────
  useEffect(() => {
    trackVaultBrowse(activeTabSlug, page)
    if (deals.length > 0) {
      trackViewItemList('vault', 'The Vault', deals.map((d, i) => ({
        item_id: d.id, item_name: d.seoTitle, item_brand: d.brand, price: d.dealPrice, index: i,
      })))
    }
  }, [activeTabSlug, page])

  function tabHref(slug: string) {
    return slug === 'all' ? '/vault' : `/vault?tab=${slug}`
  }

  function pageHref(p: number) {
    const base = activeTabSlug === 'all' ? '/vault' : `/vault?tab=${activeTabSlug}`
    return p === 1 ? base : `${base}${activeTabSlug === 'all' ? '?' : '&'}page=${p}`
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <BreadcrumbStructuredData items={[
        { name: 'Home',  url: 'https://xdipx.com/' },
        { name: 'Vault', url: 'https://xdipx.com/vault' },
      ]} />
      <div className="mb-8">
        <h1
          className="text-3xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          The shelf · previous picks ♥
        </h1>
        <p className="text-ink/60 mt-1">Every pick Emma's featured. Some still available.</p>
      </div>

      {/* Filter tabs — URL-driven, linkable */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-6 pb-1">
        {tabs.map(tab => (
          <Link
            key={tab.id}
            to={tabHref(tab.slug)}
            prefetch="intent"
            className={[
              'shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all',
              activeTabId === tab.id
                ? 'bg-coral text-white'
                : 'bg-white border border-cream-2 text-ink/70 hover:border-sage/30',
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
        <p className="text-center text-ink/40 py-16">No deals match this filter.</p>
      )}

      {/* Pagination */}
      <div className="flex justify-center gap-4 mt-10">
        {page > 1 && (
          <Link
            to={pageHref(page - 1)}
            prefetch="render"
            className="px-5 py-2 rounded-full border border-cream-2 text-ink/70 hover:bg-cream-2 transition-colors text-sm"
          >
            ← Previous
          </Link>
        )}
        {hasNextPage && (
          <Link
            to={pageHref(page + 1)}
            prefetch="render"
            className="px-5 py-2 rounded-full bg-coral text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Next page →
          </Link>
        )}
      </div>
    </div>
  )
}

