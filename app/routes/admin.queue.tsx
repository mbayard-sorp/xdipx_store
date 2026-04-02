import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher, useSearchParams } from 'react-router'
import { db }           from '~/lib/db.server'
import { dealHistory }  from '../../db/schema'
import { generateSchedule } from '~/lib/claude.server'
import { dailyFeedProcessor } from '~/lib/feed-processor.server'
import { setDealStatus, activateShopifyProduct } from '~/lib/shopify.server'
import { eq, and } from 'drizzle-orm'

export const meta: MetaFunction = () => [{ title: 'Deal Queue — xdipx Admin' }]

export async function loader(_: LoaderFunctionArgs) {
  const deals = await db
    .select()
    .from(dealHistory)
    .orderBy(dealHistory.dealDate)
    .limit(200)
  return { deals }
}

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent')

  if (intent === 'run-feed') {
    const result = await dailyFeedProcessor()
    return { ok: true, candidates: result.topCandidates.length }
  }

  if (intent === 'approve') {
    const id               = parseInt(form.get('id') as string)
    const shopifyProductId = form.get('shopifyProductId') as string | null
    await db.update(dealHistory).set({ status: 'approved' }).where(eq(dealHistory.id, id))
    if (shopifyProductId) {
      await activateShopifyProduct(shopifyProductId)
      await setDealStatus(shopifyProductId, 'approved')
    }
    return { ok: true }
  }

  if (intent === 'unapprove') {
    const id = parseInt(form.get('id') as string)
    await db.update(dealHistory).set({ status: 'pending' }).where(eq(dealHistory.id, id))
    return { ok: true }
  }

  if (intent === 'delete') {
    const id = parseInt(form.get('id') as string)
    await db.delete(dealHistory).where(eq(dealHistory.id, id))
    return { ok: true }
  }

  if (intent === 'force-live') {
    const id               = parseInt(form.get('id') as string)
    const shopifyProductId = form.get('shopifyProductId') as string
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

    // Archive whatever is currently live
    const [liveNow] = await db
      .select()
      .from(dealHistory)
      .where(and(eq(dealHistory.status, 'live')))
      .limit(1)
    if (liveNow?.shopifyProductId && liveNow.id !== id) {
      await setDealStatus(liveNow.shopifyProductId, 'archived')
      await db
        .update(dealHistory)
        .set({ status: 'archived', archivedAt: new Date() })
        .where(eq(dealHistory.id, liveNow.id))
    }

    // Ensure product is active (pipeline creates as draft)
    await activateShopifyProduct(shopifyProductId)
    // Make this deal live and stamp today's date
    await setDealStatus(shopifyProductId, 'live')
    await db
      .update(dealHistory)
      .set({ status: 'live', activatedAt: new Date(), dealDate: today })
      .where(eq(dealHistory.id, id))
    return { ok: true }
  }

  if (intent === 'simulate-rotation') {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

    // Archive current live deal
    const [liveNow] = await db
      .select()
      .from(dealHistory)
      .where(eq(dealHistory.status, 'live'))
      .limit(1)
    if (liveNow?.shopifyProductId) {
      await setDealStatus(liveNow.shopifyProductId, 'archived')
      await db.update(dealHistory)
        .set({ status: 'archived', archivedAt: new Date() })
        .where(eq(dealHistory.id, liveNow.id))
    }

    // Activate next approved deal (earliest date first, regardless of exact date)
    const [nextDeal] = await db
      .select()
      .from(dealHistory)
      .where(eq(dealHistory.status, 'approved'))
      .orderBy(dealHistory.dealDate)
      .limit(1)
    if (nextDeal?.shopifyProductId) {
      await activateShopifyProduct(nextDeal.shopifyProductId)
      await setDealStatus(nextDeal.shopifyProductId, 'live')
      await db.update(dealHistory)
        .set({ status: 'live', activatedAt: new Date(), dealDate: today })
        .where(eq(dealHistory.id, nextDeal.id))
    }

    return {
      ok: true,
      rotated: { archived: liveNow?.sku ?? null, activated: nextDeal?.sku ?? null },
    }
  }

  if (intent === 'auto-schedule') {
    const deals = await db.select().from(dealHistory).where(eq(dealHistory.status, 'pending')).limit(50)
    const candidates = deals.map(d => ({
      sku: d.sku, title: d.seoTitle ?? '', brand: d.brand ?? '',
      score: parseFloat(d.dealScore ?? '0'), categories: (d.categories ?? []) as string[],
    }))
    const schedule = await generateSchedule(candidates, 30)
    return { ok: true, schedule }
  }

  return null
}

const ALL_STATUSES = ['pending_review', 'pending', 'approved', 'live', 'archived'] as const

const STATUS_LABELS: Record<string, string> = {
  pending_review: 'Staged',
  pending:        'Pending',
  approved:       'Approved',
  live:           'Live',
  archived:       'Archived',
}

const STATUS_COLOR: Record<string, string> = {
  pending:        'bg-yellow-100 text-yellow-700',
  pending_review: 'bg-purple-100 text-purple-700',
  approved:       'bg-green-100 text-green-700',
  live:           'bg-blue-100 text-blue-700',
  archived:       'bg-gray-100 text-gray-500',
}

const FILTER_ACTIVE = 'bg-brand-charcoal text-white'
const FILTER_IDLE   = 'bg-white text-brand-charcoal/60 hover:text-brand-charcoal border border-brand-mist'

export default function AdminQueuePage() {
  const { deals }                   = useLoaderData<typeof loader>()
  const fetcher                     = useFetcher()
  const [searchParams, setSearchParams] = useSearchParams()

  // Default: hide archived
  const activeFilters: Set<string> = searchParams.has('status')
    ? new Set(searchParams.getAll('status'))
    : new Set(['pending_review', 'pending', 'approved', 'live'])

  function toggleFilter(status: string) {
    const next = new Set(activeFilters)
    if (next.has(status)) {
      next.delete(status)
    } else {
      next.add(status)
    }
    const params = new URLSearchParams()
    next.forEach(s => params.append('status', s))
    setSearchParams(params, { replace: true })
  }

  const counts = Object.fromEntries(
    ALL_STATUSES.map(s => [s, deals.filter(d => d.status === s).length]),
  )

  const visibleDeals = deals.filter(d => activeFilters.has(d.status))
  const stagedDeals  = deals.filter(d => d.status === 'pending_review')
  const rotationResult = fetcher.data && 'rotated' in fetcher.data ? fetcher.data.rotated : null

  return (
    <div>
      {rotationResult && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-2xl px-5 py-3 text-sm text-blue-700 flex items-center gap-3">
          <span>🔄</span>
          <span>
            {rotationResult.archived
              ? <>Archived <strong>{rotationResult.archived}</strong>. </>
              : 'Nothing was live. '}
            {rotationResult.activated
              ? <>Now live: <strong>{rotationResult.activated}</strong>.</>
              : 'No approved deal found to activate.'}
          </span>
        </div>
      )}

      {stagedDeals.length > 0 && (
        <div className="mb-5 bg-purple-50 border border-purple-200 rounded-2xl px-5 py-3 flex items-center gap-3 text-sm text-purple-700">
          <span className="text-base">🤖</span>
          <span>
            <strong>{stagedDeals.length}</strong> deal{stagedDeals.length > 1 ? 's' : ''} staged by the pipeline and awaiting your review —
            approve below to lock them in.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
          Deal Queue
        </h1>
        <div className="flex gap-3">
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="run-feed" />
            <button type="submit" className="text-sm font-semibold px-4 py-2 bg-brand-mist text-brand-purple rounded-full hover:bg-brand-purple/10 transition-colors">
              {fetcher.state !== 'idle' ? '⏳ Loading...' : '🔄 Import from Feed'}
            </button>
          </fetcher.Form>
          <fetcher.Form method="post"
            onSubmit={e => {
              if (!confirm('Simulate midnight rotation? This archives the live deal and activates the next approved one.')) e.preventDefault()
            }}
          >
            <input type="hidden" name="intent" value="simulate-rotation" />
            <button type="submit" className="text-sm font-semibold px-4 py-2 bg-brand-mist text-brand-charcoal rounded-full hover:bg-brand-charcoal/10 transition-colors">
              ⏩ Simulate Rotation
            </button>
          </fetcher.Form>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="auto-schedule" />
            <button type="submit" className="text-sm font-semibold px-4 py-2 bg-brand-gradient text-white rounded-full hover:opacity-90 transition-opacity">
              ✨ Auto-Schedule 30 Days
            </button>
          </fetcher.Form>
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <span className="text-xs font-semibold text-brand-charcoal/40 uppercase tracking-wide mr-1">Show:</span>
        {ALL_STATUSES.map(status => (
          <button
            key={status}
            onClick={() => toggleFilter(status)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${activeFilters.has(status) ? FILTER_ACTIVE : FILTER_IDLE}`}
          >
            {STATUS_LABELS[status]}
            {(counts[status] ?? 0) > 0 && (
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${activeFilters.has(status) ? 'bg-white/20' : 'bg-brand-mist'}`}>
                {counts[status]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-mist text-brand-charcoal/60 text-xs uppercase tracking-wide">
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Product</th>
              <th className="px-4 py-3 text-right">Deal Price</th>
              <th className="px-4 py-3 text-right">Profit/Unit</th>
              <th className="px-4 py-3 text-right">Inventory</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleDeals.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-brand-charcoal/40 text-sm">
                  No deals match the selected filters.
                </td>
              </tr>
            )}
            {visibleDeals.map(deal => {
              const profit = deal.dealPrice && deal.wholesaleCost
                ? parseFloat(deal.dealPrice) - parseFloat(deal.wholesaleCost)
                : null
              return (
                <tr key={deal.id} className="border-t border-brand-mist hover:bg-brand-mist/30 transition-colors">
                  <td className="px-4 py-3 text-brand-charcoal/70 whitespace-nowrap">{deal.dealDate}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-brand-charcoal">{deal.seoTitle ?? deal.sku}</p>
                    <p className="text-xs text-brand-charcoal/50">{deal.brand} · {deal.sku}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {deal.dealPrice ? `$${parseFloat(deal.dealPrice).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-green-600 font-semibold">
                    {profit !== null ? `$${profit.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-brand-charcoal/70">
                    {deal.unitsAvailable ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_COLOR[deal.status] ?? ''}`}>
                      {STATUS_LABELS[deal.status] ?? deal.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-3 flex-wrap">
                      {(deal.status === 'pending' || deal.status === 'pending_review') && (
                        <fetcher.Form method="post" className="inline">
                          <input type="hidden" name="intent" value="approve" />
                          <input type="hidden" name="id" value={deal.id} />
                          <input type="hidden" name="shopifyProductId" value={deal.shopifyProductId ?? ''} />
                          <button type="submit" className="text-xs font-semibold text-green-600 hover:underline">
                            Approve
                          </button>
                        </fetcher.Form>
                      )}
                      {deal.status === 'approved' && (
                        <fetcher.Form method="post" className="inline">
                          <input type="hidden" name="intent" value="unapprove" />
                          <input type="hidden" name="id" value={deal.id} />
                          <button type="submit" className="text-xs font-semibold text-yellow-600 hover:underline">
                            Unapprove
                          </button>
                        </fetcher.Form>
                      )}
                      {(deal.status === 'pending' || deal.status === 'pending_review' || deal.status === 'approved') && deal.shopifyProductId && (
                        <fetcher.Form method="post" className="inline"
                          onSubmit={e => {
                            if (!confirm(`Force "${deal.seoTitle ?? deal.sku}" live NOW? This archives the current live deal.`)) e.preventDefault()
                          }}
                        >
                          <input type="hidden" name="intent"           value="force-live" />
                          <input type="hidden" name="id"               value={deal.id} />
                          <input type="hidden" name="shopifyProductId" value={deal.shopifyProductId} />
                          <button type="submit" className="text-xs font-semibold text-blue-600 hover:underline">
                            Force Live
                          </button>
                        </fetcher.Form>
                      )}
                      <fetcher.Form method="post" className="inline"
                        onSubmit={e => {
                          if (!confirm(`Delete "${deal.seoTitle ?? deal.sku}" from the queue? This only removes it from the DB — the Shopify product is unaffected.`)) e.preventDefault()
                        }}
                      >
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id"     value={deal.id} />
                        <button type="submit" className="text-xs font-semibold text-red-400 hover:text-red-600 hover:underline">
                          Delete
                        </button>
                      </fetcher.Form>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {visibleDeals.length > 0 && (
          <div className="px-4 py-2 border-t border-brand-mist text-xs text-brand-charcoal/40 text-right">
            {visibleDeals.length} deal{visibleDeals.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
