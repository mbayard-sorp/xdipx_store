/**
 * /admin/socials/calendar: the week grid (Social Studio v2 Phase 4, #4939,
 * ADR-013 decision 9).
 *
 * Loader: `?week=YYYY-MM-DD` (any day, snapped to the Monday of that week on
 * the LA calendar; default this week) -> the 7 LA days, every post whose
 * effective slot `COALESCE(scheduled_at, scheduled_for::timestamptz)` lands
 * in the week plus posted rows by `posted_at`, the unscheduled drafts for the
 * right rail, per-platform daily caps, and today's LA date.
 *
 * Action: `reschedule` (same contract as the queue: postId, scheduledFor,
 * optional LA `time`) and `unschedule` (clears both columns). Both write
 * through `rescheduleSocialPost` so there is exactly one writer. Nothing here
 * touches publish eligibility or any gate; an approved row keeps its approval
 * when it moves.
 *
 * Desktop: drag a chip to another day and hour, or focus it and press Enter
 * for the Reschedule sheet. Mobile: day strip plus agenda, every chip has a
 * Reschedule button. `[` and `]` move weeks, `t` jumps to today, Esc closes.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router'
import { useLoaderData, useFetcher, useNavigate, useSearchParams, Link } from 'react-router'
import { useMemo, useState } from 'react'
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { socialPosts } from '../../db/schema'
import { requireAdmin } from '~/lib/session.server'
import { rescheduleSocialPost, getSocialFrequencies } from '~/lib/team.server'
import { DEFAULT_MAX_PER_DAY } from '~/lib/social-publish-job.server'
import { X_DEFAULT_MAX_PER_DAY } from '~/lib/social-publish-run.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import { laWallClockToUtc, utcToLaParts, formatLaSlot } from '~/lib/social-schedule'
import { laZoneAbbrev } from '~/lib/social-schedule-ui'
import { weekOf, addDays, capsByDay, slotOf, cellFor, shortDayLabel } from '~/lib/social-calendar'
import { CalendarGrid, CapIndicator } from '~/components/admin/social/CalendarGrid'
import { PostChip } from '~/components/admin/social/PostChip'
import { RescheduleSheet } from '~/components/admin/social/RescheduleSheet'
import { useStudioShortcuts } from '~/components/admin/social/use-shortcuts'
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon, CalendarIcon } from '~/components/admin/social/icons'
import type { CalendarPost } from '~/components/admin/social/calendar-types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The daily cap the publisher actually enforces per platform: the
 * `{platform}_publish_max_per_day` setting when set, else the owner's
 * posting frequency from Settings, else the publisher's own default.
 */
async function loadCaps(): Promise<Record<string, number>> {
  const [freq, igRaw, xRaw] = await Promise.all([
    getSocialFrequencies(),
    getPipelineSetting('instagram_publish_max_per_day'),
    getPipelineSetting('x_publish_max_per_day'),
  ])
  const num = (raw: string | null) => {
    const n = raw == null ? NaN : parseFloat(raw)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const caps: Record<string, number> = {}
  for (const [platform, f] of Object.entries(freq)) if (f > 0) caps[platform] = f
  caps['instagram'] = num(igRaw) ?? caps['instagram'] ?? DEFAULT_MAX_PER_DAY
  caps['x'] = num(xRaw) ?? caps['x'] ?? X_DEFAULT_MAX_PER_DAY
  return caps
}

const COLS = {
  id: socialPosts.id,
  platform: socialPosts.platform,
  status: socialPosts.status,
  reviewStatus: socialPosts.reviewStatus,
  tweetText: socialPosts.tweetText,
  editedText: socialPosts.editedText,
  mediaUrls: socialPosts.mediaUrls,
  posterUrl: socialPosts.posterUrl,
  videoJobId: socialPosts.videoJobId,
  scheduledAt: socialPosts.scheduledAt,
  scheduledFor: socialPosts.scheduledFor,
  postedAt: socialPosts.postedAt,
  createdAt: socialPosts.createdAt,
}

function serialize(row: { [K in keyof typeof COLS]: unknown }): CalendarPost {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null)
  return {
    id: row.id as number,
    platform: row.platform as string,
    status: row.status as string,
    reviewStatus: row.reviewStatus as string,
    tweetText: row.tweetText as string,
    editedText: (row.editedText as string | null) ?? null,
    mediaUrls: (row.mediaUrls as string[] | null) ?? null,
    posterUrl: (row.posterUrl as string | null) ?? null,
    videoJobId: (row.videoJobId as number | null) ?? null,
    scheduledAt: iso(row.scheduledAt),
    scheduledFor: (row.scheduledFor as string | null) ?? null,
    postedAt: iso(row.postedAt),
    createdAt: iso(row.createdAt),
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const now = new Date()
  const todayLa = utcToLaParts(now).date
  const url = new URL(request.url)
  const param = url.searchParams.get('week')
  const week = weekOf(param && DATE_RE.test(param) ? param : todayLa)
  const start = laWallClockToUtc(week.monday, '00:00')
  const end = laWallClockToUtc(addDays(week.monday, 7), '00:00')

  const slot = sql`coalesce(${socialPosts.scheduledAt}, ${socialPosts.scheduledFor}::timestamptz)`
  const [rows, unscheduled, caps] = await Promise.all([
    db.select(COLS).from(socialPosts)
      .where(and(
        ne(socialPosts.status, 'deleted'),
        sql`((${slot} >= ${start} and ${slot} < ${end}) or (${socialPosts.status} = 'posted' and ${socialPosts.postedAt} >= ${start} and ${socialPosts.postedAt} < ${end}))`,
      ))
      .orderBy(socialPosts.scheduledAt, socialPosts.scheduledFor)
      .limit(500),
    db.select(COLS).from(socialPosts)
      // Rejected drafts are not schedulable (no override, a fresh draft is the
      // way back), so they stay out of the rail.
      .where(and(eq(socialPosts.status, 'draft'), ne(socialPosts.reviewStatus, 'rejected'), isNull(socialPosts.scheduledAt), isNull(socialPosts.scheduledFor)))
      .orderBy(desc(socialPosts.createdAt))
      .limit(50),
    loadCaps(),
  ])

  return {
    week,
    todayLa,
    nowMs: now.getTime(),
    zone: laZoneAbbrev(now),
    posts: rows.map(serialize),
    unscheduled: unscheduled.map(serialize),
    caps,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = form.get('intent')
  const postId = parseInt(String(form.get('postId') ?? ''))
  if (!Number.isFinite(postId)) return { ok: false as const, postId: null, error: 'Bad post id' }

  if (intent === 'reschedule') {
    const day = String(form.get('scheduledFor') ?? '')
    const time = String(form.get('time') ?? '')
    if (!DATE_RE.test(day)) return { ok: false as const, postId, error: 'Bad date' }
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false as const, postId, error: 'Bad time' }
    try {
      await rescheduleSocialPost(postId, day, time ? { scheduledAt: laWallClockToUtc(day, time) } : {})
    } catch (err) {
      return { ok: false as const, postId, error: err instanceof Error ? err.message : 'Database write failed' }
    }
    return { ok: true as const, postId, intent: 'reschedule' as const }
  }

  if (intent === 'unschedule') {
    try {
      await rescheduleSocialPost(postId, null)
    } catch (err) {
      return { ok: false as const, postId, error: err instanceof Error ? err.message : 'Database write failed' }
    }
    return { ok: true as const, postId, intent: 'unschedule' as const }
  }

  return { ok: false as const, postId, error: `Unknown intent ${String(intent)}` }
}

export default function SocialsCalendar() {
  const data = useLoaderData<typeof loader>()
  const { week, todayLa, nowMs, zone, caps } = data
  const fetcher = useFetcher<typeof action>()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [sheetId, setSheetId] = useState<number | null>(null)
  const [mobileDay, setMobileDay] = useState<string>(week.days.includes(todayLa) ? todayLa : week.monday)
  const [optimistic, setOptimistic] = useState<{ postId: number; scheduledAt: string | null; scheduledFor: string | null } | null>(null)
  const [announce, setAnnounce] = useState('')

  const busy = fetcher.state !== 'idle'
  const pendingId = busy && optimistic ? optimistic.postId : null
  // Between submit and revalidation, render the move as if it had landed;
  // once the fetcher is idle the loader data is the truth again, so a failed
  // write simply falls back to where the row really is.
  const allPosts = useMemo<CalendarPost[]>(() => {
    const base = [...data.posts, ...data.unscheduled]
    if (!busy || !optimistic) return base
    return base.map(p => (p.id === optimistic.postId ? { ...p, scheduledAt: optimistic.scheduledAt, scheduledFor: optimistic.scheduledFor } : p))
  }, [data.posts, data.unscheduled, busy, optimistic])

  const weekStart = laWallClockToUtc(week.monday, '00:00').getTime()
  const weekEnd = laWallClockToUtc(addDays(week.monday, 7), '00:00').getTime()
  const inWeek = allPosts.filter(p => {
    const at = slotOf(p)
    return at != null && at.getTime() >= weekStart && at.getTime() < weekEnd
  })
  const unscheduled = allPosts.filter(p => p.status === 'draft' && !slotOf(p))
  const dayCaps = useMemo(() => capsByDay(inWeek), [inWeek])

  const error = !busy && fetcher.data && !fetcher.data.ok ? fetcher.data : null
  const liveText = error ? `Could not move #${error.postId ?? ''}: ${error.error}` : announce

  function go(date: string) {
    const next = new URLSearchParams(params)
    next.set('week', date)
    navigate(`?${next.toString()}`)
  }
  useStudioShortcuts(useMemo(() => ({
    '[': () => go(addDays(week.monday, -7)),
    ']': () => go(addDays(week.monday, 7)),
    t: () => go(todayLa),
    // Enter on a focused chip is the chip's own button; nothing to add here.
  }), [week.monday, todayLa, params]), sheetId == null)

  function submitMove(post: CalendarPost, date: string, time: string) {
    const at = laWallClockToUtc(date, time)
    setOptimistic({ postId: post.id, scheduledAt: at.toISOString(), scheduledFor: date })
    setAnnounce(`Moved #${post.id} to ${formatLaSlot(at)}`)
    fetcher.submit({ intent: 'reschedule', postId: String(post.id), scheduledFor: date, time }, { method: 'post' })
    setSheetId(null)
  }

  function submitUnschedule(post: CalendarPost) {
    setOptimistic({ postId: post.id, scheduledAt: null, scheduledFor: null })
    setAnnounce(`Unscheduled #${post.id}; it is back in the drafts rail`)
    fetcher.submit({ intent: 'unschedule', postId: String(post.id) }, { method: 'post' })
    setSheetId(null)
  }

  function onDropMove(post: CalendarPost, date: string, hour: number) {
    // Keep the row's minutes when it had some; a whole hour otherwise.
    const cur = slotOf(post)
    const minutes = cur ? utcToLaParts(cur).time.slice(3) : '00'
    submitMove(post, date, `${String(hour).padStart(2, '0')}:${minutes}`)
  }

  const sheetPost = sheetId != null ? allPosts.find(p => p.id === sheetId) ?? null : null
  const weekLabel = `${shortDayLabel(week.monday).label} to ${shortDayLabel(week.days[6]!).label}`
  const mobilePosts = inWeek
    .filter(p => cellFor(slotOf(p)!).date === mobileDay)
    .sort((a, b) => slotOf(a)!.getTime() - slotOf(b)!.getTime())

  return (
    <section className="space-y-3 pb-20 md:pb-0">
      <p className="sr-only" aria-live="polite" role="status">{liveText}</p>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line overflow-hidden">
          <button type="button" onClick={() => go(addDays(week.monday, -7))} aria-label="Previous week ([)" className="min-w-11 min-h-11 inline-flex items-center justify-center text-ink-3 hover:bg-paper-2">
            <ArrowLeftIcon size={16} />
          </button>
          <button type="button" onClick={() => go(todayLa)} className="min-h-11 px-3 text-sm text-ink border-l border-r border-line hover:bg-paper-2">
            Today
          </button>
          <button type="button" onClick={() => go(addDays(week.monday, 7))} aria-label="Next week (])" className="min-w-11 min-h-11 inline-flex items-center justify-center text-ink-3 hover:bg-paper-2">
            <ArrowRightIcon size={16} />
          </button>
        </div>
        <h2 className="font-display text-lg text-ink">{weekLabel}</h2>
        <span className="font-mono text-[11px] text-ink-3">
          {zone} · Los Angeles · {inWeek.length} this week
        </span>
        <span className="hidden md:inline font-mono text-[10px] text-ink-4 ml-auto">
          drag to move · Enter opens Reschedule · [ ] weeks · t today
        </span>
        <Link
          to="/admin/socials/compose/new"
          className="hidden md:inline-flex items-center gap-1.5 min-h-11 px-4 rounded-lg bg-coral text-white text-sm font-semibold hover:bg-coral-2"
        >
          <PlusIcon size={14} /> New post
        </Link>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 text-red-800 text-sm px-3 py-2">
          Could not move #{error.postId}: {error.error}. The chip is back where it was; fix the slot and try again.
        </div>
      )}

      {/* Desktop: grid plus rail */}
      <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_260px] gap-4 items-start">
        {inWeek.length === 0 && unscheduled.length === 0 ? (
          <EmptyWeek weekLabel={weekLabel} />
        ) : (
          <CalendarGrid
            days={week.days}
            todayLa={todayLa}
            posts={inWeek}
            caps={caps}
            capsByDay={dayCaps}
            pendingId={pendingId}
            onOpen={p => setSheetId(p.id)}
            onMove={onDropMove}
          />
        )}
        <aside className="rounded-2xl border border-line bg-paper-2 p-3 space-y-2 md:sticky md:top-4" aria-label="Unscheduled drafts">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-base text-ink">Unscheduled</h3>
            <span className="font-mono text-[11px] text-ink-3">{unscheduled.length}</span>
          </div>
          <p className="text-[11px] text-ink-4">Drag onto an hour, or press Enter on a chip.</p>
          {unscheduled.length === 0 ? (
            <p className="text-xs text-ink-3 rounded-xl border border-dashed border-line p-3">
              No drafts without a slot. Every draft already has a day; new ones land here from the Composer or the social team's next run.
            </p>
          ) : (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
              {unscheduled.map(p => (
                <PostChip
                  key={p.id}
                  post={p}
                  draggable
                  pending={pendingId === p.id}
                  onOpen={q => setSheetId(q.id)}
                  onDragEnd={(q, x, y) => {
                    const el = typeof document === 'undefined' ? null : document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cal-cell]')
                    const key = el?.dataset['calCell']
                    if (!key) return
                    const [date, hour] = key.split('T')
                    if (date && hour != null) onDropMove(q, date, Number(hour))
                  }}
                />
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* Mobile: day strip plus agenda */}
      <div className="md:hidden space-y-3">
        <div className="-mx-4 px-4 overflow-x-auto">
          <div className="flex gap-2 min-w-max" role="tablist" aria-label="Days this week">
            {week.days.map(day => {
              const { weekday, label } = shortDayLabel(day)
              const count = inWeek.filter(p => cellFor(slotOf(p)!).date === day).length
              const active = day === mobileDay
              return (
                <button
                  key={day}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMobileDay(day)}
                  className={`flex flex-col items-center gap-0.5 min-w-[52px] min-h-11 px-2 py-1.5 rounded-xl border ${
                    active ? 'border-plum bg-plum-soft' : 'border-line bg-paper'
                  } ${day === todayLa ? 'ring-1 ring-coral' : ''}`}
                >
                  <span className="text-[10px] uppercase tracking-wide text-ink-4">{weekday}</span>
                  <span className="font-mono text-xs text-ink">{label.split(' ')[1]}</span>
                  <span className="font-mono text-[10px] text-ink-3 tabular-nums" aria-label={`${count} posts`}>{count}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-base text-ink">{shortDayLabel(mobileDay).weekday} {shortDayLabel(mobileDay).label}</h3>
          <CapIndicator day={mobileDay} caps={caps} capsByDay={dayCaps} />
        </div>

        {mobilePosts.length === 0 ? (
          <p className="text-sm text-ink-3 rounded-2xl border border-dashed border-line bg-paper p-4">
            Nothing on this day. Reschedule a draft onto it from the list below, or compose a new post with a slot.
          </p>
        ) : (
          <ul className="space-y-2">
            {mobilePosts.map(p => (
              <li key={p.id}>
                <PostChip
                  post={p}
                  pending={pendingId === p.id}
                  onOpen={q => setSheetId(q.id)}
                  trailing={p.status !== 'posted' ? (
                    <button type="button" onClick={() => setSheetId(p.id)} className="min-h-11 w-full rounded-lg border border-line text-sm text-ink hover:bg-paper-2">
                      Reschedule
                    </button>
                  ) : null}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-2xl border border-line bg-paper-2 p-3 space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-base text-ink">Unscheduled</h3>
            <span className="font-mono text-[11px] text-ink-3">{unscheduled.length}</span>
          </div>
          {unscheduled.length === 0 ? (
            <p className="text-xs text-ink-3">No drafts without a slot.</p>
          ) : unscheduled.map(p => (
            <PostChip
              key={p.id}
              post={p}
              pending={pendingId === p.id}
              onOpen={q => setSheetId(q.id)}
              trailing={
                <button type="button" onClick={() => setSheetId(p.id)} className="min-h-11 w-full rounded-lg border border-line text-sm text-ink hover:bg-paper-2">
                  Schedule
                </button>
              }
            />
          ))}
        </div>

        <Link
          to="/admin/socials/compose/new"
          className="fixed bottom-4 left-4 right-4 z-40 inline-flex items-center justify-center gap-1.5 min-h-12 rounded-xl bg-coral text-white text-sm font-semibold shadow-lg"
        >
          <PlusIcon size={14} /> New post
        </Link>
      </div>

      {sheetPost && (
        <RescheduleSheet
          post={sheetPost}
          posts={allPosts}
          caps={caps}
          nowMs={nowMs}
          busy={busy}
          onClose={() => setSheetId(null)}
          onSubmit={(date, time) => submitMove(sheetPost, date, time)}
          onUnschedule={() => submitUnschedule(sheetPost)}
        />
      )}
    </section>
  )
}

function EmptyWeek({ weekLabel }: { weekLabel: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paper p-8 text-center">
      <CalendarIcon size={24} className="mx-auto text-ink-4" />
      <h3 className="font-display text-lg text-ink mt-3">Nothing scheduled {weekLabel}</h3>
      <p className="text-sm text-ink-3 mt-2 max-w-md mx-auto">
        No post has a slot in this week and there are no unscheduled drafts to place. Drafts arrive from the{' '}
        <Link to="/admin/socials/compose/new" className="link-coral">Composer</Link> or the social team's next run; approve them on the{' '}
        <Link to="/admin/socials/queue" className="link-coral">Queue</Link> and give each a slot here.
      </p>
    </div>
  )
}
