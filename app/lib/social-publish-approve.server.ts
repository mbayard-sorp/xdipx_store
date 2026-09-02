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
import { findingToStored, type GateStatusValue, type StoredGateFinding } from './social-gate-status'

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

export function isGatePlatform(platform: string): platform is GatePlatform {
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
  /**
   * The findings the verdict carried, if the gate itemised them. Optional and
   * lenient on shape: `{check, verdict, note}` is the stored form, and the
   * deterministic gate's `{check, severity, detail}` is accepted too. Stored
   * in `gate_findings` (Phase 5, #4913) beside the deterministic findings.
   */
  findings?: StoredGateFinding[] | undefined
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
  if (g['findings'] !== undefined) {
    if (!Array.isArray(g['findings'])) {
      return { ok: false, status: 400, error: 'Bad Request: gate.findings, when present, must be an array' }
    }
    parsed.findings = normaliseAgentFindings(g['findings'])
  }
  return { ok: true, verdict: parsed }
}

/**
 * Map whatever shape the agent itemised its findings in onto the stored
 * `{check, verdict, note}` form. Entries with no usable `check` are dropped
 * rather than 400ing the verdict: the findings are an annotation, and the
 * verdict plus notes are the contract.
 */
export function normaliseAgentFindings(raw: unknown[]): StoredGateFinding[] {
  const out: StoredGateFinding[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const f = item as Record<string, unknown>
    const check = typeof f['check'] === 'string' ? f['check'].trim() : ''
    if (!check) continue
    const rawVerdict =
      typeof f['verdict'] === 'string' ? f['verdict']
      : typeof f['severity'] === 'string' ? f['severity']
      : 'pass'
    const v = rawVerdict.toLowerCase()
    const verdict =
      v === 'block' ? 'block'
      : v === 'hold' || v === 'hold-for-owner' ? 'hold'
      : v === 'revise' || v === 'warn' ? 'revise'
      : 'pass'
    const note =
      typeof f['note'] === 'string' ? f['note'].trim()
      : typeof f['detail'] === 'string' ? f['detail'].trim()
      : ''
    out.push(note ? { check, verdict, note } : { check, verdict })
  }
  return out
}

/** The `gate_status` column value a verdict lands as (Phase 5, #4913). */
export function gateStatusForVerdict(verdict: PublishGateVerdict): GateStatusValue {
  switch (verdict) {
    case 'PASS': return 'pass'
    case 'REVISE': return 'revise'
    case 'BLOCK': return 'block'
    case 'HOLD': return 'hold'
  }
}

// ── The gate stamp ──────────────────────────────────────────────────────────

/**
 * Encoded into `feedback` so the verdict survives to publish time.
 *
 * Legible on purpose. The owner reads this column in the Social Studio, so it
 * opens with a line he can read at a glance and the gate's own notes follow it
 * unchanged.
 */
// Shared with the review card (client-safe); see app/lib/gate-stamp.ts.
import { STAMP_RE, splitGateStamp } from './gate-stamp'
export { splitGateStamp }

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

/**
 * Recover a stamp from a `feedback` value. Returns null when there is none.
 *
 * The header matches at any line start, not only the first character, because
 * the burn-in writers (`preserveGateStamp`, the `[expired]` prefix) keep the
 * stamp block inside a field that now opens with something else.
 */
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

/**
 * Split a `feedback` value into the stamp block (header line plus the gate's
 * notes paragraph, up to the first blank line) and everything else.
 */

/**
 * Burn-in helper (Phase 5, #4913). A writer that replaces `feedback` routes
 * its new text through this so a gate stamp a legacy reader still depends on
 * is carried along after it. `gate_status` is the verdict of record; the
 * stamp is kept only until the fallback readers go.
 *
 * TODO(#4913 burn-in): remove once no reader falls back to the stamp.
 */
export function preserveGateStamp(
  existing: string | null | undefined,
  next: string | null | undefined,
): string | null {
  const { stamp } = splitGateStamp(existing)
  const body = (next ?? '').trim()
  if (!stamp) return body || null
  if (body.includes(stamp)) return body
  return body ? `${body}\n\n${stamp}` : stamp
}

/**
 * The verdict a reader acts on: the column when it is set, else what the
 * legacy stamp says. Null when neither exists. The column always wins, so a
 * stale PASS stamp under a `block` column never publishes.
 *
 * 'owner' (ticket #5425) is a fifth column value, written only by an owner
 * approve in Social Studio (`reviewSocialPost`), never by the gate. It is
 * recognized here as a column value like the other four; it has no stamp
 * form, because `formatGateStamp` only ever encodes an agent verdict.
 *
 * TODO(#4913 burn-in): collapse to `post.gateStatus` once the stamp fallback
 * is retired.
 */
export function effectiveGateStatus(
  post: { gateStatus?: string | null; feedback?: string | null },
): GateStatusValue | null {
  const col = post.gateStatus
  if (col === 'pass' || col === 'revise' || col === 'block' || col === 'hold' || col === 'owner') return col
  const stamp = parseGateStamp(post.feedback)
  return stamp ? gateStatusForVerdict(stamp.verdict) : null
}

/** A row the unattended publisher may ship on the agent's own say-so: `gate_status = 'pass'`, or (legacy, column null) a PASS stamp. Does NOT include an owner verdict; see `isTickEligible` for the predicate the hourly tick actually uses. */
export function hasGatePass(post: { gateStatus?: string | null; feedback?: string | null }): boolean {
  return effectiveGateStatus(post) === 'pass'
}

/**
 * May the hourly tick (`social-publish-job.server.ts`) publish this row?
 * `pass` (an agent verdict) or `owner` (an owner approve, ticket #5425) both
 * qualify; nothing else does. Deliberately not folded into `hasGatePass`,
 * which stays a strict "the agent verdicted this PASS" test — a caller that
 * needs to distinguish an agent's judgment from an owner's override (the
 * whole point of adding 'owner' as its own value) must not be able to
 * confuse the two behind one name. Named "tick eligible" rather than "may
 * publish" because it says nothing about the deterministic FACT checks,
 * which the tick re-runs separately and unconditionally, regardless of which
 * of these two values got a row this far.
 */
export function isTickEligible(post: { gateStatus?: string | null; feedback?: string | null }): boolean {
  const status = effectiveGateStatus(post)
  return status === 'pass' || status === 'owner'
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
  write: (id: number, patch: ApprovePatch) => Promise<void>
}

/** Everything a verdict writes. The stamp in `feedback` is dual-written for burn-in (#4913). */
export interface ApprovePatch {
  reviewStatus: ReviewStatus
  feedback: string
  reviewedBy: string
  reviewedAt: Date
  gateStatus: GateStatusValue
  gateCheckedAt: Date
  gateFindings: StoredGateFinding[]
  updatedAt: Date
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

  // Dual write (Phase 5, #4913): the columns are the verdict of record, and
  // the stamp in `feedback` stays for one cycle so an old reader cannot break.
  const write = (
    reviewStatus: ReviewStatus,
    feedback: string,
    gateStatus: GateStatusValue,
    findings: StoredGateFinding[],
  ) =>
    repo.write(id, {
      reviewStatus,
      feedback,
      reviewedBy: input.reviewer.slice(0, 60),
      reviewedAt: now,
      gateStatus,
      gateCheckedAt: now,
      gateFindings: findings,
      updatedAt: now,
    })
  const agentFindings = input.findings ?? []

  // A non-PASS needs no verification: it is not going anywhere. Recording it is
  // the whole job, and REVISE/BLOCK carry the reason the drafter has to act on.
  if (input.verdict !== 'PASS') {
    const reviewStatus =
      input.verdict === 'BLOCK' ? 'rejected'
      : input.verdict === 'REVISE' ? 'needs_changes'
      : 'pending_review'   // HOLD: left where the owner will see it
    await write(
      reviewStatus,
      formatGateStamp({ ...input, productHandle: input.productHandle ?? null }, now),
      gateStatusForVerdict(input.verdict),
      agentFindings,
    )
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
      'revise',
      [...agentFindings, ...gate.findings.map(findingToStored)],
    )
    return {
      ok: false,
      status: 422,
      error: 'Deterministic checks blocked this post; the PASS was not applied.',
      findings: gate.findings,
    }
  }

  await write(
    'approved',
    formatGateStamp({ ...input, productHandle: input.productHandle ?? null }, now),
    'pass',
    [...agentFindings, ...gate.findings.map(findingToStored)],
  )
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
  /** Accessibility description of the (possibly regenerated) image (migration
   *  083). Optional, only present when the rework touched imagery. */
  altText?: string
  /** Durable "what does this image depict" brief (migration 084). */
  imageBrief?: string
  /** Durable subject line for the post (migration 084). */
  subject?: string
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

  // Accessibility + brief fields (migration 084). Optional and do not count
  // toward the "must change something" requirement above: they ride along
  // with a mediaUrls/tweetText rework rather than standing alone.
  let altText: string | undefined
  if (r['altText'] !== undefined) {
    if (typeof r['altText'] !== 'string' || r['altText'].trim() === '') {
      return { ok: false, status: 400, error: 'Bad Request: rework.altText, when present, must be a non-empty string' }
    }
    altText = r['altText']
  }
  let imageBrief: string | undefined
  if (r['imageBrief'] !== undefined) {
    if (typeof r['imageBrief'] !== 'string' || r['imageBrief'].trim() === '') {
      return { ok: false, status: 400, error: 'Bad Request: rework.imageBrief, when present, must be a non-empty string' }
    }
    imageBrief = r['imageBrief']
  }
  let subject: string | undefined
  if (r['subject'] !== undefined) {
    if (typeof r['subject'] !== 'string' || r['subject'].trim() === '') {
      return { ok: false, status: 400, error: 'Bad Request: rework.subject, when present, must be a non-empty string' }
    }
    subject = r['subject']
  }

  const input: ReworkInput = {}
  if (mediaUrls !== undefined) input.mediaUrls = mediaUrls
  if (tweetText !== undefined) input.tweetText = tweetText
  if (altText !== undefined) input.altText = altText
  if (imageBrief !== undefined) input.imageBrief = imageBrief
  if (subject !== undefined) input.subject = subject
  return { ok: true, input }
}

/**
 * Ticket #5415: preserve a bounced row's `feedback` as readable, resolved
 * history instead of nulling it. Nulling destroyed the instruction the
 * moment it was satisfied, which is exactly the text the owner just wrote and
 * the gate's own `owner-feedback-unmet` check (`.claude/agents/
 * social-publish-gate.md`) reads back off the row through `reworkedFrom`.
 *
 * The stamp header (`[publish-gate REVISE by ... ]`) is stripped from the
 * preserved copy before it is prefixed, because `STAMP_RE` matches at any
 * line start (the burn-in fallback readers depend on that) and `gate_status`
 * is cleared by this same write, so a surviving header would let a stale
 * REVISE stamp resurrect itself as the row's live verdict the next time
 * something falls back to parsing `feedback`. Only the notes paragraph, the
 * actual instruction, carries forward.
 */
export function markFeedbackAddressed(
  feedback: string | null | undefined,
  now: Date,
): string | null {
  const trimmed = (feedback ?? '').trim()
  if (!trimmed) return null
  const day = now.toISOString().slice(0, 10)
  const { stamp, rest } = splitGateStamp(trimmed)
  if (!stamp) {
    // No recognizable machine-stamp shape; the whole text is the note.
    return `[addressed by rework on ${day}] ${trimmed}`
  }
  const notes = stamp.replace(STAMP_RE, '').trim() || stamp
  const historic = `[addressed by rework on ${day}] ${notes}`
  return rest ? `${historic}\n\n${rest}` : historic
}

export interface ReworkPatch {
  status: 'draft'
  reviewStatus: 'pending_review'
  feedback: string | null
  reviewedBy: null
  reviewedAt: null
  /** Cleared with the stamp (#4913): a reworked row has no verdict until the gate looks again. */
  gateStatus: null
  gateCheckedAt: null
  gateFindings: null
  updatedAt: Date
  mediaUrls?: string[]
  tweetText?: string
  altText?: string
  imageBrief?: string
  subject?: string
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
  | { ok: false; status: 400 | 404 | 409; error: string }

export interface ReworkDeps {
  repo?: ReworkRepo
  now?: () => Date
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

  // Fail-closed alt-text requirement (ticket #5486), mirroring the draft op in
  // api.team.social-post.tsx. Judge the EFFECTIVE row after this rework: a
  // media-bearing Instagram/X row must carry non-empty alt text, or the
  // pre-publish gate is guaranteed to REVISE it a run later. Rework can change
  // media and alt text but not platform, so a rework that adds/keeps media
  // without supplying alt text (and none already on the row) is refused rather
  // than written back to pending_review as a guaranteed-REVISE row.
  if (post.platform === 'instagram' || post.platform === 'x') {
    const effectiveMedia = input.mediaUrls ?? post.mediaUrls ?? []
    const effectiveAlt = (input.altText ?? post.altText ?? '').trim()
    if (effectiveMedia.length > 0 && effectiveAlt === '') {
      return {
        ok: false,
        status: 400,
        error:
          `Rework refused: a media-bearing ${post.platform} post requires a non-empty altText ` +
          `(hard rule since 2026-08-22). Supply rework.altText, or the pre-publish gate REVISEs it a run later.`,
      }
    }
  }

  const now = deps.now?.() ?? new Date()
  const patch: ReworkPatch = {
    status: 'draft',
    reviewStatus: 'pending_review',
    // Ticket #5415: this used to null `feedback` the moment a REVISE was
    // satisfied, destroying the instruction the owner just read and the one
    // the gate's own `owner-feedback-unmet` check reads back off the row.
    // Preserved as addressed history instead, see `markFeedbackAddressed`.
    feedback: markFeedbackAddressed(post.feedback, now),
    reviewedBy: null,
    reviewedAt: null,
    gateStatus: null,
    gateCheckedAt: null,
    gateFindings: null,
    updatedAt: now,
    ...(input.mediaUrls !== undefined ? { mediaUrls: input.mediaUrls } : {}),
    ...(input.tweetText !== undefined ? { tweetText: input.tweetText } : {}),
    ...(input.altText !== undefined ? { altText: input.altText } : {}),
    ...(input.imageBrief !== undefined ? { imageBrief: input.imageBrief } : {}),
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
  }
  await repo.write(id, patch)
  return { ok: true, reviewStatus: 'pending_review' }
}

// ── Revert to draft (Social Studio v2, Phase 3, ADR-013 decision 4) ─────────

/**
 * Remove the gate stamp (header line plus the gate's own notes paragraph) from
 * a `feedback` value, keeping anything written after a blank line, which is
 * where owner notes and the manual-publish / stock-guard appendices land.
 * Returns null when nothing but the stamp was there.
 */
export function stripGateStamp(feedback: string | null | undefined): string | null {
  return splitGateStamp(feedback).rest
}

export interface RevertPatch {
  status: 'draft'
  reviewStatus: 'pending_review'
  feedback: string | null
  reviewedBy: null
  reviewedAt: null
  gateStatus: null
  gateCheckedAt: null
  gateFindings: null
  updatedAt: Date
}

export interface RevertRepo {
  load: (id: number) => Promise<PostRow | null>
  write: (id: number, patch: RevertPatch) => Promise<void>
}

export const dbRevertRepo: RevertRepo = {
  load: dbApproveRepo.load,
  write: async (id, patch) => {
    await db.update(socialPosts).set(patch).where(eq(socialPosts.id, id))
  },
}

export type RevertResult =
  | { ok: true; reviewStatus: 'pending_review' }
  | { ok: false; status: 404 | 409; error: string }

/**
 * Pull an approved (or bounced, or still-pending) draft back to a clean
 * `draft`/`pending_review` so the owner can edit it and the gate looks again.
 *
 * The stamp is ALWAYS burned: review fields, gate columns and the stamped
 * `feedback` header are cleared unconditionally, because "I did not really
 * change anything" cannot be proven and a stale PASS on edited content is
 * incident #3640 through a different door. Owner notes after the stamp are
 * kept. `rejected` (gate BLOCK) and `posted` rows are refused: a BLOCK has no
 * manual override anywhere in this codebase, and history is not relabelled.
 */
export async function revertSocialPostToDraft(
  id: number,
  deps: { repo?: RevertRepo; now?: () => Date } = {},
): Promise<RevertResult> {
  const repo = deps.repo ?? dbRevertRepo
  const post = await repo.load(id)
  if (!post) return { ok: false, status: 404, error: `No social post ${id}` }
  if (post.status === 'posted' || post.status === 'deleted') {
    return { ok: false, status: 409, error: `Post ${id} is ${post.status}; a published row is history, not a draft.` }
  }
  if (post.reviewStatus === 'rejected') {
    return {
      ok: false,
      status: 409,
      error: `Post ${id} is rejected. A gate BLOCK has no manual override; start a fresh draft instead.`,
    }
  }
  await repo.write(id, {
    status: 'draft',
    reviewStatus: 'pending_review',
    feedback: stripGateStamp(post.feedback),
    reviewedBy: null,
    reviewedAt: null,
    gateStatus: null,
    gateCheckedAt: null,
    gateFindings: null,
    updatedAt: deps.now?.() ?? new Date(),
  })
  return { ok: true, reviewStatus: 'pending_review' }
}

// ── Removal attribution (ticket #6758) ──────────────────────────────────────

export interface MarkRemovalOwnerRepo {
  load: (id: number) => Promise<PostRow | null>
  write: (id: number, patch: { removalSource: 'owner' }) => Promise<void>
}

export const dbMarkRemovalOwnerRepo: MarkRemovalOwnerRepo = {
  load: dbApproveRepo.load,
  write: async (id, patch) => {
    await db.update(socialPosts).set(patch).where(eq(socialPosts.id, id))
  },
}

export type MarkRemovalOwnerResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string }

/**
 * The admin socials "I removed this" action. Only valid on a row already
 * `status='deleted'` — the removal watchers cannot tell a platform takedown
 * from the owner deleting a post himself, so this is how the owner supplies
 * the answer the watcher structurally cannot. Setting removalSource='owner'
 * excludes the row from the takedown-pattern count both watchers key off
 * (`countRemovedSince`), so one self-removed post never steps drafting
 * frequency down or flips an autopublish valve off.
 */
export async function markSocialPostRemovalOwner(
  id: number,
  deps: { repo?: MarkRemovalOwnerRepo } = {},
): Promise<MarkRemovalOwnerResult> {
  const repo = deps.repo ?? dbMarkRemovalOwnerRepo
  const post = await repo.load(id)
  if (!post) return { ok: false, status: 404, error: `No social post ${id}` }
  if (post.status !== 'deleted') {
    return {
      ok: false,
      status: 409,
      error: `Post ${id} is ${post.status}, not deleted. Only a removed post can be attributed.`,
    }
  }
  await repo.write(id, { removalSource: 'owner' })
  return { ok: true }
}
