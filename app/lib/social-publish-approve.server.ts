/**
 * The write path for the independent pre-publish gate.
 *
 * Ticket #2739 built the gate in two halves: `social-publish-gate.server.ts`
 * for what is mechanical, and `.claude/agents/social-publish-gate.md` for what
 * needs judgment. The agent definition says, correctly, that it "is the only
 * thing that may set review_status 'approved' once the owner stops approving
 * posts by hand." It was never given a way to do it.
 *
 * That left the chain one link short in a way that is easy to miss, because
 * every piece looks finished. The publish job (#2740) queries for
 * `review_status='approved'` and ships inert behind its valve; the gate returns
 * a verdict into a run summary and nothing else; and the only writer of
 * 'approved' in the codebase is the owner's click in the Social Studio. Flip
 * the valve with the chain in that state and the job runs hourly, finds nothing
 * approved that the owner did not approve himself, and the bottleneck he asked
 * to remove is exactly where it was.
 *
 * This module is that link, and it is deliberately not a thin setter.
 *
 * ## The agent asserts, the server verifies
 *
 * A PASS arriving here is a claim, not a decision. Before anything is written,
 * the deterministic checks run AGAIN, server-side, on the caption and media as
 * they actually sit in the row. The agent cannot talk past them: a
 * deterministic block turns its PASS into `needs_changes` and reports why. This
 * mirrors the voice gate at the draft boundary (#3208), which exists because on
 * 2026-08-14 the drafting routine could not invoke its gate and substituted a
 * self-check. The lesson generalises: a gate that lives only in an agent's
 * instructions is a gate that is skipped the first time the agent cannot run
 * it, and this one carries account-loss risk.
 *
 * ## Why the product handle is asserted explicitly
 *
 * The deterministic gate's stock check is the reason it exists (an out-of-stock
 * product reached the feed on 2026-08-09), and it runs only when it is handed a
 * product handle. `social_posts` has no column for one; adding it is a
 * migration, which is a protected path. So the verdict payload carries
 * `featuresProduct` as a REQUIRED boolean, and a product post must name its
 * handle. "No product" becomes a thing the gate states rather than a thing it
 * omits, which is the difference between a check that is satisfied and a check
 * that silently did not run.
 *
 * The verdict is then stamped into `feedback` (see `formatGateStamp`) so the
 * handle survives to publish time, hours later, in a different process. That is
 * the same trick `live-post-feedback.ts` uses for the owner's verdict on a live
 * post, for the same reason: no column, and the column is not worth a protected
 * migration on its own.
 */

import { and, desc, eq } from 'drizzle-orm'
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import {
  runDeterministicPublishChecks,
  type GateFinding,
  type GatePlatform,
} from './social-publish-gate.server'

/**
 * Platforms this gate may verdict.
 *
 * The list is exactly the platforms the hourly tick can publish
 * (`SCHEDULED_PUBLISH_PLATFORMS` in social-publish-run.server.ts), and that
 * correspondence is the rule rather than a coincidence. `approved` means "the
 * unattended publisher may ship this", so granting it to a platform with no
 * publisher writes a row that either sits forever or, worse, becomes eligible
 * months later when a publisher lands and ships stale copy. The routine
 * playbook calls that an unpublishable draft left at `approved`, and it has
 * already happened once on Facebook and TikTok.
 *
 * X was gate-eligible in every part of this system except this line. The
 * deterministic checks have carried a `platform` parameter with X's divergences
 * annotated since 2026-08-16, the publish job ticks X hourly, and
 * `x_autopublish_enabled` was turned on. But the write path refused every
 * non-Instagram row, and nothing else in the fleet writes `approved`, so X
 * drafts sat at `pending_review` and the valve fed an empty pipe: zero X posts
 * have ever published.
 */
export const GATE_PLATFORMS: readonly GatePlatform[] = ['instagram', 'x']

function isGatePlatform(platform: string): platform is GatePlatform {
  return (GATE_PLATFORMS as readonly string[]).includes(platform)
}

/**
 * The four verdicts `social-publish-gate` returns.
 *
 * HOLD is spelled `HOLD` here and `HOLD-FOR-OWNER` in the agent definition's
 * prose; both are accepted on the wire so a literal reading of the agent file
 * does not 400.
 */
export const PUBLISH_GATE_VERDICTS = ['PASS', 'REVISE', 'BLOCK', 'HOLD'] as const
export type PublishGateVerdict = (typeof PUBLISH_GATE_VERDICTS)[number]

/**
 * Minimum length of the notes a PASS must carry.
 *
 * The agent definition asks for this in prose: "On PASS, say what you looked
 * at, so a PASS is legible as work rather than as silence." Silence is the
 * failure mode that matters here, because a PASS is the verdict that ships, so
 * it is the one where saying nothing is cheapest. Short enough that a real
 * sentence clears it, long enough that "ok" does not.
 */
export const PASS_NOTES_MIN = 40

export interface PublishGateVerdictInput {
  verdict: PublishGateVerdict
  /** Who produced the verdict. Non-empty. */
  reviewer: string
  /** What the gate looked at and found. Required, and substantive, on a PASS. */
  notes: string
  /**
   * Does this post feature a product? Required, deliberately: see the module
   * header. `false` is a claim the gate makes, and the deterministic stock
   * check is skipped only because it was made.
   */
  featuresProduct: boolean
  /** The featured product's Shopify handle. Required when `featuresProduct`. */
  productHandle?: string | undefined
}

export type PublishGateParse =
  | { ok: true; verdict: PublishGateVerdictInput }
  | { ok: false; status: 400; error: string }

/** Handles are Shopify slugs; anything else is a caller bug worth a 400. */
const HANDLE_RE = /^[a-z0-9][a-z0-9._-]*$/

/**
 * Validate a `gate` payload. Pure and side-effect-free so the contract is unit
 * tested directly rather than only through the route.
 */
export function parsePublishGateVerdict(raw: unknown): PublishGateParse {
  if (raw === undefined || raw === null) {
    return {
      ok: false,
      status: 400,
      error:
        'Bad Request: gate verdict required. Only social-publish-gate writes an ' +
        'approved review status; a post cannot become publishable without one.',
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'Bad Request: gate must be an object' }
  }
  const g = raw as Record<string, unknown>

  const rawVerdict = typeof g['verdict'] === 'string' ? g['verdict'].toUpperCase() : ''
  // The agent definition writes this verdict as HOLD-FOR-OWNER in prose.
  const verdict = (rawVerdict === 'HOLD-FOR-OWNER' ? 'HOLD' : rawVerdict) as PublishGateVerdict
  if (!(PUBLISH_GATE_VERDICTS as readonly string[]).includes(verdict)) {
    return {
      ok: false,
      status: 400,
      error: `Bad Request: gate.verdict must be one of ${PUBLISH_GATE_VERDICTS.join('|')}`,
    }
  }

  if (typeof g['reviewer'] !== 'string' || g['reviewer'].trim() === '') {
    return {
      ok: false,
      status: 400,
      error: 'Bad Request: gate.reviewer required (name the gate that produced the verdict)',
    }
  }

  const notes = typeof g['notes'] === 'string' ? g['notes'].trim() : ''
  if (verdict === 'PASS' && notes.length < PASS_NOTES_MIN) {
    return {
      ok: false,
      status: 400,
      error:
        `Bad Request: a PASS must carry at least ${PASS_NOTES_MIN} characters of notes saying ` +
        'what was looked at. A PASS is the verdict that ships unattended, so it is the one ' +
        'that has to be legible as work rather than as silence.',
    }
  }
  if (verdict !== 'PASS' && notes === '') {
    return {
      ok: false,
      status: 400,
      error: 'Bad Request: gate.notes required (the drafter has to know what to change)',
    }
  }

  if (typeof g['featuresProduct'] !== 'boolean') {
    return {
      ok: false,
      status: 400,
      error:
        'Bad Request: gate.featuresProduct must be true or false. The publish-time stock check ' +
        'runs only when it is handed a product handle, so "this post features no product" has ' +
        'to be asserted rather than inferred from a missing field.',
    }
  }
  const featuresProduct = g['featuresProduct']
  const handle = typeof g['productHandle'] === 'string' ? g['productHandle'].trim() : ''

  if (featuresProduct && !HANDLE_RE.test(handle)) {
    return {
      ok: false,
      status: 400,
      error: 'Bad Request: gate.productHandle required (a Shopify handle) when featuresProduct is true',
    }
  }
  if (!featuresProduct && handle !== '') {
    return {
      ok: false,
      status: 400,
      error: 'Bad Request: gate.productHandle must be omitted when featuresProduct is false',
    }
  }

  const parsed: PublishGateVerdictInput = {
    verdict,
    reviewer: g['reviewer'].trim(),
    notes,
    featuresProduct,
  }
  if (featuresProduct) parsed.productHandle = handle
  return { ok: true, verdict: parsed }
}

// ── The gate stamp ──────────────────────────────────────────────────────────

/**
 * Encoded into `feedback` so the verdict survives to publish time.
 *
 * Legible on purpose. The owner reads this column in the Social Studio, so it
 * opens with a line he can read at a glance and the gate's own notes follow it
 * unchanged.
 */
const STAMP_RE =
  /^\[publish-gate (PASS|REVISE|BLOCK|HOLD) by ([^\]]+?) on (\d{4}-\d{2}-\d{2}), product: ([a-z0-9._-]+|none)\]/

export interface GateStamp {
  verdict: PublishGateVerdict
  reviewer: string
  day: string
  /** null when the gate asserted the post features no product. */
  productHandle: string | null
}

export function formatGateStamp(
  input: {
    verdict: PublishGateVerdict
    reviewer: string
    notes: string
    /** null and undefined both mean "no product", and both stamp as `none`. */
    productHandle?: string | null | undefined
  },
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10)
  const product = input.productHandle ?? 'none'
  return `[publish-gate ${input.verdict} by ${input.reviewer} on ${day}, product: ${product}]\n${input.notes}`
}

/** Recover a stamp from a `feedback` value. Returns null when there is none. */
export function parseGateStamp(feedback: string | null | undefined): GateStamp | null {
  if (!feedback) return null
  const m = STAMP_RE.exec(feedback)
  if (!m) return null
  const [, verdict, reviewer, day, product] = m
  return {
    verdict: verdict as PublishGateVerdict,
    reviewer: (reviewer ?? '').trim(),
    day: day ?? '',
    productHandle: product === 'none' ? null : (product ?? null),
  }
}

// ── Applying a verdict ──────────────────────────────────────────────────────

export type ApplyResult =
  | { ok: true; reviewStatus: 'approved' | 'needs_changes' | 'rejected' | 'pending_review' }
  | { ok: false; status: 404 | 409; error: string }
  | { ok: false; status: 422; error: string; findings: GateFinding[] }

/**
 * Every data access applying a verdict performs, behind an interface.
 *
 * Same reasoning as the publish job's `PublishRepo`, and the same reason it is
 * worth the indirection: the decision this module makes is whether a post
 * becomes publishable, and the branch that carries the risk is the one where a
 * PASS meets a deterministic block. That branch is interleaved with database
 * calls, so injecting the store is what makes "can an agent's PASS overturn a
 * stock-out" a test rather than a code read.
 */
export interface ApproveRepo {
  load: (id: number) => Promise<PostRow | null>
  /**
   * Captions of recent posted rows, for the repetition check.
   *
   * Scoped to one platform, because the check asks "would a reader of THIS feed
   * see the same line twice". Instagram and X are different feeds with largely
   * different audiences, and the companion-post pattern in the crossplatform
   * strategy deliberately says related things on both. Comparing across them
   * would block that by design.
   */
  recentCaptions: (limit: number, platform: GatePlatform) => Promise<string[]>
  write: (id: number, patch: {
    reviewStatus: ReviewStatus
    feedback: string
    reviewedBy: string
    reviewedAt: Date
  }) => Promise<void>
}

export type PostRow = typeof socialPosts.$inferSelect
export type ReviewStatus = 'approved' | 'needs_changes' | 'rejected' | 'pending_review'

export interface ApplyDeps {
  now?: () => Date
  /** Passed through to the deterministic gate so a test can decide stock. */
  gateDeps?: { getAvailability?: (handle: string) => Promise<boolean | null> }
  /** Defaults to the live database. */
  repo?: ApproveRepo
}

/** The live implementation. */
export const dbApproveRepo: ApproveRepo = {
  load: async (id) => {
    const [row] = await db.select().from(socialPosts).where(eq(socialPosts.id, id)).limit(1)
    return row ?? null
  },
  recentCaptions: async (limit, platform) => {
    const rows = await db
      .select({ t: socialPosts.tweetText, e: socialPosts.editedText })
      .from(socialPosts)
      .where(and(eq(socialPosts.platform, platform), eq(socialPosts.status, 'posted')))
      .orderBy(desc(socialPosts.postedAt))
      .limit(limit)
    return rows.map(r => (r.e?.trim() || r.t))
  },
  write: async (id, patch) => {
    await db.update(socialPosts).set(patch).where(eq(socialPosts.id, id))
  },
}

/**
 * Write a gate verdict onto one draft.
 *
 * Only ever moves a row that is waiting for exactly this decision: a `draft` at
 * `pending_review`, on a platform the unattended publisher can actually ship
 * (see `GATE_PLATFORMS`). Everything else is a 409 rather than a write.
 * That narrowness is the point. A gate that could re-verdict a rejected row
 * could resurrect one, and a gate that could touch a posted row could relabel
 * history; neither is a capability this needs, and both are capabilities worth
 * not having on the path that publishes to a live account.
 */
export async function applyPublishGateVerdict(
  id: number,
  input: PublishGateVerdictInput,
  deps: ApplyDeps = {},
): Promise<ApplyResult> {
  const now = deps.now?.() ?? new Date()
  const repo = deps.repo ?? dbApproveRepo

  const post = await repo.load(id)
  if (!post) return { ok: false, status: 404, error: `No social post ${id}` }
  if (!isGatePlatform(post.platform)) {
    return {
      ok: false,
      status: 409,
      error:
        `Post ${id} is ${post.platform}; this gate verdicts ${GATE_PLATFORMS.join(' and ')} only. ` +
        'Nothing publishes the other platforms unattended, so approving one would leave a row ' +
        'that ships stale copy the day a publisher lands. The owner acts on those in /admin/socials.',
    }
  }
  const platform: GatePlatform = post.platform
  if (post.status !== 'draft' || post.reviewStatus !== 'pending_review') {
    return {
      ok: false,
      status: 409,
      error:
        `Post ${id} is ${post.status}/${post.reviewStatus}, not draft/pending_review. ` +
        'The gate verdicts a draft that is waiting for it, and nothing else.',
    }
  }

  const write = (reviewStatus: ReviewStatus, feedback: string) =>
    repo.write(id, { reviewStatus, feedback, reviewedBy: input.reviewer.slice(0, 60), reviewedAt: now })

  // A non-PASS needs no verification: it is not going anywhere. Recording it is
  // the whole job, and REVISE/BLOCK carry the reason the drafter has to act on.
  if (input.verdict !== 'PASS') {
    const reviewStatus =
      input.verdict === 'BLOCK' ? 'rejected'
      : input.verdict === 'REVISE' ? 'needs_changes'
      : 'pending_review'   // HOLD: left where the owner will see it
    await write(reviewStatus, formatGateStamp({ ...input, productHandle: input.productHandle ?? null }, now))
    return { ok: true, reviewStatus }
  }

  // ── PASS: verify before believing ────────────────────────────────────────
  const caption = post.editedText?.trim() || post.tweetText
  const gate = await runDeterministicPublishChecks({
    caption,
    mediaUrls: post.mediaUrls ?? [],
    platform,
    productHandle: input.productHandle ?? null,
    recentCaptions: await repo.recentCaptions(14, platform),
  }, deps.gateDeps)

  if (gate.blocked || gate.held) {
    // The agent may add findings; it may never overturn one. A PASS on top of a
    // deterministic block is the agent being wrong, so the row goes back for a
    // redraft carrying every finding at once rather than one per round trip.
    const summary = gate.findings.map(f => `[${f.check}] ${f.detail}`).join(' ')
    await write(
      'needs_changes',
      formatGateStamp(
        {
          // REVISE, not BLOCK, and the two must agree with the status written
          // beside them. Every deterministic block has a redraft that fixes it
          // (swap the product, regenerate the asset, rewrite the line), which is
          // what `needs_changes` means. Stamping BLOCK here would tell the
          // drafter to drop a post the row is simultaneously asking it to fix.
          verdict: 'REVISE',
          reviewer: input.reviewer,
          notes:
            `Gate returned PASS, deterministic checks refused it. ${summary}\n\n` +
            `Gate notes were: ${input.notes}`,
          productHandle: input.productHandle ?? null,
        },
        now,
      ),
    )
    return {
      ok: false,
      status: 422,
      error: 'Deterministic checks blocked this post; the PASS was not applied.',
      findings: gate.findings,
    }
  }

  await write('approved', formatGateStamp({ ...input, productHandle: input.productHandle ?? null }, now))
  return { ok: true, reviewStatus: 'approved' }
}

// ── Reworking a bounced draft ─────────────────────────────────────────────────

/**
 * The corrected content for a row the gate sent back.
 *
 * A gate REVISE lands a draft at `needs_changes` (see `applyPublishGateVerdict`).
 * The drafting routine then has to file the correction and get the row re-judged
 * — but the `{op:'draft'}` idempotency guard (#4069) dedupes on platform +
 * caption + campaign day, and an imagery-only REVISE by definition does not
 * change the caption, so every imagery rework deduped straight back into the
 * open row it was trying to fix, updating nothing. The row was then stranded:
 * `applyPublishGateVerdict` refuses anything that is not `draft`/`pending_review`,
 * so the gate could not re-judge it either, and the only escape was a direct DB
 * write. This op is the honest primitive that flow was missing (#4351): it
 * updates the bounced row in place and returns it to `pending_review` so the
 * gate re-judges it, using only the team API. #4069's duplicate-draft protection
 * is untouched — this op never creates a row, and only a row the gate itself
 * bounced (`needs_changes`) is a rework target.
 */
export interface ReworkInput {
  /** Regenerated media for an imagery REVISE. When present, non-empty. */
  mediaUrls?: string[]
  /** Rewritten caption for a copy REVISE. When present, non-empty. */
  tweetText?: string
}

export type ReworkParse =
  | { ok: true; input: ReworkInput }
  | { ok: false; status: 400; error: string }

/** Captions/URLs can be long, but not unbounded — reject a caller bug loudly. */
const REWORK_TWEET_MAX = 2000

/**
 * Validate a rework payload. Pure and side-effect-free so the contract is unit
 * tested directly rather than only through the route.
 *
 * At least one of `mediaUrls`/`tweetText` must be present: a rework has to carry
 * the correction the REVISE asked for. A bare re-gate would re-submit the exact
 * content the gate already bounced, which loops rather than fixes.
 */
export function parseReworkInput(raw: unknown): ReworkParse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'Bad Request: rework payload must be an object' }
  }
  const r = raw as Record<string, unknown>

  let mediaUrls: string[] | undefined
  if (r['mediaUrls'] !== undefined) {
    if (!Array.isArray(r['mediaUrls'])) {
      return { ok: false, status: 400, error: 'Bad Request: rework.mediaUrls must be an array of strings' }
    }
    const urls = (r['mediaUrls'] as unknown[]).filter((u): u is string => typeof u === 'string' && u.trim() !== '')
    if (urls.length === 0) {
      return { ok: false, status: 400, error: 'Bad Request: rework.mediaUrls, when present, must hold at least one non-empty URL' }
    }
    mediaUrls = urls
  }

  let tweetText: string | undefined
  if (r['tweetText'] !== undefined) {
    if (typeof r['tweetText'] !== 'string' || r['tweetText'].trim() === '') {
      return { ok: false, status: 400, error: 'Bad Request: rework.tweetText, when present, must be a non-empty string' }
    }
    if (r['tweetText'].length > REWORK_TWEET_MAX) {
      return { ok: false, status: 400, error: `Bad Request: rework.tweetText must be at most ${REWORK_TWEET_MAX} characters` }
    }
    tweetText = r['tweetText']
  }

  if (mediaUrls === undefined && tweetText === undefined) {
    return {
      ok: false,
      status: 400,
      error:
        'Bad Request: rework must change something — supply mediaUrls (imagery REVISE) and/or tweetText ' +
        '(copy REVISE). Re-gating the exact content the gate already bounced would only loop.',
    }
  }

  const input: ReworkInput = {}
  if (mediaUrls !== undefined) input.mediaUrls = mediaUrls
  if (tweetText !== undefined) input.tweetText = tweetText
  return { ok: true, input }
}

export interface ReworkPatch {
  status: 'draft'
  reviewStatus: 'pending_review'
  feedback: null
  reviewedBy: null
  reviewedAt: null
  mediaUrls?: string[]
  tweetText?: string
}

export interface ReworkRepo {
  load: (id: number) => Promise<PostRow | null>
  write: (id: number, patch: ReworkPatch) => Promise<void>
}

/** The live implementation. Reuses the approve repo's loader. */
export const dbReworkRepo: ReworkRepo = {
  load: dbApproveRepo.load,
  write: async (id, patch) => {
    await db.update(socialPosts).set(patch).where(eq(socialPosts.id, id))
  },
}

export type ReworkResult =
  | { ok: true; reviewStatus: 'pending_review' }
  | { ok: false; status: 404 | 409; error: string }

export interface ReworkDeps {
  repo?: ReworkRepo
}

/**
 * Refile a bounced draft in place and return it to the gate's inbox.
 *
 * Only a row the gate bounced (`needs_changes`) is a rework target. A `rejected`
 * (BLOCK) row is deliberately excluded: BLOCK means drop the post, and letting
 * rework resurrect one would be exactly the "gate that could re-verdict a
 * rejected row could resurrect one" capability `applyPublishGateVerdict` refuses
 * to have. `approved`/`posted`/`pending_review` rows are likewise not reworkable,
 * which is what keeps #4069's duplicate-draft protection intact from this angle:
 * this op never mints a row and never touches one that is not already awaiting
 * replacement. The reset clears the stale gate stamp so the row reads as a clean
 * `draft`/`pending_review` — the exact state `applyPublishGateVerdict` requires
 * to re-judge it.
 */
export async function reworkSocialPost(
  id: number,
  input: ReworkInput,
  deps: ReworkDeps = {},
): Promise<ReworkResult> {
  const repo = deps.repo ?? dbReworkRepo

  const post = await repo.load(id)
  if (!post) return { ok: false, status: 404, error: `No social post ${id}` }
  if (post.reviewStatus !== 'needs_changes') {
    return {
      ok: false,
      status: 409,
      error:
        `Post ${id} is ${post.status}/${post.reviewStatus}, not */needs_changes. Rework refiles a row the ` +
        'pre-publish gate sent back for changes; a rejected, approved, posted, or already-pending row is ' +
        'not a rework target.',
    }
  }

  const patch: ReworkPatch = {
    status: 'draft',
    reviewStatus: 'pending_review',
    feedback: null,
    reviewedBy: null,
    reviewedAt: null,
    ...(input.mediaUrls !== undefined ? { mediaUrls: input.mediaUrls } : {}),
    ...(input.tweetText !== undefined ? { tweetText: input.tweetText } : {}),
  }
  await repo.write(id, patch)
  return { ok: true, reviewStatus: 'pending_review' }
}
