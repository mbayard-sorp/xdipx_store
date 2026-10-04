/**
 * /admin/ad-studio/live: the Live tab (wires section 8).
 *
 * Loader filters, all URL state so back works: view (needs-action | all), lane,
 * platform, lookback (7 | 30), source (live | sample | shop-history). With no
 * source in the URL the loader picks a real one: live when creative rows exist,
 * else Shop history when an import exists, else live (the empty state).
 *
 * Actions (live-action, live-undo): a tap on a real creative goes through
 * applyRuleAction (paused_at, pause_reason, budget_multiplier, the event row,
 * the platform seam). A tap on a sample row only records the decision.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, isRouteErrorResponse, useLoaderData, useNavigation, useRevalidator, useRouteError, useSearchParams } from 'react-router'
import { getAdminUser, requireAdmin } from '~/lib/session.server'
import {
  AdMetricsError, isLiveActionKind, liveFacets, liveFeed, liveSourceCounts, recordLiveAction, undoLiveAction,
  type LiveSource,
} from '~/lib/ad-metrics.server'
import { applyRuleAction } from '~/lib/ad-rules.server'
import { FilterBar } from '~/components/admin/ads/FilterBar'
import { InstrumentBand, sourceChipText } from '~/components/admin/ads/InstrumentBand'
import { LiveRowCard } from '~/components/admin/ads/LiveRowCard'
import { LiveTable, ShopHistoryList } from '~/components/admin/ads/LiveTable'
import { laneLabel } from '~/components/admin/ads/LaneBadge'
import { EmptySlab, ErrorSlab, LiveRowSkeleton } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Live - Ad Studio - xdipx Admin' }]

const ACTION_PATH = '/admin/ad-studio/live'
const SOURCES: LiveSource[] = ['live', 'sample', 'shop-history']

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const view = url.searchParams.get('view') === 'all' ? 'all' : 'needs-action'
  const lookbackDays = url.searchParams.get('lookback') === '30' ? 30 : 7
  const lane = url.searchParams.get('lane') || null
  const platform = url.searchParams.get('platform') || null
  const sourceParam = url.searchParams.get('source')

  const counts = await liveSourceCounts()
  const source: LiveSource = SOURCES.includes(sourceParam as LiveSource)
    ? (sourceParam as LiveSource)
    : counts.live > 0 ? 'live' : counts.shopHistory > 0 ? 'shop-history' : 'live'

  // Facets come from the unfiltered feed so a filter never hides its own options.
  const all = await liveFeed({ filter: 'all', lookbackDays, source })
  const feed = await liveFeed({ filter: view, lane, platform, lookbackDays, source })
  return { view, lane, platform, lookbackDays, source, counts, feed, facets: liveFacets(all), allTotal: all.total }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const admin = await getAdminUser(request)
  const appliedBy = admin?.email || 'owner'
  try {
    if (intent === 'live-action') {
      const kind = String(form.get('kind') ?? '')
      if (!isLiveActionKind(kind)) return { ok: false as const, intent, error: 'Unknown action.' }
      const key = String(form.get('key') ?? '')
      if (!key.startsWith('sample:') && !(Number.isInteger(Number(key)) && Number(key) > 0)) {
        return { ok: false as const, intent, error: 'Unknown creative.' }
      }
      const ruleId = String(form.get('ruleId') ?? '') || null
      const resolves = Number(form.get('resolvesEventId'))
      const result = key.startsWith('sample:')
        ? await recordLiveAction({
            key, kind, ruleId, appliedBy,
            resolvesEventId: Number.isInteger(resolves) && resolves > 0 ? resolves : null,
          })
        : await applyRuleAction(Number(key), kind, appliedBy, { ruleId })
      return { ok: true as const, intent, eventId: result.eventId, message: result.message, kind }
    }
    if (intent === 'live-undo') {
      const id = Number(form.get('eventId'))
      if (!Number.isInteger(id) || id <= 0) return { ok: false as const, intent, error: 'Nothing to undo.' }
      await undoLiveAction(id, appliedBy)
      return { ok: true as const, intent, message: 'Undone.' }
    }
  } catch (err) {
    if (err instanceof AdMetricsError) return { ok: false as const, intent, error: err.message }
    console.error('[ad-studio live] action failed', err)
    return { ok: false as const, intent, error: 'That did not save. Try again.' }
  }
  return { ok: false as const, intent, error: 'Unknown intent.' }
}

export default function LiveTab() {
  const { view, lane, platform, lookbackDays, source, counts, feed, facets, allTotal } = useLoaderData<typeof loader>()
  const [, setParams] = useSearchParams()
  const navigation = useNavigation()
  const chip = sourceChipText(source)
  const loading = navigation.state === 'loading' && navigation.location?.pathname === ACTION_PATH

  function setParam(key: string, value: string | null) {
    setParams(prev => {
      const n = new URLSearchParams(prev)
      if (value) n.set(key, value); else n.delete(key)
      return n
    }, { preventScrollReset: true })
  }

  const header = (
    <div className="flex items-baseline justify-between gap-3">
      <h1 className="font-display text-xl md:text-2xl text-ink">Live</h1>
      {chip && (
        <span className="inline-flex items-center rounded-full border border-line bg-paper px-2 py-1 font-mono text-[11px] text-ink-2">
          {chip}
        </span>
      )}
    </div>
  )

  if (source === 'live' && feed.empty) {
    return (
      <div className="space-y-4">
        {header}
        <section className="rounded-2xl border border-line bg-paper p-6 text-left">
          <p className="kicker">Simulation</p>
          <h2 className="mt-2 font-display text-lg text-ink">Nothing is live, and that is on purpose.</h2>
          <p className="mt-1 max-w-[60ch] text-sm text-ink-2">
            For the first two weeks ads run with spend off. Rules R1 to R8 run against imported Shop Campaigns history and a seeded sample, so you can watch them fire before real money is behind them.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/admin/ad-studio/spend" className="inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-sm font-medium text-white">
              Import a CSV
            </Link>
            <Link to="?source=sample" className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4">
              Show the sample
            </Link>
          </div>
        </section>
      </div>
    )
  }

  const sourceLinks = (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
      <span className="font-mono uppercase tracking-wide">Source</span>
      {SOURCES.filter(s => s !== 'shop-history' || counts.shopHistory > 0).map(s => (
        <button
          key={s}
          type="button"
          aria-pressed={source === s}
          onClick={() => setParam('source', s)}
          className={`min-h-11 md:min-h-9 rounded-full border px-3 font-mono text-[11px] touch-manipulation ${source === s ? 'border-coral bg-coral-soft text-ink' : 'border-line bg-paper text-ink-3 hover:border-ink-4'}`}
        >
          {s === 'live' ? 'Live' : s === 'sample' ? 'Sample' : 'Shop history'}
        </button>
      ))}
    </div>
  )

  return (
    <div className="space-y-4">
      {header}
      <InstrumentBand band={feed.band} breakEven={feed.breakEven} source={source} onLookback={d => setParam('lookback', d === 7 ? null : String(d))} />
      {sourceLinks}

      {source === 'shop-history' ? (
        feed.shopHistory.length === 0
          ? <EmptySlab kicker="Shop history" heading="No Shop history imported." body="Import a Shop Campaigns export on the Spend tab." />
          : <ShopHistoryList days={feed.shopHistory} />
      ) : (
        <>
          <FilterBar
            segments={[
              { value: 'needs-action', label: `Needs action ${feed.needsAction}` },
              { value: 'all', label: `All ${feed.total}` },
            ]}
            segmentValue={view}
            onSegment={v => setParam('view', v === 'needs-action' ? null : v)}
            selects={[
              { key: 'lane', label: 'Lane', value: lane, options: facets.lanes, labels: Object.fromEntries(facets.lanes.map(l => [l, laneLabel(l)])) },
              { key: 'platform', label: 'Platform', value: platform, options: facets.platforms },
            ]}
            onSelect={(k, v) => setParam(k, v)}
            onClearAll={() => setParams(prev => {
              const n = new URLSearchParams(prev)
              n.delete('lane'); n.delete('platform')
              return n
            }, { preventScrollReset: true })}
          />

          {loading ? (
            <div className="space-y-3"><LiveRowSkeleton /><LiveRowSkeleton /><LiveRowSkeleton /></div>
          ) : feed.rows.length === 0 ? (
            allTotal > 0 && view === 'needs-action' ? (
              <EmptySlab
                kicker="All clear"
                heading="Nothing needs action."
                body={`${allTotal} creative${allTotal === 1 ? '' : 's'} read healthy or already paused.`}
                action={
                  <button type="button" onClick={() => setParam('view', 'all')} className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4">
                    See all
                  </button>
                }
              />
            ) : (
              <EmptySlab kicker="No match" heading="No creatives match these filters." action={
                <Link to="/admin/ad-studio/live" className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4">
                  Clear filters
                </Link>
              } />
            )
          ) : (
            <>
              <ul className="space-y-3 md:hidden" aria-busy={navigation.state === 'loading'}>
                {feed.rows.map(r => <li key={r.key} className="list-none"><LiveRowCard row={r} /></li>)}
              </ul>
              <div className="hidden md:block">
                <LiveTable rows={feed.rows} lookbackDays={lookbackDays} />
              </div>
            </>
          )}
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
      <h1 className="font-display text-xl md:text-2xl text-ink">Live</h1>
      <ErrorSlab
        title="Couldn't load Live."
        message={message}
        onRetry={() => revalidator.revalidate()}
        retrying={revalidator.state === 'loading'}
      />
    </div>
  )
}
