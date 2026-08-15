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
import { runDeterministicPublishChecks, type GateFinding } from './social-publish-gate.server'

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
  recentCaptions: (limit: number) => Promise<string[]>
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
  recentCaptions: async (limit) => {
    const rows = await db
      .select({ t: socialPosts.tweetText, e: socialPosts.editedText })
      .from(socialPosts)
      .where(and(eq(socialPosts.platform, 'instagram'), eq(socialPosts.status, 'posted')))
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
 * Only ever moves a row that is waiting for exactly this decision: an Instagram
 * `draft` at `pending_review`. Everything else is a 409 rather than a write.
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
  if (post.platform !== 'instagram') {
    return { ok: false, status: 409, error: `Post ${id} is ${post.platform}; this gate is Instagram-only` }
  }
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
    productHandle: input.productHandle ?? null,
    recentCaptions: await repo.recentCaptions(14),
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
