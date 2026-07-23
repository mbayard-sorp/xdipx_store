/**
 * Seed the friends-of-Emma cast into Sanity from reviewed portrait files.
 *
 * Uploads one chosen portrait per character and createOrReplaces a castMember
 * document (deterministic _id, so re-running is idempotent). Docs are seeded
 * active:true, approvedForUse:FALSE — the owner flips approvedForUse per face
 * in the Studio, which is the governance gate before any face is used in a
 * video.
 *
 * Usage: npx tsx scripts/seed-cast-members.ts --dir <portrait-dir>
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env' })
loadEnv({ path: '.env.local' })

interface CastSeed {
  slug: string
  name: string
  role: string
  look: string        // which portrait file (friend-{slug}-{look}.jpg)
  photoAlt: string
  shortBio: string
  personaNotes: string
}

const CAST: CastSeed[] = [
  {
    slug: 'maya', name: 'Maya', role: 'Friend of Emma', look: 'look1',
    photoAlt: 'Maya, a Black woman with natural curls and a warm smile, in soft daylight',
    shortBio: 'The friend who makes everyone comfortable. Warm, playful, quick to put you at ease.',
    personaNotes: 'Warm and playful energy; the reassuring one. Wardrobe: soft elevated loungewear, warm tones. Good for unboxing and myth-busting formats.',
  },
  {
    slug: 'sofia', name: 'Sofia', role: 'Friend of Emma', look: 'look1',
    photoAlt: 'Sofia, a Latina woman with long dark waves and confident eyes, in soft daylight',
    shortBio: 'Bold and direct. Says the thing everyone is thinking, without flinching.',
    personaNotes: 'Confident, direct energy. Wardrobe: sleek, a touch dramatic. Good for hook-problem-payoff and three-things formats.',
  },
  {
    slug: 'jade', name: 'Jade', role: 'Friend of Emma', look: 'look2',
    photoAlt: 'Jade, an East Asian woman with a sleek bob and a serene expression, in soft daylight',
    shortBio: 'Calm and quietly magnetic. Minimalist taste, unhurried delivery.',
    personaNotes: 'Serene, minimal, quietly magnetic. Wardrobe: clean lines, muted palette. Good for before-after mood and ASMR unboxing.',
  },
  {
    slug: 'priya', name: 'Priya', role: 'Friend of Emma', look: 'look1',
    photoAlt: 'Priya, a South Asian woman with long dark hair and a bright, witty smile, in soft daylight',
    shortBio: 'Witty and warm, quick to laugh. Makes the practical feel fun.',
    personaNotes: 'Witty, bright, quick to laugh. Wardrobe: playful but elevated. Good for three-things and GRWM formats.',
  },
  {
    slug: 'marcus', name: 'Marcus', role: 'Friend of Emma', look: 'look1',
    photoAlt: 'Marcus, a handsome Black man with a short beard and an easy smile, in soft daylight',
    shortBio: 'Relaxed and charming, effortlessly confident. The steady, easygoing presence.',
    personaNotes: 'Relaxed, charming, effortless. Wardrobe: elevated casual. Good for hook-problem-payoff and myth-busting.',
  },
  {
    slug: 'diego', name: 'Diego', role: 'Friend of Emma', look: 'look1',
    photoAlt: 'Diego, a handsome Latino man with swept-back hair and a polished grin, in soft daylight',
    shortBio: 'Polished and magnetic, a little flirtatious. Draws the eye and holds it.',
    personaNotes: 'Polished, flirtatious, magnetic. Wardrobe: sharp, put-together. Good for before-after and date-night GRWM.',
  },
]

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dirIdx = args.indexOf('--dir')
  if (dirIdx < 0) throw new Error('Pass --dir <portrait-dir>')
  const dir = args[dirIdx + 1]!

  const { uploadBufferToSanity, sanityImageRef } = await import('../app/lib/sanity.server')
  const { createClient } = await import('@sanity/client')
  const client = createClient({
    projectId: process.env['SANITY_PROJECT_ID']!,
    dataset: process.env['SANITY_DATASET'] || 'production',
    apiVersion: '2024-10-01',
    token: process.env['SANITY_WRITE_TOKEN'] || process.env['SANITY_API_TOKEN'],
    useCdn: false,
  })

  for (const c of CAST) {
    const file = join(dir, `friend-${c.slug}-${c.look}.jpg`)
    const buffer = readFileSync(file)
    const { assetId } = await uploadBufferToSanity(buffer, `friend-${c.slug}.jpg`, 'image/jpeg')
    const doc = {
      _id: `castMember.${c.slug}`,
      _type: 'castMember',
      name: c.name,
      slug: { _type: 'slug', current: c.slug },
      role: c.role,
      referencePhoto: sanityImageRef(assetId, c.photoAlt),
      photoAlt: c.photoAlt,
      shortBio: c.shortBio,
      personaNotes: c.personaNotes,
      active: true,
      approvedForUse: false,
    }
    await client.createOrReplace(doc)
    console.log(`seeded castMember.${c.slug} (${c.name}, ${c.look}) — active, approvedForUse:false`)
  }

  console.log(`\nDone. ${CAST.length} cast members in Sanity. Toggle "Approved for use" per face in the Studio to make them usable by the pipeline.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
