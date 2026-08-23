/**
 * /admin/socials/analytics: placeholder until Phase 6a (ticket #4914) ships
 * the metrics table, follower sparklines and CSV export. No data is read
 * here on purpose; the metrics sweep (Phase 6b) is already filling
 * metrics_json and social_follower_history behind its spend valve.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { ChartIcon } from '~/components/admin/social/icons'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return null
}

export default function SocialsAnalytics() {
  return (
    <section className="rounded-2xl border border-line bg-paper p-6 md:p-10 text-center max-w-xl mx-auto">
      <ChartIcon size={24} className="mx-auto text-ink-4" />
      <h2 className="font-display text-lg text-ink mt-3">Analytics lands in Phase 6a</h2>
      <p className="text-sm text-ink-3 mt-2">
        Likes, comments, saves, views and reach per post, follower history, best-performing sort and a CSV export arrive with the Phase 6a build.
        The six-hourly metrics sweep is already writing the numbers behind its spend valve, so the table fills from day one.
      </p>
    </section>
  )
}
