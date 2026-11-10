/**
 * audit-published-self-consistency.ts
 *
 * Ticket #21021 (split: code-shippable piece): a one-off manual sweep during
 * content run 1947 found a 24-sentence IPX7 shower/jet overreach live across
 * 17 published Notebook posts, because check-self-consistency.ts's cross-post
 * pass (#18045) only ever compares a DRAFT against the published corpus — it
 * never compares the published corpus against ITSELF. Posts that shipped
 * before #18045 existed, or whose own draft happened to carry no ingress
 * code, were never examined by anything. This script is the reusable sweep:
 * it reads every published blogPost from Sanity and runs the same two
 * deterministic checks (`analyzeParagraphs` in-document,
 * `findCrossPostIngressConflicts` cross-post) against the whole corpus at
 * once. The comparison logic itself lives in
 * app/lib/published-self-consistency-sweep.ts and is unit-tested; this
 * script only supplies the live Sanity read and prints the report.
 *
 * This script is read-only. It does not write to Sanity — fixing the 24
 * flagged sentences is a content-team task gated by the emma-empathy-reviewer
 * and sex-wellness-reviewer voice/accuracy reviews (see #21021), not a code
 * change this script makes for you.
 *
 * Usage:
 *   npx tsx scripts/audit-published-self-consistency.ts          # human-readable report
 *   npx tsx scripts/audit-published-self-consistency.ts --json   # JSON report
 *
 * Exit codes:
 *   0 — clean sweep, zero findings
 *   1 — one or more findings, or could not reach Sanity
 */
import './_load-env'
import { createClient } from '@sanity/client'
import { sweepPublishedCorpus, type PublishedPost } from '../app/lib/published-self-consistency-sweep'

const TAG = '[audit-published-self-consistency]'
const asJson = process.argv.includes('--json')

async function main(): Promise<void> {
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

  const posts = await sanity.fetch<PublishedPost[]>(
    `*[_type == "blogPost" && status == "published"]{title, "slug": slug.current, body}`,
  )

  const report = sweepPublishedCorpus(posts ?? [])

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
    process.exit(report.overLimit ? 1 : 0)
  }

  if (!report.overLimit) {
    console.log(`${TAG} OK. 0 findings across ${posts?.length ?? 0} published post(s).`)
    return
  }

  if (report.perPost.length > 0) {
    console.error(`${TAG} ${report.perPost.length} post(s) contradict themselves:`)
    for (const p of report.perPost) {
      console.error(`  ${p.slug}${p.title ? ` ("${p.title}")` : ''}`)
      for (const finding of p.findings) {
        console.error(`    [${finding.kind}] ${finding.message}`)
        for (const site of finding.sites) {
          console.error(`        [${site.section}] "${site.sentence}"`)
        }
      }
    }
  }

  if (report.crossPost.length > 0) {
    console.error(`${TAG} ${report.crossPost.length} cross-post conflict(s) between published posts:`)
    for (const c of report.crossPost) {
      console.error(
        `  "${c.token}" gets conflicting instructions on ${c.bucket}: ` +
          `"${c.draftSite.sentence}" (one post) ${c.draftPolarity}s it, ` +
          `"${c.priorSite.sentence}" (${c.priorSlug}) ${c.priorPolarity}s it.`,
      )
    }
  }

  process.exit(1)
}

main().catch(err => {
  console.error(`${TAG} ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
