/**
 * Video Studio shell (ticket #5716, the Social Studio v2 pattern): header +
 * workspace bar + <Outlet/>. Sections are ROUTES, not tabs, so each screen
 * owns its loader (the render screen's 4s revalidate no longer re-runs
 * anything else). The 867-line single page this replaced moved verbatim to
 * admin.video-studio.render.tsx; every intent it had still works there.
 */
import { Outlet, useLoaderData } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { videoEpisodes, videoJobs } from '../../db/schema'
import { eq, inArray } from 'drizzle-orm'
import { VideoWorkspaceBar } from '~/components/admin/video/VideoWorkspaceBar'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  // Counts only; each child loads its own data. Every read individually
  // caught so one dead table cannot blank the whole studio (the episode
  // tables arrive with migration 086 and may trail this deploy).
  const [needsRead, parkedJobs, doneJobs] = await Promise.all([
    db.select({ id: videoEpisodes.id }).from(videoEpisodes)
      .where(eq(videoEpisodes.productionStatus, 'pending_approval'))
      .then(r => r.length).catch(() => 0),
    db.select({ id: videoJobs.id }).from(videoJobs)
      .where(eq(videoJobs.status, 'awaiting_frame_approval'))
      .then(r => r.length).catch(() => 0),
    db.select({ id: videoJobs.id, stage: videoJobs.stage, status: videoJobs.status }).from(videoJobs)
      .where(inArray(videoJobs.status, ['done']))
      .then(rows => rows.filter(r => r.stage === 'done').length).catch(() => 0),
  ])
  return { counts: { needsRead, renderNeedsYou: parkedJobs + doneJobs } }
}

export default function VideoStudioShell() {
  const { counts } = useLoaderData<typeof loader>()
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
            Video Studio
          </h1>
          <p className="text-sm text-ink-3">
            Scripts before spend, frames before clips, your approval before anything ships.
          </p>
        </div>
      </header>
      <VideoWorkspaceBar counts={counts} />
      <Outlet />
    </div>
  )
}
