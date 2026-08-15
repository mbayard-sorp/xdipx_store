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

import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import { runDeterministicPublishChecks, type GateFinding } from './social-publish-gate.server'
import { parseGateStamp } from './social-publish-approve.server'

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
}

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
  /** Reads the autopublish valve. Injected so tests never touch settings. */
  isEnabled: () => Promise<boolean>
  /** Daily publish ceiling, independent of the drafting quota. */
  maxPerDay: () => Promise<number>
  /** Publishes one post. Returns the external id on success. */
  publish: (post: typeof socialPosts.$inferSelect) => Promise<
    { ok: true; externalPostId: string } | { ok: false; detail: string }
  >
  /**
   * Resolves the featured product handle for a post, when it has one.
   *
   * Defaults to reading the gate stamp the pre-publish gate wrote into
   * `feedback`. That default matters more than it looks: the handle is what
   * turns the deterministic stock check on, `social_posts` has no column for
   * one, and while this was merely optional nothing supplied it in production
   * — so the publish-time stock re-check, the entire reason the gate runs here
   * rather than only at draft time, silently did nothing on every row.
   */
  productHandleFor?: (post: PostRow) => Promise<string | null>
  now?: () => Date
  /** Defaults to the live database. */
  repo?: PublishRepo
  /**
   * Passed through to the deterministic gate. Exists so a test can decide
   * stock without a Shopify round trip; in production this is omitted and the
   * gate does the real lookup.
   */
  gateDeps?: { getAvailability?: (handle: string) => Promise<boolean | null> }
}

/** The live implementation. */
export const dbPublishRepo: PublishRepo = {
  sweepAbandoned: sweepAbandonedPublishing,
  countPublishedToday,
  claim: claimForPublish,
  listEligible: async (limit) => db
    .select()
    .from(socialPosts)
    .where(and(
      eq(socialPosts.platform, 'instagram'),
      eq(socialPosts.status, 'draft'),
      eq(socialPosts.reviewStatus, 'approved'),
      // `<=` today, not `=`: a post whose day was missed because the valve was
      // off still goes out, instead of being silently skipped forever.
      lte(socialPosts.scheduledFor, sql`current_date`),
    ))
    .orderBy(socialPosts.scheduledFor, socialPosts.id)
    .limit(limit),
  recentCaptions: async (limit) => {
    const rows = await db
      .select({ t: socialPosts.tweetText, e: socialPosts.editedText })
      .from(socialPosts)
      .where(and(eq(socialPosts.platform, 'instagram'), eq(socialPosts.status, 'posted')))
      .orderBy(desc(socialPosts.postedAt))
      .limit(limit)
    return rows.map(r => (r.e?.trim() || r.t))
  },
  markPosted: async (postId, externalPostId, at) => {
    await db.update(socialPosts)
      .set({ status: 'posted', externalPostId, postedAt: at })
      .where(eq(socialPosts.id, postId))
  },
  markNeedsChanges: async (postId, feedback) => {
    await db.update(socialPosts)
      // Back to the review queue rather than published. This is the one place
      // the owner still sees a post before it is public, and it only happens
      // when something is actually wrong.
      .set({ status: 'draft', reviewStatus: 'needs_changes', feedback })
      .where(eq(socialPosts.id, postId))
  },
  markFailed: async (postId, detail, terminal) => {
    await db.update(socialPosts)
      .set({ status: terminal ? 'failed' : 'draft', errorMessage: detail })
      .where(eq(socialPosts.id, postId))
  },
}

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
export async function sweepAbandonedPublishing(): Promise<number> {
  const rows = await db
    .update(socialPosts)
    .set({ status: 'draft' })
    .where(and(
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

/** Count of Instagram posts already published today. */
export async function countPublishedToday(): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(socialPosts)
    .where(and(
      eq(socialPosts.platform, 'instagram'),
      eq(socialPosts.status, 'posted'),
      sql`${socialPosts.postedAt} >= date_trunc('day', now())`,
    ))
  return rows[0]?.n ?? 0
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
  const repo = deps.repo ?? dbPublishRepo

  // Read fresh every tick, so flipping the valve off takes effect at the next
  // tick rather than at the next deploy.
  if (!(await deps.isEnabled())) {
    return { skipped: 'valve_off', swept: 0, attempts: [], publishedToday: 0 }
  }

  const swept = await repo.sweepAbandoned()

  const publishedToday = await repo.countPublishedToday()
  const maxPerDay = await deps.maxPerDay()
  if (publishedToday >= maxPerDay) {
    return { skipped: 'daily_cap', swept, attempts: [], publishedToday }
  }

  const room = Math.min(MAX_PER_TICK, maxPerDay - publishedToday)
  const eligible = await repo.listEligible(room)
  const recentCaptions = await repo.recentCaptions(14)

  const attempts: PublishAttempt[] = []

  for (const candidate of eligible) {
    const post = await repo.claim(candidate.id)
    if (!post) {
      attempts.push({ postId: candidate.id, outcome: 'claim_lost' })
      continue
    }

    const caption = post.editedText?.trim() || post.tweetText

    // Refuse anything the pre-publish gate never looked at.
    //
    // `review_status='approved'` has two possible authors: the gate, which
    // stamps its verdict into `feedback`, and the owner's click in the Social
    // Studio, which does not. Under autopublish he is not clicking, so an
    // approved row with no stamp is either a leftover from before this shipped
    // or something that reached the column another way. Either is a row nothing
    // adversarial has read, and publishing it unattended is the one thing this
    // whole chain exists to prevent. It goes back to the queue instead.
    const stamp = parseGateStamp(post.feedback)
    if (!stamp || stamp.verdict !== 'PASS') {
      await repo.markNeedsChanges(
        post.id,
        'Approved without a publish-gate PASS, so nothing independent has reviewed it. ' +
        'Run social-publish-gate over this draft (POST /api/team/social-post {op:"gate"}); ' +
        'it re-verdicts and, on a PASS, re-approves.',
      )
      attempts.push({ postId: post.id, outcome: 'no_gate_verdict' })
      continue
    }

    // The deterministic gate runs HERE, not only at gate time. Time passes
    // between approval and the scheduled slot, and stock is the thing that
    // moves in it. The handle comes from the stamp unless a caller overrides.
    const productHandle = deps.productHandleFor
      ? await deps.productHandleFor(post)
      : stamp.productHandle
    const gate = await runDeterministicPublishChecks({
      caption,
      mediaUrls: post.mediaUrls ?? [],
      productHandle,
      recentCaptions,
    }, deps.gateDeps)

    if (gate.blocked || gate.held) {
      const summary = gate.findings.map(f => `[${f.check}] ${f.detail}`).join(' ')
      await repo.markNeedsChanges(post.id, summary)
      attempts.push({ postId: post.id, outcome: 'blocked_by_gate', findings: gate.findings })
      continue
    }

    const result = await deps.publish(post)
    if (result.ok) {
      await repo.markPosted(post.id, result.externalPostId, now)
      attempts.push({ postId: post.id, outcome: 'published' })
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

  return { swept, attempts, publishedToday }
}
