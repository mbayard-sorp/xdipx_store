import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Form, useFetcher } from 'react-router'
import { db }           from '~/lib/db.server'
import { dealHistory }  from '../../db/schema'
import { generateSchedule } from '~/lib/claude.server'
import { dailyFeedProcessor } from '~/lib/feed-processor.server'
import { eq } from 'drizzle-orm'

export const meta: MetaFunction = () => [{ title: 'Deal Queue — xdipx Admin' }]

export async function loader(_: LoaderFunctionArgs) {
  const deals = await db
    .select()
    .from(dealHistory)
    .orderBy(dealHistory.dealDate)
    .limit(60)
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
    const id = parseInt(form.get('id') as string)
    await db.update(dealHistory).set({ status: 'approved' }).where(eq(dealHistory.id, id))
    return { ok: true }
  }

  if (intent === 'unapprove') {
    const id = parseInt(form.get('id') as string)
    await db.update(dealHistory).set({ status: 'pending' }).where(eq(dealHistory.id, id))
    return { ok: true }
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

export default function AdminQueuePage() {
  const { deals } = useLoaderData<typeof loader>()
  const fetcher   = useFetcher()

  const statusColor: Record<string, string> = {
    pending:  'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    live:     'bg-blue-100 text-blue-700',
    archived: 'bg-gray-100 text-gray-500',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
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
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="auto-schedule" />
            <button type="submit" className="text-sm font-semibold px-4 py-2 bg-brand-gradient text-white rounded-full hover:opacity-90 transition-opacity">
              ✨ Auto-Schedule 30 Days
            </button>
          </fetcher.Form>
        </div>
      </div>

      <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-mist text-brand-charcoal/60 text-xs uppercase tracking-wide">
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Product</th>
              <th className="px-4 py-3 text-right">Deal Price</th>
              <th className="px-4 py-3 text-right">Profit/Unit</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {deals.map(deal => {
              const profit = deal.dealPrice && deal.wholesaleCost
                ? parseFloat(deal.dealPrice) - parseFloat(deal.wholesaleCost)
                : null
              return (
                <tr key={deal.id} className="border-t border-brand-mist">
                  <td className="px-4 py-3 text-brand-charcoal/70 whitespace-nowrap">{deal.dealDate}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-brand-charcoal">{deal.seoTitle ?? deal.sku}</p>
                    <p className="text-xs text-brand-charcoal/50">{deal.brand}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {deal.dealPrice ? `$${parseFloat(deal.dealPrice).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-green-600 font-semibold">
                    {profit !== null ? `$${profit.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusColor[deal.status] ?? ''}`}>
                      {deal.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {deal.status === 'pending' && (
                      <fetcher.Form method="post" className="inline">
                        <input type="hidden" name="intent" value="approve" />
                        <input type="hidden" name="id" value={deal.id} />
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
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
