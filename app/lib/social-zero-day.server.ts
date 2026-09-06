/**
 * The social day-close alarm (owner direction 2026-09-06).
 *
 * "I consider it a failed run if no posts go out." Two consecutive days
 * (2026-09-05, 2026-09-06) ended with sixteen gated drafts and zero live posts
 * on both Instagram and X, and every social run row for those days said
 * `succeeded`. Nothing in the estate noticed, because liveness only asks
 * whether a run happened, and the run had.
 *
 * This runs once per UTC day, from the last hourly `/cron/social-publish`
 * tick (hour 23, see `isDayCloseHour`). For each scheduled publish platform
 * whose autopublish valve is on and whose `social_freq_<platform>` is above
 * zero, it counts today's `posted` rows. A platform at zero gets:
 *
 *   - one P1 `code` ticket on the social team, dedupe key
 *     `social-zero-day:<platform>` (recurring: a second zero day lands on
 *     the same live ticket instead of a second row), carrying every row the
 *     day drafted for that platform with its review status and the first line
 *     of its gate feedback, so R-DEV can diagnose without the transcript;
 *   - an `error` event on the day's most recent social run, so the dashboard
 *     shows the miss on the run that reported success.
 *
 * It never publishes, never touches a valve, never edits a row. The playbook
 * (`routine-social-daily.md` Step 1b) tells the run to file the same ticket
 * with its own diagnosis at exhaustion; the shared key means this is the
 * backstop for a run that did not, not a duplicate of one that did.
 *
 * Injected deps so the decision logic is testable without a database.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from './db.server'
import { homepageTeamRuns, socialPosts } from '../../db/schema'
import type { PublishPlatform } from './social-publish-job.server'

export const DAY_CLOSE_UTC_HOUR = 23

/** True on the last hourly tick of the UTC day. */
export function isDayCloseHour(now: Date): boolean {
  return now.getUTCHours() >= DAY_CLOSE_UTC_HOUR
}

export interface ZeroDayDraft {
  id: number
  reviewStatus: string
  status: string
  feedback: string | null
}

export interface ZeroDayDeps {
  now: Date
  platforms: readonly PublishPlatform[]
  isEnabled: (platform: PublishPlatform) => Promise<boolean>
  frequency: (platform: PublishPlatform) => Promise<number>
  postedToday: (platform: PublishPlatform) => Promise<number>
  draftsToday: (platform: PublishPlatform) => Promise<ZeroDayDraft[]>
  fileTicket: (input: ZeroDayTicket) => Promise<{ id: number; deduped: boolean }>
  latestSocialRunId: () => Promise<number | null>
  recordEvent: (runId: number, summary: string) => Promise<void>
}

export interface ZeroDayTicket {
  platform: PublishPlatform
  dedupeKey: string
  suggestion: string
}

export interface ZeroDayPlatformReport {
  platform: PublishPlatform
  checked: boolean
  reason?: 'valve_off' | 'frequency_zero' | 'posted'
  postedToday: number
  draftsToday: number
  ticketId?: number
  deduped?: boolean
}

export interface ZeroDayReport {
  day: string
  platforms: ZeroDayPlatformReport[]
}

export function zeroDayDedupeKey(platform: PublishPlatform): string {
  return `social-zero-day:${platform}`
}

/** First line of a gate stamp or owner feedback, trimmed for the ticket body. */
function firstLine(feedback: string | null): string {
  if (!feedback) return '(no feedback)'
  const line = feedback.split('\n').find(l => l.trim()) ?? ''
  return line.trim().slice(0, 220)
}

export function zeroDaySuggestionText(
  platform: PublishPlatform,
  day: string,
  drafts: readonly ZeroDayDraft[],
): string {
  const byStatus = new Map<string, number>()
  for (const d of drafts) byStatus.set(d.reviewStatus, (byStatus.get(d.reviewStatus) ?? 0) + 1)
  const counts = [...byStatus.entries()].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'
  const rows = drafts.length
    ? drafts.map(d => `- row ${d.id} (${d.reviewStatus}/${d.status}): ${firstLine(d.feedback)}`).join('\n')
    : '- no rows drafted for this platform today'
  return [
    `Zero-post day on ${platform} (${day} UTC): the autopublish valve is on, the frequency is above zero, ` +
      `and no ${platform} row reached status posted today. Owner direction 2026-09-06: a day with no live ` +
      `post is a failed run, not an honest zero (routine-social-daily.md Step 1b).`,
    `Drafts today: ${drafts.length} (${counts}).`,
    rows,
    'Diagnose from the gate findings above. The fix is one of three things and all are in scope for this ' +
      'ticket: the publish-gate prompt or calibration (app/lib/team-gates.server.ts), a deterministic check ' +
      '(app/lib/social-publish-gate.server.ts), or the drafting rules (docs/store-team/routine-social-daily.md, ' +
      '.claude/agents/social-media-manager.md). A finding that contradicts a live posted precedent or written ' +
      'doctrine (instagram-campaigns.md section 3.2a, ads-policy.md section Organic social) is a gate defect.',
    `DONE WHEN: a ${platform} row is status posted on the next calendar day, and the gate finding(s) named ` +
      'above have a merged fix (prompt, deterministic check, or playbook), QA-verified against the rows listed ' +
      'here rather than a fresh example.',
  ].join('\n\n')
}

/**
 * Evaluate every platform and file what is missing. Pure orchestration over
 * the injected deps; the production wiring is `runSocialZeroDayCheck`.
 */
export async function checkSocialZeroDay(deps: ZeroDayDeps): Promise<ZeroDayReport> {
  const day = deps.now.toISOString().slice(0, 10)
  const platforms: ZeroDayPlatformReport[] = []
  let runId: number | null | undefined

  for (const platform of deps.platforms) {
    if (!(await deps.isEnabled(platform))) {
      platforms.push({ platform, checked: false, reason: 'valve_off', postedToday: 0, draftsToday: 0 })
      continue
    }
    if ((await deps.frequency(platform)) <= 0) {
      platforms.push({ platform, checked: false, reason: 'frequency_zero', postedToday: 0, draftsToday: 0 })
      continue
    }
    const postedToday = await deps.postedToday(platform)
    if (postedToday > 0) {
      platforms.push({ platform, checked: true, reason: 'posted', postedToday, draftsToday: 0 })
      continue
    }
    const drafts = await deps.draftsToday(platform)
    const ticket = await deps.fileTicket({
      platform,
      dedupeKey: zeroDayDedupeKey(platform),
      suggestion: zeroDaySuggestionText(platform, day, drafts),
    })
    if (runId === undefined) runId = await deps.latestSocialRunId()
    if (runId) {
      await deps.recordEvent(
        runId,
        `Day-close alarm: zero ${platform} posts live on ${day} with the valve on ` +
          `(${drafts.length} drafted). Ticket #${ticket.id}${ticket.deduped ? ' (already open, refreshed)' : ''}. ` +
          'A zero-post day is a failed run (routine-social-daily.md Step 1b).',
      )
    }
    platforms.push({
      platform, checked: true, postedToday: 0, draftsToday: drafts.length,
      ticketId: ticket.id, deduped: ticket.deduped,
    })
  }
  return { day, platforms }
}

async function draftsTodayFromDb(platform: PublishPlatform): Promise<ZeroDayDraft[]> {
  const rows = await db
    .select({
      id: socialPosts.id,
      reviewStatus: socialPosts.reviewStatus,
      status: socialPosts.status,
      feedback: socialPosts.feedback,
    })
    .from(socialPosts)
    .where(and(
      eq(socialPosts.platform, platform),
      gte(socialPosts.createdAt, sql`date_trunc('day', now())`),
    ))
    .orderBy(socialPosts.id)
  return rows
}

async function latestSocialRunIdFromDb(): Promise<number | null> {
  const [row] = await db
    .select({ id: homepageTeamRuns.id })
    .from(homepageTeamRuns)
    .where(and(
      eq(homepageTeamRuns.team, 'social'),
      eq(homepageTeamRuns.runType, 'social'),
      gte(homepageTeamRuns.startedAt, sql`date_trunc('day', now())`),
    ))
    .orderBy(desc(homepageTeamRuns.startedAt))
    .limit(1)
  return row?.id ?? null
}

/** Production wiring. Called from the publish tick; never throws past its caller's catch. */
export async function runSocialZeroDayCheck(now = new Date()): Promise<ZeroDayReport> {
  const [{ getValve, VALVE_KEYS, getSocialFrequencies, createSuggestionDetailed, recordEvent },
    { countPublishedToday, }, { SCHEDULED_PUBLISH_PLATFORMS }] = await Promise.all([
    import('./team.server'),
    import('./social-publish-job.server'),
    import('./social-publish-run.server'),
  ])
  const valveFor: Record<PublishPlatform, (typeof VALVE_KEYS)[keyof typeof VALVE_KEYS]> = {
    instagram: VALVE_KEYS.instagramAutopublish,
    x: VALVE_KEYS.xAutopublish,
  }
  const freqs = await getSocialFrequencies()
  return checkSocialZeroDay({
    now,
    platforms: SCHEDULED_PUBLISH_PLATFORMS,
    isEnabled: p => getValve(valveFor[p]),
    frequency: async p => freqs[p] ?? 0,
    postedToday: p => countPublishedToday(p),
    draftsToday: draftsTodayFromDb,
    fileTicket: async t => {
      const res = await createSuggestionDetailed({
        team: 'social',
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
    latestSocialRunId: latestSocialRunIdFromDb,
    recordEvent: (runId, summary) => recordEvent({
      runId, eventType: 'error', summary, agentRole: 'social-zero-day', phase: 'day-close',
    }),
  })
}
