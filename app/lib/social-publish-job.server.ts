/**
 * The Instagram scheduled-publish job (ticket #2740).
 *
 * Owner direction 2026-08-11: "I don't want to be the bottle neck for posts to
 * go out." This is the thing that publishes without him. It is deliberately the
 * last link built, because everything before it exists to make an unattended
 * publish safe: generated imagery (#2734), the independent pre-publish gate
 * (#2739) which is the only writer of `review_status:'approved'`, and a way for
 * him to react afterwards (#2738).
 *
 * SHIPS INERT. `instagram_autopublish_enabled` defaults off, is read fresh every
 * tick, and nothing here fires until the owner flips it. Turning it on is his
 * move and his alone.
 *
 * The logic lives in this (unprotected) module rather than in the cron handler
 * on purpose. `server/cron*.ts` is a protected path precisely because "the job
 * itself is where the money and the writes are", so keeping the handler down to
 * registration keeps the owner's review surface small while the substance stays
 * testable here.
 *
 * Two failure modes drove the design, both of them real:
 *  - A post published after its product went out of stock and had to be deleted
 *    (2026-08-09). Draft-time checking is not enough; the gate re-runs here.
 *  - Fire-and-forget work after a response is silently discarded on Vercel,
 *    which killed six webhook handlers for months. The caller must AWAIT this.
 */

import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import { runDeterministicPublishChecks, type GateFinding } from './social-publish-gate.server'
import { isTickEligible, preserveGateStamp } from './social-publish-approve.server'
import { runRemovalWatch, type RemovalWatchResult } from './social-removal-watch.server'
import { checkLinkedProductStock } from './social-publish/stock-guard.server'
import { resolvePostProductHandle } from './social-publish/product-handle.server'
import { estimateXPostCostUsd, estimateXSpendUsd } from './social-publish/x-limits'
import { permalinkFor } from './social-permalink.server'
import { formatLaSlot } from './social-schedule'

/**
 * Per-tick ceiling. A code constant, not a valve: there is no reason for the
 * owner to tune this live, and its whole job is to stop one tick from draining
 * a backlog onto a live account. If the valve was off for a week and comes back
 * on, `scheduled_for <= today` matches every queued row at once; this is what
 * makes that a trickle instead of a flood.
 */
export const MAX_PER_TICK = 2

/** Fallback when `instagram_publish_max_per_day` is unset. */
export const DEFAULT_MAX_PER_DAY = 3

/**
 * Bound on one tick's own work, used to justify the sweep below: at most
 * MAX_PER_TICK posts, each capped by the publisher's 120s container-ingest
 * timeout, so a tick cannot still be running an hour later when the next fires.
 */
export const MAX_TICK_DURATION_MS = MAX_PER_TICK * 120_000

export type PublishOutcome =
  | 'published'
  | 'blocked_by_gate'
  | 'no_gate_verdict'
  | 'failed'
  | 'claim_lost'
  /** Publishing this post would cross the month's spend ceiling. */
  | 'spend_cap'
  /** The row's durable shopify_product_id is not available for sale (#2212). */
  | 'out_of_stock'

export interface PublishAttempt {
  postId: number
  outcome: PublishOutcome
  detail?: string
  findings?: GateFinding[]
}

export interface PublishTickResult {
  skipped?: string
  swept: number
  attempts: PublishAttempt[]
  publishedToday: number
  /** What the removal watch saw this tick, when it ran. */
  watch?: RemovalWatchResult | null
  /** Which platform this tick ran for. */
  platform?: PublishPlatform
  /** Month-to-date estimated spend, when this platform meters spend. */
  spendUsd?: number
  /** Unapproved rows whose slot passed more than a day ago, flagged this tick. */
  expired?: number
}

/**
 * Platforms the unattended job can publish for.
 *
 * TikTok and YouTube are deliberately absent: their adapters are stubs that
 * return `not_configured`, and a tick that ran for them would do nothing except
 * churn rows through `publishing` and back.
 */
export type PublishPlatform = 'instagram' | 'x'

/**
 * Every data access the tick performs, behind an interface.
 *
 * Not ceremony: the decisions worth testing here are the ones that decide
 * whether a post reaches a public account, and they are all interleaved with
 * database calls. Injecting the store is what makes "does a gate block stop a
 * publish" a test instead of a code-read.
 */
export interface PublishRepo {
  sweepAbandoned: () => Promise<number>
  /**
   * Flag unapproved rows whose slot is more than a day gone (Phase 4). Optional
   * so the fake repos that predate it keep working; the live repo supplies it.
   */
  expireStale?: () => Promise<number>
  countPublishedToday: () => Promise<number>
  listEligible: (limit: number) => Promise<PostRow[]>
  recentCaptions: (limit: number) => Promise<string[]>
  claim: (postId: number) => Promise<PostRow | null>
  markPosted: (postId: number, externalPostId: string, at: Date) => Promise<void>
  markNeedsChanges: (postId: number, feedback: string) => Promise<void>
  markFailed: (postId: number, detail: string, terminal: boolean) => Promise<void>
}

export type PostRow = typeof socialPosts.$inferSelect

export interface PublishTickDeps {
  /**
   * Defaults to Instagram, which is what every caller did before X existed.
   * Keeping the default means the Instagram tick and its tests are untouched.
   */
  platform?: PublishPlatform
  /** Reads the autopublish valve. Injected so tests never touch settings. */
  isEnabled: () => Promise<boolean>
  /**
   * Month-to-date spend in USD, and the ceiling it is checked against. Both
   * optional, and supplied together or not at all.
   *
   * Instagram supplies neither: publishing there is free, so a spend guard
   * would be a cap on nothing. X bills per post and a linked post costs more
   * than 13x a plain one, so on X this is the difference between a valve the
   * owner can leave on and one that quietly accrues a bill. When the ceiling is
   * reached the tick stops publishing rather than failing rows, because there
   * is nothing wrong with the posts.
   */
  monthSpendUsd?: () => Promise<number>
  maxSpendUsd?: () => Promise<number>
  /** Daily publish ceiling, independent of the drafting quota. */
  maxPerDay: () => Promise<number>
  /**
   * Publishes one post. Returns the external id on success, and an optional
   * `note` when the publish succeeded but with a caveat worth recording (e.g.
   * an Instagram post that published untagged because its product was not
   * approved for tagging, #3744). The note is attached to the `published`
   * attempt so it survives into the tick report, not just a console line.
   */
  publish: (post: typeof socialPosts.$inferSelect) => Promise<
    { ok: true; externalPostId: string; note?: string } | { ok: false; detail: string }
  >
  /**
   * Resolves the featured product handle for a post, when it has one.
   *
   * Defaults to the row's product linkage (`shopify_product_id`, resolved to
   * a handle through `productHandleById`), falling back to the handle the
   * gate stamped into `feedback` while that column is null (Phase 5, #4913).
   * That default matters more than it looks: the handle is what turns the
   * deterministic stock check on, and while this was merely optional nothing
   * supplied it in production, so the publish-time stock re-check silently
   * did nothing on every row.
   */
  productHandleFor?: (post: PostRow) => Promise<string | null>
  /**
   * Resolves `shopify_product_id` to a handle. Defaults to the Shopify Admin
   * lookup; a test injects a stub so no network call is made.
   */
  productHandleById?: (shopifyProductId: string) => Promise<string | null>
  now?: () => Date
  /** Defaults to the live database. */
  repo?: PublishRepo
  /**
   * Passed through to the deterministic gate. Exists so a test can decide
   * stock without a Shopify round trip; in production this is omitted and the
   * gate does the real lookup.
   */
  gateDeps?: { getAvailability?: (handle: string) => Promise<boolean | null> }
  /**
   * The publish-time stock guard's product lookup (ticket #2212). Defaults to
   * the real Storefront availability check; a test injects a stub here to
   * decide stock for `shopify_product_id` without a network call. Independent
   * of `gateDeps.getAvailability` above, which the deterministic gate uses for
   * the caller-supplied (gate-stamp) `productHandle` — this one is keyed by
   * the durable column instead.
   */
  checkStockByProductId?: (shopifyProductId: string) => Promise<boolean | null>
  /**
   * Looks at what is already live before this tick adds to it (ticket #2741).
   *
   * Defaults to the real watch. Tests pass a no-op, because a tick that reaches
   * Instagram to check eight posts is not the unit under test here.
   */
  removalWatch?: () => Promise<RemovalWatchResult | null>
}

/**
 * Writes that address one row by id and so need no platform scope.
 *
 * Declared before `makeDbPublishRepo` deliberately: `dbPublishRepo` below calls
 * that factory at module load, so a `const` declared after it would still be in
 * the temporal dead zone and throw on import.
 */
const sharedRepoWrites: Pick<PublishRepo, 'markNeedsChanges' | 'markFailed'> = {
  markNeedsChanges: async (postId, feedback) => {
    await db.update(socialPosts)
      // Back to the review queue rather than published. This is the one place
      // the owner still sees a post before it is public, and it only happens
      // when something is actually wrong.
      .set({ status: 'draft', reviewStatus: 'needs_changes', feedback, updatedAt: new Date() })
      .where(eq(socialPosts.id, postId))
  },
  markFailed: async (postId, detail, terminal) => {
    await db.update(socialPosts)
      .set({ status: terminal ? 'failed' : 'draft', errorMessage: detail, updatedAt: new Date() })
      .where(eq(socialPosts.id, postId))
  },
}

/**
 * Flip a row to posted, capturing its live URL (ADR-013 decision 10).
 *
 * The permalink is resolved HERE, inside the database implementation, and not
 * in the tick loop: the loop's contract with `PublishRepo.markPosted` stays
 * `(postId, externalPostId, at)`, so every fake repo in the tests is untouched
 * and the tick never learns that Instagram needs a second GET to know its own
 * URL. `permalinkFor` never throws and returns null on failure; the status
 * write is never conditional on it, and the metrics sweep backfills the gaps.
 */
export async function markPostedWithPermalink(
  platform: PublishPlatform,
  postId: number,
  externalPostId: string,
  at: Date,
): Promise<void> {
  const permalink = await permalinkFor(platform, externalPostId)
  await db.update(socialPosts)
    .set({ status: 'posted', externalPostId, postedAt: at, permalink, updatedAt: at })
    .where(eq(socialPosts.id, postId))
}

/**
 * The live implementation, bound to one platform.
 *
 * Every query here was `platform = 'instagram'` before X existed. Binding at
 * construction rather than threading a platform argument through each method
 * keeps `PublishRepo` the same shape it already was, which is why the existing
 * tests inject their fake repo unchanged.
 */
/**
 * What makes a row publishable by an unattended tick.
 *
 * Exported and separate from the query so the predicate itself is testable: it
 * is the whole safety boundary of this module (an approved draft whose day has
 * come, on this platform, and nothing else), and it was also where a row could
 * be silently stranded. A test can render this to SQL without a database.
 */
/** The COALESCE the predicate and the ordering share (ADR-013 decision 9). */
const effectiveSlotSql = sql`coalesce(${socialPosts.scheduledAt}, ${socialPosts.scheduledFor}::timestamptz)`

export function eligibleWhere(platform: PublishPlatform) {
  return and(
    eq(socialPosts.platform, platform),
    eq(socialPosts.status, 'draft'),
    eq(socialPosts.reviewStatus, 'approved'),
    // `<=` now, not `=`: a post whose slot was missed because the valve was
    // off still goes out, instead of being silently skipped forever.
    //
    // Due-ness reads `COALESCE(scheduled_at, scheduled_for::timestamptz)`
    // (ADR-013 decision 9). `scheduled_at` is the Phase 4 slot, an instant the
    // owner picked on the LA wall clock and stored in UTC. `scheduled_for` is
    // the legacy date-only column; a row carrying only `'2026-08-23'` casts to
    // midnight UTC of that day, which is 17:00 PDT on the 22nd. That is
    // accepted on purpose: it is never LATER than the old `<= current_date`
    // test (which also made the row due from the UTC day boundary), so no
    // legacy row becomes less eligible than it was, and no backfill UPDATE is
    // needed in a migration file.
    //
    // NULL (both columns) counts as due, and that is a fix rather than a
    // nicety. Not every path that creates a draft sets a slot: rows written
    // outside the scheduled drafting routine land undated, and a NULL never
    // satisfies `<=`, so an APPROVED row could be permanently invisible to the
    // only thing that publishes it. That is the same silent-skip this `<=` was
    // written to prevent, reached by a different door. It had already caught
    // one live row (#53, gate-approved 2026-08-16, still unpublished). An
    // undated approved row means "ship this when there is room", so treat it
    // that way.
    or(
      and(isNull(socialPosts.scheduledAt), isNull(socialPosts.scheduledFor)),
      sql`${effectiveSlotSql} <= now()`,
    ),
  )
}

/** How long an unapproved row may sit past its slot before it is flagged. */
export const EXPIRE_AFTER_MS = 24 * 60 * 60 * 1000

/** The marker an expired row's feedback starts with. Checked so a row is flagged once, not every tick. */
export const EXPIRED_PREFIX = '[expired]'

/**
 * The feedback an expired row carries: the marker, the slot it missed on the
 * LA wall clock, then whatever the row already said. Pure, so it is testable
 * without the database write around it. The prior text is kept whole, so a
 * gate stamp inside it still parses (`parseGateStamp` matches at any line
 * start) for the burn-in readers (#4913).
 */
export function expiredFeedback(scheduledAt: Date, prior: string | null): string {
  const line = `${EXPIRED_PREFIX} Slot ${formatLaSlot(scheduledAt)} passed without approval; reschedule or re-draft.`
  return prior?.trim() ? `${line}\n${prior}` : line
}

/**
 * Flag draft rows that were never approved and whose slot is more than
 * EXPIRE_AFTER_MS gone (Phase 4 auto-expire).
 *
 * Why flag and not delete or publish: the slot was a plan, and a plan nobody
 * signed off on is not a post. The row goes to `needs_changes` so it leaves
 * the gate's queue (the gate only verdicts draft/pending_review) and shows up
 * in the Studio as something to reschedule or re-draft. Approved rows are not
 * touched: an approved row past its slot is simply due, and the tick publishes
 * it. Rows with only the legacy `scheduled_for` are not expired either, since
 * a date-only row never had a slot to miss.
 */
export async function expireStaleUnapproved(
  platform: PublishPlatform,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - EXPIRE_AFTER_MS)
  const stale = await db
    .select({ id: socialPosts.id, scheduledAt: socialPosts.scheduledAt, feedback: socialPosts.feedback })
    .from(socialPosts)
    .where(and(
      eq(socialPosts.platform, platform),
      eq(socialPosts.status, 'draft'),
      inArray(socialPosts.reviewStatus, ['pending_review', 'needs_changes']),
      isNotNull(socialPosts.scheduledAt),
      lt(socialPosts.scheduledAt, cutoff),
      or(isNull(socialPosts.feedback), sql`${socialPosts.feedback} not like ${EXPIRED_PREFIX + '%'}`),
    ))
  let n = 0
  for (const row of stale) {
    if (!row.scheduledAt) continue
    await db.update(socialPosts)
      .set({ reviewStatus: 'needs_changes', feedback: expiredFeedback(row.scheduledAt, row.feedback), updatedAt: now })
      .where(eq(socialPosts.id, row.id))
    n++
  }
  return n
}

export function makeDbPublishRepo(platform: PublishPlatform): PublishRepo {
  return {
    sweepAbandoned: () => sweepAbandonedPublishing(platform),
    expireStale: () => expireStaleUnapproved(platform),
    countPublishedToday: () => countPublishedToday(platform),
    claim: claimForPublish,
    listEligible: async (limit) => db
      .select()
      .from(socialPosts)
      .where(eligibleWhere(platform))
      // Earliest effective slot first, NULLS LAST: a row someone scheduled
      // keeps its claim on the day's room, and undated rows fill what is
      // left. The daily cap still binds either way.
      .orderBy(sql`${effectiveSlotSql} asc nulls last`, socialPosts.id)
      .limit(limit),
    recentCaptions: async (limit) => {
      const rows = await db
        .select({ t: socialPosts.tweetText, e: socialPosts.editedText })
        .from(socialPosts)
        .where(and(eq(socialPosts.platform, platform), eq(socialPosts.status, 'posted')))
        .orderBy(desc(socialPosts.postedAt))
        .limit(limit)
      return rows.map(r => (r.e?.trim() || r.t))
    },
    markPosted: (postId, externalPostId, at) => markPostedWithPermalink(platform, postId, externalPostId, at),
    markNeedsChanges: sharedRepoWrites.markNeedsChanges,
    markFailed: sharedRepoWrites.markFailed,
  }
}

/** Kept for callers that predate the platform parameter. */
export const dbPublishRepo: PublishRepo = makeDbPublishRepo('instagram')

/**
 * Return abandoned `publishing` rows to `draft` so they can be retried.
 *
 * Two things to know about why this has no time cutoff.
 *
 * First, there is nowhere to put one. `social_posts` has no `updated_at` and no
 * claim timestamp, and `created_at` is when the row was DRAFTED, which for a
 * post scheduled days out is unrelated to when it was claimed. Using it would
 * sweep live rows instantly. Adding a column means a migration, and a migration
 * is a protected path; it is not worth one here because:
 *
 * Second, the sweep runs at the START of a tick, and a tick cannot outlive the
 * interval between ticks. One tick does at most MAX_PER_TICK publishes, each
 * bounded by the publisher's 120s ingest timeout (MAX_TICK_DURATION_MS, four
 * minutes against an hourly schedule). So any row still `publishing` when a new
 * tick begins belongs to a tick that is already over, and is by definition
 * abandoned. The assumption this rests on is that ticks do not overlap; if the
 * schedule is ever tightened below MAX_TICK_DURATION_MS, this stops being safe
 * and needs a real claim timestamp.
 *
 * Guarded on `external_post_id IS NULL`, which is the guard that actually
 * matters: a publish that succeeded on Instagram but crashed before the DB
 * write already has an external id, and sweeping it back to draft would post it
 * to a public account twice. Such a row is left alone deliberately, for a human
 * to reconcile against the live feed.
 */
export async function sweepAbandonedPublishing(
  platform: PublishPlatform = 'instagram',
): Promise<number> {
  const rows = await db
    .update(socialPosts)
    .set({ status: 'draft' })
    .where(and(
      // Scoped to one platform, which matters now that more than one ticks.
      // Unscoped, an Instagram tick would sweep an X row that a concurrent X
      // tick had just claimed, handing the same row to two publishers. The
      // non-overlap argument below holds within a platform, not across them.
      eq(socialPosts.platform, platform),
      eq(socialPosts.status, 'publishing'),
      isNull(socialPosts.externalPostId),
    ))
    .returning({ id: socialPosts.id })
  return rows.length
}

/**
 * Claim a row for this tick.
 *
 * The UPDATE is the claim: it matches on `status = 'draft'`, so if another tick
 * (or the owner's own click in the Studio) got there first, zero rows come back
 * and we skip. Doing this as a separate SELECT then UPDATE would leave a window
 * where two ticks both believe they own the row, and the cost of losing that
 * race is a duplicate public post.
 */
export async function claimForPublish(postId: number) {
  const rows = await db
    .update(socialPosts)
    .set({ status: 'publishing' })
    .where(and(eq(socialPosts.id, postId), eq(socialPosts.status, 'draft')))
    .returning()
  return rows[0] ?? null
}

/** Count of this platform's posts already published today. */
export async function countPublishedToday(
  platform: PublishPlatform = 'instagram',
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(socialPosts)
    .where(and(
      eq(socialPosts.platform, platform),
      eq(socialPosts.status, 'posted'),
      sql`${socialPosts.postedAt} >= date_trunc('day', now())`,
    ))
  return rows[0]?.n ?? 0
}

/**
 * Month-to-date X spend in USD, estimated from what was actually posted.
 *
 * Estimated rather than measured because X's API returns no per-request cost
 * and the store has no billing integration. The estimate is derived from the
 * published caption: a post carrying a link is billed at the higher tier, and
 * every other post at the lower one (see `x-limits.ts`). That makes this exact
 * as long as X's list prices are, and wrong in the same direction as the bill
 * if they change, which is why the prices live in one named constant.
 *
 * Reads `edited_text` in preference to `tweet_text`, because the edited text is
 * what was actually published and is what the link check must run against.
 */
export async function estimateXSpendThisMonthUsd(): Promise<number> {
  const rows = await db
    .select({ t: socialPosts.tweetText, e: socialPosts.editedText })
    .from(socialPosts)
    .where(and(
      eq(socialPosts.platform, 'x'),
      eq(socialPosts.status, 'posted'),
      sql`${socialPosts.postedAt} >= date_trunc('month', now())`,
    ))
  return estimateXSpendUsd(rows.map(r => r.e?.trim() || r.t))
}

/**
 * One tick. Publishes at most MAX_PER_TICK eligible posts.
 *
 * AWAIT this before responding. Vercel discards work that continues after the
 * response is sent, which is how six Shopify webhook handlers silently did
 * nothing for months.
 */
export async function runSocialPublishTick(deps: PublishTickDeps): Promise<PublishTickResult> {
  const now = deps.now?.() ?? new Date()
  const platform: PublishPlatform = deps.platform ?? 'instagram'
  const repo = deps.repo ?? makeDbPublishRepo(platform)

  // Read fresh every tick, so flipping the valve off takes effect at the next
  // tick rather than at the next deploy.
  if (!(await deps.isEnabled())) {
    return { skipped: 'valve_off', swept: 0, attempts: [], publishedToday: 0, platform }
  }

  const swept = await repo.sweepAbandoned()

  // Flag unapproved rows whose slot is a day gone (Phase 4). Runs before the
  // eligibility read on purpose, though it can never touch an approved row:
  // the Studio should show the missed slot on the same tick that would have
  // published it, not an hour later.
  const expired = repo.expireStale ? await repo.expireStale() : undefined
  const expiredField = expired !== undefined ? { expired } : {}

  // Look at what is already live before adding to it (ticket #2741).
  //
  // Order matters and is the whole point of putting this here: a removal found
  // at 14:00 stops the 14:00 publish, not the 15:00 one. Under autopublish
  // "something already live looks wrong" is the only failure signal left, since
  // nothing queues for a human to notice.
  //
  // A removal steps the drafting quota down and, on a second removal in the
  // window, turns this valve off. Both writes land before `listEligible`, so a
  // sweep that just turned the valve off does not then publish two more posts
  // in the same tick.
  const watch = await (deps.removalWatch ?? (() => runRemovalWatch()))()
  if (watch?.valveTurnedOff) {
    return { skipped: 'removal_pattern', swept, ...expiredField, attempts: [], publishedToday: 0, watch }
  }

  const publishedToday = await repo.countPublishedToday()
  const maxPerDay = await deps.maxPerDay()
  if (publishedToday >= maxPerDay) {
    return { skipped: 'daily_cap', swept, ...expiredField, attempts: [], publishedToday, platform }
  }

  // Month-to-date spend, read once per tick. Both halves are optional and are
  // supplied together; Instagram supplies neither because publishing is free.
  let spendUsd: number | undefined
  let maxSpendUsd: number | undefined
  if (deps.monthSpendUsd && deps.maxSpendUsd) {
    spendUsd = await deps.monthSpendUsd()
    maxSpendUsd = await deps.maxSpendUsd()
    if (spendUsd >= maxSpendUsd) {
      return { skipped: 'spend_cap', swept, ...expiredField, attempts: [], publishedToday, platform, spendUsd }
    }
  }

  const room = Math.min(MAX_PER_TICK, maxPerDay - publishedToday)
  const eligible = await repo.listEligible(room)
  const recentCaptions = await repo.recentCaptions(14)

  const attempts: PublishAttempt[] = []
  let spentThisTick = 0

  for (const candidate of eligible) {
    // Budget is checked BEFORE the claim, not after.
    //
    // A row is claimed by flipping it to `publishing`, and the only ways back
    // are markPosted, markNeedsChanges, or markFailed. None of them fit "the
    // post is fine, we simply cannot afford it this month": markFailed writes
    // an error message, which makes the row's NEXT attempt terminal under the
    // two-strike rule, so a budget pause would permanently kill a good post.
    // Checking first leaves the row untouched in the queue for next month.
    const cost = spendUsd !== undefined
      ? estimateXPostCostUsd(candidate.editedText?.trim() || candidate.tweetText)
      : 0
    if (spendUsd !== undefined && maxSpendUsd !== undefined) {
      if (spendUsd + spentThisTick + cost > maxSpendUsd) {
        attempts.push({
          postId: candidate.id,
          outcome: 'spend_cap',
          detail: `Would cost $${cost.toFixed(3)} against $${(maxSpendUsd - spendUsd - spentThisTick).toFixed(3)} left this month.`,
        })
        break
      }
    }

    const post = await repo.claim(candidate.id)
    if (!post) {
      attempts.push({ postId: candidate.id, outcome: 'claim_lost' })
      continue
    }

    // Durable stock guard (ticket #2212). shopify_product_id is set once at
    // draft time and never depends on whether a gate call happened to supply
    // a productHandle, so a stale approved row cannot slip an out-of-stock
    // product past this even when the gate stamp is missing or wrong. Rows
    // with no linkage are unaffected (checkLinkedProductStock returns ok:true
    // immediately) and fall through to the rest of the checks below. An
    // ineligible row here does not stop the tick — it goes back to the queue
    // and the loop moves on to the next candidate.
    const stock = await checkLinkedProductStock(post.shopifyProductId, deps.checkStockByProductId)
    if (!stock.ok) {
      // preserveGateStamp keeps the legacy stamp behind the note for burn-in
      // readers; the columns are untouched and remain the verdict of record.
      await repo.markNeedsChanges(
        post.id,
        preserveGateStamp(
          post.feedback,
          `[stock-guard] ${stock.detail} Swap the product or re-draft before this can publish.`,
        ) ?? '',
      )
      attempts.push({ postId: post.id, outcome: 'out_of_stock', ...(stock.detail ? { detail: stock.detail } : {}) })
      continue
    }

    const caption = post.editedText?.trim() || post.tweetText

    // Refuse anything neither the pre-publish gate nor the owner ever looked
    // at.
    //
    // `review_status='approved'` has two possible authors: the gate, which
    // writes its verdict into `gate_status` (and, for burn-in, the stamp in
    // `feedback`), and the owner's click in the Social Studio, which (ticket
    // #5425) now stamps `gate_status='owner'` when the row did not already
    // carry an agent PASS. Both are attended review — the gate's is an
    // agent's judgment, the owner's is his own, and either is enough for the
    // unattended publisher to act on. An approved row carrying NEITHER is
    // either a leftover from before this shipped or something that reached
    // the column another way, and that is the row this refusal still exists
    // to catch: nothing adversarial has read it, and shipping it unattended
    // is the one thing this whole chain exists to prevent.
    //
    // Rule (Phase 5, #4913; extended #5425): publishable when
    // `isTickEligible` says pass-or-owner. The column wins over the legacy
    // stamp, so a stale PASS stamp under a 'block' column never ships.
    // TODO(#4913 burn-in): the stamp half of `isTickEligible` goes next cycle.
    if (!isTickEligible(post)) {
      await repo.markNeedsChanges(
        post.id,
        'Approved without a publish-gate PASS or an owner approval verdict, so nothing ' +
        'independent has reviewed it. Either it is a pre-gate leftover (approved before ' +
        'social-publish-gate covered this platform, or before ticket #5425) or it reached ' +
        '`approved` through a path other than the Social Studio review click or the gate. ' +
        'This row is now needs_changes, and the gate only verdicts draft/pending_review, so ' +
        're-gating it in place is not possible. The way out is a rework draft carrying ' +
        'reworkedFrom:' + post.id + ' (POST /api/team/social-post {op:"draft", ..., ' +
        '"reworkedFrom":' + post.id + '}); that lands at pending_review by default and gets ' +
        'gated there on the next run (routine-social-daily.md Step 2.5).',
      )
      attempts.push({ postId: post.id, outcome: 'no_gate_verdict' })
      continue
    }

    // The deterministic gate runs HERE, not only at gate time. Time passes
    // between approval and the scheduled slot, and stock is the thing that
    // moves in it. The handle comes from the row's product linkage (stamp
    // fallback during burn-in) unless a caller overrides.
    const productHandle = deps.productHandleFor
      ? await deps.productHandleFor(post)
      : await resolvePostProductHandle(post, deps.productHandleById)
    const gate = await runDeterministicPublishChecks({
      caption,
      mediaUrls: post.mediaUrls ?? [],
      productHandle,
      recentCaptions,
      platform,
    }, deps.gateDeps)

    if (gate.blocked || gate.held) {
      const summary = gate.findings.map(f => `[${f.check}] ${f.detail}`).join(' ')
      await repo.markNeedsChanges(post.id, preserveGateStamp(post.feedback, summary) ?? summary)
      attempts.push({ postId: post.id, outcome: 'blocked_by_gate', findings: gate.findings })
      continue
    }

    const result = await deps.publish(post)
    if (result.ok) {
      await repo.markPosted(post.id, result.externalPostId, now)
      // Charged only here. A gate block or a failed publish costs nothing, so
      // counting at claim time would shrink the month's budget for posts that
      // never reached X.
      spentThisTick += cost
      attempts.push({ postId: post.id, outcome: 'published', ...(result.note ? { detail: result.note } : {}) })
      continue
    }

    // Two attempts, tracked without a new column: the first failure records the
    // error and returns the row to the queue, and a row that already carries an
    // error message is on its second try and goes terminal. A publish path that
    // retries forever against a live API is worse than one that stops.
    const terminal = !!post.errorMessage
    await repo.markFailed(post.id, result.detail, terminal)
    attempts.push({
      postId: post.id,
      outcome: 'failed',
      detail: terminal ? `terminal: ${result.detail}` : `will retry: ${result.detail}`,
    })
  }

  return {
    swept,
    attempts,
    publishedToday,
    watch,
    platform,
    ...(spendUsd !== undefined ? { spendUsd: spendUsd + spentThisTick } : {}),
    ...expiredField,
  }
}
