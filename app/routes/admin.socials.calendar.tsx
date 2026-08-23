/**
 * /admin/socials/calendar: placeholder so the workspace bar link resolves.
 * Phase 4 (ticket #4939) replaces this file with the week grid, drag
 * reschedule and the PDT slot queue; until then scheduled rows are listed
 * on the queue's Approved view with their slot.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { Link } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { CalendarIcon } from '~/components/admin/social/icons'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return null
}

export default function SocialsCalendar() {
  return (
    <section className="rounded-2xl border border-line bg-paper p-6 md:p-10 text-center max-w-xl mx-auto">
      <CalendarIcon size={24} className="mx-auto text-ink-4" />
      <h2 className="font-display text-lg text-ink mt-3">Calendar lands in Phase 4</h2>
      <p className="text-sm text-ink-3 mt-2">
        The week grid with drag reschedule and PDT slots is the Phase 4 build. Until then, set a date and time on a post in the Composer and see the slot on the{' '}
        <Link to="/admin/socials/queue?view=approved" className="link-coral">Approved view</Link>.
      </p>
    </section>
  )
}
