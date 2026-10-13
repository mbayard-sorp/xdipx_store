/**
 * check-topic-collision.ts
 *
 * Ticket #14988: a structural pass run as soon as a topic is picked and its H2
 * outline is sketched — BEFORE full prose is written — so a collision is
 * caught before a draft is spent, not mid-draft or after. Sibling of
 * check-fresh-language.ts, which this does not replace: that one catches a
 * hardened PHRASE (a word-6-gram repeated verbatim); this one catches the
 * gap it cannot see — a short H2 heading, title, or set of embedded products
 * that overlaps another post's on the same sub-topic in different words. See
 * app/lib/topic-collision.ts's header for the full incident writeup.
 *
 * Retrieval: prior posts in the same category, PLUS any whose slug shares a
 * content word with the candidate's own slug/title (the "topic stem" — e.g.
 * "anal" or "dildo"), so a same-subject post outside today's category still
 * gets compared. The analysis itself (app/lib/topic-collision.ts) is pure and
 * unit-tested against the three incidents that motivated it; this file is
 * just the GROQ + I/O wrapper, same split as check-fresh-language.ts /
 * app/lib/fresh-language.ts.
 *
 * Usage:
 *   npx tsx scripts/check-topic-collision.ts --category <categoryId> --draft <draft.json> [--slug <self-slug>]
 *   cat draft.json | npx tsx scripts/check-topic-collision.ts --category <categoryId> --slug <candidate-slug>
 *
 * The draft JSON is { title?, body? } — body is the Portable Text array, an
 * H2-only outline is enough (no prose required for a heading/embed hit).
 * `--slug` doubles as the self-exclude on a re-run AND the topic-stem source
 * when the draft has no title yet.
 *
 * Exit 0: no collision. Exit 1: a collision was found (print the hits), or
 * the draft/category could not be read — an unverifiable draft is not a pass.
 */

import './_load-env'
import { readFileSync } from 'node:fs'
import { createClient } from '@sanity/client'
import {
  analyzeTopicCollision,
  topicStemWords,
  type TopicCollisionCandidate,
  type PriorPostForCollision,
} from '../app/lib/topic-collision'

const TAG = '[topic-collision]'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const categoryId = arg('category')
if (!categoryId) {
  console.error(`${TAG} --category <categoryId> is required (the draft's blogPost category._ref).`)
  process.exit(1)
}

const selfSlug = arg('slug') ?? ''

function readDraft(): string {
  const path = arg('draft')
  return readFileSync(path ?? 0, 'utf8')
}

let draft: TopicCollisionCandidate
try {
  const raw = readDraft()
  if (!raw.trim()) {
    console.error(`${TAG} no draft JSON provided (pass --draft <path> or pipe JSON on stdin).`)
    process.exit(1)
  }
  draft = JSON.parse(raw) as TopicCollisionCandidate
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
  // The topic stem: content words from the candidate's own title, falling
  // back to its slug when no title has been written yet (pure topic
  // selection, before even a working title exists).
  const stemSource = draft.title ?? selfSlug.replace(/-/g, ' ')
  const stems = topicStemWords(stemSource)
  const stemGlobs = stems.map(s => `*${s}*`)

  const priors = await sanity.fetch<PriorPostForCollision[]>(
    `*[_type == "blogPost" && defined(publishedAt) && slug.current != $slug
        && (category._ref == $categoryId || slug.current match $stemGlobs)]
      | order(publishedAt desc)[0...20]{title, "slug": slug.current, body}`,
    { categoryId, slug: selfSlug, stemGlobs },
  )

  const report = analyzeTopicCollision(draft, priors ?? [])

  if (!report.collision) {
    console.log(`${TAG} OK. No heading/title/embed collision across ${priors?.length ?? 0} prior post(s) (category + stem: ${stems.join(', ') || '(none)'}).`)
    return
  }

  for (const h of report.headingHits) {
    console.error(`${TAG} H2 collision (${(h.overlap * 100).toFixed(0)}% shared): draft "${h.draftHeading}" vs ${h.priorSlug} "${h.priorHeading}" [${h.sharedTokens.join(', ')}]`)
  }
  for (const t of report.titleHits) {
    console.error(`${TAG} Title collision (${(t.overlap * 100).toFixed(0)}% shared): vs ${t.priorSlug} "${t.priorTitle}" [${t.sharedTokens.join(', ')}]`)
  }
  for (const e of report.embedHits) {
    console.error(`${TAG} Embed collision: shares ${e.sharedHandles.length} product(s) with ${e.priorSlug}: ${e.sharedHandles.join(', ')}`)
  }
  console.error(`${TAG} Re-angle the topic, or re-check that the cited prior post does not already answer this before spending a full draft.`)
  process.exit(1)
}

main().catch((err) => {
  console.error(`${TAG} ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
