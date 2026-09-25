/**
 * One-time backfill for `castMember.bodyPresentation` (ADR-015, ticket
 * #10730).
 *
 * The answer is already in each member's free-text `description` field
 * (e.g. "Latino man presenting late 20s" -> masculine, "Black woman
 * presenting early 30s" -> feminine), the same source
 * scripts/backfill-cast-metadata.ts's METADATA table was grounded in. Live
 * roster (owner-approved 2026-09-22, ADR-015 §Context): Diego, Marcus
 * (masculine); Emma, Jade, Maya, Priya, Sofia, Vivian (feminine).
 *
 * Usage:
 *   npx tsx scripts/backfill-cast-body-presentation.ts            # dry-run
 *   npx tsx scripts/backfill-cast-body-presentation.ts --apply    # write (only fills empty)
 *   npx tsx scripts/backfill-cast-body-presentation.ts --apply --force  # overwrite too
 *
 * Never touches any other field.
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

type BodyPresentation = 'masculine' | 'feminine'

/** Owner-approved roster (ADR-015 §Context, 2026-09-22). */
const PRESENTATION: Record<string, BodyPresentation> = {
  diego:  'masculine',
  marcus: 'masculine',
  emma:   'feminine',
  jade:   'feminine',
  maya:   'feminine',
  priya:  'feminine',
  sofia:  'feminine',
  vivian: 'feminine',
}

interface CastDoc {
  _id: string
  slug: string
  name: string
  description: string | null
  bodyPresentation: BodyPresentation | null
}

async function main(): Promise<number> {
  const client = createClient({ projectId, dataset, apiVersion: '2024-10-01', useCdn: false, token })
  const docs = await client.fetch<CastDoc[]>(
    `*[_type == "castMember" && !(_id in path("drafts.**"))]{
      _id, "slug": slug.current, name, description, bodyPresentation
    }`,
  )

  let wrote = 0
  for (const doc of docs) {
    const presentation = PRESENTATION[doc.slug]
    if (!presentation) {
      process.stderr.write(`SKIP ${doc.slug}: no presentation authored for this slug (description: "${doc.description ?? ''}")\n`)
      continue
    }
    if (!FORCE && doc.bodyPresentation) {
      process.stderr.write(`OK   ${doc.slug}: already ${doc.bodyPresentation} (use --force to overwrite)\n`)
      continue
    }
    process.stdout.write(`${doc.slug} (${doc._id}): bodyPresentation=${presentation}\n`)
    if (APPLY) {
      await client.patch(doc._id).set({ bodyPresentation: presentation }).commit()
      wrote++
    }
  }

  const missing = Object.keys(PRESENTATION).filter((slug) => !docs.some((d) => d.slug === slug))
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
