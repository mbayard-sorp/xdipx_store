/**
 * Clone a dead (rejected or gate-BLOCKed) social draft into a fresh one
 * (ticket #5416).
 *
 * `reviewSocialPost`, `reworkSocialPost` and `applyPublishGateVerdict` all
 * refuse to re-verdict a `rejected` row on purpose: a gate BLOCK has no
 * manual override anywhere in this codebase (see `team.server.ts`
 * `reviewSocialPost`), and a rejection is meant to be terminal. That is
 * correct when the row should never run again, but the owner also uses
 * Reject for "this needs real changes", and for that reading rejection was a
 * dead end: the only escape was the Composer's blank `new` screen, which
 * carries none of the caption, slides, or product link forward.
 *
 * This is the sanctioned escape. It never re-verdicts the dead row and never
 * touches its `review_status` or `gate_status` (both untouched here). It
 * mints a genuinely NEW row at `pending_review` with `gate_status` null,
 * carrying the dead row's content forward and pointing `reworked_from` at it
 * so the lineage survives and the gate's `owner-feedback-unmet` check can
 * still read the dead row's `feedback` as the instruction to satisfy. The
 * clone is judged on its own merits by the ordinary gate path; it must never
 * be able to inherit an approved state, and nothing here writes one.
 */
import { db } from './db.server'
import { socialPosts } from '../../db/schema'
import { eq } from 'drizzle-orm'
import type { PostRow } from './social-publish-approve.server'

export interface CloneRepo {
  load: (id: number) => Promise<PostRow | null>
  insert: (values: NewClonedPost) => Promise<{ id: number }>
}

export interface NewClonedPost {
  platform: string
  postType: string
  tweetText: string
  mediaUrls: string[] | null
  status: 'draft'
  createdBy: string
  reviewStatus: 'pending_review'
  reworkedFrom: number
  shopifyProductId: string | null
  altText: string | null
  imageBrief: string | null
  subject: string | null
}

export const dbCloneRepo: CloneRepo = {
  load: async (id) => {
    const [row] = await db.select().from(socialPosts).where(eq(socialPosts.id, id)).limit(1)
    return row ?? null
  },
  insert: async (values) => {
    const [row] = await db.insert(socialPosts).values(values).returning({ id: socialPosts.id })
    return { id: row!.id }
  },
}

export type CloneResult =
  | { ok: true; id: number }
  | { ok: false; status: 404 | 409; error: string }

export interface CloneDeps {
  repo?: CloneRepo
  /** Who clicked Clone. Stamped as the new row's `created_by`. */
  by: string
}

/**
 * Only a `rejected` row is a clone target. A gate BLOCK lands here too: the
 * gate writes `review_status: 'rejected'` for a BLOCK verdict exactly like a
 * plain owner Reject (`applyPublishGateVerdict`), so "rejected or blocked" is
 * one and the same server-side check, not two.
 */
export async function cloneRejectedSocialPost(
  id: number,
  deps: CloneDeps,
): Promise<CloneResult> {
  const repo = deps.repo ?? dbCloneRepo
  const post = await repo.load(id)
  if (!post) return { ok: false, status: 404, error: `No social post ${id}` }
  if (post.reviewStatus !== 'rejected') {
    return {
      ok: false,
      status: 409,
      error:
        `Post ${id} is ${post.status}/${post.reviewStatus}, not rejected. Only a rejected ` +
        '(including gate-BLOCKed) row is a clone target.',
    }
  }

  const { id: newId } = await repo.insert({
    platform: post.platform,
    postType: post.postType,
    tweetText: post.editedText?.trim() || post.tweetText,
    mediaUrls: post.mediaUrls ?? null,
    status: 'draft',
    createdBy: deps.by,
    reviewStatus: 'pending_review',
    reworkedFrom: id,
    shopifyProductId: post.shopifyProductId ?? null,
    altText: post.altText ?? null,
    imageBrief: post.imageBrief ?? null,
    subject: post.subject ?? null,
    // Deliberately no gateStatus, gateCheckedAt, gateFindings, or feedback
    // carried into the new row: it is judged on its own merits and must never
    // read as pre-approved. The dead row's feedback stays on the dead row,
    // where the gate's owner-feedback-unmet check reads it via reworkedFrom.
  })
  return { ok: true, id: newId }
}
