/**
 * Casting call, part 3 — candidate HAND references for the held-product register
 * (ticket #11476, supersedes #11464).
 *
 * Why this exists: a held contact mode (self-held, other-held, drawn) needs a
 * credible grip, and `bodyReferencePhoto` cannot supply one.
 * `generate-cast-body-references.ts`'s own header already records the reason:
 * the composite path EDITS that plate as a strong pose prior, and unlike a
 * face-down spine crop, a hand can never be pose-neutral. A briefed grip
 * built from the body plate alone came back with NO HAND IN FRAME AT ALL, or
 * the plate's own flat open palm surviving the edit regardless of the brief.
 * This script produces a SECOND, dedicated per-cast reference so a held frame
 * has a real hand to anchor a grip to instead of editing the seated plate.
 *
 * Provider: Atlas Cloud, same as the body-reference call. `refImageUrl` routes
 * to `bytedance/seedream-v4.5/edit` so the candidate inherits the real
 * person's skin tone and hand instead of the model's guess.
 *
 * Two poses per member, matching what #11475/#11476 asked for: a CLOSED GRIP
 * around a neutral cylindrical object (the shape a held product actually
 * needs) and an OPEN UPTURNED PALM (a second, unoccluded look at the same
 * hand). Same clinical style and background as the body plate on purpose:
 * `docs/store-team/instagram-campaigns.md` 3.2c's on-skin ceiling is judged
 * per member, not per reference type, so a hand reference that drifted in
 * light or ground would be a second, inconsistent anchor rather than a
 * companion to the first.
 *
 * NOTHING is uploaded to Sanity here, exactly like the body-reference call.
 * Candidates are written to --out for the owner's review; the one he picks
 * per member/pose is uploaded to `castMember.handReferencePhoto` (one field,
 * the grip look is the one the acceptance test in #11476 actually needs) and
 * his sign-off is tracked on the owner blocker list, not a Sanity boolean.
 *
 * Usage:
 *   npx tsx scripts/generate-cast-hand-references.ts --out /tmp/cast-hand
 *   npx tsx scripts/generate-cast-hand-references.ts --looks 2 --only maya,marcus
 *   npx tsx scripts/generate-cast-hand-references.ts --dry-run
 *   npx tsx scripts/generate-cast-hand-references.ts --pose grip --only diego
 *
 * Cost: $0.036/image (atlas/seedream-4.5-edit). Eight members x 2 poses x 2
 * looks is about $1.15, logged to api_token_log under feature 'video-cast'.
 *
 * Requires ATLAS_CLOUD_API_KEY and a Sanity read token. The roster is read
 * live from Sanity, same as the body-reference call, never hardcoded.
 */
import 'dotenv/config'

type HandPose = 'grip' | 'palm'
const HAND_POSES: readonly HandPose[] = ['grip', 'palm']

function isHandPose(v: string | undefined): v is HandPose {
  return v === 'grip' || v === 'palm'
}

interface Candidate {
  slug: string
  name: string
  referencePhotoUrl: string
}

/**
 * Framing, light and ground only, mirroring `generate-cast-body-references.ts`'s
 * own prompt discipline: never describes who the person is (that comes from
 * `refImageUrl`), never describes what is excluded, and closes the frame with
 * a named, inanimate object rather than a region.
 *
 * The neutral object is a plain matte cream ceramic cylinder about an inch
 * across and five inches long, carrying no product markings of any kind: the
 * composite path substitutes the real product in edit, so this reference's
 * only job is a believable hand shape around a cylindrical form, never a
 * specific product's silhouette.
 */
function buildHandPrompt(pose: HandPose): string {
  const action = pose === 'grip'
    ? 'The hand is closed in a relaxed but secure grip around a plain matte cream ceramic cylinder, ' +
      'about one inch across and five inches long, held upright at roughly chest height. ' +
      'All four fingers wrap around the front of the cylinder and the thumb rests over them, ' +
      'with no finger straying past the far edge of the object and no sixth digit or duplicated finger anywhere. '
    : 'The hand is open and relaxed with the palm turned upward and the fingers loosely spread, ' +
      'held at roughly chest height with nothing in it and nothing touching it. '

  return (
    'Keep this exact person: the same skin tone and hand. ' +
    'Photorealistic anatomical hand-and-forearm reference photograph of a fully adult person\'s hand, ' +
    'with adult proportions throughout. ' +
    'The frame is filled by one hand and the lower forearm only, with no face, torso, or other body part visible anywhere in the picture. ' +
    action +
    'Correct anatomy throughout: exactly five fingers, natural fingernails, no merged, duplicated, extra or missing digits, ' +
    'and no distortion at the wrist or knuckles. ' +
    'Flat shadowless overcast studio light, soft and directionless, no direct sun, no window in frame, no cast shadows. ' +
    'Plain wall behind in a very pale desaturated lilac, almost white, the same ground as a seated studio portrait. ' +
    'Natural unretouched skin texture, true undistorted anatomy. ' +
    'Clinical, plain and evenly lit, like a wardrobe fitting reference. ' +
    'No jewellery, no nail polish, no clothing or sleeve fabric in frame beyond the bare forearm, ' +
    'no product branding or markings of any kind on the object, ' +
    'no text, no words, no letters, no watermark, no logo, no legible branding.'
  )
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')

  const outDir = arg('--out') ?? '/tmp/cast-hand-references'
  const looksRaw = Number(arg('--looks') ?? 2)
  const looks = Math.min(Math.max(1, Number.isFinite(looksRaw) ? looksRaw : 2), 4)
  const onlyRaw = arg('--only')
  const only = onlyRaw ? new Set(onlyRaw.split(',').map(s => s.trim()).filter(Boolean)) : null
  const dryRun = process.argv.includes('--dry-run')

  const poseRaw = arg('--pose')
  if (poseRaw !== undefined && !isHandPose(poseRaw)) {
    throw new Error(`--pose must be "grip" or "palm", got "${poseRaw}"`)
  }
  const poses: readonly HandPose[] = poseRaw ? [poseRaw] : HAND_POSES

  const { getApprovedCastMembers } = await import('../app/lib/sanity.server')
  const roster = await getApprovedCastMembers()

  if (!roster.length) {
    // Same false-zero guard as generate-cast-body-references.ts: an
    // unauthenticated read of this dataset returns a partial roster, not an
    // empty one, and that partial read reached three binding documents once.
    throw new Error(
      'No approved cast members returned. Check SANITY_API_TOKEN is set and non-empty: ' +
      'an anonymous read of this dataset returns a partial roster, not an empty one.',
    )
  }

  const candidates: Candidate[] = roster
    .filter(m => !only || only.has(m.slug))
    .filter(m => {
      if (m.photoUrl) return true
      console.warn(`  skip ${m.slug}: no referencePhoto to anchor identity to`)
      return false
    })
    .map(m => ({ slug: m.slug, name: m.name, referencePhotoUrl: m.photoUrl }))

  if (only) {
    for (const slug of only) {
      if (!candidates.some(c => c.slug === slug)) {
        console.warn(`  --only "${slug}" matched no approved cast member`)
      }
    }
  }

  const images = candidates.length * poses.length * looks
  console.log(
    `Hand reference call: ${candidates.length} cast member(s) x ${poses.length} pose(s) x ${looks} look(s) ` +
    `= ${images} image(s), about $${(images * 0.036).toFixed(2)} -> ${outDir}`,
  )
  console.log(`Roster read from Sanity: ${roster.length} approved.\n`)

  if (dryRun) {
    console.log('--dry-run: nothing generated. Prompt(s) that would be sent:\n')
    for (const pose of poses) {
      console.log(`--- ${pose} ---`)
      console.log(buildHandPrompt(pose))
      console.log('')
    }
    console.log('Anchored per member to:')
    for (const c of candidates) console.log(`  ${c.name.padEnd(8)} ${c.referencePhotoUrl}`)
    return
  }

  const { atlasGenerate, atlasConfigured } = await import('../app/lib/atlas.server')
  const { logImageCost } = await import('../app/lib/token-log.server')
  if (!atlasConfigured()) throw new Error('ATLAS_CLOUD_API_KEY is not configured')

  mkdirSync(outDir, { recursive: true })

  for (const c of candidates) {
    for (const pose of poses) {
      const { buffers, costKey } = await atlasGenerate({
        prompt: buildHandPrompt(pose),
        refImageUrl: c.referencePhotoUrl,
        count: looks,
        imageSize: 'square_hd',
        telemetry: { feature: 'video-cast', caller: 'scripts/generate-cast-hand-references' },
      })
      buffers.forEach((buf, i) => {
        const file = join(outDir, `hand-${c.slug}-${pose}-look${i + 1}.jpg`)
        writeFileSync(file, buf)
        console.log(`  ${c.name} (${pose}): ${file}`)
      })
      await logImageCost({
        feature: 'video-cast',
        model: costKey,
        count: buffers.length,
        caller: 'scripts/generate-cast-hand-references',
        refId: `cast-hand-${c.slug}-${pose}`,
      })
    }
  }

  console.log(
    '\nDone. Review the candidates. Every one still needs a human pass before it is uploaded:\n' +
    '  - correct anatomy: exactly five fingers, no merged or duplicated digits, no distortion at the wrist;\n' +
    '  - the grip look actually wraps the cylinder, with no finger straying off the far edge;\n' +
    '  - no face, torso or other body part in frame, just the hand and lower forearm;\n' +
    "  - the skin tone actually matches that member's portrait;\n" +
    '  - same clinical light and ground as the body plate, nothing warmer, cooler or busier.\n' +
    'Upload the chosen grip look to castMember.handReferencePhoto.\n' +
    'The Studio must be redeployed first (cd studio && npm run deploy): the deployed schema does not\n' +
    'carry the field until then, so there is nothing to upload into.',
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
