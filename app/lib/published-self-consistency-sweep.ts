/**
 * Full-corpus self-consistency sweep for already-PUBLISHED Notebook posts.
 *
 * check-self-consistency.ts's `--slug` pass (ticket #18045) only ever compares
 * one DRAFT against the published corpus, because that is the moment the
 * content routine can still stop a bad sentence before it ships. Nothing has
 * ever compared the published corpus against ITSELF, so a post that shipped
 * before #18045 existed, or whose own draft happened to carry no ingress
 * code, was never examined by any checker (ticket #21021: a 24-sentence IPX7
 * shower/jet overreach found live across 17 posts by a one-off manual sweep
 * during content run 1947). This module is that sweep made reusable: given
 * every published post's flattened paragraphs, it runs the same two
 * deterministic checks `check-self-consistency.ts` already runs pre-publish —
 * `analyzeParagraphs` (in-document) and `findCrossPostIngressConflicts`
 * (cross-post) — against the whole corpus at once, so the class is
 * re-checkable on demand instead of only caught by whoever happens to look.
 *
 * Pure and Sanity-agnostic: scripts/audit-published-self-consistency.ts
 * supplies the live fetch and does the printing; this file only has the
 * corpus-wide comparison logic, so it unit-tests the same way
 * app/lib/self-consistency.ts does.
 */

import { draftToParagraphs } from './aphorism-closer'
import {
  analyzeParagraphs,
  findCrossPostIngressConflicts,
  type CrossPostIngressConflict,
  type DraftInput,
  type SelfConsistencyFinding,
} from './self-consistency'

export interface PublishedPost {
  slug: string
  title?: string | null
  body?: unknown
}

export interface PublishedPostFindings {
  slug: string
  title: string | null
  findings: SelfConsistencyFinding[]
}

export interface PublishedCorpusSweepReport {
  /** Posts that contradict themselves (the `analyzeParagraphs` shape), one entry per post with findings. */
  perPost: PublishedPostFindings[]
  /** Posts that contradict EACH OTHER, deduplicated so a pair is reported once regardless of scan order. */
  crossPost: CrossPostIngressConflict[]
  overLimit: boolean
}

function draftInputFor(post: PublishedPost): DraftInput {
  return { title: post.title ?? null, body: post.body }
}

/**
 * A stable key for a conflict so the same pair/sentence/sentence is never
 * reported twice regardless of which post was scanned as the "draft" side.
 * Pairs each slug with ITS OWN sentence before sorting, so sorting by slug
 * cannot separate a sentence from the post it actually came from.
 */
function conflictDedupeKey(slugA: string, c: CrossPostIngressConflict): string {
  const [a, b] = [
    { slug: slugA, sentence: c.draftSite.sentence },
    { slug: c.priorSlug, sentence: c.priorSite.sentence },
  ].sort((x, y) => x.slug.localeCompare(y.slug))
  return [c.token, c.bucket, a!.slug, a!.sentence, b!.slug, b!.sentence].join('\u0000')
}

/**
 * Runs the in-document check and the cross-post check against every
 * published post, treating each post in turn as the "draft" against every
 * OTHER post as "priors" (the same shape `findCrossPostIngressConflicts`
 * already takes). Scanning N posts this way finds a conflicting pair twice,
 * once from each side, so results are deduplicated by (unordered pair,
 * token, bucket, both sentences) before being returned.
 */
export function sweepPublishedCorpus(posts: PublishedPost[]): PublishedCorpusSweepReport {
  const paragraphsBySlug = new Map(posts.map(p => [p.slug, draftToParagraphs(draftInputFor(p))]))

  const perPost: PublishedPostFindings[] = []
  for (const post of posts) {
    const report = analyzeParagraphs(paragraphsBySlug.get(post.slug)!)
    if (report.findings.length > 0) {
      perPost.push({ slug: post.slug, title: post.title ?? null, findings: report.findings })
    }
  }

  const seen = new Set<string>()
  const crossPost: CrossPostIngressConflict[] = []
  for (const post of posts) {
    const priors = posts
      .filter(p => p.slug !== post.slug)
      .map(p => ({ slug: p.slug, paragraphs: paragraphsBySlug.get(p.slug)! }))
    const conflicts = findCrossPostIngressConflicts(paragraphsBySlug.get(post.slug)!, priors)
    for (const c of conflicts) {
      const key = conflictDedupeKey(post.slug, c)
      if (seen.has(key)) continue
      seen.add(key)
      crossPost.push(c)
    }
  }

  return { perPost, crossPost, overLimit: perPost.length > 0 || crossPost.length > 0 }
}
