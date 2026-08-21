/**
 * Casting call — generate candidate portraits for the "friends of Emma" cast.
 *
 * Generates N candidate looks per proposed character via fal FLUX (dev tier),
 * doctrine-compliant (bright grounds, premium-campaign wardrobe, photoreal,
 * no text), and writes JPEGs to --out for the owner's review. NOTHING is
 * uploaded to Sanity here: approved looks are seeded as castMember docs (with
 * approvedForUse=true) only after the owner confirms each character, and
 * rejected looks are discarded.
 *
 * Usage:
 *   npx tsx scripts/generate-cast-candidates.ts --out /tmp/cast [--looks 2] [--only marcus,jade]
 *
 * Cost: ~$0.025/image (flux/dev) -> full 6-character x 2-look run ≈ $0.30,
 * logged to api_token_log under feature 'video-cast'.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env' })
loadEnv({ path: '.env.local' })

interface CastSpec {
  slug: string
  name: string
  look: string
  vibe: string
}

/**
 * The proposed cast: diverse across races, two men, per the owner's direction
 * (2026-07-22). First names only. Ages all clearly adult (late 20s to mid 30s).
 */
const CAST: CastSpec[] = [
  {
    slug: 'maya',
    name: 'Maya',
    look: 'a Black woman in her early 30s with natural curls and a warm, playful smile',
    vibe: 'warm, playful, the friend who makes everyone comfortable',
  },
  {
    slug: 'sofia',
    name: 'Sofia',
    look: 'a Latina woman in her late 20s with long dark waves and confident eyes',
    vibe: 'bold, confident, direct',
  },
  {
    slug: 'jade',
    name: 'Jade',
    look: 'an East Asian woman in her early 30s with a sleek bob and a serene, knowing expression',
    vibe: 'calm, minimal, quietly magnetic',
  },
  {
    slug: 'priya',
    name: 'Priya',
    look: 'a South Asian woman in her early 30s with long dark hair and a bright, witty smile',
    vibe: 'witty, warm, quick to laugh',
  },
  {
    slug: 'marcus',
    name: 'Marcus',
    look: 'a handsome Black man in his early 30s with a short beard, athletic build, and an easy charming smile',
    vibe: 'relaxed, charming, effortlessly confident',
  },
  {
    slug: 'diego',
    name: 'Diego',
    look: 'a handsome Latino man in his late 20s with dark swept-back hair, light stubble, and a polished, flirty grin',
    vibe: 'polished, flirtatious, magnetic',
  },
  // Added 2026-08-21 (owner direction): a cast member over 50 so midlife
  // Notebook topics can be cast honestly instead of borrowing a 30s face.
  {
    slug: 'vivian',
    name: 'Vivian',
    look: 'a radiant woman in her mid 50s with shoulder-length silver-streaked hair, gentle laugh lines, and a warm, assured smile',
    vibe: 'grounded, candid, unshockable, the friend who has seen it all and says the quiet part kindly',
  },
]

function buildPrompt(spec: CastSpec): string {
  return (
    `Photorealistic editorial portrait of ${spec.look}. ${spec.vibe} energy. ` +
    'Vertical three-quarter portrait framing, soft high-key daylight, clean white paper studio backdrop with a subtle warm coral tint. ' +
    'Elevated everyday loungewear, premium lingerie-campaign styling sensibility, fully clothed, tasteful. ' +
    'Sharp focus on the face, natural skin texture, warm approachable eye contact with the camera. ' +
    'No text, no words, no letters, no watermark, no logo, no jewelry with legible branding.'
  )
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const outIdx = args.indexOf('--out')
  const outDir = outIdx >= 0 ? args[outIdx + 1]! : '/tmp/cast-candidates'
  const looksIdx = args.indexOf('--looks')
  const looks = looksIdx >= 0 ? Math.min(Math.max(1, Number(args[looksIdx + 1])), 4) : 2
  const onlyIdx = args.indexOf('--only')
  const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1]!.split(',')) : null

  const { falGenerate, falConfigured } = await import('../app/lib/fal.server')
  const { logImageCost } = await import('../app/lib/token-log.server')
  if (!falConfigured()) throw new Error('FAL_KEY is not configured')

  mkdirSync(outDir, { recursive: true })
  const roster = CAST.filter(c => !only || only.has(c.slug))
  console.log(`Casting call: ${roster.length} characters x ${looks} looks -> ${outDir}`)

  for (const spec of roster) {
    const { buffers, costKey } = await falGenerate({
      prompt: buildPrompt(spec),
      count: looks,
      imageSize: 'portrait_16_9',
    })
    buffers.forEach((buf, i) => {
      const file = join(outDir, `friend-${spec.slug}-look${i + 1}.jpg`)
      writeFileSync(file, buf)
      console.log(`  ${spec.name}: ${file}`)
    })
    await logImageCost({
      feature: 'video-cast',
      model: costKey,
      count: buffers.length,
      caller: 'scripts/generate-cast-candidates',
      refId: `cast-${spec.slug}`,
    })
  }

  console.log('\nDone. Review the portraits; approved looks become Sanity castMember docs (approvedForUse=true).')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
