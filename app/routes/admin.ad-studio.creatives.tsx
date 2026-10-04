/**
 * /admin/ad-studio/creatives: the Creatives tab (wires section 5).
 *
 * Loader reads filters from search params (view, lane, concept, product,
 * rating, format, idea, blocked, group, limit) and pages by id. The action
 * takes the owner's rating (intent=feedback, intent=clear-feedback) and a
 * single-creative render retry (intent=render-creative), all behind
 * requireAdmin. Ratings never come from a team-token route.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, isRouteErrorResponse, useLoaderData, useNavigation, useRevalidator, useRouteError, useSearchParams } from 'react-router'
import { Fragment, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { getAdminUser, requireAdmin } from '~/lib/session.server'
import { handleAdFeedbackIntent } from '~/lib/ad-ideas.server'
import { getCreativeFacets, listCreatives, type ListCreativesFilters } from '~/lib/ad-creative-list.server'
import { CREATIVE_PAGE, CREATIVE_PAGE_MAX, CREATIVE_VIEWS, type CreativeListItem, type CreativeView } from '~/lib/ad-creative-types'
import { countCreativesToRate } from '~/lib/ad-ideas.server'
import { renderCreative } from '~/lib/ad-render.server'
import { getAdsSpendEnabled } from '~/lib/ad-settings.server'
import { ExportRefusal } from '~/lib/ad-export/common'
import { MetaPushError } from '~/lib/ad-export/meta-payload'
import { buildExport, getMetaPayload, pushCreativeToMeta } from '~/lib/ad-export/service.server'
import { getAdFormat } from '~/lib/ad-formats'
import { isFeedbackFilter } from '~/lib/ad-creative-feedback-reasons'
import { Reveal } from '~/components/motion/Reveal'
import { CreativeCard } from '~/components/admin/ads/CreativeCard'
import { FilterBar } from '~/components/admin/ads/FilterBar'
import { laneLabel } from '~/components/admin/ads/LaneBadge'
import { CreativeCardSkeleton, EmptySlab, ErrorSlab } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Creatives - Ad Studio - xdipx Admin' }]

const ACTION_PATH = '/admin/ad-studio/creatives'

function parseView(v: string | null): CreativeView {
  return (CREATIVE_VIEWS as readonly string[]).includes(v ?? '') ? (v as CreativeView) : 'to-rate'
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const view = parseView(url.searchParams.get('view'))
  const blocked = url.searchParams.get('blocked') === '1'
  const lane = url.searchParams.get('lane') || null
  const concept = url.searchParams.get('concept') || null
  const product = url.searchParams.get('product') || null
  const format = url.searchParams.get('format') || null
  const ratingRaw = url.searchParams.get('rating')
  const rating = isFeedbackFilter(ratingRaw) ? ratingRaw : null
  const ideaRaw = Number(url.searchParams.get('idea'))
  const ideaId = Number.isInteger(ideaRaw) && ideaRaw > 0 ? ideaRaw : null
  const group = url.searchParams.get('group') === 'idea'
  const limitRaw = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(CREATIVE_PAGE_MAX, Math.trunc(limitRaw)) : CREATIVE_PAGE

  const filters: ListCreativesFilters = { view, blocked, lane, concept, product, rating, format, ideaId, limit }
  const [page, facets, toRate, spendEnabled] = await Promise.all([
    listCreatives(filters), getCreativeFacets(), countCreativesToRate().catch(() => 0), getAdsSpendEnabled().catch(() => false),
  ])
  return {
    view, blocked, group, filters: { lane, concept, product, rating, format, ideaId },
    items: page.items, hasMore: page.nextCursor != null, limit, facets, toRate, spendEnabled,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  if (intent === 'feedback' || intent === 'clear-feedback') {
    const admin = await getAdminUser(request)
    return handleAdFeedbackIntent('creative', form, admin?.email || 'owner')
  }
  if (intent === 'render-creative') {
    const id = Number(form.get('creativeId'))
    if (!Number.isInteger(id) || id <= 0) return { ok: false as const, error: 'Bad creative id' }
    const out = await renderCreative(id)
    if (out.status === 'failed') return { ok: false as const, error: out.error ?? 'The render failed.' }
    if (out.status === 'skipped' && out.skipped !== 'already_rendered') return { ok: false as const, error: `Not rendered: ${out.skipped}` }
    return { ok: true as const, status: out.status }
  }
  if (intent === 'build-export') {
    const admin = await getAdminUser(request)
    const id = Number(form.get('creativeId'))
    if (!Number.isInteger(id) || id <= 0) return { ok: false as const, error: 'Bad creative id' }
    try {
      const out = await buildExport({ creativeIds: [id] }, admin?.email || 'owner')
      return { ok: true as const, summary: out.summary.lines, warnings: out.summary.warnings, filename: out.filename }
    } catch (err) {
      if (err instanceof ExportRefusal) return { ok: false as const, errorCode: err.code, error: err.issues.slice(0, 4).join(' ') }
      return { ok: false as const, error: err instanceof Error ? err.message : 'The export failed.' }
    }
  }
  if (intent === 'view-payload') {
    const id = Number(form.get('creativeId'))
    if (!Number.isInteger(id) || id <= 0) return { ok: false as const, error: 'Bad creative id' }
    const found = await getMetaPayload(id)
    if (!found) return { ok: false as const, error: 'No stored Meta payload on this creative. Build it first.' }
    return { ok: true as const, ...found }
  }
  if (intent === 'push-meta-draft') {
    // The only caller of push. The valve is checked inside, before anything else is read or sent.
    const admin = await getAdminUser(request)
    const id = Number(form.get('creativeId'))
    if (!Number.isInteger(id) || id <= 0) return { ok: false as const, error: 'Bad creative id' }
    try {
      const res = await pushCreativeToMeta(id, admin?.email || 'owner')
      return { ok: true as const, externalAdId: res.externalAdId }
    } catch (err) {
      if (err instanceof MetaPushError) return { ok: false as const, errorCode: err.code, error: err.message }
      return { ok: false as const, error: err instanceof Error ? err.message : 'The push failed.' }
    }
  }
  return { ok: false as const, error: 'Unknown intent' }
}

function ideaHeading(items: CreativeListItem[]): string {
  const first = items[0]!
  const concept = (first.conceptSlug ?? 'creative').replace(/[-_]+/g, ' ')
  return `idea #${first.ideaId} · ${concept} · ${items.length} ${items.length === 1 ? 'size' : 'sizes'}`
}

export default function CreativesTab() {
  const { view, blocked, group, filters, items, hasMore, limit, facets, toRate, spendEnabled } = useLoaderData<typeof loader>()
  const [, setParams] = useSearchParams()
  const navigation = useNavigation()
  const reduce = useReducedMotion()
  const [pinned, setPinned] = useState<Record<number, CreativeListItem>>({})

  const loadingMore = navigation.state === 'loading' && navigation.location?.pathname === ACTION_PATH

  function setParam(key: string, value: string | null, reset = true) {
    setParams(prev => {
      const n = new URLSearchParams(prev)
      if (value) n.set(key, value); else n.delete(key)
      if (reset && key !== 'limit') n.delete('limit')
      return n
    }, { preventScrollReset: true })
  }

  function onSheet(id: number, open: boolean) {
    setPinned(prev => {
      if (open) {
        const item = items.find(i => i.id === id)
        return item ? { ...prev, [id]: item } : prev
      }
      if (!(id in prev)) return prev
      const { [id]: _drop, ...rest } = prev
      return rest
    })
  }

  const shown = [...items]
  for (const item of Object.values(pinned)) if (!shown.some(i => i.id === item.id)) shown.push(item)
  shown.sort((a, b) => b.id - a.id)
  // Group by idea keeps each idea's rows together, newest idea first.
  const ordered = group
    ? [...shown].sort((a, b) => (b.ideaId ?? 0) - (a.ideaId ?? 0) || a.id - b.id)
    : shown

  const anyFilter = Boolean(filters.lane || filters.concept || filters.product || filters.rating || filters.format || filters.ideaId || blocked)
  const noneEver = facets.lanes.length === 0

  const clearKeys = ['lane', 'concept', 'product', 'rating', 'format', 'idea', 'blocked', 'limit']

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-display text-xl md:text-2xl text-ink">Creatives</h1>
        <p className="font-mono text-xs tabular-nums text-ink-3">{toRate} to rate</p>
      </div>

      <FilterBar
        segments={[
          { value: 'to-rate', label: 'To rate' },
          { value: 'hearted', label: 'Hearted' },
          { value: 'exported', label: 'Exported' },
          { value: 'all', label: 'All' },
        ]}
        segmentValue={blocked ? '' : view}
        onSegment={v => setParams(prev => {
          const n = new URLSearchParams(prev)
          if (v === 'to-rate') n.delete('view'); else n.set('view', v)
          n.delete('blocked'); n.delete('limit')
          return n
        }, { preventScrollReset: true })}
        selects={[
          { key: 'lane', label: 'Lane', value: filters.lane, options: facets.lanes, labels: Object.fromEntries(facets.lanes.map(l => [l, laneLabel(l)])) },
          { key: 'concept', label: 'Concept', value: filters.concept, options: facets.concepts, labels: Object.fromEntries(facets.concepts.map(c => [c, c.replace(/[-_]+/g, ' ')])) },
          { key: 'product', label: 'Product', value: filters.product, options: facets.products },
          { key: 'rating', label: 'Rating', value: filters.rating, options: ['loved', 'rejected', 'unrated'], labels: { loved: 'Loved', rejected: 'Rejected', unrated: 'Unrated' } },
          { key: 'format', label: 'Format', value: filters.format, options: facets.formats, labels: Object.fromEntries(facets.formats.map(f => [f, getAdFormat(f)?.label ?? f])) },
        ]}
        onSelect={(k, v) => setParam(k, v)}
        toggles={[
          { key: 'group', label: 'Group by idea', on: group, onToggle: on => setParam('group', on ? 'idea' : null, false) },
          { key: 'blocked', label: facets.blockedCount > 0 ? `Blocked (${facets.blockedCount})` : 'Blocked', on: blocked, onToggle: on => setParam('blocked', on ? '1' : null) },
        ]}
        chips={filters.ideaId ? [{ key: 'idea', label: `idea #${filters.ideaId}`, onClear: () => setParam('idea', null) }] : []}
        onClearAll={() => setParams(prev => {
          const n = new URLSearchParams(prev)
          for (const k of clearKeys) n.delete(k)
          return n
        }, { preventScrollReset: true })}
      />

      {ordered.length === 0 ? (
        anyFilter ? (
          <EmptySlab
            kicker="No match"
            heading="No creatives match these filters."
            action={
              <Link to="/admin/ad-studio/creatives" className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4">
                Clear filters
              </Link>
            }
          />
        ) : noneEver ? (
          <EmptySlab
            kicker="Simulation"
            heading="Nothing rendered yet."
            body="Creatives appear after you heart an idea and a render pass runs."
            action={
              <Link to="/admin/ad-studio/ideas" className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4">
                Rate ideas
              </Link>
            }
          />
        ) : (
          <EmptySlab
            kicker={view === 'to-rate' ? 'All caught up' : 'Nothing here'}
            heading={view === 'to-rate' ? 'Every creative is rated.' : view === 'hearted' ? 'No hearted creatives yet.' : view === 'exported' ? 'Nothing exported yet.' : 'No creatives yet.'}
            action={view !== 'to-rate' ? (
              <button type="button" onClick={() => setParam('view', null)} className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4">
                See creatives to rate
              </button>
            ) : undefined}
          />
        )
      ) : (
        <ul
          className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0 xl:grid-cols-3"
          aria-busy={navigation.state === 'loading'}
        >
          <AnimatePresence initial={false}>
            {ordered.map((item, i) => {
              const fmt = getAdFormat(item.format)
              const prev = ordered[i - 1]
              const startsGroup = group && (!prev || prev.ideaId !== item.ideaId)
              const groupItems = group ? ordered.filter(x => x.ideaId === item.ideaId) : []
              const card = (
                <CreativeCard
                  item={item}
                  action={ACTION_PATH}
                  priority={i === 0 ? 'high' : i === 1 ? 'eager' : 'lazy'}
                  spendEnabled={spendEnabled}
                  onRatingSheetChange={onSheet}
                />
              )
              return (
                <Fragment key={item.id}>
                  {startsGroup && (
                    <li className="list-none pt-2 font-mono text-[11px] text-ink-3 lg:col-span-full">{ideaHeading(groupItems)}</li>
                  )}
                  <motion.li
                    layout={!reduce}
                    {...(reduce ? {} : { exit: { opacity: 0, scale: 0.98, transition: { duration: 0.24, ease: [0.4, 0, 1, 1] as [number, number, number, number] } } })}
                    className={`list-none ${fmt?.spanWide ? 'lg:col-span-2' : ''}`}
                  >
                    {i >= 2 && i < 8 ? <Reveal variant="fade" index={i - 2}>{card}</Reveal> : card}
                  </motion.li>
                </Fragment>
              )
            })}
          </AnimatePresence>
          {loadingMore && (
            <>
              <li className="list-none"><CreativeCardSkeleton square /></li>
              <li className="list-none"><CreativeCardSkeleton /></li>
            </>
          )}
        </ul>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setParam('limit', String(Math.min(CREATIVE_PAGE_MAX, limit + CREATIVE_PAGE)), false)}
            disabled={loadingMore}
            className="min-h-11 rounded-full border border-line bg-paper px-5 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation"
          >
            {loadingMore ? 'Loading' : `Show ${CREATIVE_PAGE} more`}
          </button>
        </div>
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
      <h1 className="font-display text-xl md:text-2xl text-ink">Creatives</h1>
      <ErrorSlab
        title="Couldn't load creatives."
        message={message}
        onRetry={() => revalidator.revalidate()}
        retrying={revalidator.state === 'loading'}
      />
    </div>
  )
}
