import { useEffect, useRef } from 'react'
import { useFetcher } from 'react-router'
import {
  AD_PLATFORM_SUGGESTIONS, EXPENSE_CATEGORIES, NALPAC_SHIPPING_RATES, PNL_EPOCH, addDays, daysInMonth, expenseCategoryLabel,
  type ExpenseRow, type FixedCostRow, type ManualAdSpendRow,
} from '~/lib/pnl-core'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { Card } from './Card'
import { dayLabel, money, monthLabel } from './format'

type ActionResult = { ok: boolean; message?: string; error?: string } | undefined

const input = 'w-full rounded-[10px] border border-line-2 bg-paper px-3 py-2 text-sm focus:outline-none focus:border-plum'
const btn = 'inline-flex items-center justify-center rounded-[10px] bg-ink text-paper text-sm font-semibold px-4 py-2 hover:bg-ink-2 disabled:opacity-50'
const th = 'font-medium pb-2 text-[11px] uppercase tracking-[0.08em] text-ink-3'

function Status({ data }: { data: ActionResult }) {
  if (!data) return null
  return (
    <p role="status" className={`text-xs mt-2 ${data.ok ? 'text-[#1F6B3A]' : 'text-[#A3261B]'}`}>
      {data.ok ? data.message : data.error}
    </p>
  )
}

/** Resets a form after its fetcher comes back successful. */
function useResetOnSuccess(fetcher: { state: string; data: unknown }) {
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (fetcher.state === 'idle' && (fetcher.data as ActionResult)?.ok) ref.current?.reset()
  }, [fetcher.state, fetcher.data])
  return ref
}

export function CostsPanel({
  isOwner, today, handlingFeePerOrder, fixed, expenses, expensesReady, manualAds, manualAdsReady,
}: {
  isOwner: boolean
  today: string
  handlingFeePerOrder: number | null
  fixed: FixedCostRow[]
  expenses: ExpenseRow[]
  expensesReady: boolean
  manualAds: ManualAdSpendRow[]
  manualAdsReady: boolean
}) {
  const ful = useFetcher<ActionResult>()
  const addFixed = useFetcher<ActionResult>()
  const endFixed = useFetcher<ActionResult>()
  const addExp = useFetcher<ActionResult>()
  const delExp = useFetcher<ActionResult>()
  const fixedRef = useResetOnSuccess(addFixed)
  const expRef = useResetOnSuccess(addExp)

  const current = fixed.filter(f => !f.effectiveTo || f.effectiveTo > today)
  const past = fixed.filter(f => f.effectiveTo && f.effectiveTo <= today)
  const monthlyTotal = current.filter(f => f.effectiveFrom <= today).reduce((s, f) => s + f.monthlyUsd, 0)

  return (
    <div className="space-y-4">
      {!isOwner && (
        <p className="text-sm text-ink-3 bg-paper-2 border border-line rounded-[10px] px-3 py-2">Only the owner can change costs. Everything here is read-only for you.</p>
      )}

      <AdSpendByMonth isOwner={isOwner} today={today} rows={manualAds} ready={manualAdsReady} />

      <Card kicker="Cost of sales" title="Shipping">
        <p className="text-sm text-ink-3 mb-3 max-w-2xl">
          Every order that ships is charged Nalpac&apos;s average rate for the method the customer chose and where it went.
          The cost applies even when the customer got free shipping, since Nalpac still bills it.
        </p>
        <ResponsiveTable className="mb-4">
          <table className="w-full min-w-[340px] text-sm">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Shopify rate</th>
                <th className={`${th} text-left`}>Nalpac rate</th>
                <th className={`${th} text-right`}>Our cost</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(NALPAC_SHIPPING_RATES).map(r => (
                <tr key={r.label} className="border-t border-line">
                  <td className="py-2 pr-3">{r.label}</td>
                  <td className="py-2 pr-3 text-ink-3">{r.nalpac}</td>
                  <td className="py-2 text-right tabular-nums">{money(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
        <p className="text-xs text-ink-4 mb-4">These rates are set in code (app/lib/pnl-core.ts). When Nalpac changes them, they get updated there.</p>

        <p className="text-sm text-ink-2 font-semibold">Extra handling fee per order (optional)</p>
        <p className="text-sm text-ink-3 mb-3 max-w-2xl">
          Anything Nalpac or anyone else charges per order on top of shipping, such as a drop-ship or packaging fee. Leave it blank if there is none.
        </p>
        <ful.Form method="post" className="flex flex-col gap-3 md:flex-row md:items-end">
          <input type="hidden" name="intent" value="save-handling" />
          <label className="block md:w-56">
            <span className="text-xs text-ink-3">Dollars per order</span>
            <input name="amount" inputMode="decimal" defaultValue={handlingFeePerOrder ? handlingFeePerOrder.toFixed(2) : ''} placeholder="e.g. 2.00" className={input} disabled={!isOwner} />
          </label>
          <button type="submit" className={btn} disabled={!isOwner || ful.state !== 'idle'}>{ful.state !== 'idle' ? 'Saving…' : 'Save'}</button>
        </ful.Form>
        <Status data={ful.data} />
      </Card>

      <Card kicker="Operating expenses" title="Software & subscriptions" action={<p className="text-sm text-ink-3 tabular-nums">{money(monthlyTotal)}/month now</p>}>
        <p className="text-sm text-ink-3 mb-3 max-w-2xl">
          Recurring vendor costs: Shopify plan, Vercel, Neon, Klaviyo, Sanity, the Claude Max subscription, Twilio and so on.
          Each one is spread evenly over the days it was in force. Adding a new price for a vendor ends the old one the day the new one starts.
        </p>
        {fixed.length > 0 && (
          <ResponsiveTable className="mb-4">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr>
                  <th className={`${th} text-left`}>Vendor</th>
                  <th className={`${th} text-right`}>Monthly</th>
                  <th className={`${th} text-left pl-4`}>In force</th>
                  <th className={`${th} text-right`} />
                </tr>
              </thead>
              <tbody>
                {[...current, ...past].map(f => {
                  const ended = !!f.effectiveTo && f.effectiveTo <= today
                  return (
                    <tr key={f.id} className={`border-t border-line ${ended ? 'text-ink-4' : ''}`}>
                      <td className="py-2 pr-3">{f.vendor}{f.note && <span className="block text-[11px] text-ink-4">{f.note}</span>}</td>
                      <td className="py-2 text-right tabular-nums">{money(f.monthlyUsd)}</td>
                      <td className="py-2 pl-4 text-ink-3 whitespace-nowrap">{dayLabel(f.effectiveFrom)} → {f.effectiveTo ? dayLabel(f.effectiveTo) : 'now'}</td>
                      <td className="py-2 text-right">
                        {isOwner && !ended && (
                          <endFixed.Form method="post" className="inline-flex items-center gap-2">
                            <input type="hidden" name="intent" value="end-fixed" />
                            <input type="hidden" name="id" value={f.id} />
                            <input type="date" name="end" defaultValue={today} aria-label={`End date for ${f.vendor}`} className="rounded-[8px] border border-line-2 px-2 py-1 text-xs" />
                            <button type="submit" className="text-xs font-semibold text-plum hover:text-plum-2" disabled={endFixed.state !== 'idle'}>End</button>
                          </endFixed.Form>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ResponsiveTable>
        )}
        <Status data={endFixed.data} />
        {isOwner && (
          <addFixed.Form ref={fixedRef} method="post" className="grid grid-cols-2 gap-3 md:grid-cols-[1.4fr_0.8fr_0.9fr_1.4fr_auto] md:items-end">
            <input type="hidden" name="intent" value="add-fixed" />
            <label className="block col-span-2 md:col-span-1"><span className="text-xs text-ink-3">Vendor</span><input name="vendor" required maxLength={48} placeholder="Vercel" className={input} /></label>
            <label className="block"><span className="text-xs text-ink-3">Per month</span><input name="monthly" required inputMode="decimal" placeholder="20.00" className={input} /></label>
            <label className="block"><span className="text-xs text-ink-3">Since</span><input name="from" type="date" required defaultValue={today} className={input} /></label>
            <label className="block col-span-2 md:col-span-1"><span className="text-xs text-ink-3">Note (optional)</span><input name="note" maxLength={200} placeholder="Pro plan" className={input} /></label>
            <button type="submit" className={`${btn} col-span-2 md:col-span-1`} disabled={addFixed.state !== 'idle'}>{addFixed.state !== 'idle' ? 'Adding…' : 'Add'}</button>
          </addFixed.Form>
        )}
        <Status data={addFixed.data} />
      </Card>

      <Card kicker="One-off" title="Expenses">
        <p className="text-sm text-ink-3 mb-3 max-w-2xl">
          Dated money out that no integration reports. Advertising lands in the marketing section beside imported platform spend,
          shipping & fulfillment in cost of sales, and the rest in operating expenses.
        </p>
        {!expensesReady ? (
          <p className="text-sm text-ink-3 bg-paper-2 border border-line rounded-[10px] px-3 py-2">
            The expenses table arrives with migration 119, which the production build applies on the next deploy.
          </p>
        ) : (
          <>
            {isOwner && (
              <addExp.Form ref={expRef} method="post" className="grid grid-cols-2 gap-3 md:grid-cols-[0.9fr_1.1fr_1.2fr_0.8fr_1.4fr_auto] md:items-end mb-4">
                <input type="hidden" name="intent" value="add-expense" />
                <label className="block"><span className="text-xs text-ink-3">Date</span><input name="date" type="date" required defaultValue={today} className={input} /></label>
                <label className="block">
                  <span className="text-xs text-ink-3">Category</span>
                  <select name="category" required className={input} defaultValue="advertising">
                    {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
                <label className="block col-span-2 md:col-span-1"><span className="text-xs text-ink-3">Paid to</span><input name="vendor" required maxLength={80} placeholder="Reddit Ads" className={input} /></label>
                <label className="block"><span className="text-xs text-ink-3">Amount</span><input name="amount" required inputMode="decimal" placeholder="45.00" className={input} /></label>
                <label className="block"><span className="text-xs text-ink-3">Note (optional)</span><input name="note" maxLength={300} className={input} /></label>
                <button type="submit" className={`${btn} col-span-2 md:col-span-1`} disabled={addExp.state !== 'idle'}>{addExp.state !== 'idle' ? 'Logging…' : 'Log it'}</button>
              </addExp.Form>
            )}
            <Status data={addExp.data} />
            <Status data={delExp.data} />
            {expenses.length === 0 ? (
              <p className="text-sm text-ink-4">No expenses logged yet.</p>
            ) : (
              <ResponsiveTable>
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr>
                      <th className={`${th} text-left`}>Date</th>
                      <th className={`${th} text-left`}>Category</th>
                      <th className={`${th} text-left`}>Paid to</th>
                      <th className={`${th} text-right`}>Amount</th>
                      <th className={`${th} text-right`} />
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map(e => (
                      <tr key={e.id} className="border-t border-line">
                        <td className="py-2 pr-3 whitespace-nowrap text-ink-3">{dayLabel(e.day)}</td>
                        <td className="py-2 pr-3 text-ink-3">{expenseCategoryLabel(e.category)}</td>
                        <td className="py-2 pr-3">{e.vendor}{e.note && <span className="block text-[11px] text-ink-4">{e.note}</span>}</td>
                        <td className="py-2 text-right tabular-nums">{money(e.amount)}</td>
                        <td className="py-2 text-right">
                          {isOwner && (
                            <delExp.Form method="post" onSubmit={ev => { if (!confirm(`Delete the ${money(e.amount)} expense to ${e.vendor}?`)) ev.preventDefault() }}>
                              <input type="hidden" name="intent" value="delete-expense" />
                              <input type="hidden" name="id" value={e.id} />
                              <button type="submit" className="text-xs font-semibold text-ink-3 hover:text-[#A3261B]">Delete</button>
                            </delExp.Form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ResponsiveTable>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

/**
 * One total per platform per month, typed in until the platform's spend is
 * imported. Saving the same platform and month again replaces the figure.
 */
function AdSpendByMonth({ isOwner, today, rows, ready }: { isOwner: boolean; today: string; rows: ManualAdSpendRow[]; ready: boolean }) {
  const save = useFetcher<ActionResult>()
  const del = useFetcher<ActionResult>()
  const formRef = useResetOnSuccess(save)
  const thisMonth = today.slice(0, 7)

  const months = new Map<string, ManualAdSpendRow[]>()
  for (const r of rows) {
    const m = r.from.slice(0, 7)
    months.set(m, [...(months.get(m) ?? []), r])
  }

  return (
    <Card kicker="Marketing" title="Ad spend by month">
      <p className="text-sm text-ink-3 mb-3 max-w-2xl">
        Until each platform is imported automatically, type what each one billed for the month. Past months are spread evenly over the month.
        For the current month, enter the total so far: it covers the 1st through today, and entering it again later replaces it.
      </p>
      {!ready ? (
        <p className="text-sm text-ink-3 bg-paper-2 border border-line rounded-[10px] px-3 py-2">
          This arrives with migration 120, which the production build applies on the next deploy.
        </p>
      ) : (
        <>
          {isOwner && (
            <save.Form ref={formRef} method="post" className="grid grid-cols-2 gap-3 md:grid-cols-[1.3fr_1fr_0.8fr_1.3fr_auto] md:items-end mb-2">
              <input type="hidden" name="intent" value="save-ad-spend" />
              <label className="block col-span-2 md:col-span-1">
                <span className="text-xs text-ink-3">Platform</span>
                <input name="platform" required maxLength={40} list="pnl-ad-platforms" placeholder="Meta" className={input} autoComplete="off" />
                <datalist id="pnl-ad-platforms">
                  {AD_PLATFORM_SUGGESTIONS.map(p => <option key={p} value={p} />)}
                </datalist>
              </label>
              <label className="block">
                <span className="text-xs text-ink-3">Month</span>
                <input name="month" type="month" required min={PNL_EPOCH.slice(0, 7)} max={thisMonth} defaultValue={thisMonth} className={input} />
              </label>
              <label className="block">
                <span className="text-xs text-ink-3">Amount</span>
                <input name="amount" required inputMode="decimal" placeholder="250.00" className={input} />
              </label>
              <label className="block col-span-2 md:col-span-1">
                <span className="text-xs text-ink-3">Note (optional)</span>
                <input name="note" maxLength={200} placeholder="From the Meta invoice" className={input} />
              </label>
              <button type="submit" className={`${btn} col-span-2 md:col-span-1`} disabled={save.state !== 'idle'}>{save.state !== 'idle' ? 'Saving…' : 'Save'}</button>
            </save.Form>
          )}
          <Status data={save.data} />
          <Status data={del.data} />
          {rows.length === 0 ? (
            <p className="text-sm text-ink-4 mt-3">No ad spend entered yet.</p>
          ) : (
            <ResponsiveTable className="mt-4">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr>
                    <th className={`${th} text-left`}>Month</th>
                    <th className={`${th} text-left`}>Platform</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={`${th} text-right`} />
                  </tr>
                </thead>
                <tbody>
                  {[...months.entries()].map(([m, list]) => (
                    list.map((r, i) => {
                      const partial = r.to !== addDays(`${m}-01`, daysInMonth(`${m}-01`) - 1)
                      return (
                        <tr key={r.id} className={`border-t ${i === 0 ? 'border-line-2' : 'border-line'}`}>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {i === 0 && (
                              <>
                                <span className="font-semibold text-ink">{monthLabel(m)}</span>
                                <span className="block text-[11px] text-ink-4 tabular-nums">{money(list.reduce((sum, x) => sum + x.amount, 0))} total</span>
                              </>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            {r.platform}
                            {partial && <span className="block text-[11px] text-ink-4">through {dayLabel(r.to)}</span>}
                            {r.note && <span className="block text-[11px] text-ink-4">{r.note}</span>}
                          </td>
                          <td className="py-2 text-right tabular-nums">{money(r.amount)}</td>
                          <td className="py-2 text-right">
                            {isOwner && (
                              <del.Form method="post" onSubmit={ev => { if (!confirm(`Delete ${r.platform} for ${monthLabel(m)}?`)) ev.preventDefault() }}>
                                <input type="hidden" name="intent" value="delete-ad-spend" />
                                <input type="hidden" name="id" value={r.id} />
                                <button type="submit" className="text-xs font-semibold text-ink-3 hover:text-[#A3261B]">Delete</button>
                              </del.Form>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          )}
        </>
      )}
    </Card>
  )
}
