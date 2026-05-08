/**
 * Import Emma's presets into Sanity from a JSON file produced by Co-Work.
 *
 *   npx tsx scripts/seed-emma-presets.ts <path-to-json>
 *   npx tsx scripts/seed-emma-presets.ts <path-to-json> --dry-run
 *   npx tsx scripts/seed-emma-presets.ts <path-to-json> --replace   # delete existing emmaPreset docs first
 *
 * Idempotent: each preset gets a deterministic _id derived from its slug
 * (`emmaPreset.<slug>`), so re-running with the same file updates in place.
 * Use --replace to wipe any presets not present in the file.
 *
 * Input JSON format — array of preset objects. Required: label, slug
 * (string OR { current: string }), and at least one of moodTags /
 * audienceTags / mattersTags. Everything else is optional.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@sanity/client'

const projectId = process.env['SANITY_PROJECT_ID']
const dataset   = process.env['SANITY_DATASET'] ?? 'production'
const token     = process.env['SANITY_API_TOKEN']

if (!projectId || !token) {
  console.error('Missing SANITY_PROJECT_ID or SANITY_API_TOKEN in .env')
  process.exit(1)
}

const args     = process.argv.slice(2)
const dryRun   = args.includes('--dry-run')
const replace  = args.includes('--replace')
const filePath = args.find(a => !a.startsWith('--'))

if (!filePath) {
  console.error('Usage: npx tsx scripts/seed-emma-presets.ts <path-to-json> [--dry-run] [--replace]')
  process.exit(1)
}

interface PresetInput {
  label:         string
  slug:          string | { current: string; _type?: string }
  narratorCopy?: string
  moodTags?:     string[]
  audienceTags?: string[]
  mattersTags?:  string[]
  priceMax?:     number | null
  featured?:     boolean
  order?:        number
}

const raw = readFileSync(resolve(filePath), 'utf8')
const parsed = JSON.parse(raw)
const presets: PresetInput[] = Array.isArray(parsed)
  ? parsed
  : Array.isArray(parsed.presets)
    ? parsed.presets
    : []

if (presets.length === 0) {
  console.error(`No presets found in ${filePath}. Expected a JSON array or { presets: [...] }.`)
  process.exit(1)
}

function getSlug(p: PresetInput): string {
  if (typeof p.slug === 'string')                   return p.slug
  if (p.slug && typeof p.slug.current === 'string') return p.slug.current
  throw new Error(`Preset "${p.label}" has no usable slug`)
}

const docs = presets.map((p, i) => {
  const slug = getSlug(p)
  if (!slug) throw new Error(`Preset at index ${i} ("${p.label}") missing slug`)
  if (!p.label) throw new Error(`Preset at index ${i} missing label`)
  const hasFilter =
    (p.moodTags?.length ?? 0)     > 0 ||
    (p.audienceTags?.length ?? 0) > 0 ||
    (p.mattersTags?.length ?? 0)  > 0 ||
    (p.priceMax != null)
  if (!hasFilter) {
    throw new Error(`Preset "${p.label}" has no filters — nothing to apply`)
  }

  return {
    _id:    `emmaPreset.${slug}`,
    _type:  'emmaPreset',
    label:  p.label,
    slug:   { _type: 'slug', current: slug },
    ...(p.narratorCopy ? { narratorCopy: p.narratorCopy } : {}),
    ...(p.moodTags?.length     ? { moodTags:     p.moodTags     } : {}),
    ...(p.audienceTags?.length ? { audienceTags: p.audienceTags } : {}),
    ...(p.mattersTags?.length  ? { mattersTags:  p.mattersTags  } : {}),
    ...(p.priceMax != null     ? { priceMax:     p.priceMax     } : {}),
    featured: p.featured !== false,
    order:    typeof p.order === 'number' ? p.order : i,
  }
})

console.log(`Loaded ${docs.length} presets from ${filePath}`)
docs.forEach(d => {
  const filters = [
    d.moodTags     && `mood:${d.moodTags.length}`,
    d.audienceTags && `audience:${d.audienceTags.length}`,
    d.mattersTags  && `matters:${d.mattersTags.length}`,
    d.priceMax != null && `≤$${d.priceMax}`,
  ].filter(Boolean).join(' · ')
  console.log(`  [${d.order}] ${d.label}  (${filters})`)
})

if (dryRun) {
  console.log('\n--dry-run: nothing written.')
  process.exit(0)
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-10-01',
  useCdn: false,
  token,
})

if (replace) {
  const incomingIds = new Set(docs.map(d => d._id))
  const existing = await client.fetch<{ _id: string }[]>(
    `*[_type == "emmaPreset"]{ _id }`,
  )
  const stale = existing.filter(e => !incomingIds.has(e._id))
  if (stale.length > 0) {
    console.log(`\n--replace: deleting ${stale.length} stale preset(s):`)
    const tx = client.transaction()
    for (const s of stale) {
      console.log(`  - ${s._id}`)
      tx.delete(s._id)
    }
    await tx.commit()
  }
}

const tx = client.transaction()
for (const d of docs) tx.createOrReplace(d)
const res = await tx.commit()
console.log(`\n✓ Wrote ${docs.length} preset(s) in transaction ${res.transactionId}`)
