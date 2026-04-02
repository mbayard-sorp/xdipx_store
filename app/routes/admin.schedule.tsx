import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState } from 'react'
import { db }           from '~/lib/db.server'
import { dealHistory }  from '../../db/schema'
import { setDealStatus } from '~/lib/shopify.server'
import { eq, and, gte, lte, not, inArray } from 'drizzle-orm'

export const meta: MetaFunction = () => [{ title: 'Sales Schedule — xdipx Admin' }]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function estDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

function buildWindow(): string[] {
  return Array.from({ length: 14 }, (_, i) => estDateStr(i))
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader(_: LoaderFunctionArgs) {
  const window = buildWindow()
  const [first, last] = [window[0]!, window[window.length - 1]!]

  // Deals with dates in the 14-day window
  const scheduled = await db
    .select()
    .from(dealHistory)
    .where(
      and(
        gte(dealHistory.dealDate, first),
        lte(dealHistory.dealDate, last),
        not(inArray(dealHistory.status, ['archived'])),
      ),
    )
    .orderBy(dealHistory.dealDate)

  // Approved/pending deals outside the window (available to drag in)
  const unscheduled = await db
    .select()
    .from(dealHistory)
    .where(
      and(
        not(inArray(dealHistory.status, ['live', 'archived'])),
        not(and(gte(dealHistory.dealDate, first), lte(dealHistory.dealDate, last))!),
      ),
    )
    .orderBy(dealHistory.dealDate)
    .limit(50)

  return { window, scheduled, unscheduled }
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent')

  if (intent === 'reschedule') {
    const id      = parseInt(form.get('id') as string)
    const newDate = form.get('newDate') as string
    await db
      .update(dealHistory)
      .set({ dealDate: newDate })
      .where(eq(dealHistory.id, id))
    return { ok: true }
  }

  if (intent === 'force-live') {
    const id               = parseInt(form.get('id') as string)
    const shopifyProductId = form.get('shopifyProductId') as string
    const today = estDateStr(0)

    const [liveNow] = await db
      .select()
      .from(dealHistory)
      .where(eq(dealHistory.status, 'live'))
      .limit(1)

    if (liveNow?.shopifyProductId && liveNow.id !== id) {
      await setDealStatus(liveNow.shopifyProductId, 'archived')
      await db
        .update(dealHistory)
        .set({ status: 'archived', archivedAt: new Date() })
        .where(eq(dealHistory.id, liveNow.id))
    }

    await setDealStatus(shopifyProductId, 'live')
    await db
      .update(dealHistory)
      .set({ status: 'live', activatedAt: new Date(), dealDate: today })
      .where(eq(dealHistory.id, id))
    return { ok: true }
  }

  return null
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Deal = Awaited<ReturnType<typeof loader>>['scheduled'][number]

// ─── DealCard (draggable) ────────────────────────────────────────────────────

function DealCard({
  deal,
  onDragStart,
  compact = false,
}: {
  deal: Deal
  onDragStart: (id: string) => void
  compact?: boolean
}) {
  const fetcher = useFetcher<{ ok: boolean }>()

  const statusColor: Record<string, string> = {
    pending:  'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    live:     'bg-blue-100 text-blue-700',
  }

  return (
    <div
      draggable
      onDragStart={() => onDragStart(String(deal.id))}
      className="bg-white border border-brand-mist rounded-xl px-3 py-2 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-shadow select-none"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand-charcoal truncate leading-tight">
            {deal.seoTitle ?? deal.sku}
          </p>
          {!compact && (
            <p className="text-xs text-brand-charcoal/50 mt-0.5 truncate">{deal.brand}</p>
          )}
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${statusColor[deal.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {deal.status}
        </span>
      </div>

      {!compact && deal.dealPrice && (
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs font-bold text-brand-coral">${parseFloat(deal.dealPrice).toFixed(2)}</span>
          {deal.wholesaleCost && (
            <span className="text-xs text-green-600 font-medium">
              +${(parseFloat(deal.dealPrice) - parseFloat(deal.wholesaleCost)).toFixed(2)} profit
            </span>
          )}
        </div>
      )}

      {(deal.status === 'pending' || deal.status === 'approved') && deal.shopifyProductId && !compact && (
        <fetcher.Form
          method="post"
          className="mt-2"
          onSubmit={e => {
            if (!confirm(`Force "${deal.seoTitle ?? deal.sku}" live NOW?`)) e.preventDefault()
          }}
        >
          <input type="hidden" name="intent"           value="force-live" />
          <input type="hidden" name="id"               value={deal.id} />
          <input type="hidden" name="shopifyProductId" value={deal.shopifyProductId} />
          <button
            type="submit"
            className="text-xs font-semibold text-blue-600 hover:underline"
          >
            Force Live Now →
          </button>
        </fetcher.Form>
      )}
    </div>
  )
}

// ─── DaySlot (drop target) ───────────────────────────────────────────────────

function DaySlot({
  date,
  deal,
  isToday,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
}: {
  date: string
  deal: Deal | undefined
  isToday: boolean
  dragOver: boolean
  onDragOver: (date: string) => void
  onDragLeave: () => void
  onDrop: (date: string) => void
  onDragStart: (id: string) => void
}) {
  return (
    <div
      onDragOver={e => { e.preventDefault(); onDragOver(date) }}
      onDragLeave={onDragLeave}
      onDrop={e => { e.preventDefault(); onDrop(date) }}
      className={[
        'rounded-2xl border-2 p-3 transition-colors min-h-[88px]',
        dragOver
          ? 'border-brand-coral bg-brand-coral/5'
          : isToday
            ? 'border-brand-purple bg-brand-mist'
            : 'border-transparent bg-white/60',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-semibold ${isToday ? 'text-brand-purple' : 'text-brand-charcoal/50'}`}>
          {isToday ? '⭐ Today' : formatDate(date)}
        </span>
        {isToday && (
          <span className="text-xs text-brand-charcoal/40">{formatDate(date)}</span>
        )}
      </div>

      {deal ? (
        <DealCard deal={deal} onDragStart={onDragStart} />
      ) : (
        <div className={[
          'rounded-xl border-2 border-dashed px-3 py-3 text-xs text-center transition-colors',
          dragOver ? 'border-brand-coral/50 text-brand-coral' : 'border-brand-charcoal/15 text-brand-charcoal/30',
        ].join(' ')}>
          {dragOver ? 'Drop to schedule' : 'No deal scheduled'}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminSchedulePage() {
  const { window: dateWindow, scheduled, unscheduled } = useLoaderData<typeof loader>()
  const fetcher = useFetcher<{ ok: boolean }>()

  const [draggedId, setDraggedId]     = useState<string | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)

  // Build a date → deal map from current loader data, with optimistic updates
  const dealByDate = new Map<string, Deal>(scheduled.map(d => [d.dealDate, d]))

  function handleDrop(targetDate: string) {
    if (!draggedId) return
    setDragOverDate(null)
    fetcher.submit(
      { intent: 'reschedule', id: draggedId, newDate: targetDate },
      { method: 'post' },
    )
    setDraggedId(null)
  }

  const today = estDateStr(0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold text-brand-charcoal"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Sales Schedule
          </h1>
          <p className="text-sm text-brand-charcoal/50 mt-0.5">
            Next 14 days — drag deals to reschedule. Deals go live at midnight EST.
          </p>
        </div>
      </div>

      <div className="flex gap-6 items-start">

        {/* ── 14-day calendar ──────────────────────────────────────────── */}
        <div className="flex-1 grid grid-cols-2 gap-3">
          {dateWindow.map(date => (
            <DaySlot
              key={date}
              date={date}
              deal={dealByDate.get(date)}
              isToday={date === today}
              dragOver={dragOverDate === date}
              onDragOver={setDragOverDate}
              onDragLeave={() => setDragOverDate(null)}
              onDrop={handleDrop}
              onDragStart={setDraggedId}
            />
          ))}
        </div>

        {/* ── Unscheduled sidebar ──────────────────────────────────────── */}
        <aside className="w-64 shrink-0 bg-white rounded-2xl shadow-sm p-4">
          <h2
            className="text-sm font-bold text-brand-charcoal mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Unscheduled Deals
          </h2>
          <p className="text-xs text-brand-charcoal/40 mb-3">
            Drag any deal onto a calendar slot to schedule it.
          </p>

          {unscheduled.length === 0 ? (
            <p className="text-xs text-brand-charcoal/30 text-center py-8">
              No unscheduled deals
            </p>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {unscheduled.map(deal => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  onDragStart={setDraggedId}
                  compact
                />
              ))}
            </div>
          )}
        </aside>

      </div>
    </div>
  )
}
