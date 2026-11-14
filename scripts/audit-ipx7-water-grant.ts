/**
 * audit-ipx7-water-grant.ts
 *
 * Ticket #21947, the engineering half of bus row #21540 clauses (a) and (d):
 * a detector for "an IPX7 mark granted a shower, bath, tap, jet, or
 * running-water permission with no restriction clause" did not exist, so
 * every instance of the class had to be found by a human reading the
 * corpus. This script is that detector made reusable: it reads every
 * published blogPost from Sanity, flattens it to sentences, and runs
 * sentenceGrantsUnrestrictedIpx7Water (app/lib/ipx7-water-grant.ts, unit
 * tested) over all of them.
 *
 * This script is read-only. It does not write to Sanity — fixing a flagged
 * sentence is a content-team task gated by the emma-empathy-reviewer and
 * sex-wellness-reviewer voice/accuracy reviews, not a code change this
 * script makes for you.
 *
 * Known limit, stated here rather than hidden: this is a reusable-token
 * checker, so it cannot see a grant sentence that refers back to the rating
 * by pronoun ("that code") instead of repeating "IPX7". A sweep returning
 * zero still does not prove the corpus is clean of every phrasing of this
 * defect — see app/lib/ipx7-water-grant.ts's own header.
 *
 * Usage:
 *   npx tsx scripts/audit-ipx7-water-grant.ts          # human-readable report
 *   npx tsx scripts/audit-ipx7-water-grant.ts --json   # JSON report
 *
 * Exit codes:
 *   0 — clean sweep, zero findings
 *   1 — one or more findings, or could not reach Sanity
 */
import './_load-env'
import { createClient } from '@sanity/client'
import { draftToParagraphs } from '../app/lib/aphorism-closer'
import { findIpx7WaterGrants, type Ipx7WaterGrantHit } from '../app/lib/ipx7-water-grant'

const TAG = '[audit-ipx7-water-grant]'
const asJson = process.argv.includes('--json')

interface PublishedPost {
  slug: string
  title?: string | null
  body?: unknown
}

interface PostHits {
  slug: string
  title: string | null
  hits: Ipx7WaterGrantHit[]
}

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

  const perPost: PostHits[] = []
  for (const post of posts ?? []) {
    const paragraphs = draftToParagraphs({ title: post.title ?? null, body: post.body })
    const hits = findIpx7WaterGrants(paragraphs)
    if (hits.length > 0) perPost.push({ slug: post.slug, title: post.title ?? null, hits })
  }

  if (asJson) {
    console.log(JSON.stringify({ perPost, overLimit: perPost.length > 0 }, null, 2))
    process.exit(perPost.length > 0 ? 1 : 0)
  }

  if (perPost.length === 0) {
    console.log(`${TAG} OK. 0 findings across ${posts?.length ?? 0} published post(s).`)
    return
  }

  console.error(`${TAG} ${perPost.length} post(s) carry a sentence that grants IPX7 water use with no restriction:`)
  for (const p of perPost) {
    console.error(`  ${p.slug}${p.title ? ` ("${p.title}")` : ''}`)
    for (const hit of p.hits) {
      console.error(`    [${hit.section}] "${hit.sentence}"`)
    }
  }
  process.exit(1)
}

main().catch(err => {
  console.error(`${TAG} ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
