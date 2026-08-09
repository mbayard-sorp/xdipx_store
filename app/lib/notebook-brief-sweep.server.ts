/**
 * Stranded-brief sweep for the Notebook content pipeline.
 *
 * The daily content-writer routine patches a seoContentBrief to `published`
 * (and sets its `publishedPost` ref) when the post goes live. Three times the
 * final patch did not survive contact with a real run: the blogPost went live
 * while its brief stayed `queued`/`drafted`, so the editorial queue kept
 * re-serving work that was already done (posts live 2026-07-25, 2026-07-29, and
 * how-do-app-controlled-vibrators-work live 2026-08-05 but its brief still
 * `queued`, closed out by hand on run 196).
 *
 * Step 6.3 of routine-content-daily.md already mandates a published-perspective
 * verify read after publish; prose could not stop the recurrence, so this is
 * the durable mechanical backstop for when that step is skipped or fails
 * silently. It is read-only against the PUBLISHED Sanity perspective (the same
 * perspective the routine's own verify is supposed to check) and flags any
 * seoContentBrief still in `queued`/`drafted` whose slug already has a
 * published blogPost, filing one deduped ticket per stranded brief.
 *
 * The remediation is a Sanity data patch (mark the brief published), not a code
 * change, so the ticket is filed `kind:'process'` — filing it `code` would put
 * it in the daily dev claim loop with nothing to code, where it would only ever
 * bounce.
 *
 * Server-only. Invoked from runNotebookHealthcheck so it rides the existing
 * /cron/notebook-healthcheck schedule with no new cron wiring.
 */
import { Sentry } from '~/lib/sentry.server'
import { getClient } from '~/lib/sanity.server'

/** A brief left behind: still queued/drafted although its slug is live. */
export interface StrandedBrief {
  id: string
  slug: string
  status: string
  /** Whether the brief's publishedPost reference was ever set. */
  hasPublishedRef: boolean
}

export interface StrandedBriefSweepResult {
  /** True only when nothing is stranded. */
  ok: boolean
  stranded: StrandedBrief[]
  /** Ticket ids filed (0 = deduped against a live ticket, or filing failed). */
  ticketsFiled: number[]
}

/** Statuses a brief should have already left once its post is published. */
export const STRANDED_BRIEF_STATUSES = ['queued', 'drafted'] as const

// GROQ join: a brief in a pre-published status whose slug already resolves to a
// published blogPost. Runs on the published perspective so it reflects the
// committed state the routine's own verify read is supposed to check, not
// in-flight drafts.
const STRANDED_BRIEFS_QUERY = `*[_type == "seoContentBrief"
  && status in $statuses
  && count(*[_type == "blogPost" && status == "published" && slug.current == ^.slug.current]) > 0]{
    "id": _id,
    "slug": slug.current,
    status,
    "hasPublishedRef": defined(publishedPost)
  } | order(_id asc)`

/**
 * Query Sanity (published perspective) for stranded briefs. Never throws — a
 * client failure returns an empty list so the caller (the render healthcheck)
 * is never masked by a sweep problem.
 */
export async function findStrandedBriefs(): Promise<StrandedBrief[]> {
  const client = getClient(false, false, 'published')
  if (!client) return []
  const rows = (await client.fetch(STRANDED_BRIEFS_QUERY, {
    statuses: [...STRANDED_BRIEF_STATUSES],
  })) as unknown
  if (!Array.isArray(rows)) return []
  return rows.filter(
    (r): r is StrandedBrief =>
      !!r &&
      typeof (r as StrandedBrief).id === 'string' &&
      typeof (r as StrandedBrief).slug === 'string',
  )
}

/**
 * Flag every stranded brief: one deduped `process` ticket per brief, plus a P3
 * Sentry capture. Deduped on the slug so a brief that stays stranded across
 * daily runs stays a single ticket. Never throws.
 */
export async function sweepStrandedBriefs(): Promise<StrandedBriefSweepResult> {
  let stranded: StrandedBrief[]
  try {
    stranded = await findStrandedBriefs()
  } catch (err) {
    console.error('[notebook-brief-sweep] query failed (ignored):', err)
    return { ok: false, stranded: [], ticketsFiled: [] }
  }

  if (stranded.length === 0) return { ok: true, stranded: [], ticketsFiled: [] }

  Sentry.captureException(
    new Error(
      `Notebook brief sweep found ${stranded.length} stranded brief(s): ` +
        stranded.map((b) => `${b.slug} (${b.status})`).join(', '),
    ),
    { tags: { sweep: 'notebook-brief', severity: 'P3' }, extra: { stranded } },
  )

  const ticketsFiled: number[] = []
  try {
    const { fileDetectionTicket, makeDedupeKey, priorityFromSeverity } = await import(
      '~/lib/detection-tickets.server'
    )
    for (const b of stranded) {
      ticketsFiled.push(
        await fileDetectionTicket({
          detector: 'notebook-brief-sweep',
          dedupeKey: makeDedupeKey('stranded-brief', b.slug),
          priority: priorityFromSeverity('P3'),
          category: 'other',
          kind: 'process',
          suggestion:
            `seoContentBrief "${b.slug}" (${b.id}) is still status=${b.status} ` +
            `(publishedPost ${b.hasPublishedRef ? 'set' : 'null'}) while a blogPost with ` +
            `the same slug is already published. The editorial queue will keep re-serving ` +
            `already-done work until the brief is closed out.\n\n` +
            `Fix: patch the brief to status="published" and set its publishedPost ref (the ` +
            `final step of routine-content-daily.md Step 6.3). This is a Sanity data patch, ` +
            `not a code change.\n\n` +
            `Detected by the notebook-brief sweep on the published perspective.`,
          links: [{ kind: 'doc', ref: b.id, state: 'stranded' }],
        }),
      )
    }
  } catch (err) {
    console.error('[notebook-brief-sweep] ticket filing failed (ignored):', err)
  }

  return { ok: false, stranded, ticketsFiled }
}
