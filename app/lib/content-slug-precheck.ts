/**
 * content-slug-precheck.ts
 *
 * Pure decision logic for ticket #3401/#3405: the daily content routine's Step 3
 * slug pre-check used to read the raw perspective, so a blogPost held as an
 * unpublished draft (for example a post a gate BLOCKed, per Step 5 item 4) looked
 * exactly like a taken slug. A run following that mechanically would skip the
 * brief to a fresh topic and orphan the finished draft, observed live on run
 * 327 (blogPost-which-dildo-material-is-best), only avoided because the same
 * session still held the context and filed a resume suggestion by hand.
 *
 * The fix has two parts, both expressed here as one decision table instead of
 * left as prose the routine could re-drift on a future rewrite (the class of bug
 * this ticket is): a slug only reads as "taken" when a post is actually
 * published, and an unpublished draft at that slug means RESUME it as today's
 * post rather than selecting a fresh topic. The live Sanity reads (published
 * perspective, then raw perspective) live in scripts/check-slug-precheck.ts;
 * this module is dependency-free so the decision table is unit-testable without
 * network access, mirroring app/lib/blog-hero-embed-audit.ts.
 */

export interface SlugPrecheckInput {
  /** `_id` of a blogPost at this slug with `status == "published"`, or null when
   *  no published post lives at this slug. */
  publishedId: string | null
  /** `_id` of a blogPost at this slug that is NOT published (a raw-perspective
   *  match with `status != "published"`, typically a `drafts.<id>` doc), or null
   *  when nothing unpublished exists at this slug either. */
  draftId: string | null
}

export type SlugPrecheckDecision =
  | { action: 'slug-taken'; reason: 'published' }
  | { action: 'resume-draft'; reason: 'unpublished-draft'; draftId: string }
  | { action: 'slug-free'; reason: 'no-post-at-slug' }

/**
 * A published post always wins the slug regardless of what else exists at it
 * (a published post can coexist with a since-abandoned draft revision). Only
 * once nothing is published do we ask whether an unpublished draft should be
 * resumed instead of orphaned.
 */
export function decideSlugPrecheck(input: SlugPrecheckInput): SlugPrecheckDecision {
  if (input.publishedId) {
    return { action: 'slug-taken', reason: 'published' }
  }
  if (input.draftId) {
    return { action: 'resume-draft', reason: 'unpublished-draft', draftId: input.draftId }
  }
  return { action: 'slug-free', reason: 'no-post-at-slug' }
}
