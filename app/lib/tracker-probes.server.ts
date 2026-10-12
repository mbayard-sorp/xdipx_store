/**
 * Measured verdicts for tracker milestones, so a GREEN row has to earn it.
 *
 * ## The failure this closes
 *
 * `tracker.server.ts` parses an "evidence probe" column out of every milestone
 * row and nothing has ever executed it. The RAG letter beside it is hand-typed,
 * the daily digest counts RED trackers into its subject line from that letter,
 * and `/admin/trackers` renders it. So a milestone can read `done / GREEN`
 * indefinitely after the condition it claims stopped holding.
 *
 * Measured against production on 2026-09-04, the day this shipped:
 *
 *   b1-bus         done   GREEN   probe wants "below 10"   measured 33
 *   e3-targetteam  dropped GREEN  probe wants "is 0"       measured 95
 *   a4-probes      in-prog AMBER  probe wants "is 0"       measured  8
 *
 * Two of the three milestones whose probes are machine-checkable were asserting
 * GREEN while their own stated evidence failed. The third was honest. That
 * ratio is the argument for this file.
 *
 * ## Registry drift, corrected 2026-10-12 (ticket #14942)
 *
 * All three of the original entries had drifted from the tracker:
 *  - `e3-targetteam` was CUT (the tracker row itself reads `dropped`, 2026-09-02:
 *    `target_team IS NULL` was redefined to mean "the proposing team owns it",
 *    so the backfill this probe measured would write redundant data). Removed.
 *  - `b1-bus` (closed, done/GREEN) measured the exact same quantity as
 *    `e1-blocked` (the live, actively-tracked RED milestone: "blocked rows at
 *    attempt_count 0, below 10"), so every contradiction it could ever report
 *    was reported twice under two keys, one of them already closed. Re-keyed
 *    to `e1-blocked` rather than re-targeted at the harder-to-verify
 *    `dismissed`-edge-usage reading the ticket also offered: the query was
 *    already right, it was just filed under the wrong milestone.
 *  - `a4-probes` had fallen out of sync with the tracker's own corrected probe
 *    text (`docs/store-team/trackers/self-healing-automation.md`, row a4-probes,
 *    2026-09-15 entry): missing `override_no_probe_reason IS NULL` entirely, and
 *    excluding only `category = 'decision'` where the tracker excludes `console`
 *    too. Corrected to match that row's literal probe exactly. Left open: that
 *    tracker text does not exclude `category = 'approval'`, even though
 *    `PROBE_REQUIRED_CATEGORIES` (`owner-blockers-core.ts`) doesn't require one
 *    there either — a real ambiguity the tracker row itself hasn't resolved, so
 *    this entry restates the tracker's literal words rather than guessing past
 *    them.
 *
 * ## Why the SQL lives here and not in the markdown
 *
 * The obvious implementation reads the probe cell and runs it. It was rejected:
 * `docs/store-team/trackers/*.md` is inside the agent-editor docs allowlist, so
 * executing those cells would let an agent-authored markdown row run arbitrary
 * SQL as the application's database user, with no human in the path — the
 * allowlist merges docs PRs without a QA verdict. A measurement worth having is
 * not worth a code-execution surface, and the estate already has the safer
 * pattern: the owner-blocker probe vocabulary is a code registry keyed by name.
 *
 * So milestones opt in by id, here, where the query is reviewable in a diff.
 * Coverage is deliberately partial: three of about thirty. A milestone with no
 * entry renders as ASSERTED rather than measured, which is honest, and adding
 * one is a small reviewable PR rather than a markdown edit.
 */
import { sql } from 'drizzle-orm'

import { db } from '~/lib/db.server'

const LOG = '[tracker-probes]'

export type ProbeVerdict = 'pass' | 'fail' | 'unreadable'

export interface MilestoneProbe {
  /** `<tracker slug>:<milestone id>`. */
  key: string
  /** The bound, in the same words as the tracker cell. */
  describe: string
  /** Measure it. Returns null when the query could not be answered. */
  measure: () => Promise<number | null>
  /** True when the measurement satisfies the bound. */
  ok: (measured: number) => boolean
}

async function scalar(q: ReturnType<typeof sql>): Promise<number | null> {
  try {
    const r = await db.execute(q)
    const row = (r.rows ?? [])[0] as Record<string, unknown> | undefined
    const v = row?.['n']
    return v === null || v === undefined ? null : Number(v)
  } catch (err) {
    console.warn(`${LOG} probe query failed`, err)
    return null
  }
}

/**
 * The registry. Keys match the tracker file's slug and the milestone id.
 *
 * Each entry restates its bound in `describe` rather than importing it from the
 * markdown, on purpose: if the doc and the code disagree about what GREEN
 * means, that disagreement should be visible rather than silently resolved in
 * favour of whichever one was read last.
 */
export const MILESTONE_PROBES: readonly MilestoneProbe[] = [
  {
    // Re-keyed from the now-closed b1-bus (ticket #14942): the query itself was
    // already correct, just filed under the wrong milestone, duplicating this
    // one under a second key. e1-blocked is the live, actively-tracked (RED)
    // milestone this bound actually belongs to.
    key: 'self-healing-automation:e1-blocked',
    describe: 'blocked rows at attempt_count 0, below 10',
    measure: () => scalar(sql`
      SELECT COUNT(*)::int AS n FROM homepage_team_suggestions
       WHERE status = 'blocked' AND attempt_count = 0`),
    ok: (n) => n < 10,
  },
  {
    key: 'self-healing-automation:a4-probes',
    describe: 'open blockers with no probe, no override reason, not decision/console, is 0',
    measure: () => scalar(sql`
      SELECT COUNT(*)::int AS n FROM owner_blockers
       WHERE status = 'open' AND verify_probe IS NULL AND override_no_probe_reason IS NULL
         AND category NOT IN ('decision', 'console')`),
    ok: (n) => n === 0,
  },
]

const BY_KEY = new Map(MILESTONE_PROBES.map((p) => [p.key, p]))

export interface MilestoneMeasurement {
  key: string
  describe: string
  measured: number | null
  verdict: ProbeVerdict
}

/** Measure every registered probe. Never throws. */
export async function measureMilestones(): Promise<MilestoneMeasurement[]> {
  const out: MilestoneMeasurement[] = []
  for (const p of MILESTONE_PROBES) {
    const measured = await p.measure()
    out.push({
      key: p.key,
      describe: p.describe,
      measured,
      verdict: measured === null ? 'unreadable' : p.ok(measured) ? 'pass' : 'fail',
    })
  }
  return out
}

export function hasProbe(slug: string, milestoneId: string): boolean {
  return BY_KEY.has(`${slug}:${milestoneId}`)
}

/**
 * A milestone whose asserted RAG and measured verdict disagree.
 *
 * Only GREEN is contradicted by a failing probe. An AMBER or RED row that fails
 * its probe is simply telling the truth, and flagging it would bury the two
 * rows that are not.
 */
export interface RagContradiction {
  key: string
  assertedRag: string
  describe: string
  measured: number | null
}

export function findContradictions(
  milestones: readonly { slug: string; id: string; rag: string }[],
  measurements: readonly MilestoneMeasurement[],
): RagContradiction[] {
  const byKey = new Map(measurements.map((m) => [m.key, m]))
  const out: RagContradiction[] = []
  for (const m of milestones) {
    const measurement = byKey.get(`${m.slug}:${m.id}`)
    if (!measurement || measurement.verdict !== 'fail') continue
    if (m.rag !== 'GREEN') continue
    out.push({
      key: measurement.key,
      assertedRag: m.rag,
      describe: measurement.describe,
      measured: measurement.measured,
    })
  }
  return out
}
