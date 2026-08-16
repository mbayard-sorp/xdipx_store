/**
 * check-slug-precheck.ts
 *
 * Ticket #3401/#3405: the daily content routine's Step 3 slug pre-check used to
 * read the raw Sanity perspective, so an unpublished blogPost draft (for example
 * one a gate BLOCKed per Step 5 item 4) looked exactly like a taken slug. A run
 * following that mechanically skipped to a fresh topic and orphaned the finished
 * draft (run 327, blogPost-which-dildo-material-is-best).
 *
 * This script runs the two corrected GROQ reads (published perspective, then
 * raw/draft perspective) and hands the result to the pure decision table in
 * app/lib/content-slug-precheck.ts, mirroring the app/lib/blog-hero-embed-audit.ts
 * + scripts/check-hero-embed-match.ts split: decision logic is dependency-free
 * and unit-tested, this script only supplies live data.
 *
 * Usage:
 *   npx tsx scripts/check-slug-precheck.ts --slug <slug>
 *
 * Prints the decision as JSON on stdout, one of:
 *   {"action":"slug-taken","reason":"published"}
 *   {"action":"resume-draft","reason":"unpublished-draft","draftId":"drafts.blogPost-<slug>"}
 *   {"action":"slug-free","reason":"no-post-at-slug"}
 *
 * Exit codes:
 *   0: decision computed (any of the three outcomes above; slug-taken and
 *      resume-draft are both normal, expected outcomes, not failures)
 *   1: bad usage or Sanity connection failure (an unverifiable slug is never
 *      safe to treat as free)
 */

import './_load-env'
import { createClient } from '@sanity/client'
import { decideSlugPrecheck } from '../app/lib/content-slug-precheck'

const TAG = '[slug-precheck]'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const slug = arg('slug')
if (!slug) {
  console.error(`${TAG} --slug <slug> is required.`)
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
  const [publishedId, draftId] = await Promise.all([
    sanity.fetch<string | null>(
      `*[_type == "blogPost" && slug.current == $slug && status == "published"][0]._id`,
      { slug },
    ),
    sanity.fetch<string | null>(
      `*[_type == "blogPost" && slug.current == $slug && status != "published"][0]._id`,
      { slug },
    ),
  ])

  const decision = decideSlugPrecheck({ publishedId: publishedId ?? null, draftId: draftId ?? null })
  console.log(JSON.stringify(decision))
}

main().catch(err => {
  console.error(`${TAG} Sanity read failed:`, err instanceof Error ? err.message : err)
  process.exit(1)
})
