/**
 * scripts/seed-notebook-content.ts
 *
 * Bootstrap the Notebook redesign's additive Sanity content:
 *   1. singleton.notebookSettings (masthead kicker + newsletter copy — the
 *      same voice-gated strings the components ship as fallbacks, so Studio
 *      editing starts from the approved copy).
 *   2. Four blogCategoryExtras docs (guides / comparisons / care /
 *      wellness-basics) with intro lines. `accent` stays unset — the
 *      code-side categoryAccent() map governs until an editor overrides.
 *   3. Three launch blogSeries docs (First Times / How It Works / Field
 *      Notes) with kickers + descriptions from the art-direction doc.
 *   4. blogPostExtras docs attaching existing PUBLISHED posts to their
 *      series (createIfNotExists + patch — never clobbers editor edits),
 *      and the series posts[] arrays in beginner-first order.
 *
 * Idempotent: deterministic _ids (singleton.notebookSettings,
 * blogCategoryExtras.<slug>, blogSeries.<slug>, blogPostExtras.<post-slug>).
 * Re-running updates settings/categories/series in place and only ever adds
 * missing post attachments. Posts that don't exist yet are skipped and
 * reported — re-run after the content-writer publishes them.
 *
 *   npx tsx scripts/seed-notebook-content.ts [--dry-run]
 */
import 'dotenv/config'
import { createClient } from '@sanity/client'

const projectId = process.env['SANITY_PROJECT_ID']
const dataset   = process.env['SANITY_DATASET'] ?? 'production'
const token     = process.env['SANITY_API_TOKEN']

if (!projectId || !token) {
  console.error('Missing SANITY_PROJECT_ID or SANITY_API_TOKEN in .env')
  process.exit(1)
}

const dryRun = process.argv.includes('--dry-run')

const client = createClient({ projectId, dataset, apiVersion: '2024-10-01', useCdn: false, token })

// ── 1. Notebook settings singleton ──────────────────────────────────────────
// Strings mirror the component fallbacks shipped in the redesign (already
// passed emma-empathy-reviewer).

const NOTEBOOK_SETTINGS = {
  _id: 'singleton.notebookSettings',
  _type: 'notebookSettings',
  kicker: 'The xdipx Notebook',
  newsletterHeading: 'The Notebook, in your inbox.',
  newsletterBody: "One send, once-ish a week. Only the ones worth reading. Unsubscribe anytime, we're not needy.",
  newsletterButtonLabel: 'Show me',
}

// ── 2. Category extras ──────────────────────────────────────────────────────

const CATEGORY_EXTRAS: { slug: string; intro: string }[] = [
  { slug: 'guides',          intro: 'Where to start and how to choose, explained plainly.' },
  { slug: 'comparisons',     intro: 'Two honest options, side by side, so you can pick the one that fits.' },
  { slug: 'care',            intro: 'Cleaning, storage, and keeping what you own in good shape.' },
  { slug: 'wellness-basics', intro: 'Materials, body safety, and the foundations worth knowing.' },
]

// ── 3. Launch series (art direction §8) ─────────────────────────────────────

interface SeriesSeed {
  slug: string
  title: string
  kicker: string
  description: string
  /** Post slugs in beginner-first reading order (content-plan backlog slugs). */
  postSlugs: string[]
}

const SERIES: SeriesSeed[] = [
  {
    slug: 'first-times',
    title: 'First Times',
    kicker: 'First Times',
    description: "Plain answers for the thing you're buying for the first time. No experience assumed, no wrong questions.",
    postSlugs: [
      'how-to-choose-your-first-sex-toy',
      'what-is-a-good-first-toy-gift',
      'how-do-you-start-anal-play',
      'how-do-you-start-prostate-play',
      'how-do-you-start-with-restraints',
    ],
  },
  {
    slug: 'how-it-works',
    title: 'How It Works',
    kicker: 'How It Works',
    description: 'What a toy actually does, and the trick behind it, explained plainly.',
    postSlugs: [
      'how-does-a-clitoral-suction-toy-work',
      'how-do-you-use-a-wand-massager',
      'what-is-a-rabbit-vibrator',
      'what-is-a-bullet-vibrator-good-for',
      'what-does-a-couples-vibrator-do',
      'what-does-a-cock-ring-do',
      'how-do-app-controlled-vibrators-work',
    ],
  },
  {
    slug: 'field-notes',
    title: 'Field Notes',
    kicker: 'Field Notes',
    description: 'Short, practical notes on keeping what you own clean, safe, and lasting.',
    postSlugs: [
      'how-do-you-clean-a-sex-toy',
      'how-do-you-store-sex-toys-discreetly',
      'how-do-you-care-for-silicone-toys',
      'can-you-share-sex-toys-safely',
      'is-silicone-body-safe',
      'what-is-a-body-safe-material',
      'do-kegel-exercisers-work',
    ],
  },
]

async function main() {
  // Resolve live docs up front so nothing seeds a dangling reference.
  const [categories, posts] = await Promise.all([
    client.fetch<{ _id: string; slug: string }[]>(
      `*[_type == "blogCategory"]{ _id, "slug": slug.current }`,
    ),
    client.fetch<{ _id: string; slug: string }[]>(
      `*[_type == "blogPost" && status == "published"]{ _id, "slug": slug.current }`,
    ),
  ])
  const categoryBySlug = new Map(categories.map(c => [c.slug, c._id]))
  const postBySlug = new Map(posts.map(p => [p.slug, p._id]))

  const plan: string[] = []
  const skipped: string[] = []

  // 1. Settings singleton
  plan.push(`createOrReplace ${NOTEBOOK_SETTINGS._id}`)

  // 2. Category extras (only for categories that exist)
  const extrasDocs = CATEGORY_EXTRAS.flatMap(({ slug, intro }) => {
    const categoryId = categoryBySlug.get(slug)
    if (!categoryId) {
      skipped.push(`blogCategoryExtras.${slug} (no blogCategory "${slug}")`)
      return []
    }
    plan.push(`createOrReplace blogCategoryExtras.${slug}`)
    return [{
      _id: `blogCategoryExtras.${slug}`,
      _type: 'blogCategoryExtras',
      category: { _type: 'reference', _ref: categoryId },
      intro,
    }]
  })

  // 3. Series docs with resolved published posts, order preserved
  const seriesDocs = SERIES.map(s => {
    const found = s.postSlugs.filter(slug => postBySlug.has(slug))
    const missing = s.postSlugs.filter(slug => !postBySlug.has(slug))
    for (const m of missing) skipped.push(`series ${s.slug}: post "${m}" not published yet`)
    plan.push(`createOrReplace blogSeries.${s.slug} (${found.length}/${s.postSlugs.length} posts attached)`)
    return {
      doc: {
        _id: `blogSeries.${s.slug}`,
        _type: 'blogSeries',
        title: s.title,
        slug: { _type: 'slug', current: s.slug },
        kicker: s.kicker,
        description: s.description,
        posts: found.map((slug, i) => ({
          _type: 'reference',
          _ref: postBySlug.get(slug)!,
          _key: `post-${i}-${slug.slice(0, 24)}`,
        })),
      },
      attachments: found.map((slug, i) => ({ slug, postId: postBySlug.get(slug)!, order: i + 1 })),
    }
  })

  // 4. Post extras attachments (createIfNotExists + patch, never clobber)
  for (const s of seriesDocs) {
    for (const a of s.attachments) {
      plan.push(`attach blogPostExtras.${a.slug} → ${s.doc._id} (part ${a.order})`)
    }
  }

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, plan, skipped }, null, 2))
    return
  }

  // Settings + extras + series in one transaction (pure bootstrap docs).
  const tx = client.transaction()
  tx.createOrReplace(NOTEBOOK_SETTINGS)
  for (const doc of extrasDocs) tx.createOrReplace(doc)
  for (const s of seriesDocs) tx.createOrReplace(s.doc)
  await tx.commit()

  // Attachments patch per post — createIfNotExists first so a doc an editor
  // already created (deck, sources) keeps every field it has.
  for (const s of seriesDocs) {
    for (const a of s.attachments) {
      const docId = `blogPostExtras.${a.slug}`
      await client.createIfNotExists({
        _id: docId,
        _type: 'blogPostExtras',
        post: { _type: 'reference', _ref: a.postId },
      })
      await client
        .patch(docId)
        .set({
          series: { _type: 'reference', _ref: s.doc._id },
          seriesOrder: a.order,
        })
        .commit()
    }
  }

  console.log(JSON.stringify({ done: true, applied: plan, skipped }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
