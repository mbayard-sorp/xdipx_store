/**
 * Lane output floors: does a lane that is running actually produce anything.
 *
 * ## Why this is not a column on `cron_expectations`
 *
 * The plan this implements said to add `floor_value` and `completeness_probe`
 * to that table and seed each floor at the lane's observed p10. Measured
 * against production on 2026-09-04, before writing any of it:
 *
 * | lane     | last output | 30-day shape          | p10 |
 * |----------|-------------|-----------------------|-----|
 * | indexnow | 2026-08-30  | 26 of 30 days at zero | 0   |
 * | outreach | 2026-08-21  | 1 send in 8 weeks     | 0   |
 * | social   | 2026-09-04  | 18 of 30 days active  | 0   |
 *
 * A rate floor seeded at p10 would therefore be zero for all three: a check
 * that cannot fail, which is strictly worse than no check because it
 * manufactures the appearance of coverage. That is the same defect as the
 * liveness alarm's 0/7 precision, arriving from the opposite direction, and the
 * fix for it is not a different threshold — it is a different question.
 *
 * Two lanes here are sporadic by nature. For those the meaningful question is
 * not "how much did you produce today" but "when did you last produce
 * anything", and a staleness bound answers it honestly where a rate bound
 * cannot. Only `social` produces regularly enough for a rate floor to mean
 * something.
 *
 * The second reason the column was wrong: outreach sends are not produced by a
 * cron at all. They are agent work. Hanging their floor off a `cron_expectations`
 * row would have required inventing a route to attach it to.
 *
 * So floors live here, in code, keyed by lane. That costs tunability without a
 * deploy, which at this scale is a smaller price than a migration plus five
 * coordinated edits across `cron-runs.server.ts` where missing any one silently
 * drops the value.
 *
 * ## What a breach means
 *
 * A floor breach is a LANE's problem and files at that lane, never at the
 * owner: invariant 3 of the self-healing program. It rides the same
 * `kind:'process'` tier-1 path as a cron breach, so it self-closes the moment
 * the lane produces again.
 */
import { db } from '~/lib/db.server'
import { sql } from 'drizzle-orm'

const LOG = '[lane-floors]'

export type FloorKind = 'rate' | 'staleness'

export interface LaneFloor {
  /** Stable id, used in the dedupe key. */
  lane: string
  /** Team the breach files at. */
  team: string
  kind: FloorKind
  /** `rate`: minimum output in the window. `staleness`: maximum days of silence. */
  threshold: number
  /** Human sentence for the ticket body. */
  describe: string
  /** Why this threshold and not another, from measured data. */
  rationale: string
}

export interface FloorVerdict extends LaneFloor {
  /** The measured value, or null when the probe could not ask. */
  measured: number | null
  /** True when the floor is breached. Null means not applicable today. */
  breached: boolean | null
  detail: string
}

/**
 * The floors, with the measurement each was chosen from.
 *
 * Deliberately three, not a sweep of every lane. A floor nobody chose from real
 * data is a guess, and a guess that fires is indistinguishable from a fault.
 */
export const LANE_FLOORS: readonly LaneFloor[] = [
  {
    lane: 'indexnow',
    team: 'content',
    kind: 'staleness',
    threshold: 7,
    describe: 'IndexNow has submitted no URL for 7 days',
    rationale:
      'Sporadic by design: 26 of the last 30 days pushed nothing, and one day pushed 1,588. '
      + 'A rate floor on that distribution is either always breached or never. Silence is the '
      + 'signal that matters, and the gaps between real pushes have been 3 to 15 days, so 7 '
      + 'sits above normal cadence and below the outage the audit measured (19 URLs in 9 days '
      + 'while the sitemap grew 220 and indexed pages fell from 97 to 91).',
  },
  {
    lane: 'outreach',
    team: 'strategy',
    kind: 'staleness',
    threshold: 14,
    describe: 'the outreach lane has sent nothing for 14 days',
    rationale:
      'One send in eight weeks with the valve open for four of them. Measured 2026-09-04 the '
      + 'lane sits at exactly 14 days, so this does not fire today and fires tomorrow unless '
      + 'something sends. That is the intended shape: a floor should become true when the '
      + 'condition does, not arrive pre-tripped to prove it works.',
  },
  {
    lane: 'social',
    team: 'social',
    kind: 'rate',
    threshold: 1,
    describe: 'no social post published in 24h while the gates were open',
    rationale:
      'The only lane regular enough for a rate floor: 18 of 30 days active, median 2 posts on '
      + 'an active day, with social_freq_* set to 2 per platform. The floor is 1 rather than '
      + 'the configured 2 because it should catch a stopped lane, not a slow one; the 12 quiet '
      + 'days in the window are the finding, and one deduped row that closes on the next post '
      + 'reports them without becoming a daily alarm.',
  },
]

/** Days since the most recent row, or null when the table has never had one. */
async function daysSince(query: ReturnType<typeof sql>): Promise<number | null> {
  const r = await db.execute(query)
  const row = (r.rows ?? [])[0] as Record<string, unknown> | undefined
  const v = row?.['days']
  return v === null || v === undefined ? null : Number(v)
}

async function countRows(query: ReturnType<typeof sql>): Promise<number> {
  const r = await db.execute(query)
  const row = (r.rows ?? [])[0] as Record<string, unknown> | undefined
  return Number(row?.['n'] ?? 0)
}

/** True when at least one social platform is cleared to publish today. */
async function socialGateOpen(): Promise<boolean> {
  try {
    const { getPipelineSetting } = await import('~/lib/feed-processor.server')
    const [team, ig, x] = await Promise.all([
      getPipelineSetting('social_team_autopost'),
      getPipelineSetting('instagram_autopublish_enabled'),
      getPipelineSetting('x_autopublish_enabled'),
    ])
    // The team valve is the master; either platform valve is enough downstream.
    return team === 'true' && (ig === 'true' || x === 'true')
  } catch (err) {
    console.warn(`${LOG} gate read failed, treating as closed`, err)
    // Fail CLOSED for the alarm, not for the lane: if we cannot prove the gate
    // was open we must not accuse the lane of missing a floor it was barred
    // from meeting. A false quiet is recoverable; a false accusation trains the
    // reader to skip the list.
    return false
  }
}

async function measure(f: LaneFloor): Promise<{ measured: number | null; breached: boolean | null; detail: string }> {
  switch (f.lane) {
    case 'indexnow': {
      const d = await daysSince(sql`
        SELECT (now()::date - MAX(pinged_at)::date) AS days FROM indexnow_pings`)
      if (d === null) return { measured: null, breached: null, detail: 'no IndexNow submission has ever been recorded' }
      return { measured: d, breached: d > f.threshold, detail: `last submission ${d} day(s) ago, bound ${f.threshold}` }
    }
    case 'outreach': {
      const d = await daysSince(sql`
        SELECT (now()::date - MAX(sent_at)::date) AS days
          FROM outreach_messages WHERE direction = 'out'`)
      if (d === null) return { measured: null, breached: null, detail: 'no outreach send has ever been recorded' }
      return { measured: d, breached: d > f.threshold, detail: `last send ${d} day(s) ago, bound ${f.threshold}` }
    }
    case 'social': {
      if (!await socialGateOpen()) {
        return { measured: null, breached: null, detail: 'gates closed, the lane is not permitted to publish' }
      }
      const n = await countRows(sql`
        SELECT COUNT(*)::int AS n FROM social_posts
         WHERE status = 'posted' AND posted_at > now() - interval '24 hours'`)
      return { measured: n, breached: n < f.threshold, detail: `${n} post(s) in 24h with gates open, floor ${f.threshold}` }
    }
    default:
      return { measured: null, breached: null, detail: `no probe implemented for lane ${f.lane}` }
  }
}

/**
 * Measure every floor. Never throws: a floor that cannot be read reports
 * `breached: null`, which the caller treats as "no opinion" rather than
 * "healthy" — the same render-truth rule the liveness manifest follows.
 */
export async function checkLaneFloors(): Promise<FloorVerdict[]> {
  const out: FloorVerdict[] = []
  for (const f of LANE_FLOORS) {
    try {
      const m = await measure(f)
      out.push({ ...f, ...m })
    } catch (err) {
      console.warn(`${LOG} probe failed for ${f.lane}`, err)
      out.push({ ...f, measured: null, breached: null, detail: `probe failed: ${String(err).slice(0, 200)}` })
    }
  }
  return out
}
