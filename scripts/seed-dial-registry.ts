/**
 * Seed the Sanity dialRegistry singleton with the per-product-type starter
 * dial labels. Idempotent: uses createIfNotExists so re-runs do not clobber
 * editor revisions.
 *
 *   npx tsx scripts/seed-dial-registry.ts
 *
 * To force-overwrite the registry back to the starter set, pass --force.
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

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-10-01',
  useCdn: false,
  token,
})

const STARTER = {
  _id:   'singleton.dialRegistry',
  _type: 'dialRegistry',
  airPulsation: ['Intensity', 'Quietness', 'Softness', 'Suction strength', 'Buildup speed', 'Learning curve'],
  vibrator:     ['Intensity', 'Quietness', 'Pattern variety', 'Buildup speed', 'Battery life', 'Learning curve'],
  wand:         ['Intensity', 'Quietness', 'Reach', 'Grip comfort', 'Battery life', 'Cord/cordless'],
  lube:         ['Slipperiness', 'Longevity', 'Taste-safe', 'Body-safe', 'Tidy-up', 'Skin feel'],
  wear:         ['Fit', 'Softness', 'Washability', 'Discretion', 'Adjustability', 'Occasion'],
}

const force = process.argv.includes('--force')

if (force) {
  await client.createOrReplace(STARTER)
  console.log('  ↻ singleton.dialRegistry — overwritten with starter set')
} else {
  await client.createIfNotExists(STARTER)
  console.log('  ✓ singleton.dialRegistry — ensured (existing values kept)')
}
