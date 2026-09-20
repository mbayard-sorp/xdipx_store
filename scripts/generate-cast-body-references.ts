/**
 * Casting call, part 2 — candidate BODY references for the on-skin register.
 *
 * Why this exists: `instagram-campaigns.md` §3.7 clause (a) requires an
 * on-skin macro/close crop to be generated from the cast member's approved
 * BODY reference, because a frame of a hip or a sternum carries no face for
 * the portrait `referencePhoto` to anchor to. As of 2026-09-20
 * `bodyReferencePhoto` is null on all eight approved cast members, so the
 * whole on-skin treatment is blocked: `presenterPhotoUrlForCrop` falls back to
 * the portrait, the model invents everything below the neck including skin
 * tone, and nothing warns. This script produces the candidates that close it.
 *
 * Provider: Atlas Cloud (owner direction, 2026-09-20), which has been the
 * primary still-image provider since 2026-08-15. `generate-cast-candidates.ts`
 * still calls fal only because it predates that migration and was never moved.
 *
 * **Generated FROM each member's approved portrait, never from a description.**
 * Passing `refImageUrl` routes to `bytedance/seedream-v4.5/edit`, so the
 * candidate inherits the real person's skin tone, build and hair instead of
 * the model's guess at a text description. §3.2a is explicit that identity
 * comes from the reference photo and never from the prompt, and that adding
 * appearance words on top of a reference is the second most common way
 * identity breaks -- so the prompt below deliberately describes framing,
 * light and ground, and says nothing about who the person is.
 *
 * **A reference is neutral, not a ceiling frame.** This is the lesson the
 * schema comment on `editorialPhoto` already records: the video-register
 * `referencePhoto`'s wardrobe propagates into every composited frame built
 * from it. Whatever styling, charge or mood lands in a body reference will
 * propagate the same way into every on-skin post generated from it. So these
 * are evenly lit, plainly framed, neck-down frames whose job is to establish
 * skin tone, body hair, and any tattoos or jewellery that serve as adult
 * identity markers. The charge belongs in the post brief (§3.2b/§3.2c), never
 * baked into the anchor.
 *
 * NOTHING is uploaded to Sanity here, exactly as in the original casting call.
 * Candidates are written to --out for the owner's review; the one he picks per
 * member is uploaded to `castMember.bodyReferencePhoto` and his sign-off is
 * tracked on the owner blocker list rather than as a Sanity boolean (see
 * `studio/schemas/castMemberBodyFields.js`).
 *
 * Usage:
 *   npx tsx scripts/generate-cast-body-references.ts --out /tmp/cast-body
 *   npx tsx scripts/generate-cast-body-references.ts --looks 3 --only maya,marcus
 *   npx tsx scripts/generate-cast-body-references.ts --dry-run
 *
 * Cost: $0.036/image (atlas/seedream-4.5-edit). Eight members x 3 looks is
 * about $0.86, logged to api_token_log under feature 'video-cast'.
 *
 * Requires ATLAS_CLOUD_API_KEY and a Sanity read token. The roster is read
 * live from Sanity rather than hardcoded: the list in
 * `generate-cast-candidates.ts` still says six and there are eight.
 */
import 'dotenv/config'

interface Candidate {
  slug: string
  name: string
  referencePhotoUrl: string
}

/**
 * Framing, light and ground only. Nothing about who the person is: that comes
 * from the reference image, and competing with it is what drifts a face.
 *
 * Every clause here is doing work that §3.2c's measured findings demand:
 *   - Describes what FILLS the frame and what CLOSES its edges, never what is
 *     excluded. Describing the exclusion produced a nude wide shot in every
 *     attempt tested.
 *   - Closes the lower edge with a folded sheet, an INANIMATE closer, which
 *     held in 5 of 5 frames. A limb described by region held in 0 of 4, so the
 *     arms are given an action ("crossed tight") rather than a region.
 *   - Seated upright, never supine-from-above, which shared the composition of
 *     6 of 6 fence breaches on breast-in-frame briefs.
 *   - Names jewellery, the cheapest adult identity marker available and one
 *     the owner has licensed, because clause (b) is judged on ambiguity.
 *   - Says "warm off-white linen", never "paper": the brand token name renders
 *     as literal sheets of paper (a prop in 4 of 7 frames before the ban).
 */
function buildBodyPrompt(): string {
  return (
    'Keep this exact person: the same skin tone, body hair, and body. ' +
    'Photorealistic anatomical body reference photograph. ' +
    'The frame is filled edge to edge by the collarbones, chest, ribs, waist and hips of the same person, ' +
    'seated upright and square to the camera on a plain pale oak bench; ' +
    'the chin and jaw close the top edge of the frame and the knees close the bottom edge. ' +
    'Bare, with no clothing anywhere in the picture, a fine gold chain at the throat and a fine gold bangle at one wrist. ' +
    'A folded cream linen towel is laid flat across the lap and closes the frame over the hips; ' +
    'both arms are crossed tight and high across the chest so the forearms press flat and cover the nipples completely. ' +
    'Flat shadowless overcast studio light, soft and directionless, no direct sun, no window in frame, no cast shadows. ' +
    'Plain wall behind in a very pale desaturated lilac, almost white. ' +
    'Relaxed neutral expression, mouth closed, not smiling, not posed, looking straight ahead. ' +
    'Natural unretouched skin texture, true undistorted anatomy, correct hands with five fingers each, ' +
    'one navel on the front only. Clinical, plain and evenly lit, like a wardrobe fitting reference. ' +
    'No face in the frame, no nipples, no areola, no genitals, no pubic area, no product, no furniture clutter, ' +
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

  const outDir = arg('--out') ?? '/tmp/cast-body-references'
  const looksRaw = Number(arg('--looks') ?? 3)
  const looks = Math.min(Math.max(1, Number.isFinite(looksRaw) ? looksRaw : 3), 4)
  const onlyRaw = arg('--only')
  const only = onlyRaw ? new Set(onlyRaw.split(',').map(s => s.trim()).filter(Boolean)) : null
  const dryRun = process.argv.includes('--dry-run')

  const { getApprovedCastMembers } = await import('../app/lib/sanity.server')
  const roster = await getApprovedCastMembers()

  if (!roster.length) {
    // The 2026-08-19 false zero: an unauthenticated read of this dataset
    // returns one of eight docs, and that partial read was reported as the
    // whole truth in three binding documents. Never treat empty as "none".
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

  const images = candidates.length * looks
  console.log(
    `Body reference call: ${candidates.length} cast member(s) x ${looks} look(s) = ${images} image(s), ` +
    `about $${(images * 0.036).toFixed(2)} -> ${outDir}`,
  )
  console.log(`Roster read from Sanity: ${roster.length} approved.\n`)

  if (dryRun) {
    console.log('--dry-run: nothing generated. Prompt that would be sent:\n')
    console.log(buildBodyPrompt())
    console.log('\nAnchored per member to:')
    for (const c of candidates) console.log(`  ${c.name.padEnd(8)} ${c.referencePhotoUrl}`)
    return
  }

  const { atlasGenerate, atlasConfigured } = await import('../app/lib/atlas.server')
  const { logImageCost } = await import('../app/lib/token-log.server')
  if (!atlasConfigured()) throw new Error('ATLAS_CLOUD_API_KEY is not configured')

  mkdirSync(outDir, { recursive: true })

  for (const c of candidates) {
    const { buffers, costKey } = await atlasGenerate({
      prompt: buildBodyPrompt(),
      refImageUrl: c.referencePhotoUrl,
      count: looks,
      imageSize: 'portrait_4_3',
      telemetry: { feature: 'video-cast', caller: 'scripts/generate-cast-body-references' },
    })
    buffers.forEach((buf, i) => {
      const file = join(outDir, `body-${c.slug}-look${i + 1}.jpg`)
      writeFileSync(file, buf)
      console.log(`  ${c.name}: ${file}`)
    })
    await logImageCost({
      feature: 'video-cast',
      model: costKey,
      count: buffers.length,
      caller: 'scripts/generate-cast-body-references',
      refId: `cast-body-${c.slug}`,
    })
  }

  console.log(
    '\nDone. Review the candidates. Every one still needs a human pass before it is uploaded:\n' +
    '  - no nipple, no areola, no genitals, no pubic area, nothing age-ambiguous;\n' +
    '  - correct anatomy, one navel on the front, no merged or duplicated limbs;\n' +
    "  - the skin tone and body actually match that member's portrait.\n" +
    'Upload the chosen look to castMember.bodyReferencePhoto and write skinToneNote beside it.\n' +
    'The Studio must be redeployed first (cd studio && npm run deploy): as of 2026-09-20 the\n' +
    'deployed schema does not carry the field, so there is nothing to upload into.',
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
