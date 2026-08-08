/**
 * audit-blog-hero-embed.ts
 *
 * Ticket #886: flag published Notebook posts whose hero image names a product
 * the article never embeds. A hero showing a product the post never mentions is
 * a credibility leak on a surface whose whole job is being citable (run 155
 * found one: a Wanda Lust wand hero on a post embedding only a bullet and two
 * magic wands).
 *
 * The hero carries no structured product reference, so this is a heuristic
 * check: it reads each post's free-text heroImageAlt + imagePrompt and looks for
 * a catalog product named there whose handle is not among the post's
 * blogProductEmbed handles. The matching logic (and its precision guardrails)
 * lives in app/lib/blog-hero-embed-audit.ts and is unit-tested; this script only
 * supplies the live Sanity data and prints the report.
 *
 * Usage:
 *   tsx scripts/audit-blog-hero-embed.ts            # human-readable report
 *   tsx scripts/audit-blog-hero-embed.ts --json     # JSON array of mismatches
 *
 * Report goes to stdout; the summary line goes to stderr so it survives piping.
 *
 * Exit codes:
 *   0 — ran successfully (whether or not mismatches were found — this is an
 *       advisory audit, not a gate)
 *   1 — Sanity connection failure or SANITY_PROJECT_ID missing
 */

import './_load-env'
import { createClient } from '@sanity/client'
import {
  findHeroEmbedMismatches,
  type AuditBlogPost,
  type CatalogProduct,
} from '../app/lib/blog-hero-embed-audit'

const AS_JSON = process.argv.slice(2).includes('--json')

const projectId = process.env['SANITY_PROJECT_ID']
if (!projectId) {
  process.stderr.write('ERROR: SANITY_PROJECT_ID is not set. Run scripts/setup-worktree.sh first.\n')
  process.exit(1)
}

const sanity = createClient({
  projectId,
  dataset: process.env['SANITY_DATASET'] ?? 'production',
  apiVersion: '2024-10-01',
  useCdn: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  token: process.env['SANITY_API_TOKEN'],
} as any)

async function main(): Promise<void> {
  const [posts, catalog] = await Promise.all([
    sanity.fetch<AuditBlogPost[]>(
      `*[_type == "blogPost" && status == "published"]{
        "slug": slug.current,
        heroImageAlt,
        imagePrompt,
        "embedHandles": body[_type == "blogProductEmbed"].productHandle
      }`,
    ),
    sanity.fetch<CatalogProduct[]>(
      `*[_type == "productPage" && archived != true && defined(shopifyHandle)]{
        "handle": shopifyHandle,
        title
      }`,
    ),
  ])

  // Defensive: a post with no embeds returns null for the projection, not [].
  const normalizedPosts = posts.map((p) => ({ ...p, embedHandles: p.embedHandles ?? [] }))
  const mismatches = findHeroEmbedMismatches(normalizedPosts, catalog)

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(mismatches, null, 2) + '\n')
  } else if (mismatches.length === 0) {
    process.stdout.write('No hero/embed mismatches found.\n')
  } else {
    for (const m of mismatches) {
      process.stdout.write(
        `MISMATCH  /notebook/${m.slug}\n` +
          `  hero names: ${m.matchedHandle}${m.matchedTitle ? ` (${m.matchedTitle})` : ''}` +
          `  [matched on: ${m.matchedOn.join(', ')}]\n` +
          `  embeds:     ${m.embedHandles.join(', ') || '(none)'}\n` +
          `  alt:        ${m.heroImageAlt ?? '(none)'}\n\n`,
      )
    }
  }

  process.stderr.write(
    `Scanned ${normalizedPosts.length} published posts against ${catalog.length} products — ` +
      `${mismatches.length} hero/embed mismatch(es).\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
