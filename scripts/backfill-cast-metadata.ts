/**
 * backfill-cast-metadata.ts — populate castMember selection metadata
 * (ticket #2751 DONE WHEN 1).
 *
 * All six castMember docs (Diego, Jade, Marcus, Maya, Priya, Sofia) shipped
 * with archetype / ageRange / description NULL and no emotionTags, so no agent
 * could select from the roster programmatically — casting was a coin flip of
 * opening photos, which is how the same light/young pattern recurred until the
 * run-269 keeper note caught it. This backfills the queryable signal: age
 * presentation, build, skin tone, and the reader-emotions each presenter
 * carries well.
 *
 * Values are grounded in the owner-approved cast specs the portraits were
 * generated FROM (scripts/generate-cast-candidates.ts look/vibe lines), not
 * eyeballed guesses.
 *
 * Usage:
 *   npx tsx scripts/backfill-cast-metadata.ts            # dry-run: show current vs proposed
 *   npx tsx scripts/backfill-cast-metadata.ts --apply    # write (only fills empty fields)
 *   npx tsx scripts/backfill-cast-metadata.ts --apply --force  # overwrite non-empty too
 *
 * Never touches referencePhoto / editorialPhoto / approvedForUse.
 */

import 'dotenv/config'
import { createClient } from '@sanity/client'

const projectId = process.env['SANITY_PROJECT_ID']
const dataset = process.env['SANITY_DATASET'] ?? 'production'
const token =
  process.env['SANITY_API_TOKEN'] ?? process.env['SANITY_WRITE_TOKEN'] ?? process.env['SANITY_TOKEN']

if (!projectId || !token) {
  process.stderr.write('ERROR: SANITY_PROJECT_ID and a Sanity write token are required.\n')
  process.exit(2)
}

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

interface CastMeta {
  archetype: string
  ageRange: string
  description: string
  emotionTags: string[]
}

/** Grounded in scripts/generate-cast-candidates.ts (owner direction 2026-07-22). */
const METADATA: Record<string, CastMeta> = {
  maya: {
    archetype: 'warm best friend',
    ageRange: 'early 30s',
    description:
      'Black woman presenting early 30s, medium build, deep warm skin tone, natural curls, warm playful smile.',
    emotionTags: ['playful', 'comforted', 'welcomed', 'tender'],
  },
  sofia: {
    archetype: 'bold confidante',
    ageRange: 'late 20s',
    description:
      'Latina woman presenting late 20s, slim build, warm olive skin tone, long dark waves, confident direct gaze.',
    emotionTags: ['confident', 'empowered', 'bold', 'curious'],
  },
  jade: {
    archetype: 'calm minimalist',
    ageRange: 'early 30s',
    description:
      'East Asian woman presenting early 30s, slight build, light warm skin tone, sleek bob, serene knowing expression.',
    emotionTags: ['calm', 'reassured', 'reflective', 'serene'],
  },
  priya: {
    archetype: 'witty girlfriend',
    ageRange: 'early 30s',
    description:
      'South Asian woman presenting early 30s, medium build, medium brown skin tone, long dark hair, bright witty smile.',
    emotionTags: ['amused', 'lighthearted', 'delighted', 'curious'],
  },
  marcus: {
    archetype: 'easygoing charmer',
    ageRange: 'early 30s',
    description:
      'Black man presenting early 30s, athletic build, deep skin tone, short beard, easy charming smile.',
    emotionTags: ['relaxed', 'assured', 'warm', 'confident'],
  },
  diego: {
    archetype: 'polished flirt',
    ageRange: 'late 20s',
    description:
      'Latino man presenting late 20s, lean build, light olive skin tone, dark swept-back hair with light stubble, polished flirty grin.',
    emotionTags: ['flirtatious', 'bold', 'magnetic', 'playful'],
  },
}

interface CastDoc {
  _id: string
  slug: string
  name: string
  archetype: string | null
  ageRange: string | null
  description: string | null
  emotionTags: string[] | null
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

async function main(): Promise<number> {
  const client = createClient({ projectId, dataset, apiVersion: '2024-10-01', useCdn: false, token })
  const docs = await client.fetch<CastDoc[]>(
    `*[_type == "castMember" && !(_id in path("drafts.**"))]{
      _id, "slug": slug.current, name, archetype, ageRange, description, emotionTags
    }`,
  )

  let wrote = 0
  for (const doc of docs) {
    const meta = METADATA[doc.slug]
    if (!meta) {
      process.stderr.write(`SKIP ${doc.slug}: no metadata authored for this slug\n`)
      continue
    }
    const patch: Partial<CastMeta> = {}
    for (const key of ['archetype', 'ageRange', 'description', 'emotionTags'] as const) {
      if (FORCE || isEmpty(doc[key])) {
        // @ts-expect-error narrow per-key assignment
        patch[key] = meta[key]
      }
    }
    if (Object.keys(patch).length === 0) {
      process.stderr.write(`OK   ${doc.slug}: already populated (use --force to overwrite)\n`)
      continue
    }
    process.stdout.write(`${doc.slug} (${doc._id}): ${JSON.stringify(patch)}\n`)
    if (APPLY) {
      await client.patch(doc._id).set(patch).commit()
      wrote++
    }
  }

  const missing = Object.keys(METADATA).filter((slug) => !docs.some((d) => d.slug === slug))
  for (const slug of missing) process.stderr.write(`WARN: no published castMember doc for "${slug}"\n`)

  process.stderr.write(APPLY ? `applied ${wrote} patch(es)\n` : 'dry-run (re-run with --apply to write)\n')
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`)
    process.exit(2)
  },
)
