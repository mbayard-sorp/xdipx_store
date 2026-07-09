import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher, useSearchParams } from 'react-router'
import React, { useEffect, useRef, useState } from 'react'
import { db }           from '~/lib/db.server'
import { dealHistory }  from '../../db/schema'
import { generateSchedule } from '~/lib/claude.server'
import { dailyFeedProcessor } from '~/lib/feed-processor.server'
import { setDealStatus, activateShopifyProduct, getAdminProductData } from '~/lib/shopify.server'
import { activateDeal } from '~/lib/deal-rotator.server'
import { eq, and } from 'drizzle-orm'

export const meta: MetaFunction = () => [{ title: 'Deal Queue — xdipx Admin' }]

export async function loader(_: LoaderFunctionArgs) {
  const deals = await db
    .select()
    .from(dealHistory)
    .orderBy(dealHistory.dealDate)
    .limit(200)

  // Batch-fetch current Shopify prices + images for all deals that have a product ID.
  // Uses Admin API so draft/unpublished products are included.
  const numericIds = deals
    .map(d => d.shopifyProductId)
    .filter((id): id is string => Boolean(id))
  const shopifyDataMap = numericIds.length > 0
    ? await getAdminProductData(numericIds)
    : {}

  return { deals, shopifyDataMap }
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
    // DB 'queued' = owner-approved and eligible for nightly activation.
    // The Shopify metafield keeps its own 'approved' vocabulary below.
    await db.update(dealHistory).set({ status: 'queued' }).where(eq(dealHistory.id, id))
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
    const id = parseInt(form.get('id') as string)

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
        .set({ status: 'archived', completedAt: new Date() })
        .where(eq(dealHistory.id, liveNow.id))
    }

    // Load target deal and route through activateDeal — which pushes
    // configured dealPrice to the variant before flipping status live.
    const [target] = await db
      .select()
      .from(dealHistory)
      .where(eq(dealHistory.id, id))
      .limit(1)
    if (target) await activateDeal(target)
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
        .set({ status: 'archived', completedAt: new Date() })
        .where(eq(dealHistory.id, liveNow.id))
    }

    // Activate next queued (owner-approved) deal, earliest date first
    const [nextDeal] = await db
      .select()
      .from(dealHistory)
      .where(eq(dealHistory.status, 'queued'))
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

  if (intent === 'unarchive') {
    const id               = parseInt(form.get('id') as string)
    const shopifyProductId = form.get('shopifyProductId') as string | null
    await db.update(dealHistory).set({ status: 'pending', completedAt: null }).where(eq(dealHistory.id, id))
    if (shopifyProductId) await setDealStatus(shopifyProductId, 'pending')
    return { ok: true }
  }

  if (intent === 'save-date') {
    const id = parseInt(form.get('id') as string)
    const dealDate = form.get('dealDate') as string
    if (dealDate) {
      await db.update(dealHistory).set({ dealDate }).where(eq(dealHistory.id, id))
    }
    return { ok: true }
  }

  return null
}

const ALL_STATUSES = ['pending', 'queued', 'live', 'archived'] as const

const STATUS_LABELS: Record<string, string> = {
  pending:  'Pending',
  queued:   'Queued (approved)',
  live:     'Live',
  archived: 'Archived',
}

const STATUS_COLOR: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-700',
  queued:   'bg-green-100 text-green-700',
  live:     'bg-blue-100 text-blue-700',
  archived: 'bg-gray-100 text-gray-500',
}

const FILTER_ACTIVE = 'bg-ink text-white'
const FILTER_IDLE   = 'bg-white text-ink/60 hover:text-ink border border-cream-2'

type PendingConfirm = {
  intent: string
  id?: number | undefined
  shopifyProductId?: string | undefined
  label: string
  message: string
}

export default function AdminQueuePage() {
  const { deals, shopifyDataMap }       = useLoaderData<typeof loader>()
  const fetcher                         = useFetcher()
  const saveFetcher                     = useFetcher()
  const [searchParams, setSearchParams] = useSearchParams()
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const confirmFetcher                  = useFetcher()
  const [expandedRow, setExpandedRow]   = useState<number | null>(null)
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)
  const [editedDates, setEditedDates]   = useState<Record<number, string>>({})

  // Close any open dropdown on click outside
  useEffect(() => {
    if (openDropdown === null) return
    const handler = () => setOpenDropdown(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [openDropdown])

  // Default: hide archived
  const activeFilters: Set<string> = searchParams.has('status')
    ? new Set(searchParams.getAll('status'))
    : new Set(['pending', 'queued', 'live'])

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
  const stagedDeals  = deals.filter(d => d.status === 'pending')
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
              : 'No queued deal found to activate.'}
          </span>
        </div>
      )}

      {stagedDeals.length > 0 && (
        <div className="mb-5 bg-purple-50 border border-purple-200 rounded-2xl px-5 py-3 flex items-center gap-3 text-sm text-purple-700">
          <span className="text-base">🤖</span>
          <span>
            <strong>{stagedDeals.length}</strong> pending deal{stagedDeals.length > 1 ? 's' : ''} awaiting your approval —
            approve below to queue for the nightly rotation.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Deal Queue
        </h1>
        <div className="flex gap-3">
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="run-feed" />
            <button type="submit" className="text-sm font-semibold px-4 py-2 bg-cream-2 text-sage rounded-full hover:bg-sage/10 transition-colors">
              {fetcher.state !== 'idle' ? '⏳ Loading...' : '🔄 Import from Feed'}
            </button>
          </fetcher.Form>
          <button
            type="button"
            onClick={() => setPendingConfirm({
              intent: 'simulate-rotation',
              label: 'Simulate Rotation',
              message: 'This archives the live deal and activates the next approved one. Continue?',
            })}
            className="text-sm font-semibold px-4 py-2 bg-cream-2 text-ink rounded-full hover:bg-ink/10 transition-colors"
          >
            ⏩ Simulate Rotation
          </button>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="auto-schedule" />
            <button type="submit" className="text-sm font-semibold px-4 py-2 bg-coral text-white rounded-full hover:opacity-90 transition-opacity">
              ✨ Auto-Schedule 30 Days
            </button>
          </fetcher.Form>
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <span className="text-xs font-semibold text-ink/40 uppercase tracking-wide mr-1">Show:</span>
        {ALL_STATUSES.map(status => (
          <button
            key={status}
            onClick={() => toggleFilter(status)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${activeFilters.has(status) ? FILTER_ACTIVE : FILTER_IDLE}`}
          >
            {STATUS_LABELS[status]}
            {(counts[status] ?? 0) > 0 && (
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${activeFilters.has(status) ? 'bg-white/20' : 'bg-cream-2'}`}>
                {counts[status]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '120px' }} />
            <col style={{ width: '48px' }} />
            <col />
            <col style={{ width: '80px' }} />
            <col style={{ width: '75px' }} />
            <col style={{ width: '75px' }} />
            <col style={{ width: '85px' }} />
            <col style={{ width: '70px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '120px' }} />
            <col style={{ width: '70px' }} />
          </colgroup>
          <thead>
            <tr className="bg-cream-2 text-ink/60 text-xs uppercase tracking-wide">
              <th className="px-3 py-3 text-left">Date</th>
              <th className="px-1 py-3"></th>
              <th className="px-3 py-3 text-left">Product</th>
              <th className="px-3 py-3 text-right">Wholesale</th>
              <th className="px-3 py-3 text-right">MSRP</th>
              <th className="px-3 py-3 text-right">MAP</th>
              <th className="px-3 py-3 text-right">Deal Price</th>
              <th className="px-3 py-3 text-right">Margin</th>
              <th className="px-3 py-3 text-right">Inventory</th>
              <th className="px-3 py-3 text-center">Status</th>
              <th className="px-3 py-3 text-center">Actions</th>
              <th className="px-3 py-3 text-center">Save</th>
            </tr>
          </thead>
          <tbody>
            {visibleDeals.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-ink/40 text-sm">
                  No deals match the selected filters.
                </td>
              </tr>
            )}
            {visibleDeals.map(deal => {
              const shopifyData = deal.shopifyProductId ? shopifyDataMap[deal.shopifyProductId] : null
              const msrp      = deal.msrp          ? parseFloat(deal.msrp)          : null
              const wholesale = deal.wholesaleCost  ? parseFloat(deal.wholesaleCost) : null
              const map       = deal.mapPrice       ? parseFloat(deal.mapPrice)      : null
              const dealPrice = shopifyData?.price != null
                ? shopifyData.price
                : deal.dealPrice ? parseFloat(deal.dealPrice) : null
              const margin    = dealPrice && wholesale ? (dealPrice - wholesale) / dealPrice : null
              const images    = shopifyData?.images ?? []
              const thumbUrl  = images[0] ?? null
              const isExpanded = expandedRow === deal.id

              return (
                <React.Fragment key={deal.id}>
                  <tr
                    className={[
                      'border-t border-cream-2 transition-colors cursor-pointer select-none',
                      isExpanded ? 'bg-cream-2/40' : 'hover:bg-cream-2/30',
                    ].join(' ')}
                    onClick={e => {
                      const target = e.target as HTMLElement
                      if (target.closest('button, input, a, select')) return
                      setExpandedRow(isExpanded ? null : deal.id)
                    }}
                  >
                    {/* Date — editable */}
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      {deal.dealDate === '2099-12-31' ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-ink/40 italic">Unscheduled</span>
                          <input
                            type="date"
                            onChange={e => setEditedDates(prev => ({ ...prev, [deal.id]: e.target.value }))}
                            className="text-xs border border-cream-2 rounded-lg px-2 py-1 w-full bg-transparent focus:outline-none focus:ring-1 focus:ring-sage/50 text-ink/70"
                          />
                        </div>
                      ) : (
                        <input
                          type="date"
                          defaultValue={deal.dealDate}
                          onChange={e => setEditedDates(prev => ({ ...prev, [deal.id]: e.target.value }))}
                          className="text-xs border border-cream-2 rounded-lg px-2 py-1 w-full bg-transparent focus:outline-none focus:ring-1 focus:ring-sage/50 text-ink/70"
                        />
                      )}
                    </td>

                    {/* Thumbnail */}
                    <td className="px-1 py-3">
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt=""
                          className="w-9 h-9 object-cover rounded-lg shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-cream-2 flex items-center justify-center shrink-0">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink/20">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M3 9h18M9 21V9" />
                          </svg>
                        </div>
                      )}
                    </td>

                    {/* Product info */}
                    <td className="px-3 py-3 min-w-0">
                      <p className="font-medium text-ink truncate">{deal.seoTitle ?? deal.sku}</p>
                      <p className="text-xs text-ink/50 truncate">{deal.brand} · {deal.sku}</p>
                    </td>

                    <td className="px-3 py-3 text-right text-ink/60 text-xs">
                      {wholesale ? `$${wholesale.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right text-ink/60 text-xs">
                      {msrp ? `$${msrp.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right text-ink/60 text-xs">
                      {map != null && map > 0 ? `$${map.toFixed(2)}` : <span className="text-ink/30">none</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-ink text-xs">
                      {dealPrice != null ? `$${dealPrice.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-xs">
                      {margin !== null
                        ? <span className={margin >= 0.4 ? 'text-green-600' : margin >= 0.25 ? 'text-yellow-600' : 'text-red-500'}>
                            {Math.round(margin * 100)}%
                          </span>
                        : '—'}
                    </td>
                    <td className="px-3 py-3 text-right text-ink/70 text-xs">
                      {deal.unitsAvailable ?? '—'}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${STATUS_COLOR[deal.status] ?? ''}`}>
                        {STATUS_LABELS[deal.status] ?? deal.status}
                      </span>
                    </td>

                    {/* Actions — pill dropdown */}
                    <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <ActionsDropdown
                        deal={deal}
                        isOpen={openDropdown === deal.id}
                        onToggle={() => setOpenDropdown(openDropdown === deal.id ? null : deal.id)}
                        fetcher={fetcher}
                        onConfirm={setPendingConfirm}
                        onClose={() => setOpenDropdown(null)}
                      />
                    </td>

                    {/* Save button */}
                    <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => saveFetcher.submit(
                          { intent: 'save-date', id: String(deal.id), dealDate: editedDates[deal.id] ?? deal.dealDate },
                          { method: 'post' },
                        )}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full bg-coral text-white hover:opacity-90 transition-opacity whitespace-nowrap"
                      >
                        Save
                      </button>
                    </td>
                  </tr>

                  {/* Expanded image gallery */}
                  {isExpanded && images.length > 0 && (
                    <tr key={`${deal.id}-gallery`} className="bg-cream-2/50 border-t border-cream-2/60">
                      <td colSpan={12} className="px-5 py-4">
                        <p className="text-xs font-semibold text-ink/40 uppercase tracking-wide mb-3">
                          Product Images ({images.length})
                        </p>
                        <div className="flex gap-3 flex-wrap">
                          {images.map((url, i) => (
                            <div key={i} className="relative group shrink-0">
                              <img
                                src={url}
                                alt={`Image ${i + 1}`}
                                className="w-24 h-24 object-cover rounded-xl shadow-sm transition-transform duration-200 group-hover:scale-150 group-hover:shadow-xl group-hover:z-10 relative"
                              />
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  {isExpanded && images.length === 0 && (
                    <tr key={`${deal.id}-no-img`} className="bg-cream-2/50 border-t border-cream-2/60">
                      <td colSpan={12} className="px-5 py-4 text-xs text-ink/40 italic">
                        No images available from Shopify for this product.
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
        {visibleDeals.length > 0 && (
          <div className="px-4 py-2 border-t border-cream-2 text-xs text-ink/40 text-right">
            {visibleDeals.length} deal{visibleDeals.length !== 1 ? 's' : ''} — click a row to preview images
          </div>
        )}
      </div>

      {/* Inline confirmation dialog */}
      {pendingConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setPendingConfirm(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <p className="text-sm font-medium text-ink mb-1">{pendingConfirm.label}</p>
            <p className="text-sm text-ink/60 mb-5">{pendingConfirm.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="px-4 py-2 text-sm font-semibold text-ink/60 hover:text-ink rounded-xl transition-colors"
              >
                Cancel
              </button>
              <confirmFetcher.Form
                method="post"
                onSubmit={() => setPendingConfirm(null)}
                className="inline"
              >
                <input type="hidden" name="intent" value={pendingConfirm.intent} />
                {pendingConfirm.id != null && (
                  <input type="hidden" name="id" value={pendingConfirm.id} />
                )}
                {pendingConfirm.shopifyProductId && (
                  <input type="hidden" name="shopifyProductId" value={pendingConfirm.shopifyProductId} />
                )}
                <button
                  type="submit"
                  className={`px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${
                    pendingConfirm.intent === 'delete'
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : 'bg-coral text-white hover:opacity-90'
                  }`}
                >
                  {pendingConfirm.label}
                </button>
              </confirmFetcher.Form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Actions dropdown ──────────────────────────────────────────────────────

interface ActionsDropdownProps {
  deal: {
    id: number
    status: string
    seoTitle: string | null
    sku: string
    shopifyProductId: string | null
  }
  isOpen: boolean
  onToggle: () => void
  fetcher: ReturnType<typeof useFetcher>
  onConfirm: (c: PendingConfirm) => void
  onClose: () => void
}

function ActionsDropdown({ deal, isOpen, onToggle, fetcher, onConfirm, onClose }: ActionsDropdownProps) {
  const ref = useRef<HTMLDivElement>(null)

  const canApprove    = deal.status === 'pending'
  const canUnapprove  = deal.status === 'queued'
  const canUnarchive  = deal.status === 'archived'
  const canForceLive  = (canApprove || canUnapprove || canUnarchive) && Boolean(deal.shopifyProductId)

  return (
    <div
      ref={ref}
      className="relative inline-block"
      onClick={e => e.stopPropagation()}
    >
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full bg-cream-2 text-ink hover:bg-ink/10 transition-colors whitespace-nowrap"
      >
        Actions
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          className={`transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-white rounded-xl shadow-lg border border-cream-2 py-1 min-w-[148px]">
          {canApprove && (
            <fetcher.Form method="post" onSubmit={onClose}>
              <input type="hidden" name="intent" value="approve" />
              <input type="hidden" name="id" value={deal.id} />
              <input type="hidden" name="shopifyProductId" value={deal.shopifyProductId ?? ''} />
              <button type="submit" className="w-full text-left px-4 py-2 text-xs font-medium text-green-600 hover:bg-cream-2 transition-colors">
                ✓ Approve
              </button>
            </fetcher.Form>
          )}
          {canUnapprove && (
            <fetcher.Form method="post" onSubmit={onClose}>
              <input type="hidden" name="intent" value="unapprove" />
              <input type="hidden" name="id" value={deal.id} />
              <button type="submit" className="w-full text-left px-4 py-2 text-xs font-medium text-yellow-600 hover:bg-cream-2 transition-colors">
                ↩ Unqueue
              </button>
            </fetcher.Form>
          )}
          {canUnarchive && (
            <fetcher.Form method="post" onSubmit={onClose}>
              <input type="hidden" name="intent" value="unarchive" />
              <input type="hidden" name="id" value={deal.id} />
              <input type="hidden" name="shopifyProductId" value={deal.shopifyProductId ?? ''} />
              <button type="submit" className="w-full text-left px-4 py-2 text-xs font-medium text-yellow-600 hover:bg-cream-2 transition-colors">
                ↩ Return to Queue
              </button>
            </fetcher.Form>
          )}
          {canForceLive && (
            <button
              onClick={() => {
                onClose()
                onConfirm({
                  intent: 'force-live',
                  id: deal.id,
                  shopifyProductId: deal.shopifyProductId ?? undefined,
                  label: 'Force Live',
                  message: `Force "${deal.seoTitle ?? deal.sku}" live now? This archives the current live deal.`,
                })
              }}
              className="w-full text-left px-4 py-2 text-xs font-medium text-blue-600 hover:bg-cream-2 transition-colors"
            >
              ⚡ Force Live
            </button>
          )}
          <div className="my-1 border-t border-cream-2/60" />
          <button
            onClick={() => {
              onClose()
              onConfirm({
                intent: 'delete',
                id: deal.id,
                label: 'Delete',
                message: `Remove "${deal.seoTitle ?? deal.sku}" from the queue? The Shopify product is unaffected.`,
              })
            }}
            className="w-full text-left px-4 py-2 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
          >
            ✕ Delete
          </button>
        </div>
      )}
    </div>
  )
}
