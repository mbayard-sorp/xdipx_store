/**
 * /admin/marketing-calendar — promos, holidays, and campaign themes the
 * homepage team merchandises around.
 *
 * The merch-calendar agent proposes future-dated entries here; the daily
 * routine reads "today's" entry to pick the hero theme / promo window. Owner
 * can add/edit/remove entries by hand too.
 *
 * Status correction (ticket #7310): the team-token 'setStatus' op in
 * api.team.calendar.tsx enforces a strict, one-way state machine
 * (CALENDAR_TRANSITIONS) for the social routine's own IG-campaign rows, with
 * no edge back out of a terminal state -- deliberately, so an automated
 * routine can never talk a finished campaign back open. But an automated
 * close can still be *wrong* (a false-positive removal-watch step-down, a
 * stale window vs. instagram-campaigns.md), and until now nothing could
 * correct that short of a manual DB write. The 'setStatus' intent below is
 * that correction path: owner-only (same requireAdmin gate this page already
 * uses for outright deletion), any row, any legal CALENDAR_STATUSES value, no
 * transition-map restriction. It does not touch or weaken the team-token
 * machine above.
 *
 * Degrades gracefully when migration 049 (marketing_calendar) isn't applied.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Form, useLoaderData } from 'react-router'
import { asc, eq, gte } from 'drizzle-orm'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { marketingCalendar } from '../../db/schema'

export const meta: MetaFunction = () => [{ title: 'Marketing Calendar — xdipx Admin' }]

// Mirrors CALENDAR_STATUSES in api.team.calendar.tsx (ticket #3030's state
// machine lives there). Kept as a plain literal copy rather than a cross-route
// import: this is a stable 4-value enum, not the kind of larger vocab
// (mood/audience/product-type tags) that drifts when hand-typed.
const CALENDAR_STATUSES = ['planned', 'active', 'done', 'skipped'] as const

type Entry = typeof marketingCalendar.$inferSelect

interface LoaderData {
  migrated: boolean
  entries: Entry[]
}

export async function loader({ request }: LoaderFunctionArgs): Promise<LoaderData> {
  await requireAdmin(request)
  try {
    // Show today onward (yesterday's are history). current_date - 1 day guard.
    const since = new Date()
    since.setDate(since.getDate() - 1)
    const sinceStr = since.toISOString().slice(0, 10)
    const entries = await db
      .select()
      .from(marketingCalendar)
      .where(gte(marketingCalendar.eventDate, sinceStr))
      .orderBy(asc(marketingCalendar.eventDate))
      .limit(100)
    return { migrated: true, entries }
  } catch {
    return { migrated: false, entries: [] }
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')

  try {
    if (intent === 'add') {
      const eventDate = String(form.get('eventDate') ?? '').trim()
      const name = String(form.get('name') ?? '').trim()
      if (!eventDate || !name) return Response.json({ ok: false, error: 'date + name required' }, { status: 400 })
      const type = String(form.get('type') ?? 'promo')
      const theme = String(form.get('theme') ?? '').trim()
      await db.insert(marketingCalendar).values({
        eventDate,
        name,
        type: ['holiday', 'promo', 'campaign'].includes(type) ? type : 'promo',
        ...(theme ? { theme } : {}),
      })
      return Response.json({ ok: true })
    }
    if (intent === 'delete') {
      const id = Number(form.get('id'))
      if (Number.isFinite(id)) {
        await db.delete(marketingCalendar).where(eq(marketingCalendar.id, id))
      }
      return Response.json({ ok: true })
    }
    if (intent === 'setStatus') {
      const id = Number(form.get('id'))
      const status = String(form.get('status') ?? '')
      if (!Number.isFinite(id) || id <= 0) {
        return Response.json({ ok: false, error: 'id required' }, { status: 400 })
      }
      if (!(CALENDAR_STATUSES as readonly string[]).includes(status)) {
        return Response.json(
          { ok: false, error: `status must be one of ${CALENDAR_STATUSES.join('|')}` },
          { status: 400 },
        )
      }
      // Owner-only correction (#7310): no CALENDAR_TRANSITIONS check. Any row,
      // any legal status, including out of a terminal state -- that is the
      // point of this edge existing.
      await db
        .update(marketingCalendar)
        .set({ status, updatedAt: new Date() })
        .where(eq(marketingCalendar.id, id))
      return Response.json({ ok: true })
    }
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
  return Response.json({ ok: false }, { status: 400 })
}

const TYPE_TONE: Record<string, string> = {
  holiday:  'bg-plum-soft text-plum',
  promo:    'bg-coral-soft text-coral',
  campaign: 'bg-sage/20 text-sage',
}

export default function MarketingCalendarPage() {
  const { migrated, entries } = useLoaderData<typeof loader>()

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
        Marketing Calendar
      </h1>

      {!migrated && (
        <div className="rounded-xl border border-coral bg-coral-soft/50 px-4 py-3 text-sm text-ink">
          Migration <code>049_homepage_team</code> isn't applied yet, so the calendar table doesn't
          exist. Apply it with{' '}
          <code className="font-mono">npx tsx scripts/apply-migrations.ts --from 049</code>.
        </div>
      )}

      {/* Add entry */}
      <section className="bg-paper rounded-xl border border-line p-5">
        <h2 className="kicker mb-3">Add entry</h2>
        <Form method="post" className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="intent" value="add" />
          <label className="flex flex-col gap-1 text-xs text-ink-4">
            Date
            <input type="date" name="eventDate" required className="rounded-lg border border-line bg-paper-2 px-3 py-1.5 text-sm text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-4">
            Type
            <select name="type" className="rounded-lg border border-line bg-paper-2 px-3 py-1.5 text-sm text-ink">
              <option value="promo">promo</option>
              <option value="holiday">holiday</option>
              <option value="campaign">campaign</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-4 sm:col-span-2">
            Name
            <input name="name" required placeholder="Valentine's Day, Spring refresh…" className="rounded-lg border border-line bg-paper-2 px-3 py-1.5 text-sm text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-4 sm:col-span-2">
            Theme / note (optional)
            <input name="theme" placeholder="hero angle, promo window, products to feature…" className="rounded-lg border border-line bg-paper-2 px-3 py-1.5 text-sm text-ink" />
          </label>
          <div className="sm:col-span-2">
            <button className="rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white hover:bg-coral-2">Add</button>
          </div>
        </Form>
      </section>

      {/* Upcoming */}
      <section>
        <h2 className="kicker mb-3">Upcoming</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-ink-4">Nothing scheduled. Add an entry above, or let the merch-calendar agent propose some.</p>
        ) : (
          <div className="bg-paper rounded-xl border border-line divide-y divide-line">
            {entries.map(e => (
              <div key={e.id} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    <span className="font-mono text-ink-4">{String(e.eventDate)}</span>{' '}
                    <span className="font-medium">{e.name}</span>
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-mono ${TYPE_TONE[e.type] ?? 'bg-paper-3 text-ink-4'}`}>{e.type}</span>
                    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-mono bg-paper-3 text-ink-4">{e.status}</span>
                  </p>
                  {e.theme && <p className="text-xs text-ink-4 truncate">{e.theme}</p>}
                </div>
                <div className="flex items-center gap-3">
                  {/* Owner-only status correction (#7310) — bypasses CALENDAR_TRANSITIONS,
                      unlike the team-token setStatus op in api.team.calendar.tsx. */}
                  <Form method="post" className="flex items-center gap-1.5">
                    <input type="hidden" name="intent" value="setStatus" />
                    <input type="hidden" name="id" value={e.id} />
                    <select
                      name="status"
                      defaultValue={e.status}
                      aria-label={`Set status for ${e.name}`}
                      className="rounded-lg border border-line bg-paper-2 px-2 py-1 text-xs text-ink"
                    >
                      {CALENDAR_STATUSES.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button className="text-xs text-ink-4 hover:text-coral">Save</button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={e.id} />
                    <button className="text-xs text-ink-4 hover:text-coral" aria-label={`Delete ${e.name}`}>Remove</button>
                  </Form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
