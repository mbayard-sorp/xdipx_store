/**
 * /admin/ad-studio/ideas: the Ideas tab (wires section 4).
 *
 * Loader reads filters from search params (view, lane, concept, product,
 * archived, limit). The action takes the owner's heart / thumbs-down
 * (intent=feedback, intent=clear-feedback) behind requireAdmin; the write path
 * is never a team-token route, so the ads routine's training signal cannot
 * feed on itself. A heart also moves the idea to hearted and a thumbs-down to
 * rejected (see setIdeaFeedback).
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, isRouteErrorResponse, useLoaderData, useNavigation, useRevalidator, useRouteError, useSearchParams } from 'react-router'
import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { getAdminUser, requireAdmin } from '~/lib/session.server'
import {
  getIdeaFacets, handleAdFeedbackIntent, isAdLane, listIdeas, type ListIdeasFilters,
} from '~/lib/ad-ideas.server'
import type { IdeaListItem } from '~/lib/ad-idea-types'
import { nextRenderPassLabel } from '~/lib/ad-passes'
import { renderIdeaNow } from '~/lib/ad-render.server'
import { Reveal } from '~/components/motion/Reveal'
import { IdeaCard } from '~/components/admin/ads/IdeaCard'
import { FilterBar } from '~/components/admin/ads/FilterBar'
import { laneLabel } from '~/components/admin/ads/LaneBadge'
import { EmptySlab, ErrorSlab, IdeaCardSkeleton } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Ideas - Ad Studio - xdipx Admin' }]

const VIEWS = ['to-rate', 'hearted', 'rejected', 'all'] as const
type View = typeof VIEWS[number]
const PAGE = 20
const PAGE_MAX = 100
const ACTION_PATH = '/admin/ad-studio/ideas'

function parseView(v: string | null): View {
  return (VIEWS as readonly string[]).includes(v ?? '') ? (v as View) : 'to-rate'
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const view = parseView(url.searchParams.get('view'))
  const laneRaw = url.searchParams.get('lane')
  const lane = isAdLane(laneRaw) ? laneRaw : null
  const concept = url.searchParams.get('concept') || null
  const product = url.searchParams.get('product') || null
  const archived = url.searchParams.get('archived') === '1'
  const limitRaw = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(PAGE_MAX, Math.trunc(limitRaw)) : PAGE

  const filters: ListIdeasFilters = { lane, concept, product, limit }
  if (archived) filters.status = 'archived'
  else if (view === 'to-rate') { filters.status = 'proposed'; filters.rating = 'unrated' }
  else if (view === 'hearted') filters.rating = 'loved'
  else if (view === 'rejected') filters.rating = 'rejected'

  const [page, facets] = await Promise.all([listIdeas(filters), getIdeaFacets()])
  return {
    view,
    archived,
    filters: { lane, concept, product },
    items: page.items,
    hasMore: page.nextCursor != null,
    limit,
    facets,
    nextPassLabel: nextRenderPassLabel(new Date()),
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  if (intent === 'feedback' || intent === 'clear-feedback') {
    const admin = await getAdminUser(request)
    return handleAdFeedbackIntent('idea', form, admin?.email || 'owner')
  }
  if (intent === 'render-now') {
    const admin = await getAdminUser(request)
    const ideaId = Number(form.get('ideaId'))
    if (!Number.isInteger(ideaId) || ideaId <= 0) return { ok: false as const, error: 'Bad idea id' }
    const res = await renderIdeaNow(ideaId, admin?.email || 'owner', { budgetMs: 200_000 })
    const skipped = [
      ...res.enqueue.skipped.map(s => `${s.format ? `${s.format}: ` : ''}${s.reason.replace(/_/g, ' ')}`),
      ...res.outcomes.filter(o => o.status === 'skipped' && o.skipped !== 'already_rendered').map(o => `#${o.creativeId}: ${o.skipped}`),
    ]
    const failedRows = res.outcomes.filter(o => o.status === 'failed')
    if (res.outcomes.length === 0 && skipped.length > 0) return { ok: false as const, error: `Nothing rendered. ${skipped.join('; ')}` }
    return {
      ok: true as const,
      ideaId,
      rendered: res.outcomes.filter(o => o.status === 'draft' && o.skipped !== 'already_rendered').length,
      blocked: res.outcomes.filter(o => o.status === 'blocked').length,
      failed: failedRows.length,
      deferred: res.deferred.length,
      skipped: [...skipped, ...failedRows.map(o => `#${o.creativeId}: ${o.error ?? 'failed'}`)],
    }
  }
  return { ok: false as const, error: 'Unknown intent' }
}

export default function IdeasTab() {
  const { view, archived, filters, items, hasMore, limit, facets, nextPassLabel } = useLoaderData<typeof loader>()
  const [, setParams] = useSearchParams()
  const navigation = useNavigation()
  const reduce = useReducedMotion()
  // Cards whose rating sheet is open stay on screen even after the loader drops them,
  // then leave (with the exit animation) when the sheet closes.
  const [pinned, setPinned] = useState<Record<number, IdeaListItem>>({})

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

  const anyFilter = Boolean(filters.lane || filters.concept || filters.product || archived)
  const noIdeasEver = facets.lanes.length === 0

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-display text-xl md:text-2xl text-ink">Ideas</h1>
        <p className="font-mono text-xs tabular-nums text-ink-3">{facets.toRate} to rate</p>
      </div>

      <FilterBar
        segments={[
          { value: 'to-rate', label: 'To rate' },
          { value: 'hearted', label: 'Hearted' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'all', label: 'All' },
        ]}
        segmentValue={view}
        onSegment={v => setParam('view', v === 'to-rate' ? null : v)}
        selects={[
          { key: 'lane', label: 'Lane', value: filters.lane, options: facets.lanes, labels: Object.fromEntries(facets.lanes.map(l => [l, laneLabel(l)])) },
          { key: 'concept', label: 'Concept', value: filters.concept, options: facets.concepts, labels: Object.fromEntries(facets.concepts.map(c => [c, c.replace(/[-_]+/g, ' ')])) },
          { key: 'product', label: 'Product', value: filters.product, options: facets.products },
        ]}
        onSelect={(k, v) => setParam(k, v)}
        archived={archived}
        onArchived={on => setParam('archived', on ? '1' : null)}
        onClearAll={() => setParams(prev => {
          const n = new URLSearchParams(prev)
          for (const k of ['lane', 'concept', 'product', 'archived', 'limit']) n.delete(k)
          return n
        }, { preventScrollReset: true })}
      />

      {shown.length === 0 ? (
        anyFilter ? (
          <EmptySlab
            kicker="No match"
            heading="No ideas match these filters."
            action={
              <Link to="/admin/ad-studio/ideas" className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4">
                Clear filters
              </Link>
            }
          />
        ) : view === 'to-rate' && noIdeasEver ? (
          <EmptySlab
            kicker="Simulation"
            heading="No ideas yet today."
            body="The ads routine files 10 to 20 ideas at 14:30 UTC. Ratings you leave now shape tomorrow's batch."
          />
        ) : view === 'to-rate' ? (
          <EmptySlab
            kicker="All caught up"
            heading="Every idea is rated."
            body="Hearted ones render on the next pass."
            action={
              <Link to="/admin/ad-studio/creatives" className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4">
                Go to Creatives
              </Link>
            }
          />
        ) : (
          <EmptySlab
            kicker="Nothing here"
            heading={view === 'hearted' ? 'No hearted ideas yet.' : view === 'rejected' ? 'No rejected ideas yet.' : 'No ideas yet.'}
            action={
              <button
                type="button"
                onClick={() => setParam('view', null)}
                className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4"
              >
                See ideas to rate
              </button>
            }
          />
        )
      ) : (
        <ul className="space-y-3 lg:space-y-4 xl:grid xl:grid-cols-2 xl:gap-4 xl:space-y-0" aria-busy={navigation.state === 'loading'}>
          <AnimatePresence initial={false}>
            {shown.map((idea, i) => (
              <motion.li
                key={idea.id}
                layout={!reduce}
                {...(reduce ? {} : { exit: { opacity: 0, scale: 0.98, transition: { duration: 0.24, ease: [0.4, 0, 1, 1] as [number, number, number, number] } } })}
                className="list-none"
              >
                {i < 8 ? (
                  <Reveal variant="fade" index={i}>
                    <IdeaCard idea={idea} action={ACTION_PATH} nextPassLabel={nextPassLabel} onRatingSheetChange={onSheet} />
                  </Reveal>
                ) : (
                  <IdeaCard idea={idea} action={ACTION_PATH} nextPassLabel={nextPassLabel} onRatingSheetChange={onSheet} />
                )}
              </motion.li>
            ))}
          </AnimatePresence>
          {loadingMore && (
            <>
              <li className="list-none"><IdeaCardSkeleton /></li>
              <li className="list-none"><IdeaCardSkeleton /></li>
            </>
          )}
        </ul>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setParam('limit', String(Math.min(PAGE_MAX, limit + PAGE)), false)}
            disabled={loadingMore}
            className="min-h-11 rounded-full border border-line bg-paper px-5 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation"
          >
            {loadingMore ? 'Loading' : `Show ${PAGE} more`}
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
      <h1 className="font-display text-xl md:text-2xl text-ink">Ideas</h1>
      <ErrorSlab
        title="Couldn't load ideas."
        message={message}
        onRetry={() => revalidator.revalidate()}
        retrying={revalidator.state === 'loading'}
      />
    </div>
  )
}
