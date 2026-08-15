/**
 * check-fresh-language.ts
 *
 * Deterministic Step 4 fresh-language pre-check for a Notebook draft, run BEFORE
 * the emma-empathy-reviewer voice gate (sibling of check-aphorism-closers.ts and
 * check-unsourced-frequency.ts). Like check-hero-embed-match.ts, and unlike the
 * two prose checkers, it reads Sanity live: the whole point is cross-post reuse,
 * which the voice gate cannot see because it has no Sanity access.
 *
 * It GROQs the last N published posts in the same topic cluster (same category),
 * then reports any word-6-gram the draft shares with them, weighting headings —
 * the surface where the tic hardened (ticket #3009: "Where does this need a
 * caveat?" shipped verbatim across two published podcast-notes posts before a
 * hand diff finally caught it). The analysis lives in app/lib/fresh-language.ts
 * and is unit-tested; this file is just the GROQ + I/O wrapper.
 *
 * Usage:
 *   npx tsx scripts/check-fresh-language.ts --category <categoryId> --draft <draft.json> [--slug <self-slug>]
 *   cat draft.json | npx tsx scripts/check-fresh-language.ts --category <categoryId>
 *
 * The draft JSON is the blogPost draft: { title?, excerpt?, body? } where body is
 * the Portable Text array. Exit 0 when the draft shares no 6-gram, 1 when it
 * shares any (the limit is zero) so the routine can gate on the exit code. Exit 1
 * too when the draft or category cannot be read — an unverifiable draft is not a
 * pass.
 */

import './_load-env'
import { readFileSync } from 'node:fs'
import { createClient } from '@sanity/client'
import { analyzeFreshness, type DraftInput, type PriorPost } from '../app/lib/fresh-language'

const TAG = '[fresh-language]'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const categoryId = arg('category')
if (!categoryId) {
  console.error(`${TAG} --category <categoryId> is required (the draft's blogPost category._ref).`)
  process.exit(1)
}

// Draft JSON: --draft <path>, or stdin when omitted.
function readDraft(): string {
  const path = arg('draft')
  return readFileSync(path ?? 0, 'utf8')
}

let draft: DraftInput
try {
  const raw = readDraft()
  if (!raw.trim()) {
    console.error(`${TAG} no draft JSON provided (pass --draft <path> or pipe JSON on stdin).`)
    process.exit(1)
  }
  draft = JSON.parse(raw) as DraftInput
} catch (err) {
  console.error(`${TAG} could not read/parse draft JSON:`, err instanceof Error ? err.message : err)
  process.exit(1)
}

const projectId = process.env['SANITY_PROJECT_ID']
if (!projectId) {
  console.error(`${TAG} SANITY_PROJECT_ID is not set. Run scripts/setup-worktree.sh first.`)
  process.exit(1)
}

const sanity = createClient({
  projectId,
  dataset: process.env['SANITY_DATASET'] ?? 'production',
  apiVersion: '2024-10-01',
  useCdn: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  token: process.env['SANITY_API_TOKEN'],
} as any)

async function main(): Promise<void> {
  // Same cluster query the routine's Step 4 fresh-language pre-check specifies.
  // slug != $slug excludes the draft's own published doc on a re-run; an empty
  // sentinel excludes nothing, which is correct for a not-yet-published draft.
  const priors = await sanity.fetch<PriorPost[]>(
    `*[_type == "blogPost" && category._ref == $categoryId && slug.current != $slug]
      | order(publishedAt desc)[0...10]{title, "slug": slug.current, body}`,
    { categoryId, slug: arg('slug') ?? '' },
  )

  const report = analyzeFreshness(draft, priors ?? [])

  if (!report.overlap) {
    console.log(`${TAG} OK. 0 shared 6-grams across ${priors?.length ?? 0} prior post(s) in this cluster.`)
    return
  }

  // Headings first — the high-risk surface the tic hardened on.
  if (report.headingHits.length > 0) {
    console.error(`${TAG} ${report.headingHits.length} shared 6-gram(s) on a heading surface (high risk):`)
    for (const h of report.headingHits) {
      const where = h.draftKind === 'heading' ? `draft heading "${h.draftLabel}"` : `draft ${h.draftLabel}`
      const priorNote = h.priorInHeading ? ', also a prior heading' : ''
      console.error(`  "${h.ngram}" — ${where} vs ${h.priorSlugs.join(', ')}${priorNote}`)
    }
  }

  const bodyOnly = report.hits.filter(h => !report.headingHits.includes(h))
  if (bodyOnly.length > 0) {
    console.error(`${TAG} ${bodyOnly.length} shared 6-gram(s) in body prose:`)
    for (const h of bodyOnly) {
      console.error(`  "${h.ngram}" — draft ${h.draftLabel} vs ${h.priorSlugs.join(', ')}`)
    }
  }

  console.error(`${TAG} Rewrite each recycled phrase before the voice gate (limit is zero).`)
  process.exit(1)
}

main().catch((err) => {
  console.error(`${TAG} ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
