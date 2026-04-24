/**
 * Seed the Sanity askEmmaVocabulary singleton with the starter mood / audience /
 * matters labels from the v2 Collection wireframe. Idempotent: uses
 * createIfNotExists so re-runs do not clobber editor revisions.
 *
 *   npx tsx scripts/seed-ask-emma-vocab.ts
 *
 * To force-overwrite the vocabulary back to the starter set, pass --force.
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
  _id:   'singleton.askEmmaVocabulary',
  _type: 'askEmmaVocabulary',
  mood:     ['slow-and-intimate', 'playful', 'adventurous', 'unhurried-solo'],
  audience: ['me', 'us', 'gift'],
  matters:  ['quiet', 'soft-touch', 'travel-size', 'first-time', 'waterproof', 'rechargeable', 'hands-free'],
}

const force = process.argv.includes('--force')

if (force) {
  await client.createOrReplace(STARTER)
  console.log('  ↻ singleton.askEmmaVocabulary — overwritten with starter set')
} else {
  await client.createIfNotExists(STARTER)
  console.log('  ✓ singleton.askEmmaVocabulary — ensured (existing values kept)')
}
