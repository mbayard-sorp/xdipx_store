/**
 * Every scheduled surface this system has, and the floor each is held to.
 *
 * ## Why this is a file and not a query
 *
 * `vercel.json` says what is *scheduled*. It cannot say what a missing run
 * *means*, who should act, or whether absence is a money event. It also is not
 * the whole truth: there is a second scheduler plane. The browser checkout
 * probe runs from GitHub Actions at `30 7 * * *`, outside Vercel, outside
 * `cronRoute`, outside `cron_runs` — and it is the closest thing this estate has
 * to "can a customer actually reach checkout". A manifest that enumerated the 29
 * Vercel crons and stopped would certify that blindness as healthy, which is
 * worse than having no manifest at all.
 *
 * ## Why it is not seeded from the migration
 *
 * An `INSERT` fails the additive allowlist in `migration-classify.server.ts`, so
 * seeding rows in `090_cron_runs.sql` would make the whole file `manual` and
 * cost an owner merge for a table definition. Upserting from here instead also
 * puts the manifest where it belongs: adding a cron requires adding its
 * expectation in the same PR, and `cron-expectations.test.ts` asserts exactly
 * that against `vercel.json` and the workflow files. Prose never becomes the
 * source of truth for a live fact.
 *
 * ## `recorded` is a cost decision, stated out loud
 *
 * `server/cron.ts` gives the two every-2-minute pollers a KV negative cache with
 * an explicit comment: when the last pass found zero in-flight jobs, skip the
 * Neon query entirely so the cron does not keep DB compute awake. Someone
 * deliberately engineered 1,440 daily invocations to touch Neon zero times. A
 * blanket `cron_runs` INSERT fires before that check and reinstates 2,880 writes
 * a day whose entire content is `skipped: idle`, pinning Neon compute awake on a
 * platform billed by compute-hour.
 *
 * So `recorded: true` is reserved for surfaces whose failure has a next actor
 * (~12 of 30, ~360 rows/day). Everything else gets a KV heartbeat: same
 * liveness invariant, no Neon wake. Absence of both, past `periodMinutes +
 * graceMinutes`, is how a killed run is detected — a process SIGKILLed at the
 * 300s ceiling cannot write its own epitaph, so "killed" is always inferred at
 * read time, never observed.
 *
 * ## `graceMinutes` exists because a floor with no slack gets trained away
 *
 * A 300s lambda plus a cold start plus scheduler jitter is ordinary variance.
 * The live cautionary tale is the "enrich stage may be stalled" line, which has
 * warned every single day for six weeks against a table that stopped being
 * written on 2026-07-21: a health line that WARNs constantly is a line the
 * reader learns to skip, which is strictly worse than no line.
 */

export type CronPlane = 'vercel' | 'actions'

export interface CronExpectation {
  /** Route path on the Vercel plane; workflow file path on the Actions plane. */
  route: string
  plane: CronPlane
  /** The declared cadence, verbatim, so the drift test compares rather than re-derives. */
  schedule: string
  /** How often this surface must show evidence of life. */
  periodMinutes: number
  /** Slack before absence is a breach. */
  graceMinutes: number
  /** True = a `cron_runs` row per invocation. False = a KV heartbeat only. */
  recorded: boolean
  /** A breach is a money-path event and may page. */
  moneyRelevant: boolean
  /** Whose lane a breach files a ticket at. Never the owner's inbox. */
  ownerTeam: string | null
  notes: string
}

/** Minutes between fires, for the cadences actually in use here. */
const EVERY_2_MIN = 2
const EVERY_10_MIN = 10
const EVERY_15_MIN = 15
const EVERY_30_MIN = 30
const HOURLY = 60
const EVERY_3_HOURS = 180
const EVERY_6_HOURS = 360
const DAILY = 1440
const WEEKLY = 10_080
const MONTHLY = 44_640

export const CRON_EXPECTATIONS: readonly CronExpectation[] = [
  // -------------------------------------------------------------------------
  // Recorded: failure has a next actor.
  // -------------------------------------------------------------------------
  {
    route: '/cron/pricing-batch-recompute',
    plane: 'vercel',
    schedule: '0 7 * * *',
    periodMinutes: DAILY,
    graceMinutes: 90,
    recorded: true,
    moneyRelevant: true,
    ownerTeam: 'product',
    notes:
      'The reason this table exists. Ran and died at the 300s ceiling every morning for at least '
      + 'four days with no error recorded, because a SIGKILL is not a throw, while the digest '
      + 'printed GOOD on a COUNT(*) > 0 test. Grace is 90 min because the pass now self-continues '
      + 'up to 8 times.',
  },
  {
    route: '/cron/pricing-audit-prune',
    plane: 'vercel',
    schedule: '15 7 * * *',
    periodMinutes: DAILY,
    graceMinutes: 60,
    recorded: true,
    moneyRelevant: false,
    ownerTeam: 'product',
    notes:
      'Split out of the recompute so a DELETE of up to 20,000 rows stops competing for the budget '
      + 'the money path needs. pricing_audit_log was 432,000 rows and 188 MB, 78% of the whole '
      + '241 MB database, with no retention policy at all.',
  },
  {
    route: '/cron/checkout-probe',
    plane: 'vercel',
    schedule: '0 */6 * * *',
    periodMinutes: EVERY_6_HOURS,
    graceMinutes: 30,
    recorded: true,
    moneyRelevant: true,
    ownerTeam: 'strategy',
    notes:
      'The HTTP tier. One of only two classes permitted to page by SMS. Records ok on a 403 today, '
      + 'which is tightened before it carries that weight (milestone g5-probe).',
  },
  {
    route: '.github/workflows/checkout-probe.yml',
    plane: 'actions',
    schedule: '30 7 * * *',
    periodMinutes: DAILY,
    graceMinutes: 120,
    recorded: false,
    moneyRelevant: true,
    ownerTeam: 'strategy',
    notes:
      'The SECOND SCHEDULER PLANE, and the reason this manifest is not just vercel.json. The '
      + 'browser tier: a real Playwright run against the live checkout. It cannot write to '
      + 'cron_runs (it runs on a GitHub runner, not in the app), so liveness is read from its '
      + 'checkout_probe_runs rows instead. Absence here is invisible to every other health surface.',
  },
  {
    route: '/cron/release-engine',
    plane: 'vercel',
    schedule: '*/10 * * * *',
    periodMinutes: EVERY_10_MIN,
    graceMinutes: 20,
    recorded: true,
    moneyRelevant: false,
    ownerTeam: 'strategy',
    notes:
      'If this stops, every agent PR silently waits for the owner and nothing says so. It also '
      + 'carries the hourly out-of-band reconcile that unstrands hand-merged PRs, so its absence '
      + 'strands tickets as well as merges.',
  },
  {
    route: '/cron/owner-digest',
    plane: 'vercel',
    schedule: '0 13 * * *',
    periodMinutes: DAILY,
    graceMinutes: 60,
    recorded: true,
    moneyRelevant: false,
    ownerTeam: 'strategy',
    notes:
      'A missed send must be loud. Once quiet days stop sending (milestone d4-senders), a FAILED '
      + 'send becomes indistinguishable from a quiet one, and that is a seven-day blind window — '
      + 'strictly worse than the noise it replaced. This row is what makes the difference legible.',
  },
  {
    route: '/cron/blocker-list',
    plane: 'vercel',
    schedule: '30 13 * * *',
    periodMinutes: DAILY,
    graceMinutes: 60,
    recorded: true,
    moneyRelevant: false,
    ownerTeam: 'strategy',
    notes:
      'Load-bearing for a reason that is easy to miss: verifyBlockers() has exactly one caller '
      + 'chain and it ends here, so this is the ONLY thing that evaluates blocker probes and '
      + 'auto-clears rows. Deleting this cron would delete probe evaluation right after a stage '
      + 'made probes mandatory.',
  },
  {
    route: '/cron/social-publish',
    plane: 'vercel',
    schedule: '0 * * * *',
    periodMinutes: HOURLY,
    graceMinutes: 30,
    recorded: true,
    moneyRelevant: false,
    ownerTeam: 'social',
    notes: 'The only thing that ships gate-approved posts. Absence is silent: drafts simply accumulate approved.',
  },
  {
    route: '/cron/discontinued-sweep',
    plane: 'vercel',
    schedule: '45 23 * * *',
    periodMinutes: DAILY,
    graceMinutes: 90,
    recorded: true,
    moneyRelevant: false,
    ownerTeam: 'product',
    notes: 'Catalog integrity: without it the storefront keeps selling what the feed has dropped.',
  },
  {
    route: '/cron/import-enrich',
    plane: 'vercel',
    schedule: '*/30 * * * *',
    periodMinutes: EVERY_30_MIN,
    graceMinutes: 40,
    recorded: true,
    moneyRelevant: false,
    ownerTeam: 'product',
    notes:
      'The draft-to-live half of the import chain. Holds a 290s lock deliberately longer than its '
      + 'own interval, so overlapping passes are expected and are not a breach.',
  },
  {
    route: '/cron/homepage-healthcheck',
    plane: 'vercel',
    schedule: '*/30 * * * *',
    periodMinutes: EVERY_30_MIN,
    graceMinutes: 30,
    recorded: true,
    moneyRelevant: false,
    ownerTeam: 'homepage',
    notes:
      'One of only two crons whose failure a visitor sees, and the rollback path for a bad '
      + 'homepage publish. Escalation class storefront-down.',
  },
  {
    route: '/cron/profit-summary',
    plane: 'vercel',
    schedule: '5 0 * * *',
    periodMinutes: DAILY,
    graceMinutes: 60,
    recorded: true,
    moneyRelevant: true,
    ownerTeam: 'strategy',
    notes: 'The daily money row every downstream report reads. A gap here silently zeroes a day.',
  },
  {
    route: '/cron/db-backup',
    plane: 'vercel',
    schedule: '40 4 * * *',
    periodMinutes: DAILY,
    graceMinutes: 120,
    recorded: true,
    moneyRelevant: false,
    ownerTeam: 'strategy',
    notes:
      'The only copy of this database that survives the Neon account. Recorded because a missing '
      + 'nightly dump has a next actor and a 36h staleness floor the restore probe enforces. Not '
      + 'money-relevant in the paging sense: a missed dump is not an outage, it is a widening '
      + 'window, and paging on it would spend the SMS channel on something a queue row covers.',
  },
  {
    route: '/cron/db-restore-probe',
    plane: 'vercel',
    schedule: '10 6 * * *',
    periodMinutes: DAILY,
    graceMinutes: 120,
    recorded: true,
    moneyRelevant: false,
    ownerTeam: 'strategy',
    notes:
      'The half that makes the other half a backup. A dump nobody reads back is a file, and the '
      + 'failures it hides are the expensive ones: a table that serialised to nothing, a gzip that '
      + 'never finished, a private object the token can no longer read. Daily rather than weekly '
      + 'because the gap between "the backup broke" and "someone found out" is the quantity G1 '
      + 'exists to shrink.',
  },
  {
    route: '/cron/janitor-sweep',
    plane: 'vercel',
    schedule: '0 */6 * * *',
    periodMinutes: EVERY_6_HOURS,
    graceMinutes: 60,
    recorded: true,
    moneyRelevant: false,
    ownerTeam: 'strategy',
    notes:
      'The reader for everything this manifest describes, and the only caller of '
      + 'syncCronExpectations. Recorded deliberately, and the recursion is the point: if the '
      + 'watcher stops, nothing else notices anything has stopped, so it must be visible to the '
      + 'same mechanism it operates. Its own breach is read from its cron_runs rows by whoever '
      + 'looks next.',
  },
  {
    route: '/cron/main-ci-watch',
    plane: 'vercel',
    schedule: '*/10 * * * *',
    periodMinutes: EVERY_10_MIN,
    graceMinutes: 40,
    recorded: true,
    moneyRelevant: false,
    ownerTeam: 'strategy',
    notes:
      'Catches a red default branch, which reds every open PR at once. Grace is deliberately wide: '
      + 'a 10-minute poll cannot beat a multi-minute Actions run whose remedy is itself a '
      + 'multi-minute deploy, so detection latency already exceeds remedy latency here.',
  },

  // -------------------------------------------------------------------------
  // Heartbeat only: high-frequency, or failure has no distinct next actor.
  // -------------------------------------------------------------------------
  {
    route: '/cron/enrichment-batch-poller',
    plane: 'vercel',
    schedule: '*/2 * * * *',
    periodMinutes: EVERY_2_MIN,
    graceMinutes: 15,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'product',
    notes:
      'NEVER make this recorded. Its KV negative cache exists precisely so 720 daily invocations '
      + 'touch Neon zero times; a row per invocation would pin DB compute awake around the clock.',
  },
  {
    route: '/cron/video-job-poller',
    plane: 'vercel',
    schedule: '*/2 * * * *',
    periodMinutes: EVERY_2_MIN,
    graceMinutes: 15,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'social',
    notes: 'Same negative cache, same rule as the enrichment poller.',
  },
  {
    route: '/cron/warm',
    plane: 'vercel',
    schedule: '*/15 * * * *',
    periodMinutes: EVERY_15_MIN,
    graceMinutes: 20,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'homepage',
    notes:
      'The second of the two crons a visitor feels. Its current shape is itself the result of a '
      + 'prior Shopify rate-limit incident, so it is explicitly not a frequency-cut candidate.',
  },
  {
    route: '/cron/warm-homepage',
    plane: 'vercel',
    schedule: 'internal',
    periodMinutes: EVERY_15_MIN,
    graceMinutes: 30,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'homepage',
    notes: 'Registered route, not in vercel.json: driven internally. Listed so the manifest is the full surface, not just the scheduled subset.',
  },
  {
    route: '/cron/warm-homepage-b',
    plane: 'vercel',
    schedule: 'internal',
    periodMinutes: EVERY_15_MIN,
    graceMinutes: 30,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'homepage',
    notes: 'As warm-homepage, for variant b.',
  },
  {
    route: '/cron/conversion-watch',
    plane: 'vercel',
    schedule: '*/15 * * * *',
    periodMinutes: EVERY_15_MIN,
    graceMinutes: 30,
    recorded: false,
    moneyRelevant: true,
    ownerTeam: 'strategy',
    notes:
      'The conversion-delivery watcher and the CAPI reconciler, split off log-monitor in G3. They '
      + 'rode that route only because it was the one every-15-minutes slot back when vercel.json '
      + 'was protected, which it stopped being on 2026-08-19. Leaving them attached while '
      + 'log-monitor dropped to hourly would have taken the check that notices Purchase delivery '
      + 'is dead from 15 minutes to 60, on the path that once stayed broken for two months. '
      + 'moneyRelevant, and the watcher owns one of the two paging classes.',
  },
  {
    route: '/cron/log-monitor',
    plane: 'vercel',
    schedule: '25 * * * *',
    periodMinutes: HOURLY,
    graceMinutes: 30,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'strategy',
    notes:
      'Classifier deleted in G3: 433 calls and 16.9M input tokens over 30 days, faithfully '
      + 'classifying npm-install lines, for zero log-derived tickets in its lifetime. What remains '
      + 'is the auto-expired-run folder, which never needed a model — an expired run is a '
      + 'homepage_team_runs row, not a console line, so the classifier could never have seen it. '
      + 'Hourly because these are post-hoc diagnostic tickets and the query already holds a run '
      + 'back through a recovery grace. The route keeps its name because ADR-009 records the '
      + 'decision to ride it and rewriting an ADR to match a later change falsifies the record.',
  },
  {
    route: '/cron/import-monitor',
    plane: 'vercel',
    schedule: '0 8 * * *',
    periodMinutes: DAILY,
    graceMinutes: 90,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'product',
    notes: 'Files import candidates; a missed day delays the queue rather than breaking anything live.',
  },
  {
    route: '/cron/social-metrics-sweep',
    plane: 'vercel',
    schedule: '20 */6 * * *',
    periodMinutes: EVERY_6_HOURS,
    graceMinutes: 60,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'social',
    notes: 'Backfills engagement onto published posts.',
  },
  {
    route: '/cron/social-asset-auto-archive',
    plane: 'vercel',
    schedule: '50 3 * * *',
    periodMinutes: DAILY,
    graceMinutes: 120,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'social',
    notes: 'Housekeeping.',
  },
  {
    route: '/cron/outreach-inbox',
    plane: 'vercel',
    schedule: '*/30 * * * *',
    periodMinutes: EVERY_30_MIN,
    graceMinutes: 60,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'strategy',
    notes: 'Frequency-cut candidate: inbound replies do not arrive on a 30-minute cadence.',
  },
  {
    route: '/cron/review-reminders',
    plane: 'vercel',
    schedule: '0 9 * * *',
    periodMinutes: DAILY,
    graceMinutes: 120,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'strategy',
    notes: 'Post-purchase review asks. At three lifetime orders this is near-dormant by construction.',
  },
  {
    route: '/cron/notebook-healthcheck',
    plane: 'vercel',
    schedule: '41 7 * * *',
    periodMinutes: DAILY,
    graceMinutes: 120,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'content',
    notes: 'Notebook render check.',
  },
  {
    route: '/cron/gsc-snapshot',
    plane: 'vercel',
    schedule: '0 6 * * 1',
    periodMinutes: WEEKLY,
    graceMinutes: 240,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'content',
    notes: 'Weekly Search Console snapshot.',
  },
  {
    route: '/cron/gsc-index-sweep',
    plane: 'vercel',
    schedule: '15 */3 * * *',
    periodMinutes: EVERY_3_HOURS,
    graceMinutes: 90,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'content',
    notes:
      'Frequency-cut candidate: GSC\'s own data updates on a multi-hour lag, so 8 polls a day '
      + 'cannot observe 8 distinct states.',
  },
  {
    route: '/cron/indexnow-push',
    plane: 'vercel',
    schedule: '40 4 * * *',
    periodMinutes: DAILY,
    graceMinutes: 120,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'content',
    notes: 'Pushes changed URLs to IndexNow.',
  },
  {
    route: '/cron/seo-daily',
    plane: 'vercel',
    schedule: '30 12 * * *',
    periodMinutes: DAILY,
    graceMinutes: 120,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'content',
    notes: 'Daily SEO aggregate.',
  },
  {
    route: '/cron/keyword-research',
    plane: 'vercel',
    schedule: '0 2 1 * *',
    periodMinutes: MONTHLY,
    graceMinutes: 1440,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'content',
    notes: 'Monthly. The longest period in the manifest, hence a full day of grace.',
  },
  {
    route: '/cron/aeo-surface-check',
    plane: 'vercel',
    schedule: '0 6 * * 0',
    periodMinutes: WEEKLY,
    graceMinutes: 240,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'content',
    notes: 'Weekly LLM-discovery surface sweep.',
  },
  {
    route: '/cron/runpod-pod-watch',
    plane: 'vercel',
    schedule: '17 * * * *',
    periodMinutes: HOURLY,
    graceMinutes: 30,
    recorded: false,
    moneyRelevant: true,
    ownerTeam: 'social',
    notes:
      'Money-relevant in the literal sense: it files an owner blocker when a RunPod pod is left '
      + 'RUNNING, which bills by the hour. Heartbeat rather than recorded only because it is '
      + 'hourly and its own output is already a durable blocker row.',
  },
  {
    route: '/cron/checkout-probe-report',
    plane: 'vercel',
    schedule: 'internal',
    periodMinutes: DAILY,
    graceMinutes: 240,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'strategy',
    notes: 'Registered route, not in vercel.json: reports on probe history when asked.',
  },
  {
    route: '/cron/regenerate-emma-rail',
    plane: 'vercel',
    schedule: 'internal',
    periodMinutes: DAILY,
    graceMinutes: 240,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'homepage',
    notes:
      'One of the three routes that bypassed cronRoute entirely with a bare router.post, so it was '
      + 'invisible to any wrapper-level instrumentation. Routed through cronRoute in this change.',
  },
  {
    route: '/cron/purchase-reconcile',
    plane: 'vercel',
    schedule: 'internal',
    periodMinutes: DAILY,
    graceMinutes: 240,
    recorded: true,
    moneyRelevant: true,
    ownerTeam: 'strategy',
    notes:
      'The money-adjacent one of the three bypasses: it reconciles paid Shopify orders against the '
      + 'conversion ledger. Bare router.post until this change, so nothing could have told you it '
      + 'had stopped.',
  },
  {
    route: '/cron/warm-discovery-index',
    plane: 'vercel',
    schedule: 'internal',
    periodMinutes: DAILY,
    graceMinutes: 240,
    recorded: false,
    moneyRelevant: false,
    ownerTeam: 'homepage',
    notes: 'The third bypass. Routed through cronRoute in this change.',
  },
]

/** Indexed by route, for the wrapper's per-request lookup. */
export const CRON_EXPECTATION_BY_ROUTE: ReadonlyMap<string, CronExpectation> =
  new Map(CRON_EXPECTATIONS.map((e) => [e.route, e]))

/** Routes that write a `cron_runs` row. Everything else heartbeats only. */
export const RECORDED_CRON_ROUTES: ReadonlySet<string> =
  new Set(CRON_EXPECTATIONS.filter((e) => e.recorded).map((e) => e.route))

/** True when this route should write a durable row rather than a heartbeat. */
export function isRecordedCronRoute(route: string): boolean {
  return RECORDED_CRON_ROUTES.has(route)
}
