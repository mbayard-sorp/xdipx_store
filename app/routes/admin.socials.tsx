/**
 * /admin/socials — the Social Studio shell (Social Studio v2, Phase 3,
 * ticket #4938, ADR-013 decision 12).
 *
 * Routes, not tabs. This file owns the workspace bar and an <Outlet/>; every
 * screen is a child route with its own loader and action:
 *
 *   /admin/socials                 -> redirects to /calendar (Phase 4,
 *                                     #4939, the default screen)
 *   /admin/socials/queue           Review + Approved + History, all review
 *                                  and posting intents (admin.socials.queue)
 *   /admin/socials/compose/new     Composer, owner-composed draft
 *   /admin/socials/compose/:id     Composer on an existing row
 *   /admin/socials/library         Image library (+ /:assetId drawer)
 *   /admin/socials/analytics       Stub until Phase 6a
 *   /admin/socials/calendar        Week grid, drag reschedule, PDT sheet
 *   /admin/socials/settings        FrequencyPanel + frequency intents
 *
 * Old deep links (`/admin/socials?tab=Review|Approved|Compose|History|
 * Settings`) redirect to the matching child so nothing bookmarked breaks.
 *
 * Publishing has two paths. The owner's explicit clicks (Post-now on an
 * approved draft, the legacy X quick post) always work. Unattended publishing
 * runs on the hourly /cron/social-publish tick and is gated per platform by
 * instagram_autopublish_enabled and x_autopublish_enabled, both default off.
 * The old X_AUTO_POST_ENABLED env var was retired 2026-08-16; it gated nothing.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Outlet, redirect, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getValve, VALVE_KEYS } from '~/lib/team.server'
import { getStudioCounts } from '~/lib/social-studio.server'
import { WorkspaceBar } from '~/components/admin/social/WorkspaceBar'

export const meta: MetaFunction = () => [{ title: 'Social Studio — xdipx Admin' }]

const TAB_REDIRECTS: Record<string, string> = {
  review: '/admin/socials/queue',
  approved: '/admin/socials/queue?view=approved',
  compose: '/admin/socials/compose/new',
  history: '/admin/socials/queue?view=history',
  settings: '/admin/socials/settings',
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const tab = url.searchParams.get('tab')?.toLowerCase()
  if (tab && TAB_REDIRECTS[tab]) throw redirect(TAB_REDIRECTS[tab])

  const [counts, igAutopublish, xAutopublish] = await Promise.all([
    getStudioCounts(),
    getValve(VALVE_KEYS.instagramAutopublish),
    getValve(VALVE_KEYS.xAutopublish),
  ])
  return { counts, igAutopublish, xAutopublish }
}

export default function SocialStudioShell() {
  const { counts, igAutopublish, xAutopublish } = useLoaderData<typeof loader>()
  const anyAuto = igAutopublish || xAutopublish
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl text-ink">Social Studio</h1>
        <p className="font-mono text-[11px] text-ink-4">
          {anyAuto
            ? `autopublish on: ${[igAutopublish && 'instagram', xAutopublish && 'x'].filter(Boolean).join(', ')}`
            : 'autopublish off: nothing ships without your click'}
        </p>
      </div>
      <WorkspaceBar counts={counts} />
      <Outlet />
    </div>
  )
}
