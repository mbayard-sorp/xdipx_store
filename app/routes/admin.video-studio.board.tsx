/**
 * The production board (ticket #5716): every episode and every job-only row,
 * one grouped table, one derived status each, a six-dot stage rail, and one
 * next-action verb. This is the "see where we are with each one" screen.
 *
 * Not a kanban: six lanes at 375px force the page body to scroll sideways,
 * which CLAUDE.md forbids, and at 2 episodes/week this is table volume. The
 * table scrolls inside <ResponsiveTable>; the body never does.
 */
import { Link, useLoaderData } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { videoEpisodes, videoJobs, videoSeries, socialPosts } from '../../db/schema'
import { desc, inArray } from 'drizzle-orm'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { videoStatusOf, stageIndexOf, nextActionOf, STAGE_STEPS, type VideoStatus } from '~/lib/video-status'

interface BoardRow {
  key: string
  episodeId: number | null
  jobRowId: number | null
  label: string
  title: string
  status: VideoStatus
  stageIndex: number
  cast: string[]
  product: string | null
  costUsd: string | null
  next: { label: string; to: string } | null
  updatedAt: string
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const episodes = await db.select().from(videoEpisodes)
    .orderBy(desc(videoEpisodes.seasonNumber), desc(videoEpisodes.episodeNumber))
    .limit(100)
    .catch(() => [] as (typeof videoEpisodes.$inferSelect)[])
  const seriesRows = episodes.length
    ? await db.select().from(videoSeries).where(inArray(videoSeries.id, [...new Set(episodes.map(e => e.seriesId))])).catch(() => [])
    : []
  const seriesById = new Map(seriesRows.map(s => [s.id, s]))

  const jobs = await db.select().from(videoJobs).orderBy(desc(videoJobs.createdAt)).limit(60).catch(() => [] as (typeof videoJobs.$inferSelect)[])
  const jobById = new Map(jobs.map(j => [j.id, j]))

  const jobIds = jobs.map(j => j.id)
  const posts = jobIds.length
    ? await db.select({ videoJobId: socialPosts.videoJobId, episodeId: socialPosts.episodeId, status: socialPosts.status })
        .from(socialPosts).where(inArray(socialPosts.videoJobId, jobIds)).catch(() => [])
    : []

  const linkedJobIds = new Set(episodes.map(e => e.videoJobId).filter((id): id is number => id != null))

  const rows: BoardRow[] = []
  for (const ep of episodes) {
    const job = ep.videoJobId != null ? jobById.get(ep.videoJobId) ?? null : null
    const epPosts = posts.filter(p => (p.episodeId != null && p.episodeId === ep.id) || (job && p.videoJobId === job.id))
    const status = videoStatusOf(ep, job, epPosts)
    const series = seriesById.get(ep.seriesId)
    rows.push({
      key: `ep-${ep.id}`,
      episodeId: ep.id,
      jobRowId: job?.id ?? null,
      label: `S${ep.seasonNumber}E${ep.episodeNumber}`,
      title: ep.logline,
      status,
      stageIndex: stageIndexOf(status.key, ep),
      cast: ep.castSlugs ?? [],
      product: ep.productPlacements?.[0]?.handle ?? null,
      costUsd: ep.actualCostUsd ?? ep.estCostUsd,
      next: nextActionOf(status.key, ep.id, job?.id ?? null),
      updatedAt: (ep.updatedAt ?? ep.createdAt).toISOString(),
      seriesTitle: series?.title ?? null,
    } as BoardRow & { seriesTitle: string | null })
  }
  // Job-only rows (ad-hoc composes, pre-program jobs): still visible, still
  // one status, never hidden just because no episode exists.
  for (const job of jobs) {
    if (linkedJobIds.has(job.id) || job.episodeId != null) continue
    const jobPosts = posts.filter(p => p.videoJobId === job.id)
    const status = videoStatusOf(null, job, jobPosts)
    rows.push({
      key: `job-${job.id}`,
      episodeId: null,
      jobRowId: job.id,
      label: job.formula,
      title: `${job.productHandle} (${job.modelTier})`,
      status,
      stageIndex: stageIndexOf(status.key, null),
      cast: job.presenter !== 'none' ? [job.presenter.replace('friend:', '')] : [],
      product: job.productHandle,
      costUsd: job.costUsd,
      next: nextActionOf(status.key, null, job.id),
      updatedAt: job.updatedAt.toISOString(),
    })
  }

  const tiles = {
    needsRead: rows.filter(r => r.status.key === 'scripted').length,
    needsFrame: rows.filter(r => r.status.key === 'framing').length,
    needsReview: rows.filter(r => r.status.key === 'review').length,
    rendering: rows.filter(r => r.status.key === 'rendering').length,
    scheduled: rows.filter(r => r.status.key === 'scheduled').length,
    posted: rows.filter(r => r.status.key === 'posted').length,
  }

  return { rows, tiles }
}

function GateTile({ label, count, to, accent }: { label: string; count: number; to: string; accent?: boolean }) {
  return (
    <Link
      to={to}
      className={`rounded-2xl border p-3 transition hover:border-coral ${
        accent && count > 0 ? 'border-coral bg-coral-soft' : 'border-line bg-paper-2'
      }`}
    >
      <div className="text-2xl font-bold tabular-nums text-ink">{count}</div>
      <div className="text-xs text-ink-3">{label}</div>
    </Link>
  )
}

function StageRail({ index }: { index: number }) {
  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label={`Stage ${index + 1} of ${STAGE_STEPS.length}: ${STAGE_STEPS[index]}`}
      title={STAGE_STEPS[index]}
    >
      {STAGE_STEPS.map((step, i) => (
        <span
          key={step}
          className={`h-1.5 w-1.5 rounded-full ${i < index ? 'bg-ink-4' : i === index ? 'bg-coral' : 'bg-paper-3 border border-line'}`}
        />
      ))}
    </span>
  )
}

export default function VideoBoard() {
  const { rows, tiles } = useLoaderData<typeof loader>()
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <GateTile label="Needs your read" count={tiles.needsRead} to="/admin/video-studio/scripts" accent />
        <GateTile label="Needs a frame" count={tiles.needsFrame} to="/admin/video-studio/render" accent />
        <GateTile label="Needs your review" count={tiles.needsReview} to="/admin/video-studio/render" accent />
        <GateTile label="Rendering" count={tiles.rendering} to="/admin/video-studio/render" />
        <GateTile label="Scheduled" count={tiles.scheduled} to="/admin/socials/calendar" />
        <GateTile label="Posted" count={tiles.posted} to="/admin/socials/queue" />
      </div>

      {rows.length === 0 ? (
        <section className="rounded-2xl border border-line bg-paper-2 p-6 text-sm text-ink-3">
          Nothing in production yet. The writers room proposes the first slate on its Tuesday run;
          episodes land here at every stage from concept to posted.
        </section>
      ) : (
        <section className="rounded-2xl border border-line bg-paper p-3 md:p-4">
          <ResponsiveTable>
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="py-2 pr-3 font-semibold">Ep</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Title</th>
                  <th className="py-2 pr-3 font-semibold">Stage</th>
                  <th className="py-2 pr-3 font-semibold">Cast</th>
                  <th className="py-2 pr-3 font-semibold">Product</th>
                  <th className="py-2 pr-3 font-semibold">Cost</th>
                  <th className="py-2 pr-3 font-semibold">Next</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(r => (
                  <tr key={r.key} className="align-top">
                    <td className="py-2 pr-3 font-mono text-xs text-ink">{r.label}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold leading-none ${r.status.cls}`}>
                        <span aria-hidden>{r.status.glyph}</span>
                        {r.status.word}
                      </span>
                    </td>
                    <td className="max-w-[320px] truncate py-2 pr-3 text-ink" title={r.title}>
                      {r.episodeId != null ? (
                        <Link to={`/admin/video-studio/scripts/${r.episodeId}`} className="hover:underline">{r.title}</Link>
                      ) : r.title}
                    </td>
                    <td className="py-2 pr-3"><StageRail index={r.stageIndex} /></td>
                    <td className="py-2 pr-3 text-xs text-ink-3">{r.cast.join(', ') || '·'}</td>
                    <td className="py-2 pr-3 text-xs text-ink-3">{r.product ?? '·'}</td>
                    <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink-3">
                      {r.costUsd != null ? `$${Number(r.costUsd).toFixed(2)}` : '·'}
                    </td>
                    <td className="py-2 pr-3">
                      {r.next ? (
                        <Link to={r.next.to} className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-paper hover:bg-ink-2">
                          {r.next.label}
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-4">·</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        </section>
      )}
    </div>
  )
}
