/**
 * The script reader (ticket #5716): one episode, read the way a page is read.
 * Arc context first (you cannot judge a part-2 door without knowing what part
 * 1 left hanging), the hook set large, beats as prose blocks, closers labeled
 * with the rule they satisfy, the cost against the ceiling with approve
 * disabled when over, and the append-only revision-notes loop.
 *
 * The trailing underscore escapes the scripts queue's layout while staying
 * inside the studio shell (flatRoutes; precedent admin.imports_.opportunities).
 */
import { Link, useFetcher, useLoaderData, useNavigate } from 'react-router'
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { useState } from 'react'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { videoEpisodes, videoSeries } from '../../db/schema'
import { and, eq } from 'drizzle-orm'
import { decideEpisode } from '~/lib/video-episodes.server'
import { getTeamConfig } from '~/lib/team.server'
import { VIDEO_MAX_COST_CENTS_DEFAULT } from '~/lib/team-keys'
import { REVIEW_NOTE_TAGS } from './admin.video-studio.scripts'

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const id = Number(params['episodeId'])
  if (!Number.isFinite(id) || id <= 0) throw new Response('Not Found', { status: 404 })
  const [ep] = await db.select().from(videoEpisodes).where(eq(videoEpisodes.id, id)).limit(1)
  if (!ep) throw new Response('Not Found', { status: 404 })
  const [series] = await db.select().from(videoSeries).where(eq(videoSeries.id, ep.seriesId)).limit(1)

  // Arc context: the aired episode that OPENED the loop this one pays off.
  const paysOff = ep.paysOffLoopKey
    ? (await db.select({ id: videoEpisodes.id, episodeNumber: videoEpisodes.episodeNumber, part2Hook: videoEpisodes.part2Hook })
        .from(videoEpisodes)
        .where(and(eq(videoEpisodes.seriesId, ep.seriesId), eq(videoEpisodes.opensLoopKey, ep.paysOffLoopKey)))
        .limit(1))[0] ?? null
    : null

  const cfg = await getTeamConfig('video').catch(() => null)
  const maxCostCents = cfg?.maxCostCents ?? VIDEO_MAX_COST_CENTS_DEFAULT

  const script = (ep.scriptJson ?? {}) as Record<string, unknown>
  const scenes = Array.isArray(script['scenes']) ? script['scenes'] as Record<string, unknown>[] : []
  const beats = Array.isArray(script['beats']) ? script['beats'] as { line: string; direction?: string; tone?: string }[] : []
  const captions = (script['captions'] ?? {}) as Record<string, string>

  return {
    ep: {
      id: ep.id,
      label: `S${ep.seasonNumber}E${ep.episodeNumber}`,
      seriesTitle: series?.title ?? null,
      logline: ep.logline,
      concept: ep.concept,
      formula: ep.formula,
      arcPosition: ep.arcPosition,
      hookText: ep.hookText,
      hookPattern: ep.hookPattern,
      part2Hook: ep.part2Hook,
      opensLoopKey: ep.opensLoopKey,
      paysOffLoopKey: ep.paysOffLoopKey,
      paysOffEpisodeNumber: paysOff?.episodeNumber ?? null,
      paysOffQuestion: paysOff?.part2Hook ?? null,
      callbackToEpisode: ep.callbackToEpisode,
      castSlugs: ep.castSlugs ?? [],
      placements: ep.productPlacements ?? [],
      estCostUsd: ep.estCostUsd,
      modelTier: ep.modelTier,
      productionStatus: ep.productionStatus,
      isReserve: ep.isReserve,
      gateVerdicts: ep.gateVerdictsJson ?? null,
      reviewNotes: ep.reviewNotesJson ?? [],
      plannedSlotAt: ep.plannedSlotAt?.toISOString() ?? null,
      siteCut: ep.siteCutJson ?? null,
      presenterLine: typeof script['presenterLine'] === 'string' ? script['presenterLine'] as string : null,
      voiceover: typeof script['voiceover'] === 'string' ? script['voiceover'] as string : null,
      shareLine: typeof script['shareLine'] === 'string' ? script['shareLine'] as string : null,
      cta: typeof script['cta'] === 'string' ? script['cta'] as string : null,
      scenes,
      beats,
      captions,
    },
    maxCostCents,
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdmin(request)
  const user = await getAdminUser(request)
  const form = await request.formData()
  const decision = String(form.get('decision') ?? '')
  const id = Number(params['episodeId'])
  // pre-render decisions plus the post-failure ones (retake/reroute/drop).
  const DECISIONS = ['approved', 'needs_changes', 'rejected', 'retake', 'reroute', 'drop'] as const
  if (!(DECISIONS as readonly string[]).includes(decision)) {
    return Response.json({ ok: false, error: 'Bad decision' }, { status: 400 })
  }
  try {
    const tags = String(form.get('tags') ?? '').split(',').map(t => t.trim()).filter(Boolean)
    await decideEpisode({
      episodeId: id,
      decision: decision as (typeof DECISIONS)[number],
      decidedBy: user?.email ?? 'owner',
      ...(String(form.get('note') ?? '').trim() ? { note: String(form.get('note')).trim() } : {}),
      ...(tags.length ? { tags } : {}),
      ...(String(form.get('plannedSlotAt') ?? '').trim() ? { plannedSlotAt: String(form.get('plannedSlotAt')).trim() } : {}),
    })
    return Response.json({ ok: true, decision })
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Decision failed' }, { status: 400 })
  }
}

function Closer({ label, rule, value }: { label: string; rule: string; value: string | null }) {
  return (
    <div className={`rounded-xl border p-3 ${value ? 'border-line bg-paper' : 'border-dashed border-line bg-paper-3'}`}>
      <p className="text-[11px] uppercase tracking-wide text-ink-4">{label} <span className="font-mono">({rule})</span></p>
      {value ? <p className="mt-1 text-sm text-ink">&ldquo;{value}&rdquo;</p> : <p className="mt-1 text-xs text-ink-4">none</p>}
    </div>
  )
}

export default function ScriptReader() {
  const { ep, maxCostCents } = useLoaderData<typeof loader>()
  const fetcher = useFetcher<{ ok: boolean; decision?: string; error?: string }>()
  const navigate = useNavigate()
  const [changesOpen, setChangesOpen] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const busy = fetcher.state !== 'idle'
  const decided = fetcher.data?.ok ? fetcher.data.decision : null
  const err = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null
  const overCeiling = ep.estCostUsd != null && Number(ep.estCostUsd) * 100 > maxCostCents
  const decidable = ep.productionStatus === 'pending_approval' || ep.productionStatus === 'needs_changes'
  const failed = ep.productionStatus === 'failed'

  return (
    <div className="space-y-4">
      {/* Sticky decision bar: top on desktop, bottom sheet at 375px so the thumb reaches it. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 p-3 backdrop-blur md:sticky md:top-0 md:z-10 md:rounded-2xl md:border md:border-line md:bg-paper-2">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            <span className="font-mono text-ink">{ep.label}</span>
            <span className="ml-2 text-ink-3">{ep.seriesTitle ?? ep.formula}</span>
            {ep.estCostUsd != null && (
              <span className={`ml-2 font-mono text-xs tabular-nums ${overCeiling ? 'text-red-700' : 'text-ink-3'}`}>
                est ${Number(ep.estCostUsd).toFixed(2)}{overCeiling ? ` over the $${(maxCostCents / 100).toFixed(2)} ceiling` : ''}
              </span>
            )}
          </div>
          {decided ? (
            <span className="text-sm font-semibold text-ink-3">
              {decided === 'approved' ? 'Approved ✓'
                : decided === 'retake' ? 'Retake queued ↻'
                : decided === 'needs_changes' || decided === 'reroute' ? 'Sent back ↺'
                : decided === 'drop' ? 'Dropped ✕'
                : 'Rejected ✕'}
              <button type="button" onClick={() => navigate('/admin/video-studio/scripts')} className="ml-3 underline">Back to slate</button>
            </span>
          ) : decidable ? (
            <div className="flex flex-wrap items-center gap-2">
              <fetcher.Form method="post">
                <input type="hidden" name="decision" value="approved" />
                <button
                  type="submit"
                  disabled={busy || overCeiling}
                  title={overCeiling ? 'Over the per-video ceiling; the enqueue would refuse it anyway' : undefined}
                  className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-40"
                >
                  Approve
                </button>
              </fetcher.Form>
              <button type="button" onClick={() => setChangesOpen(v => !v)} className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-coral">
                Changes
              </button>
              <fetcher.Form method="post" onSubmit={e => { if (!confirm(`Reject ${ep.label}?`)) e.preventDefault() }}>
                <input type="hidden" name="decision" value="rejected" />
                <input type="hidden" name="note" value="rejected from the reader" />
                <button type="submit" disabled={busy} className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50">
                  Reject
                </button>
              </fetcher.Form>
            </div>
          ) : failed ? (
            // The render failed. Retake re-arms it (retiring the dead job),
            // Reroute sends it back to the room with notes, Drop removes it.
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-red-800">render failed</span>
              <fetcher.Form method="post" onSubmit={e => { if (!confirm(`Retake ${ep.label}? It renders again from the top.`)) e.preventDefault() }}>
                <input type="hidden" name="decision" value="retake" />
                <button type="submit" disabled={busy} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-40">
                  Retake
                </button>
              </fetcher.Form>
              <button type="button" onClick={() => setChangesOpen(v => !v)} className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-coral">
                Reroute to room
              </button>
              <fetcher.Form method="post" onSubmit={e => { if (!confirm(`Drop ${ep.label} from the reader?`)) e.preventDefault() }}>
                <input type="hidden" name="decision" value="drop" />
                <input type="hidden" name="note" value="dropped from the reader after a failed render" />
                <button type="submit" disabled={busy} className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50">
                  Drop
                </button>
              </fetcher.Form>
            </div>
          ) : (
            <span className="text-xs text-ink-4">status: {ep.productionStatus}</span>
          )}
        </div>
        {changesOpen && !decided && (
          <fetcher.Form method="post" className="mx-auto mt-2 max-w-4xl space-y-2" onSubmit={() => setChangesOpen(false)}>
            <input type="hidden" name="decision" value={failed ? 'reroute' : 'needs_changes'} />
            <input type="hidden" name="tags" value={tags.join(',')} />
            <div className="flex flex-wrap gap-1.5">
              {REVIEW_NOTE_TAGS.map(tag => {
                const on = tags.includes(tag)
                return (
                  <button key={tag} type="button" onClick={() => setTags(p => on ? p.filter(t => t !== tag) : [...p, tag])}
                    className={`rounded-full border px-2 py-1 text-[11px] ${on ? 'border-coral bg-coral-soft text-ink' : 'border-line text-ink-3 hover:border-coral'}`}>
                    {tag}
                  </button>
                )
              })}
            </div>
            <textarea name="note" required rows={2} placeholder="What should change? Required; this is the room's training data."
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm" />
            <button type="submit" disabled={busy} className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-paper disabled:opacity-40">
              Send back with notes
            </button>
          </fetcher.Form>
        )}
        {err && <p className="mx-auto mt-1 max-w-4xl text-xs text-red-700">{err}</p>}
      </div>

      <div className="mx-auto max-w-4xl space-y-4 pb-28 md:pb-4">
        <Link to="/admin/video-studio/scripts" className="text-xs text-ink-3 hover:text-ink">← Back to the slate</Link>

        {/* Arc context: what this pays off, what it leaves open. */}
        <div className="grid gap-2 md:grid-cols-2">
          <div className={`rounded-xl border p-3 ${ep.paysOffLoopKey ? 'border-line bg-paper' : 'border-dashed border-line bg-paper-3'}`}>
            <p className="text-[11px] uppercase tracking-wide text-ink-4">Pays off</p>
            {ep.paysOffLoopKey ? (
              <p className="mt-1 text-sm text-ink">
                #{ep.paysOffLoopKey}
                {ep.paysOffEpisodeNumber != null && <span className="text-ink-3"> · opened in ep {ep.paysOffEpisodeNumber}</span>}
                {ep.paysOffQuestion && <span className="text-ink-3"> · &ldquo;{ep.paysOffQuestion}&rdquo;</span>}
                {ep.callbackToEpisode != null && <span className="text-ink-3"> · callback names ep {ep.callbackToEpisode}</span>}
              </p>
            ) : <p className="mt-1 text-xs text-ink-4">No prior thread</p>}
          </div>
          <div className={`rounded-xl border p-3 ${ep.opensLoopKey ? 'border-line bg-paper' : 'border-dashed border-line bg-paper-3'}`}>
            <p className="text-[11px] uppercase tracking-wide text-ink-4">Leaves open</p>
            {ep.opensLoopKey ? (
              <p className="mt-1 text-sm text-ink">#{ep.opensLoopKey}{ep.part2Hook ? <span className="text-ink-3"> · &ldquo;{ep.part2Hook}&rdquo;</span> : null}</p>
            ) : <p className="mt-1 text-xs text-ink-4">Closes clean</p>}
          </div>
        </div>

        {/* The hook, set large: it is the whole bet. */}
        {ep.hookText && (
          <div className="rounded-2xl border border-line bg-paper-2 p-4">
            <p className="text-[11px] uppercase tracking-wide text-ink-4">
              Cold open (0:00-0:03, estimated read){ep.hookPattern ? <span className="font-mono"> · {ep.hookPattern}</span> : null}
            </p>
            <p className="mt-1 text-xl font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
              &ldquo;{ep.hookText}&rdquo;
            </p>
          </div>
        )}

        <p className="text-sm text-ink-3">{ep.concept ?? ep.logline}</p>

        {/* Beats as prose blocks, never a table: the spoken line must read at
            reading size at 375px. */}
        {(ep.scenes.length > 0 ? ep.scenes : ep.beats).length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-ink">Scenes</h2>
            {ep.scenes.length > 0
              ? ep.scenes.map((sc, i) => (
                  <div key={i} className="rounded-xl border border-line bg-paper p-3">
                    <p className="text-[11px] uppercase tracking-wide text-ink-4">
                      Scene {i + 1} · {String(sc['slug'] ?? '')} · {String(sc['durationSeconds'] ?? '?')}s
                      {sc['continuity'] === 'last-frame' ? ' · continues' : ' · own frame'}
                    </p>
                    {typeof sc['spokenLine'] === 'string' && sc['spokenLine'] && (
                      <p className="mt-1 text-base text-ink">&ldquo;{sc['spokenLine'] as string}&rdquo;</p>
                    )}
                    {typeof sc['motionPrompt'] === 'string' && (
                      <p className="mt-1 text-xs text-ink-3">camera: {sc['motionPrompt'] as string}</p>
                    )}
                  </div>
                ))
              : ep.beats.map((b, i) => (
                  <div key={i} className="rounded-xl border border-line bg-paper p-3">
                    <p className="text-base text-ink">&ldquo;{b.line}&rdquo;</p>
                    {b.direction && <p className="mt-1 text-xs text-ink-3">{b.direction}</p>}
                  </div>
                ))}
          </section>
        )}

        {ep.presenterLine && (
          <section className="rounded-xl border border-line bg-paper p-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-4">Spoken line ({ep.modelTier ?? 'tier from default'})</p>
            <p className="mt-1 text-base text-ink">&ldquo;{ep.presenterLine}&rdquo;</p>
          </section>
        )}
        {ep.voiceover && (
          <section className="rounded-xl border border-line bg-paper p-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-4">Voiceover (b-roll, no on-camera mouth)</p>
            <p className="mt-1 text-base text-ink">&ldquo;{ep.voiceover}&rdquo;</p>
          </section>
        )}

        <section className="grid gap-2 md:grid-cols-3">
          <Closer label="Share line" rule="S1" value={ep.shareLine} />
          <Closer label="CTA" rule="C1" value={ep.cta} />
          <Closer label="Part-2 door" rule="SE3" value={ep.part2Hook} />
        </section>

        {/* Cast and product placement, the shopper roles visible. */}
        <section className="rounded-xl border border-line bg-paper p-3 text-sm">
          <p className="text-[11px] uppercase tracking-wide text-ink-4">Cast and product</p>
          <p className="mt-1 text-ink">{ep.castSlugs.join(', ') || 'no cast assigned'}</p>
          {ep.placements.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-xs text-ink-3">
              {ep.placements.map((pl, i) => (
                <li key={i}>{pl.handle} · {pl.role} · {pl.mentionType}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-amber-800">No product in this episode; the script must justify the absence.</p>
          )}
        </section>

        {Object.keys(ep.captions).length > 0 && (
          <section className="rounded-xl border border-line bg-paper p-3 text-sm">
            <p className="text-[11px] uppercase tracking-wide text-ink-4">Captions</p>
            {Object.entries(ep.captions).map(([k, v]) => (
              <p key={k} className="mt-1 text-xs text-ink-3"><span className="font-mono text-ink">{k}</span>: {v}</p>
            ))}
          </section>
        )}

        {ep.siteCut && (
          <section className="rounded-xl border border-line bg-paper p-3 text-sm">
            <p className="text-[11px] uppercase tracking-wide text-ink-4">Site cut (register 9, /social + PDP)</p>
            {ep.siteCut.title && <p className="mt-1 font-semibold text-ink">{ep.siteCut.title}</p>}
            {ep.siteCut.dek && <p className="text-xs text-ink-3">{ep.siteCut.dek}</p>}
          </section>
        )}

        {ep.reviewNotes.length > 0 && (
          <section className="rounded-xl border border-line bg-paper-3 p-3 text-sm">
            <p className="text-[11px] uppercase tracking-wide text-ink-4">Your earlier notes (append-only)</p>
            <ul className="mt-1 space-y-1 text-xs text-ink-3">
              {ep.reviewNotes.map((n, i) => (
                <li key={i}>
                  <span className="font-mono">{n.at.slice(0, 10)}</span> {n.decision}
                  {n.tags?.length ? ` [${n.tags.join(', ')}]` : ''}{n.note ? `: ${n.note}` : ''}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
