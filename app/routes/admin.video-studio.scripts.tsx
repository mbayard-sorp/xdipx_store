/**
 * The slate queue (ticket #5716): every pending_approval episode in one
 * sitting. Decisions post per row on their own fetcher, so a mid-sitting
 * failure or reload loses nothing already decided. needs_changes without a
 * note is refused server-side (decideEpisode): a silent rejection teaches
 * the writers room nothing.
 *
 * This is the money gate's screen. Approving here is what arms a render;
 * nothing the room proposes has cost a cent yet.
 */
import { Link, useFetcher, useLoaderData } from 'react-router'
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { useState } from 'react'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { videoEpisodes, videoSeries } from '../../db/schema'
import { asc, eq, inArray } from 'drizzle-orm'
import { decideEpisode } from '~/lib/video-episodes.server'

export const REVIEW_NOTE_TAGS = [
  'hook weak',
  'too spec-heavy',
  'wrong cast',
  'product feels forced',
  'arc does not pay off',
  'claims experience',
  'share line will not travel',
] as const

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const episodes = await db.select().from(videoEpisodes)
    .where(eq(videoEpisodes.productionStatus, 'pending_approval'))
    .orderBy(asc(videoEpisodes.seasonNumber), asc(videoEpisodes.episodeNumber))
    .limit(50)
    .catch(() => [] as (typeof videoEpisodes.$inferSelect)[])
  const seriesRows = episodes.length
    ? await db.select().from(videoSeries).where(inArray(videoSeries.id, [...new Set(episodes.map(e => e.seriesId))])).catch(() => [])
    : []
  const seriesById = new Map(seriesRows.map(s => [s.id, s.title]))
  const totalEstUsd = episodes.reduce((sum, e) => sum + (e.estCostUsd ? Number(e.estCostUsd) : 0), 0)
  return {
    episodes: episodes.map(e => ({
      id: e.id,
      label: `S${e.seasonNumber}E${e.episodeNumber}`,
      seriesTitle: seriesById.get(e.seriesId) ?? null,
      logline: e.logline,
      hookText: e.hookText,
      castSlugs: e.castSlugs ?? [],
      product: e.productPlacements?.[0]?.handle ?? null,
      estCostUsd: e.estCostUsd,
      isReserve: e.isReserve,
      gateVerdicts: e.gateVerdictsJson ?? null,
      plannedSlotAt: e.plannedSlotAt?.toISOString() ?? null,
    })),
    totalEstUsd,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const user = await getAdminUser(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const decidedBy = user?.email ?? 'owner'
  try {
    if (intent === 'decide') {
      const episodeId = Number(form.get('episodeId'))
      const decision = String(form.get('decision') ?? '')
      if (!Number.isFinite(episodeId) || episodeId <= 0) return Response.json({ ok: false, error: 'Missing episodeId' }, { status: 400 })
      if (decision !== 'approved' && decision !== 'needs_changes' && decision !== 'rejected') {
        return Response.json({ ok: false, error: 'Bad decision' }, { status: 400 })
      }
      const tags = String(form.get('tags') ?? '').split(',').map(t => t.trim()).filter(Boolean)
      await decideEpisode({
        episodeId,
        decision,
        decidedBy,
        ...(String(form.get('note') ?? '').trim() ? { note: String(form.get('note')).trim() } : {}),
        ...(tags.length ? { tags } : {}),
        ...(String(form.get('plannedSlotAt') ?? '').trim() ? { plannedSlotAt: String(form.get('plannedSlotAt')).trim() } : {}),
      })
      return Response.json({ ok: true, episodeId, decision })
    }
    if (intent === 'approve-remaining') {
      const ids = String(form.get('episodeIds') ?? '').split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
      if (!ids.length) return Response.json({ ok: false, error: 'No episodes to approve' }, { status: 400 })
      let approved = 0
      const errors: string[] = []
      for (const id of ids) {
        try {
          await decideEpisode({ episodeId: id, decision: 'approved', decidedBy })
          approved++
        } catch (err) {
          errors.push(`${id}: ${err instanceof Error ? err.message : 'failed'}`)
        }
      }
      return Response.json({ ok: errors.length === 0, approved, errors })
    }
    return Response.json({ ok: false, error: `Unknown intent ${intent}` }, { status: 400 })
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Decision failed' }, { status: 400 })
  }
}

type Ep = Awaited<ReturnType<typeof loader>>['episodes'][number]

function SlateRow({ ep }: { ep: Ep }) {
  const fetcher = useFetcher<{ ok: boolean; decision?: string; error?: string }>()
  const [changesOpen, setChangesOpen] = useState(false)
  const decided = fetcher.data?.ok ? fetcher.data.decision : null
  const busy = fetcher.state !== 'idle'
  const err = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null

  return (
    <div className={`rounded-2xl border p-4 ${decided === 'approved' ? 'border-sage/40 bg-sage/10' : decided ? 'border-line bg-paper-3' : 'border-line bg-paper-2'}`}>
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <span className="font-mono text-ink">{ep.label}</span>
            {ep.seriesTitle && <span>{ep.seriesTitle}</span>}
            {ep.isReserve && <span className="rounded-full border border-line px-2 py-0.5">evergreen reserve</span>}
            {ep.estCostUsd != null && <span className="font-mono tabular-nums">est ${Number(ep.estCostUsd).toFixed(2)}</span>}
            {ep.gateVerdicts?.doctor && <span>doctor {ep.gateVerdicts.doctor}</span>}
            {ep.gateVerdicts?.voice && <span>voice {ep.gateVerdicts.voice}</span>}
          </div>
          {/* The hook is the whole bet: largest text in the row. */}
          {ep.hookText && <p className="mt-1 text-base font-semibold text-ink">&ldquo;{ep.hookText}&rdquo;</p>}
          <p className="mt-1 text-sm text-ink-3">{ep.logline}</p>
          <p className="mt-1 text-xs text-ink-4">
            {ep.castSlugs.join(', ') || 'no cast'} · {ep.product ?? 'no product'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link to={`/admin/video-studio/scripts/${ep.id}`} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-coral">
            Read full script
          </Link>
          {!decided && (
            <>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="decide" />
                <input type="hidden" name="episodeId" value={ep.id} />
                <input type="hidden" name="decision" value="approved" />
                <button type="submit" disabled={busy} className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-paper disabled:opacity-40">
                  Approve
                </button>
              </fetcher.Form>
              <button type="button" onClick={() => setChangesOpen(v => !v)} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-coral">
                Changes
              </button>
              <fetcher.Form
                method="post"
                onSubmit={e => { if (!confirm(`Reject ${ep.label}? The room reads the reason next Tuesday.`)) e.preventDefault() }}
              >
                <input type="hidden" name="intent" value="decide" />
                <input type="hidden" name="episodeId" value={ep.id} />
                <input type="hidden" name="decision" value="rejected" />
                <input type="hidden" name="note" value="rejected from the slate queue" />
                <button type="submit" disabled={busy} className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50">
                  Reject
                </button>
              </fetcher.Form>
            </>
          )}
          {decided && <span className="text-xs font-semibold text-ink-3">{decided === 'approved' ? 'Approved ✓' : decided === 'needs_changes' ? 'Sent back ↺' : 'Rejected ✕'}</span>}
        </div>
      </div>
      {changesOpen && !decided && (
        <fetcher.Form method="post" className="mt-3 space-y-2 rounded-xl border border-line bg-paper p-3" onSubmit={() => setChangesOpen(false)}>
          <input type="hidden" name="intent" value="decide" />
          <input type="hidden" name="episodeId" value={ep.id} />
          <input type="hidden" name="decision" value="needs_changes" />
          <TagPicker />
          <textarea
            name="note"
            required
            placeholder="What should change? This note is the room's training data; a decision with no note is refused."
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            rows={2}
          />
          <button type="submit" disabled={busy} className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-paper disabled:opacity-40">
            Send back with notes
          </button>
        </fetcher.Form>
      )}
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
    </div>
  )
}

function TagPicker() {
  const [picked, setPicked] = useState<string[]>([])
  return (
    <div className="flex flex-wrap gap-1.5">
      <input type="hidden" name="tags" value={picked.join(',')} />
      {REVIEW_NOTE_TAGS.map(tag => {
        const on = picked.includes(tag)
        return (
          <button
            key={tag}
            type="button"
            onClick={() => setPicked(p => on ? p.filter(t => t !== tag) : [...p, tag])}
            className={`rounded-full border px-2 py-1 text-[11px] ${on ? 'border-coral bg-coral-soft text-ink' : 'border-line text-ink-3 hover:border-coral'}`}
          >
            {tag}
          </button>
        )
      })}
    </div>
  )
}

export default function ScriptsQueue() {
  const { episodes, totalEstUsd } = useLoaderData<typeof loader>()
  const batch = useFetcher<{ ok: boolean; approved?: number; errors?: string[] }>()
  return (
    <div className="space-y-3">
      {episodes.length === 0 ? (
        <section className="rounded-2xl border border-line bg-paper-2 p-6 text-sm text-ink-3">
          No scripts waiting on you. The writers room files its next slate on Tuesday; nothing it
          proposes costs anything until you approve it here.
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-paper-2 px-4 py-3">
            <p className="text-sm text-ink">
              <span className="font-semibold">{episodes.length}</span> script{episodes.length === 1 ? '' : 's'} waiting on your read
              <span className="ml-2 font-mono text-xs tabular-nums text-ink-3">est ${totalEstUsd.toFixed(2)} if all approved</span>
            </p>
            <batch.Form
              method="post"
              onSubmit={e => { if (!confirm(`Approve all ${episodes.length} remaining scripts?`)) e.preventDefault() }}
            >
              <input type="hidden" name="intent" value="approve-remaining" />
              <input type="hidden" name="episodeIds" value={episodes.map(e => e.id).join(',')} />
              <button type="submit" disabled={batch.state !== 'idle'} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-coral disabled:opacity-40">
                Approve remaining
              </button>
            </batch.Form>
          </div>
          {batch.data?.approved != null && (
            <p className="text-xs text-ink-3">Approved {batch.data.approved}. {batch.data.errors?.length ? `Failed: ${batch.data.errors.join('; ')}` : ''}</p>
          )}
          {episodes.map(ep => <SlateRow key={ep.id} ep={ep} />)}
        </>
      )}
    </div>
  )
}
