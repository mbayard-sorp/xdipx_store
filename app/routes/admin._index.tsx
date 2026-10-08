/**
 * /admin: the P&L dashboard. Sales, revenue, costs and profit since the first
 * real sale (2026-07-23), for any window, against the window before it.
 *
 * Every number is computed in app/lib/pnl-core.ts from inputs read in
 * app/lib/pnl.server.ts: Shopify orders (revenue, discounts, refunds,
 * shipping, tax, actual payment fees), COGS from the order metafields and
 * inventory cost, imported ad-platform spend, metered AI spend, and the costs
 * the owner enters on the Costs tab. Days are the store's local days.
 *
 * Cost edits are owner-only, same as the ad caps on /admin/ad-studio/spend.
 */
import { useMemo } from 'react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction, ShouldRevalidateFunction } from 'react-router'
import { Form, Link, isRouteErrorResponse, useLoaderData, useNavigation, useRouteError, useSearchParams } from 'react-router'
import { getAdminUser, requireAdmin } from '~/lib/session.server'
import {
  PnlInputError, addExpense, addFixedCost, deleteExpense, deleteManualAdSpend, endFixedCost, getStoreTimezone, loadPnlData,
  saveHandlingFeePerOrder, saveManualAdSpend,
} from '~/lib/pnl.server'
import {
  PNL_EPOCH, RANGE_PRESETS, adPlatformRows, dayInTz, manualAdOverlaps, goalStatus, monthStart, monthlyColumns, orderBreakdown,
  productBreakdown, ratiosFor, resolveRange, seriesFor, statementRows, totalsFor, waterfallSteps, deltaPct,
} from '~/lib/pnl-core'
import { Card } from '~/components/admin/pnl/Card'
import { KpiTile } from '~/components/admin/pnl/KpiTile'
import { TrendChart, bucketLabel } from '~/components/admin/pnl/TrendChart'
import { Waterfall } from '~/components/admin/pnl/Waterfall'
import { MonthlyStatement, StatementTable } from '~/components/admin/pnl/Statement'
import { AdPlatformsTable, BreakdownTable, OrdersLedger } from '~/components/admin/pnl/Tables'
import { CostsPanel } from '~/components/admin/pnl/CostsPanel'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { count, longDay, money, moneyHeadline, monthLabel, multiple, pct, windowLabel } from '~/components/admin/pnl/format'

export const meta: MetaFunction = () => [{ title: 'Profit & Loss — xdipx Admin' }]

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'statement', label: 'P&L statement' },
  { id: 'sales', label: 'Sales' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'orders', label: 'Orders' },
  { id: 'costs', label: 'Costs' },
] as const
type TabId = (typeof TABS)[number]['id']

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const fresh = url.searchParams.get('fresh') === '1'

  // Resolve the range in the store's timezone; it is read from Shopify once per process.
  const tz = await getStoreTimezone()
  const today = dayInTz(Date.now(), tz)
  const range = resolveRange({ range: url.searchParams.get('range'), from: url.searchParams.get('from'), to: url.searchParams.get('to') }, today)

  // One read covers the window, the window before it, and this month (for the goal).
  const ms = monthStart(today)
  const fetchFrom = [range.from, range.prev?.from ?? range.from, ms < PNL_EPOCH ? PNL_EPOCH : ms].sort()[0]!
  const [admin, data] = await Promise.all([getAdminUser(request), loadPnlData({ from: fetchFrom, to: today }, { fresh })])
  const { inputs } = data

  const cur = totalsFor(inputs, range.from, range.to)
  const prev = range.prev ? totalsFor(inputs, range.prev.from, range.prev.to) : null
  const series = seriesFor(inputs, range.from, range.to, range.granularity)
  const months = monthlyColumns(inputs, range.from, range.to)
  const inRange = inputs.orders.filter(o => o.day >= range.from && o.day <= range.to).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const quality: string[] = [...data.gaps]
  if (cur.cogsMissingUnits > 0) quality.push(`${cur.cogsMissingUnits} unit${cur.cogsMissingUnits === 1 ? '' : 's'} sold with no wholesale cost on file. Product cost is understated by those units.`)
  for (const o of manualAdOverlaps(inputs.manualAds, inputs.ads)) {
    quality.push(`${o} has both a monthly entry and imported spend, so it is probably counted twice. Delete the monthly entry on the Costs tab once the import covers that month.`)
  }
  if (data.fixedAll.length === 0) quality.push('No software or subscription costs are entered, so net profit leaves out hosting, apps and the Claude Max plan. Add them on the Costs tab.')

  return {
    isOwner: admin?.role === 'owner',
    tz: data.tz,
    today,
    range,
    storeDomain: process.env['SHOPIFY_STORE_DOMAIN'] ?? null,
    cur, prev,
    ratios: ratiosFor(cur),
    prevRatios: prev ? ratiosFor(prev) : null,
    rows: statementRows(cur),
    prevRows: prev ? statementRows(prev) : null,
    series,
    months,
    waterfall: waterfallSteps(cur),
    goal: goalStatus(inputs, today),
    products: productBreakdown(inputs.orders, range.from, range.to, 'product'),
    categories: productBreakdown(inputs.orders, range.from, range.to, 'category'),
    channels: orderBreakdown(inputs.orders, range.from, range.to, o => o.channel),
    sources: orderBreakdown(inputs.orders, range.from, range.to, o => o.source),
    customers: orderBreakdown(inputs.orders, range.from, range.to, o => (o.customerType === 'new' ? 'New customers' : o.customerType === 'returning' ? 'Returning customers' : 'Unknown')),
    platforms: adPlatformRows(inputs.ads, inputs.expenses, range.from, range.to, inputs.manualAds),
    orders: inRange,
    handlingFeePerOrder: inputs.handlingFeePerOrder,
    fixed: data.fixedAll,
    expenses: data.expensesRecent,
    expensesReady: data.expensesReady,
    manualAds: data.manualAdsAll,
    manualAdsReady: data.manualAdsReady,
    quality,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const admin = await getAdminUser(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  if (admin?.role !== 'owner') return { ok: false as const, error: 'Only the owner can change costs.' }
  try {
    switch (intent) {
      case 'save-handling':
        return { ok: true as const, message: await saveHandlingFeePerOrder(form.get('amount'), 'owner') }
      case 'add-fixed':
        return { ok: true as const, message: await addFixedCost({ vendor: form.get('vendor'), monthly: form.get('monthly'), from: form.get('from'), note: form.get('note') }) }
      case 'end-fixed':
        return { ok: true as const, message: await endFixedCost(Number(form.get('id')), form.get('end')) }
      case 'add-expense':
        return {
          ok: true as const,
          message: await addExpense({
            date: form.get('date'), category: form.get('category'), vendor: form.get('vendor'), amount: form.get('amount'), note: form.get('note'),
          }, admin.email),
        }
      case 'delete-expense':
        return { ok: true as const, message: await deleteExpense(Number(form.get('id'))) }
      case 'save-ad-spend': {
        const today = dayInTz(Date.now(), await getStoreTimezone())
        return {
          ok: true as const,
          message: await saveManualAdSpend({ platform: form.get('platform'), month: form.get('month'), amount: form.get('amount'), note: form.get('note') }, admin.email, today),
        }
      }
      case 'delete-ad-spend':
        return { ok: true as const, message: await deleteManualAdSpend(Number(form.get('id'))) }
    }
  } catch (err) {
    if (err instanceof PnlInputError) return { ok: false as const, error: err.message }
    console.error('[admin pnl] action failed', err)
    return { ok: false as const, error: 'That did not save. Try again.' }
  }
  return { ok: false as const, error: 'Unknown action.' }
}

/** Switching tabs is client state; only a new range or a cost edit needs the loader. */
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }) => {
  if (formMethod && formMethod !== 'GET') return defaultShouldRevalidate
  const a = new URLSearchParams(currentUrl.search)
  const b = new URLSearchParams(nextUrl.search)
  a.delete('tab'); b.delete('tab')
  if (currentUrl.pathname === nextUrl.pathname && a.toString() === b.toString()) return false
  return defaultShouldRevalidate
}

export default function PnlDashboard() {
  const d = useLoaderData<typeof loader>()
  const [params] = useSearchParams()
  const navigation = useNavigation()
  const reloading = navigation.state === 'loading' && navigation.location?.pathname === '/admin'
  const tab = (TABS.some(t => t.id === params.get('tab')) ? params.get('tab') : 'overview') as TabId

  const withParams = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    p.delete('fresh')
    for (const [k, v] of Object.entries(patch)) { if (v == null) p.delete(k); else p.set(k, v) }
    const s = p.toString()
    return s ? `/admin?${s}` : '/admin'
  }
  const exportQuery = useMemo(() => {
    const p = new URLSearchParams({ range: d.range.preset })
    if (d.range.preset === 'custom') { p.set('from', d.range.from); p.set('to', d.range.to) }
    return p.toString()
  }, [d.range])

  return (
    <div className="max-w-[1280px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="kicker mb-1">Since first sale · {longDay(PNL_EPOCH)}</p>
          <h1 className="font-display text-2xl md:text-3xl text-ink leading-tight">Profit &amp; Loss</h1>
          <p className="text-sm text-ink-3 mt-1">
            {windowLabel(d.range.from, d.range.to)}
            {d.range.prev && <> · compared with {windowLabel(d.range.prev.from, d.range.prev.to)}{d.range.prev.partial ? ' (shorter, it starts at the first sale)' : ''}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link to={withParams({ fresh: '1' })} className="rounded-[10px] border border-line-2 bg-paper px-3 py-2 font-semibold text-ink-2 hover:border-ink-3" preventScrollReset>
            {reloading ? 'Refreshing…' : 'Refresh'}
          </Link>
          <a href={`/admin/pnl-export?kind=statement&${exportQuery}`} className="rounded-[10px] border border-line-2 bg-paper px-3 py-2 font-semibold text-ink-2 hover:border-ink-3">Export P&amp;L</a>
          <a href={`/admin/pnl-export?kind=orders&${exportQuery}`} className="rounded-[10px] border border-line-2 bg-paper px-3 py-2 font-semibold text-ink-2 hover:border-ink-3">Export orders</a>
        </div>
      </div>

      {/* Range: presets first, custom after them. Scopes everything below. */}
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between mb-4">
        <nav aria-label="Date range" className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible md:pb-0">
          {RANGE_PRESETS.map(p => {
            const active = d.range.preset === p.id
            return (
              <Link
                key={p.id}
                to={withParams({ range: p.id, from: null, to: null })}
                preventScrollReset
                aria-current={active ? 'true' : undefined}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors ${active ? 'bg-ink text-paper border-ink' : 'bg-paper text-ink-2 border-line-2 hover:border-ink-3'}`}
              >
                {p.label}
              </Link>
            )
          })}
        </nav>
        <Form method="get" action="/admin" className="flex flex-wrap items-center gap-1.5 text-xs shrink-0" preventScrollReset>
          <input type="hidden" name="range" value="custom" />
          {params.get('tab') && <input type="hidden" name="tab" value={params.get('tab')!} />}
          <input type="date" name="from" min={PNL_EPOCH} max={d.today} defaultValue={d.range.from} aria-label="From" className="rounded-[8px] border border-line-2 bg-paper px-2 py-1.5 w-[132px]" />
          <span className="text-ink-4">to</span>
          <input type="date" name="to" min={PNL_EPOCH} max={d.today} defaultValue={d.range.to} aria-label="To" className="rounded-[8px] border border-line-2 bg-paper px-2 py-1.5 w-[132px]" />
          <button type="submit" className={`rounded-[8px] px-3 py-1.5 font-semibold ${d.range.preset === 'custom' ? 'bg-ink text-paper' : 'bg-paper-3 text-ink-2 hover:bg-line-2'}`}>Apply</button>
        </Form>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="P&L sections" className="flex gap-1 border-b border-line mb-5 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        {TABS.map(t => (
          <Link
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            to={withParams({ tab: t.id === 'overview' ? null : t.id })}
            preventScrollReset
            className={`whitespace-nowrap px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${tab === t.id ? 'border-coral text-ink font-semibold' : 'border-transparent text-ink-3 hover:text-ink'}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className={`transition-opacity ${reloading ? 'opacity-60' : ''}`}>
        {tab === 'overview' && <Overview d={d} />}
        {tab === 'statement' && <StatementTab d={d} />}
        {tab === 'sales' && <SalesTab d={d} />}
        {tab === 'marketing' && <MarketingTab d={d} />}
        {tab === 'orders' && (
          <Card title="Orders" kicker={`${count(d.orders.length)} in range`}>
            <OrdersLedger orders={d.orders} handlingFeePerOrder={d.handlingFeePerOrder} storeDomain={d.storeDomain} />
          </Card>
        )}
        {tab === 'costs' && (
          <CostsPanel
            isOwner={d.isOwner} today={d.today} handlingFeePerOrder={d.handlingFeePerOrder} fixed={d.fixed}
            expenses={d.expenses} expensesReady={d.expensesReady} manualAds={d.manualAds} manualAdsReady={d.manualAdsReady}
          />
        )}
      </div>

      <p className="text-[11px] text-ink-4 mt-8">
        Order-date basis in the store&apos;s timezone ({d.tz}). Test orders and unpaid orders are excluded; refunds count against the day the order was placed.
        Revenue excludes sales tax. Payment fees are Shopify&apos;s actual fees.
      </p>
    </div>
  )
}

type Data = ReturnType<typeof useLoaderData<typeof loader>>

function Overview({ d }: { d: Data }) {
  const [params] = useSearchParams()
  const salesHref = (() => { const p = new URLSearchParams(params); p.set('tab', 'sales'); p.delete('fresh'); return `/admin?${p}` })()
  const c = d.cur
  const p = d.prev
  const r = d.ratios
  const pr = d.prevRatios
  const trend = (k: 'netRevenue' | 'grossProfit' | 'adSpend' | 'netProfit' | 'orders') => (d.series.length >= 2 ? d.series.map(s => s[k]) : undefined)
  const partialProfit = d.fixed.length === 0
    ? 'Leaves out software and subscription costs, which have not been entered yet. See the notes below.'
    : undefined

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Net revenue" value={moneyHeadline(c.netRevenue)} delta={deltaPct(c.netRevenue, p?.netRevenue)} trend={trend('netRevenue')} accent="#C2350F"
          sub={`${count(c.orders)} order${c.orders === 1 ? '' : 's'}`} />
        <KpiTile label="Gross profit" value={moneyHeadline(c.grossProfit)} delta={deltaPct(c.grossProfit, p?.grossProfit)} trend={trend('grossProfit')} accent="#7A2BB8"
          sub={`${pct(r.grossMarginPct, 0)} margin`} />
        <KpiTile label="Ad spend" value={moneyHeadline(c.adSpend)} delta={deltaPct(c.adSpend, p?.adSpend)} goodWhenUp={false} trend={c.adSpend > 0 ? trend('adSpend') : undefined}
          sub={r.mer != null ? `${multiple(r.mer)} MER` : 'no spend recorded'} />
        <KpiTile label="Net profit" value={moneyHeadline(c.netProfit)} delta={deltaPct(c.netProfit, p?.netProfit)} trend={trend('netProfit')} accent="#7A2BB8" emphasis
          sub={`${pct(r.netMarginPct, 0)} margin`} caveat={partialProfit} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MiniStat label="Orders" value={count(c.orders)} delta={deltaPct(c.orders, p?.orders)} />
        <MiniStat label="Avg. order value" value={money(r.aov)} delta={deltaPct(r.aov ?? 0, pr?.aov)} />
        <MiniStat label="Units sold" value={count(c.units)} delta={deltaPct(c.units, p?.units)} />
        <MiniStat label="New customers" value={count(c.newCustomers)} sub={c.returningCustomers > 0 ? `${count(c.returningCustomers)} returning` : 'no repeat buyers yet'} />
        <MiniStat label="Blended CAC" value={r.cac == null ? '—' : money(r.cac)} sub={r.breakevenCpa != null ? `break-even ${money(r.breakevenCpa)}` : undefined} goodWhenUp={false} delta={pr?.cac != null && r.cac != null ? deltaPct(r.cac, pr.cac) : null} />
        <MiniStat label="Shipping margin" value={money(r.shippingMargin)} sub={`discounts ${pct(r.discountRatePct, 0)} · refunds ${pct(r.refundRatePct, 0)}`} delta={null} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card kicker={`By ${d.range.granularity}`} title="Revenue and profit">
          {d.series.some(s => s.netRevenue !== 0 || s.netProfit !== 0)
            ? <TrendChart series={d.series} granularity={d.range.granularity} />
            : <p className="text-sm text-ink-3">No sales or costs in this window.</p>}
          <details className="mt-3 group">
            <summary className="text-xs font-semibold text-plum cursor-pointer select-none">Show as a table</summary>
            <ResponsiveTable className="mt-2">
              <table className="w-full min-w-[480px] text-xs">
                <thead><tr className="text-ink-3 text-left"><th className="py-1 font-medium">Period</th><th className="py-1 font-medium text-right">Orders</th><th className="py-1 font-medium text-right">Net revenue</th><th className="py-1 font-medium text-right">Ad spend</th><th className="py-1 font-medium text-right">Net profit</th></tr></thead>
                <tbody>
                  {d.series.map(s => (
                    <tr key={s.bucket} className="border-t border-line tabular-nums">
                      <td className="py-1">{bucketLabel(s, d.range.granularity, true)}</td>
                      <td className="py-1 text-right">{s.orders}</td>
                      <td className="py-1 text-right">{money(s.netRevenue)}</td>
                      <td className="py-1 text-right">{money(s.adSpend)}</td>
                      <td className="py-1 text-right">{money(s.netProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </details>
        </Card>
        <div className="space-y-4">
          <GoalCard goal={d.goal} />
          <Card kicker="Every revenue dollar" title="Where it went">
            <Waterfall steps={d.waterfall} />
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card kicker="Top sellers" title="Products" action={<Link to={salesHref} preventScrollReset className="text-xs font-semibold text-plum">All products →</Link>}>
          <BreakdownTable rows={d.products} firstCol="Product" limit={5} compact />
        </Card>
        <Card kicker="Where orders come from" title="Channels & sources">
          <BreakdownTable rows={d.sources} firstCol="Source" showUnits={false} limit={6} compact />
        </Card>
      </div>

      {d.quality.length > 0 && <QualityNotes notes={d.quality} />}
    </div>
  )
}

function MiniStat({ label, value, delta, sub, goodWhenUp = true }: { label: string; value: string; delta?: number | null; sub?: string | undefined; goodWhenUp?: boolean }) {
  const show = delta !== undefined && delta !== null
  const up = (delta ?? 0) > 0
  const good = show && Math.abs(delta!) >= 0.05 ? up === goodWhenUp : null
  return (
    <div className="rounded-[12px] border border-line bg-paper px-3 py-2.5 min-w-0">
      <p className="text-[11px] text-ink-3 truncate">{label}</p>
      <p className="text-base font-semibold text-ink mt-0.5 truncate">{value}</p>
      <p className="text-[11px] text-ink-4 truncate">
        {show && <span className={`font-semibold mr-1 tabular-nums ${good == null ? 'text-ink-3' : good ? 'text-[#1F6B3A]' : 'text-[#A3261B]'}`}>{delta! > 0 ? '↑' : delta! < 0 ? '↓' : '→'}{Math.abs(delta!).toFixed(0)}%</span>}
        {sub}
      </p>
    </div>
  )
}

function GoalCard({ goal }: { goal: Data['goal'] }) {
  const pctDone = Math.round(goal.progress * 100)
  const projPct = goal.goal > 0 ? Math.max(0, Math.min(100, (goal.projected / goal.goal) * 100)) : 0
  return (
    <Card kicker={`${monthLabel(goal.month)} · day ${goal.daysElapsed} of ${goal.daysInMonth}`} title="Monthly profit goal">
      <div className="flex items-end justify-between gap-3">
        <p className="text-[28px] leading-none font-semibold text-ink">{moneyHeadline(goal.netProfitMtd)}</p>
        <p className="text-sm text-ink-3">of {moneyHeadline(goal.goal)}</p>
      </div>
      <div
        className="relative h-2.5 rounded-full bg-plum-soft mt-3 overflow-hidden"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={goal.goal}
        aria-valuenow={Math.max(0, goal.netProfitMtd)}
        aria-label="Net profit this month against the goal"
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-plum" style={{ width: `${pctDone}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-ink/40" style={{ left: `${projPct}%` }} title="Projected month end" />
      </div>
      <p className="text-xs text-ink-3 mt-2">
        At this month&apos;s pace: <span className="font-semibold text-ink">{money(goal.projected)}</span> by month end
        {goal.projected < goal.goal && goal.goal > 0 ? `, ${money(goal.goal - goal.projected)} short` : ''}.
      </p>
    </Card>
  )
}

function QualityNotes({ notes }: { notes: string[] }) {
  return (
    <Card kicker="Read this before trusting the totals" title="What these numbers do not include yet">
      <ul className="space-y-1.5 text-sm text-ink-2 list-disc pl-5">
        {notes.map(n => <li key={n}>{n}</li>)}
      </ul>
    </Card>
  )
}

function StatementTab({ d }: { d: Data }) {
  return (
    <div className="space-y-4">
      <Card kicker={windowLabel(d.range.from, d.range.to)} title="Profit & loss statement">
        <StatementTable rows={d.rows} prevRows={d.prevRows} netRevenue={d.cur.netRevenue} hasPrev={!!d.prev} />
      </Card>
      {d.months.length > 1 && (
        <Card kicker="Month by month" title="Monthly P&L">
          <MonthlyStatement columns={d.months} total={d.cur} />
        </Card>
      )}
      {d.months.length <= 1 && (
        <p className="text-xs text-ink-4">Pick a range that spans more than one month (try “Since first sale”) for the month-by-month view.</p>
      )}
      {d.quality.length > 0 && <QualityNotes notes={d.quality} />}
    </div>
  )
}

function SalesTab({ d }: { d: Data }) {
  return (
    <div className="space-y-4">
      <Card kicker="Net product revenue after discounts and returns" title="Products">
        <BreakdownTable rows={d.products} firstCol="Product" limit={25} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card kicker="Shopify product type" title="Categories">
          <BreakdownTable rows={d.categories} firstCol="Category" limit={10} />
        </Card>
        <Card kicker="Who is buying" title="New vs returning">
          <BreakdownTable rows={d.customers} firstCol="Customer" profitLabel="Profit after cost & fees" showUnits={false} />
        </Card>
        <Card kicker="Where the checkout happened" title="Sales channels">
          <BreakdownTable rows={d.channels} firstCol="Channel" profitLabel="Profit after cost & fees" showUnits={false} />
        </Card>
        <Card kicker="UTM and referrer at order time" title="Marketing sources">
          <BreakdownTable rows={d.sources} firstCol="Source" profitLabel="Profit after cost & fees" showUnits={false} />
        </Card>
      </div>
    </div>
  )
}

function MarketingTab({ d }: { d: Data }) {
  const [params] = useSearchParams()
  const costsHref = (() => { const p = new URLSearchParams(params); p.set('tab', 'costs'); p.delete('fresh'); return `/admin?${p}` })()
  const r = d.ratios
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Ad spend" value={money(d.cur.adSpend)} delta={deltaPct(d.cur.adSpend, d.prev?.adSpend)} goodWhenUp={false} />
        <MiniStat label="MER (revenue ÷ ad spend)" value={multiple(r.mer)} delta={d.prevRatios?.mer != null && r.mer != null ? deltaPct(r.mer, d.prevRatios.mer) : null} />
        <MiniStat label="Blended CAC" value={r.cac == null ? '—' : money(r.cac)} sub={`${count(d.cur.newCustomers)} new customers`} />
        <MiniStat label="Break-even CPA" value={money(r.breakevenCpa)} sub="gross profit per order" />
      </div>
      <Card
        kicker="Imported, monthly entries and logged ad expenses"
        title="Ad platforms"
        action={<Link to={costsHref} preventScrollReset className="text-xs font-semibold text-plum">Enter monthly ad spend →</Link>}
      >
        <AdPlatformsTable rows={d.platforms} netRevenue={d.cur.netRevenue} newCustomers={d.cur.newCustomers} />
        <p className="text-[11px] text-ink-4 mt-3">
          Platform orders and ROAS are what each platform claims. MER and CAC use Shopify&apos;s own revenue and new-customer count, so they cannot double count.
        </p>
      </Card>
      <Card kicker="After ads" title="Contribution">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Figure label="Gross profit" value={money(d.cur.grossProfit)} />
          <Figure label="Ad spend" value={`−${money(d.cur.adSpend)}`} />
          <Figure label="Contribution" value={money(d.cur.contribution)} strong />
          <Figure label="Contribution margin" value={pct(r.contributionMarginPct)} />
        </div>
      </Card>
    </div>
  )
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className={`tabular-nums ${strong ? 'font-semibold text-ink text-lg' : 'text-ink-2 text-base'}`}>{value}</p>
    </div>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="max-w-xl">
      <h1 className="font-display text-2xl text-ink mb-3">Profit &amp; Loss</h1>
      <div className="rounded-[14px] border border-line bg-paper p-5">
        <p className="font-semibold text-ink">The P&amp;L could not load.</p>
        <p className="text-sm text-ink-3 mt-1">{message}</p>
        <p className="text-sm text-ink-3 mt-2">Orders are read live from Shopify, so a Shopify outage or an expired token shows up here. <a href="/admin" className="link-coral">Try again</a>.</p>
      </div>
    </div>
  )
}
