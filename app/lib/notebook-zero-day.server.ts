/**
 * The Notebook day-close alarm (ticket #13393).
 *
 * Since 2026-08-01 the content routine ended 9 of 64 days with nothing live
 * (08-01, 08-04, 08-05, 08-06, 08-18, 08-21, 09-11, 09-29, 10-03), and nothing
 * noticed. `notebook-healthcheck` (07:41 UTC) asserts the newest post renders;
 * it never reads that post's date, so a day that held its draft reads as
 * healthy because YESTERDAY's post still renders fine. Routine liveness keys
 * on `MAX(started_at)`, so a run that held its post reads as a normal
 * `succeeded` row (valve off) or a `failed` row the owner digest already
 * counts once, neither of which says "today has no live post."
 *
 * Modeled on `app/lib/social-zero-day.server.ts`: a once-a-day check that,
 * when the team's own valves say a post SHOULD have gone live, counts today's
 * actually-published rows and, at zero, files a P1 `code` ticket under a
 * recurring dedupe key (one live ticket at a time) and posts an `error` event
 * on the day's content run.
 *
 * It never publishes, never touches a valve, never edits a Sanity doc.
 *
 * Injected deps so the decision logic (`checkNotebookZeroDay`) is testable
 * without a database or a Sanity client.
 */
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { db } from './db.server'
import { homepageTeamRuns } from '../../db/schema'
import { getClient } from './sanity.server'

export const NOTEBOOK_ZERO_DAY_DEDUPE_KEY = 'notebook-zero-day'

/** [start, end) of the UTC calendar day containing `now`, plus its date string. */
export function utcDayRange(now: Date): { start: Date; end: Date; day: string } {
  const day = now.toISOString().slice(0, 10)
  const start = new Date(`${day}T00:00:00.000Z`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end, day }
}

/** [start, end) of the UTC calendar day immediately before the one containing `now`. */
export function utcPreviousDayRange(now: Date): { start: Date; end: Date; day: string } {
  const { start: todayStart } = utcDayRange(now)
  const start = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)
  return { start, end: todayStart, day: start.toISOString().slice(0, 10) }
}

/**
 * A run's `error` column carries `zero-post-day:notebook:<reason>` when the
 * content routine itself held a post with the autopublish valve on
 * (`routine-content-daily.md` Step 7's zero-post-day rule; `<reason>` is one
 * of `hero`, `gate-block`, `gate-refused`, or `other`). This is "the hold
 * reason taken from that day's content run": the routine already wrote it in
 * exactly this shape, so this check reads it back rather than re-deriving it.
 */
export function holdReasonFromRunError(error: string | null | undefined): string | null {
  const m = /^zero-post-day:notebook:(.+)$/.exec((error ?? '').trim())
  return m ? m[1]!.trim() : null
}

export interface NotebookHeldDraft {
  slug: string
}

export interface NotebookZeroDayDeps {
  now: Date
  isContentEnabled: () => Promise<boolean>
  isAutopublishOn: () => Promise<boolean>
  /** The slug of a blogPost published today (UTC), or null if none. */
  publishedSlugToday: () => Promise<string | null>
  /** The most recently created non-published blogPost from today (UTC), if any. */
  heldDraftToday: () => Promise<NotebookHeldDraft | null>
  /** The hold reason recorded on today's content run, if any. */
  holdReasonToday: () => Promise<string | null>
  fileTicket: (input: { dedupeKey: string; suggestion: string }) => Promise<{ id: number; deduped: boolean }>
  latestContentRunId: () => Promise<number | null>
  recordEvent: (runId: number, summary: string) => Promise<void>
}

export interface NotebookZeroDayReport {
  day: string
  checked: boolean
  reason?: 'valve_off' | 'live'
  publishedSlug?: string | null
  heldDraft?: NotebookHeldDraft | null
  holdReason?: string | null
  ticketId?: number
  deduped?: boolean
}

/** First line of a suggestion/feedback string, trimmed. */
function firstLine(s: string | null): string {
  if (!s) return '(no hold reason on record)'
  const line = s.split('\n').find(l => l.trim()) ?? ''
  return line.trim().slice(0, 220)
}

export function notebookZeroDaySuggestionText(
  day: string,
  heldDraft: NotebookHeldDraft | null,
  holdReason: string | null,
): string {
  const draftLine = heldDraft
    ? `A held draft from today exists at slug "${heldDraft.slug}". Hold reason: ${firstLine(holdReason)}.`
    : `No held draft was found for today either (${firstLine(holdReason)}); the routine may not have run ` +
      'at all today.'
  return [
    `Zero-post day on the Notebook (${day} UTC): content_team_enabled and content_team_autopublish are ` +
      'both on, and no blogPost reached status published today. A held draft with autopublish on is a ' +
      "missed day, not a clean outcome (routine-content-daily.md Step 6/7's zero-post-day rule, mirroring " +
      "routine-social-daily.md Step 1b's owner direction that a day with no live post is a failed run).",
    draftLine,
    'Diagnose from the hold reason above (one of hero, gate-block, gate-refused, or other per the playbook) ' +
      "and the day's content run events in /admin/homepage-team. The fix is one of: the hero/image pipeline, " +
      'the publish-gate prompt or calibration, or the drafting rules ' +
      '(docs/store-team/routine-content-daily.md).',
    'DONE WHEN: a blogPost is status published on the next calendar day, and the held draft named above ' +
      '(when one exists) is either published or explicitly superseded, QA-verified against this slug rather ' +
      'than a fresh example.',
  ].join('\n\n')
}

/**
 * Evaluate the day and file what is missing. Pure orchestration over the
 * injected deps; the production wiring is `runNotebookZeroDayCheck`.
 */
export async function checkNotebookZeroDay(deps: NotebookZeroDayDeps): Promise<NotebookZeroDayReport> {
  const day = deps.now.toISOString().slice(0, 10)

  const [enabled, autopublish] = await Promise.all([deps.isContentEnabled(), deps.isAutopublishOn()])
  if (!enabled || !autopublish) {
    return { day, checked: false, reason: 'valve_off' }
  }

  const publishedSlug = await deps.publishedSlugToday()
  if (publishedSlug) {
    return { day, checked: true, reason: 'live', publishedSlug }
  }

  const [heldDraft, holdReason] = await Promise.all([deps.heldDraftToday(), deps.holdReasonToday()])
  const ticket = await deps.fileTicket({
    dedupeKey: NOTEBOOK_ZERO_DAY_DEDUPE_KEY,
    suggestion: notebookZeroDaySuggestionText(day, heldDraft, holdReason),
  })

  const runId = await deps.latestContentRunId()
  if (runId) {
    await deps.recordEvent(
      runId,
      `Day-close alarm: zero Notebook posts live on ${day} UTC with content_team_autopublish on` +
        `${heldDraft ? ` (held draft at "${heldDraft.slug}")` : ''}. ` +
        `Ticket #${ticket.id}${ticket.deduped ? ' (already open, refreshed)' : ''}. A zero-post day is a ` +
        'missed day, not a clean outcome (routine-content-daily.md Step 7).',
    )
  }

  return {
    day,
    checked: true,
    publishedSlug: null,
    heldDraft,
    holdReason,
    ticketId: ticket.id,
    deduped: ticket.deduped,
  }
}

// ── Sanity + DB glue (production wiring, not unit-tested directly — the
// decision logic above is) ─────────────────────────────────────────────────

async function publishedSlugInRangeFromSanity(start: Date, end: Date): Promise<string | null> {
  const client = getClient(false, false, 'published')
  if (!client) return null
  const row = (await client.fetch(
    `*[_type == "blogPost" && status == "published" && publishedAt >= $start && publishedAt < $end]
      | order(publishedAt desc) [0]{ "slug": slug.current }`,
    { start: start.toISOString(), end: end.toISOString() },
  )) as { slug?: string } | null
  return row?.slug ?? null
}

async function heldDraftInRangeFromSanity(start: Date, end: Date): Promise<NotebookHeldDraft | null> {
  // Raw perspective so an unpublished (drafts.*) doc comes back too, the same
  // perspective content-slug-precheck's live script uses to find an
  // unpublished draft at a slug.
  const client = getClient(false, false, 'raw')
  if (!client) return null
  const row = (await client.fetch(
    `*[_type == "blogPost" && status != "published" && _createdAt >= $start && _createdAt < $end]
      | order(_createdAt desc) [0]{ "slug": slug.current }`,
    { start: start.toISOString(), end: end.toISOString() },
  )) as { slug?: string } | null
  return row?.slug ? { slug: row.slug } : null
}

async function contentRunInRangeFromDb(start: Date, end: Date): Promise<{ id: number; error: string | null } | null> {
  const [row] = await db
    .select({ id: homepageTeamRuns.id, error: homepageTeamRuns.error })
    .from(homepageTeamRuns)
    .where(and(
      eq(homepageTeamRuns.team, 'content'),
      eq(homepageTeamRuns.runType, 'content'),
      gte(homepageTeamRuns.startedAt, start),
      lt(homepageTeamRuns.startedAt, end),
    ))
    .orderBy(desc(homepageTeamRuns.startedAt))
    .limit(1)
  return row ?? null
}

/** Production wiring. Called from the day-close cron tick; never throws past its caller's catch. */
export async function runNotebookZeroDayCheck(now = new Date()): Promise<NotebookZeroDayReport> {
  const { start, end } = utcDayRange(now)
  const { getTeamConfig, getValve, VALVE_KEYS, createSuggestionDetailed, recordEvent } =
    await import('./team.server')

  let runCache: { id: number; error: string | null } | null | undefined
  const run = async () => {
    if (runCache === undefined) runCache = await contentRunInRangeFromDb(start, end)
    return runCache
  }

  return checkNotebookZeroDay({
    now,
    isContentEnabled: async () => (await getTeamConfig('content')).enabled,
    isAutopublishOn: () => getValve(VALVE_KEYS.contentAutopublish),
    publishedSlugToday: () => publishedSlugInRangeFromSanity(start, end),
    heldDraftToday: () => heldDraftInRangeFromSanity(start, end),
    holdReasonToday: async () => holdReasonFromRunError((await run())?.error ?? null),
    fileTicket: async t => {
      const res = await createSuggestionDetailed({
        team: 'content',
        category: 'other',
        kind: 'code',
        priority: 1,
        cxRisk: 'med',
        dedupeKey: t.dedupeKey,
        dedupeScope: 'recurring',
        suggestion: t.suggestion,
      })
      return { id: res.id, deduped: res.deduped }
    },
    latestContentRunId: async () => (await run())?.id ?? null,
    recordEvent: (runId, summary) => recordEvent({
      runId, eventType: 'error', summary, agentRole: 'notebook-zero-day', phase: 'day-close',
    }),
  })
}

/** What the owner digest reports for one UTC day: the live slug, or a miss with its reason. */
export interface NotebookDayStatus {
  day: string
  slug: string | null
  holdReason: string | null
}

async function notebookDayStatusForRange(start: Date, end: Date, day: string): Promise<NotebookDayStatus> {
  const slug = await publishedSlugInRangeFromSanity(start, end)
  if (slug) return { day, slug, holdReason: null }
  const run = await contentRunInRangeFromDb(start, end)
  return { day, slug: null, holdReason: holdReasonFromRunError(run?.error ?? null) }
}

/**
 * The previous UTC day's Notebook status, for the owner digest's one-line
 * summary (ticket #13393 DONE WHEN 3). Best-effort: a Sanity/DB failure here
 * must not stop the digest, so the caller should catch and degrade, the same
 * convention every other `gather*` function in `owner-digest.server.ts` uses.
 */
export async function gatherNotebookYesterdayStatus(now = new Date()): Promise<NotebookDayStatus> {
  const { start, end, day } = utcPreviousDayRange(now)
  return notebookDayStatusForRange(start, end, day)
}
