/**
 * /admin/ads/tree: campaign > ad set > ad (ticket #16412, plan section 4, phase 3b).
 *
 * Read-only. One table inside ResponsiveTable: campaign rows open to their ad
 * sets, ad sets to their ads, indented inside the first cell. Every figure
 * comes from loadTree(), which reads Neon only, so no platform call happens
 * while this page loads.
 *
 * Expansion lives in component state, seeded from the `open` search param
 * and written back to it with history.replaceState. A reload or a shared link
 * keeps what was open, and opening a row never re-runs a loader.
 *
 * Filters are a plain GET form. The bulk checkboxes are drawn but disabled:
 * pause and resume arrive with the actions ledger in phase 5.
 */
import { Fragment, useCallback, useMemo, useState } from 'react'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Form, Link, isRouteErrorResponse, useLoaderData, useRevalidator, useRouteError, useSearchParams } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { loadTree } from '~/lib/ads/tree.server'
import {
  STATUS_FILTERS, allKeys, parseOpen, serializeOpen,
  type OrdersWindow, type StatusFilter, type TreeBudget, type TreeNode,
} from '~/lib/ads/tree-core'
import { ageWords } from '~/lib/ads/console-core'
import { formatMoney, formatRoas } from '~/lib/ad-metrics-core'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { EmptySlab, ErrorSlab } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Tree - Ads - xdipx Admin' }]


export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const now = new Date()
  const page = await loadTree({
    platform: url.searchParams.get('platform'),
    status: url.searchParams.get('status'),
    campaignId: url.searchParams.get('campaign'),
  }, undefined, now)
  return { page, now: now.toISOString() }
}

const BULK_TITLE = 'Arrives with the actions ledger (phase 5)'

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  active: 'Active',
  paused: 'Paused',
  disapproved: 'Disapproved',
}

const LEVEL_WORD: Record<TreeNode['level'], string> = { campaign: 'Campaign', adset: 'Ad set', ad: 'Ad' }

function statusWords(s: string | null): string {
  if (!s) return 'Unknown'
  const w = s.toLowerCase().replace(/_/g, ' ')
  return w.charAt(0).toUpperCase() + w.slice(1)
}

function statusTone(s: string | null): string {
  switch ((s ?? '').toUpperCase()) {
    case 'ACTIVE': return 'border-sage/30 bg-paper-2 text-sage'
    case 'DISAPPROVED': return 'border-red-300 bg-red-50 text-red-800'
    case 'WITH_ISSUES': return 'border-amber-300 bg-amber-50 text-amber-800'
    case 'PENDING_REVIEW':
    case 'IN_PROCESS': return 'border-plum/20 bg-plum-soft text-plum-2'
    default: return 'border-line bg-paper-2 text-ink-3'
  }
}

function StatusChip({ status }: { status: string | null }) {
  return (
    <span className={`inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 font-mono text-[10px] uppercase tracking-wide whitespace-nowrap ${statusTone(status)}`}>
      {statusWords(status)}
    </span>
  )
}

function budgetText(b: TreeBudget | null): { text: string; muted: boolean } {
  if (!b) return { text: 'n/a', muted: true }
  if (b.owner === 'campaign') return { text: 'Campaign budget', muted: true }
  if (b.owner === 'adset') return { text: 'Ad set budget', muted: true }
  return { text: b.kind === 'daily' ? `${formatMoney(b.cents)}/day` : `${formatMoney(b.cents)} lifetime`, muted: false }
}

function ordersText(o: OrdersWindow | null): string {
  return o ? String(o.orders) : 'n/a'
}

function roasText(o: OrdersWindow | null): string {
  if (!o || o.orders === 0) return 'n/a'
  return formatRoas(o.netRoas)
}

function roasTone(o: OrdersWindow | null): string {
  if (!o || o.roasOk == null) return 'text-ink'
  return o.roasOk ? 'text-sage' : 'text-red-800'
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th scope="col" className={`px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wide text-ink-3 whitespace-nowrap ${className}`}>{children}</th>
}

const NUM = 'px-3 py-2 align-top font-mono text-sm tabular-nums text-ink whitespace-nowrap'
const INDENT: Record<TreeNode['level'], string> = { campaign: 'pl-0', adset: 'pl-3 md:pl-5', ad: 'pl-6 md:pl-10' }

function TreeRow({ node, open, onToggle, unknownSpend, unknownOrders }: {
  node: TreeNode
  open: boolean
  onToggle: (key: string) => void
  unknownSpend: boolean
  unknownOrders: boolean
}) {
  const hasChildren = node.children.length > 0
  const budget = budgetText(node.budget)
  const money = (cents: number) => (unknownSpend ? 'unknown' : formatMoney(cents))
  const m7 = node.d7
  const n = node.children.length
  const childWord = node.level === 'campaign' ? (n === 1 ? 'ad set' : 'ad sets') : (n === 1 ? 'ad' : 'ads')
  return (
    <tr className={`border-t border-line ${node.level === 'campaign' ? 'bg-paper' : 'bg-paper-2'}`}>
      <td className={`sticky left-0 z-10 px-3 py-2 align-top ${node.level === 'campaign' ? 'bg-paper' : 'bg-paper-2'}`}>
        <div className={`flex w-[236px] items-start gap-1.5 md:w-[300px] md:gap-2 ${INDENT[node.level]}`}>
          <input
            type="checkbox"
            disabled
            title={BULK_TITLE}
            aria-label={`Select ${node.name} (${BULK_TITLE})`}
            className="mt-3 h-4 w-4 shrink-0 cursor-not-allowed opacity-50 md:mt-1.5"
          />
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggle(node.key)}
              aria-expanded={open}
              aria-label={`${open ? 'Close' : 'Open'} ${node.name}, ${node.children.length} ${childWord}`}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-mono text-sm text-ink-3 hover:bg-paper-3 touch-manipulation md:h-7 md:w-7"
            >
              <span aria-hidden="true" className={`inline-block transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>›</span>
            </button>
          ) : (
            <span aria-hidden="true" className="inline-block h-11 w-11 shrink-0 md:h-7 md:w-7" />
          )}
          <div className="min-w-0 flex-1 py-1 md:py-0.5">
            <p className="break-words text-sm font-medium leading-snug text-ink">{node.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusChip status={node.effectiveStatus} />
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink-4">
                {LEVEL_WORD[node.level]}{hasChildren ? `, ${node.children.length} ${childWord}` : ''}
              </span>
              {node.orphan && <span className="font-mono text-[10px] uppercase tracking-wide text-amber-800">parent not in mirror</span>}
            </div>
          </div>
        </div>
      </td>
      <td className={`${NUM} ${budget.muted ? 'text-ink-4' : ''}`}>{budget.text}</td>
      <td className={NUM}>{money(node.d1.spendCents)}</td>
      <td className={NUM} title={node.source7 === 'children' ? `Summed from its ${node.level === 'campaign' ? 'ad sets' : 'ads'}` : undefined}>{money(m7.spendCents)}</td>
      <td className={NUM}>{unknownSpend ? 'unknown' : m7.impressions.toLocaleString('en-US')}</td>
      <td className={NUM}>{unknownSpend || m7.ctrPct == null ? 'n/a' : `${m7.ctrPct.toFixed(2)}%`}</td>
      <td className={NUM}>{unknownSpend ? 'unknown' : m7.leads}</td>
      <td className={`${NUM} ${m7.cplOver ? 'text-red-800' : ''}`}>{unknownSpend || m7.cplCents == null ? 'n/a' : formatMoney(m7.cplCents)}</td>
      <td className={NUM}>
        {unknownOrders ? 'unknown' : ordersText(node.orders7)}
        {!unknownOrders && node.orders30 && <span className="block text-[11px] text-ink-3">30d {node.orders30.orders}</span>}
      </td>
      <td className={NUM}>{unknownOrders || !node.orders7 || node.orders7.cpaCents == null ? 'n/a' : formatMoney(node.orders7.cpaCents)}</td>
      <td className={`${NUM} ${unknownOrders ? '' : roasTone(node.orders7)}`} title={node.sharedCreative ? 'Creative shared with other ads: revenue over the spend of every ad carrying it' : undefined}>
        {unknownOrders ? 'unknown' : roasText(node.orders7)}
        {!unknownOrders && node.orders30 && <span className="block text-[11px] text-ink-3">30d {roasText(node.orders30)}</span>}
      </td>
      <td className="px-3 py-2 align-top text-sm whitespace-nowrap">
        <div className="flex flex-col items-start">
          {node.adsManagerHref && (
            <a href={node.adsManagerHref} target="_blank" rel="noreferrer" className="link-coral inline-flex min-h-11 items-center md:min-h-0">
              Ads Manager
            </a>
          )}
          {node.studioHref && node.creativeId != null && (
            <Link to={node.studioHref} className="link-coral inline-flex min-h-11 items-center md:min-h-0">
              Creative #{node.creativeId}{node.sharedCreative ? ' (shared)' : ''}
            </Link>
          )}
        </div>
      </td>
    </tr>
  )
}

function Rows({ nodes, isOpen, onToggle, unknownSpend, unknownOrders }: {
  nodes: TreeNode[]
  isOpen: (key: string) => boolean
  onToggle: (key: string) => void
  unknownSpend: boolean
  unknownOrders: boolean
}) {
  return (
    <>
      {nodes.map(n => {
        const open = isOpen(n.key)
        return (
          <Fragment key={n.key}>
            <TreeRow node={n} open={open} onToggle={onToggle} unknownSpend={unknownSpend} unknownOrders={unknownOrders} />
            {open && n.children.length > 0 && (
              <Rows nodes={n.children} isOpen={isOpen} onToggle={onToggle} unknownSpend={unknownSpend} unknownOrders={unknownOrders} />
            )}
          </Fragment>
        )
      })}
    </>
  )
}

export default function AdsTree() {
  const { page, now } = useLoaderData<typeof loader>()
  // Keyed on the filters, so a new filter starts from its own default expansion.
  const f = page.filters
  return <TreeView key={`${f.platform ?? ''}|${f.status}|${f.campaignId ?? ''}`} page={page} now={now} />
}

function TreeView({ page, now }: ReturnType<typeof useLoaderData<typeof loader>>) {
  const [searchParams] = useSearchParams()
  const everyKey = useMemo(() => allKeys(page.roots), [page.roots])

  // A status filter opens everything by default, so the matching rows are visible.
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => {
    const raw = searchParams.get('open')
    const parsed = parseOpen(raw)
    if (parsed.all || (raw == null && page.filters.status !== 'all')) return new Set(everyKey)
    return parsed.keys
  })

  const writeOpen = useCallback((keys: Set<string>) => {
    setOpenKeys(keys)
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const allOpen = everyKey.length > 0 && everyKey.every(k => keys.has(k))
    if (allOpen) url.searchParams.set('open', 'all')
    else if (keys.size === 0) url.searchParams.set('open', '')
    else url.searchParams.set('open', serializeOpen(keys))
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [everyKey])

  const onToggle = useCallback((key: string) => {
    const next = new Set(openKeys)
    if (next.has(key)) next.delete(key); else next.add(key)
    writeOpen(next)
  }, [openKeys, writeOpen])

  const isOpen = useCallback((key: string) => openKeys.has(key), [openKeys])
  const unknownSpend = page.failed.includes('insights')
  const unknownOrders = page.failed.includes('attributed orders')
  const filtered = page.filters.status !== 'all' || page.filters.campaignId != null
  const t = page.totals

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-xl md:text-2xl text-ink">Tree</h1>
        <p className="font-mono text-[11px] text-ink-3">
          {t.campaigns} campaign{t.campaigns === 1 ? '' : 's'}, {t.adsets} ad set{t.adsets === 1 ? '' : 's'}, {t.ads} ad{t.ads === 1 ? '' : 's'}.
          {' '}Synced {page.lastSyncedAt ? `${ageWords(Date.parse(now) - Date.parse(page.lastSyncedAt))} ago` : 'never'}.
        </p>
      </header>

      {page.simulation && (
        <p className="rounded-2xl border border-plum/20 bg-plum-soft px-4 py-3 text-sm text-plum-2">
          Simulation. Spend is off, so no ad money moves. This is what the mirror holds.
        </p>
      )}
      {page.failed.length > 0 && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Some reads failed ({page.failed.join(', ')}). The columns that depend on them say unknown.
        </p>
      )}

      <Form method="get" className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-wide text-ink-3">Status</span>
          <select
            name="status"
            defaultValue={page.filters.status}
            className="min-h-11 rounded-xl border border-line bg-paper px-3 text-sm text-ink md:min-h-9"
          >
            {STATUS_FILTERS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-wide text-ink-3">Campaign</span>
          <select
            name="campaign"
            defaultValue={page.filters.campaignId ?? ''}
            className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-paper px-3 text-sm text-ink md:min-h-9 md:w-auto md:max-w-[360px]"
          >
            <option value="">All campaigns</option>
            {page.campaigns.map(c => <option key={c.externalId} value={c.externalId}>{c.name}</option>)}
          </select>
        </label>
        {page.filters.platform && <input type="hidden" name="platform" value={page.filters.platform} />}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-sm font-medium text-white touch-manipulation md:min-h-9">
            Filter
          </button>
          {filtered && (
            <Link to="/admin/ads/tree" className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 md:min-h-9">
              Clear
            </Link>
          )}
        </div>
      </Form>

      {page.roots.length === 0 ? (
        t.campaigns + t.adsets + t.ads === 0 ? (
          <EmptySlab
            kicker="Mirror"
            heading="The mirror is empty."
            body="The entity sync has not written any campaigns yet. It runs every six hours, and the tree fills in after its first pass."
          />
        ) : (
          <EmptySlab
            kicker="No match"
            heading="Nothing matches these filters."
            action={
              <Link to="/admin/ads/tree" className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4">
                Clear filters
              </Link>
            }
          />
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => writeOpen(new Set(everyKey))}
              className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-ink hover:border-ink-4 touch-manipulation md:min-h-9"
            >
              Open all
            </button>
            <button
              type="button"
              onClick={() => writeOpen(new Set())}
              className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-ink hover:border-ink-4 touch-manipulation md:min-h-9"
            >
              Close all
            </button>
            <span className="font-mono text-[11px] text-ink-3">{page.shown} row{page.shown === 1 ? '' : 's'} match</span>
          </div>

          <ResponsiveTable className="rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[1180px] border-collapse">
              <thead>
                <tr className="bg-paper">
                  <th scope="col" className="sticky left-0 z-20 bg-paper px-3 py-2 text-left">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        disabled
                        title={BULK_TITLE}
                        aria-label={`Select all (${BULK_TITLE})`}
                        className="h-4 w-4 cursor-not-allowed opacity-50"
                      />
                      <span className="font-mono text-[11px] font-medium uppercase tracking-wide text-ink-3">Name</span>
                    </div>
                  </th>
                  <Th>Budget</Th>
                  <Th>Spend 1d</Th>
                  <Th>Spend 7d</Th>
                  <Th>Impr. 7d</Th>
                  <Th>CTR 7d</Th>
                  <Th>Leads 7d</Th>
                  <Th>CPL 7d</Th>
                  <Th>Orders 7d</Th>
                  <Th>CPA 7d</Th>
                  <Th>Net ROAS 7d</Th>
                  <Th>Links</Th>
                </tr>
              </thead>
              <tbody>
                <Rows nodes={page.roots} isOpen={isOpen} onToggle={onToggle} unknownSpend={unknownSpend} unknownOrders={unknownOrders} />
              </tbody>
            </table>
          </ResponsiveTable>

          <p className="max-w-prose text-xs text-ink-3">
            Days are UTC, ending {page.today}. A campaign or ad set with no insight rows of its own shows the sum of what sits under it.
            CPL turns red above the {formatMoney(page.leadCplCeilingCents)} ceiling. Orders and net ROAS come from attributed Shopify orders on each ad&apos;s creative,
            and each creative counts once under a parent. ROAS is green at or above break-even ({formatRoas(page.breakEvenRoas)}).
            {t.removedHidden > 0 ? ` ${t.removedHidden} row${t.removedHidden === 1 ? '' : 's'} the platform no longer returns ${t.removedHidden === 1 ? 'is' : 'are'} hidden.` : ''}
          </p>
        </>
      )}
    </div>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  const revalidator = useRevalidator()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl md:text-2xl text-ink">Tree</h1>
      <ErrorSlab
        title="Couldn't load the tree."
        message={message}
        onRetry={() => revalidator.revalidate()}
        retrying={revalidator.state === 'loading'}
      />
    </div>
  )
}
