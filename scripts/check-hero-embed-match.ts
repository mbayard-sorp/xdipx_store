/**
 * check-hero-embed-match.ts
 *
 * Deterministic per-post pre-flight for a Notebook post's hero, run in the Step 5
 * cluster BEFORE the emma-empathy-reviewer voice gate (sibling of
 * check-aphorism-closers.ts and check-unsourced-frequency.ts). Unlike those two,
 * which read a draft JSON, this one is slug-scoped and reads Sanity live, because
 * the checks it runs need the post's structured hero fields and the live catalog.
 *
 * It closes the two hero guardrails that shipped wired to nothing (ticket #2750):
 *
 *   1. imagePrompt is non-empty. The composed prompt used to be discarded on hero
 *      upload, leaving blogPost.imagePrompt NULL on every post, so a bad hero
 *      could never be retro'd. scripts/gen-notebook-art.ts now writes it; this
 *      asserts it actually landed.
 *   2. hero/embed coupling, BOTH directions:
 *      - the existing audit's direction: the hero names a catalog product the
 *        post does NOT embed (findHeroEmbedMismatches), and
 *      - the direction that audit is blind to: the post carries embeds but the
 *        hero names NO catalog product at all (heroNamesAnyProduct). This is the
 *        actual failure mode the owner complained about — a generic hero that
 *        depicts nothing the article is about.
 *
 * Usage:
 *   npx tsx scripts/check-hero-embed-match.ts --slug <slug>
 *
 * Exit 0 when clean, 1 when any check flags (so the routine can gate on the exit
 * code). Exit 1 too when the post cannot be read — an unverifiable hero is not a
 * pass.
 */

import './_load-env'
import { createClient } from '@sanity/client'
import {
  findHeroEmbedMismatches,
  heroNamesAnyProduct,
  type AuditBlogPost,
  type CatalogProduct,
} from '../app/lib/blog-hero-embed-audit'

const TAG = '[hero-embed-match]'

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

interface HeroPost extends AuditBlogPost {
  imagePrompt: string | null
  hasHero: boolean
}

async function main(): Promise<void> {
  // Prefer the draft (Step 5 runs pre-publish), falling back to the published doc.
  const [post, catalog] = await Promise.all([
    sanity.fetch<HeroPost | null>(
      `*[_type == "blogPost" && slug.current == $slug]
        | order((_id in path("drafts.**")) desc)[0]{
          "slug": slug.current,
          heroImageAlt,
          imagePrompt,
          "hasHero": defined(heroImage),
          "embedHandles": body[_type == "blogProductEmbed"].productHandle
        }`,
      { slug },
    ),
    sanity.fetch<CatalogProduct[]>(
      `*[_type == "productPage" && archived != true && defined(shopifyHandle)]{
        "handle": shopifyHandle,
        title
      }`,
    ),
  ])

  if (!post) {
    console.error(`${TAG} no blogPost with slug "${slug}" — cannot verify the hero.`)
    process.exit(1)
  }

  const embedHandles = post.embedHandles ?? []
  const auditPost: AuditBlogPost = {
    slug: post.slug,
    heroImageAlt: post.heroImageAlt,
    imagePrompt: post.imagePrompt,
    embedHandles,
  }

  const problems: string[] = []

  // (1) imagePrompt present.
  if (!post.imagePrompt || !post.imagePrompt.trim()) {
    problems.push(
      'imagePrompt is empty. The hero prompt was not captured on upload — re-run ' +
        'gen-notebook-art.ts --surface hero with an explicit --prompt so a bad hero can be retro\'d.',
    )
  }

  // (2a) hero names a product the post does not embed.
  for (const m of findHeroEmbedMismatches([auditPost], catalog)) {
    problems.push(
      `hero names ${m.matchedHandle}${m.matchedTitle ? ` (${m.matchedTitle})` : ''} ` +
        `[matched on: ${m.matchedOn.join(', ')}] which the post does not embed. ` +
        `Embeds: ${m.embedHandles.join(', ') || '(none)'}.`,
    )
  }

  // (2b) the inverse the audit misses: embeds exist but the hero names no product.
  if (embedHandles.length > 0 && !heroNamesAnyProduct(auditPost, catalog)) {
    problems.push(
      'hero names no catalog product at all, but the post embeds ' +
        `${embedHandles.join(', ')}. A generic hero on a product-led post is the failure ` +
        'mode to fix: make the hero depict a product the article is actually about.',
    )
  }

  if (problems.length > 0) {
    console.error(`${TAG} ${problems.length} issue(s) to resolve before the voice gate:`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }

  console.log(`${TAG} OK. Hero prompt present and hero/embed coupling clean.`)
}

main().catch((err) => {
  console.error(`${TAG} ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
