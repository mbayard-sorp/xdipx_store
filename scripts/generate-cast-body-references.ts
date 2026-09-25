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
 * are evenly lit, plainly framed, unoccluded frames whose job is to establish
 * skin tone, body hair, and any tattoos or jewellery that serve as adult
 * identity markers. The charge belongs in the post brief (§3.2b/§3.2c), never
 * baked into the anchor -- and neither does an occluder, which is why the arms
 * hang clear of the torso rather than crossing it.
 *
 * The frame runs head to mid-thigh and shows the pubic mound, because §3.2a's
 * owner ceiling licenses the mound and a little hair in published frames and an
 * anchor has to reach the ceiling it anchors. It stops hard short of labia,
 * vulva or any genital detail: `genitaliaAbsent` in
 * `app/lib/social-vision-gate.server.ts` fails a frame on exactly that and
 * `social-publish-gate.server.ts` blocks a failed verdict, so a reference
 * carrying it could anchor nothing that ships.
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
 *   npx tsx scripts/generate-cast-body-references.ts --only diego --variant male
 *
 * The female and male prompts differ in exactly one licensed zone (§3.2a: the
 * mound is visible on a woman, the groin is covered on a man) and the variant
 * is resolved per member from the roster description, printed before spend.
 * `--variant` forces it for the whole run.
 *
 * Cost: $0.036/image (atlas/seedream-4.5-edit). Eight members x 3 looks is
 * about $0.86, logged to api_token_log under feature 'video-cast'.
 *
 * Requires ATLAS_CLOUD_API_KEY and a Sanity read token. The roster is read
 * live from Sanity rather than hardcoded: the list in
 * `generate-cast-candidates.ts` still says six and there are eight.
 */
import 'dotenv/config'

/**
 * Which ceiling the member's prompt is written to. §3.2a licenses different
 * things for women and men, in the owner's own words: for a woman "the pubic
 * mound and a little pubic hair is visible above the line", for a man "Penis:
 * not shown, but all other parts of a man are fine". So the male reference is
 * bare to the same degree everywhere except the groin, which the towel covers
 * outright. It is the same frame, the same light and the same ground; only the
 * one licensed zone differs.
 */
type BodyVariant = 'female' | 'male'

interface Candidate {
  slug: string
  name: string
  referencePhotoUrl: string
  variant: BodyVariant
}

/**
 * Resolve the variant from the roster row rather than a hardcoded slug list,
 * because the roster is read live and a hardcoded list is exactly what went
 * stale in `generate-cast-candidates.ts` (it still says six; there are eight).
 *
 * `castMember` carries no gender field, so this reads the `description` the
 * schema already requires for deliberate casting ("Latino man presenting late
 * 20s", "Black woman presenting early 30s"). The `\bman` boundary is load
 * bearing and easy to "fix" wrongly: in "woman presenting" the `m` is preceded
 * by `o`, a word character, so there is no word boundary and it does NOT match.
 * Do not relax it to /man presenting/ — that matches every woman on the roster.
 *
 * Anything it cannot read as male gets the female prompt, and the resolved
 * variant is printed per member on every run so a misread is visible before
 * money is spent rather than after. `--variant` overrides it outright.
 */
function resolveVariant(description: string | null, override: BodyVariant | null): BodyVariant {
  if (override) return override
  return description && /\bman presenting\b/i.test(description) ? 'male' : 'female'
}

/**
 * Framing, light and ground only. Nothing about who the person is: that comes
 * from the reference image, and competing with it is what drifts a face.
 *
 * Every clause here is doing work that §3.2c's measured findings, and three
 * rounds of candidates, demand:
 *   - Describes what FILLS the frame and what CLOSES its edges, never what is
 *     excluded. Describing the exclusion produced a nude wide shot in every
 *     attempt tested.
 *   - Closes the lower edge with a folded towel, an INANIMATE closer, which
 *     held in 5 of 5 frames. A limb described by region held in 0 of 4, so the
 *     thighs are given an action ("pressed together") rather than a region.
 *   - **Arms hang straight down, clear of the torso.** Round 2 crossed them
 *     tight and high across the chest, and the crossed forearms baked a
 *     permanent occluder into the anchor: every on-skin frame built from it
 *     would inherit an arm over the sternum, which is precisely the bare
 *     contact zone §3.2b names as ceiling. An anchor must not pre-occlude the
 *     thing the posts are for. Arms down leaves the chest and ribs
 *     unobstructed and lets the crop, the pose, a hand or the product do the
 *     occluding per frame, where §3.2a puts that decision.
 *   - **The whole head and face are in frame.** Round 2 asked for a neck-down
 *     crop and got a face anyway in half the candidates: "no face in the
 *     frame" fought the reference image, which is a portrait, and the
 *     reference won. Asking for the face outright stops that fight and costs
 *     nothing. The anchor's job is skin tone, body hair and build, and a
 *     visible face makes the identity match verifiable at a glance.
 *   - **The pubic mound and a little natural pubic hair are visible.** The
 *     owner's 2026-08-22 ceiling, quoted verbatim in §3.2a, licenses exactly
 *     that in published frames, so an anchor that stopped at the hip line
 *     could not anchor a frame that goes where the ceiling already allows.
 *     Round 4 showed the hair needs a BOUNDARY as well as a licence: asked for
 *     plainly, the patch rendered spilling off the mound onto the outer thigh
 *     (owner review, 2026-09-20). So it is specified as a small neat triangle
 *     confined to the mound and stopping at the thigh crease, with smooth bare
 *     thighs named positively -- the same fills-and-closes discipline the rest
 *     of this prompt uses, applied to the hair.
 *   - **No labia, vulva, cleft or genital detail, thighs closed throughout.**
 *     Mechanical rather than editorial: §3.2a's stop list is "labia visible or
 *     outlined", `genitaliaAbsent` in `app/lib/social-vision-gate.server.ts`
 *     fails a frame on exactly that, and `social-publish-gate.server.ts` blocks
 *     a failed verdict. Nothing containing it can ever publish, so a reference
 *     containing it anchors nothing shippable. Mound visible and labia not IS
 *     the published ceiling. Do not widen this line here.
 *   - **Names adulthood outright, the one deliberate exception to "say nothing
 *     about the person".** Round 5 ran the four female friends: Sofia, Vivian
 *     and Emma passed, and all three of Jade's candidates read materially
 *     younger than her persona and were rejected. Her portrait is the only age
 *     signal the call has, and for her it does not carry. The exception is
 *     justified on the same mechanical ground as the labia clause rather than
 *     on taste: clause (b) is judged on ambiguity, `social-vision-gate.server.ts`
 *     fails an age-ambiguous frame, and a reference that reads ambiguous
 *     anchors nothing shippable. Adult proportions are stated positively and
 *     youthful or adolescent features are named in the negatives. This
 *     describes a floor, never a look, and never a specific age: the
 *     reference image still owns identity.
 *     **It did not fix Jade, and it was never going to.** Re-running her with
 *     this clause produced three more candidates that read exactly as young as
 *     the first three, with near-identical faces across all six. That is §3.2a
 *     working as documented: identity comes from the reference photo, apparent
 *     age is part of identity, and prompt text does not override it. Do not
 *     retry this by sharpening the wording. The clause stays as a floor for
 *     members whose portraits already carry adulthood, and Jade's fix is
 *     upstream, in her `referencePhoto` (and in `ageRange`, which reads
 *     "early 30s" against an owner who says 25), not here.
 *   - Seated upright, never supine-from-above, which shared the composition of
 *     6 of 6 fence breaches on breast-in-frame briefs.
 *   - Names jewellery, the cheapest adult identity marker available and one
 *     the owner has licensed, because clause (b) is judged on ambiguity.
 *   - Says "a very pale desaturated lilac, almost white", never "plum-soft":
 *     a brand token name renders as its literal saturated reading, and round 1
 *     came back with a saturated mauve wall. Same failure class as the standing
 *     ban on the word "paper", which put literal sheets of paper in 4 of 7
 *     frames.
 */
function buildBodyPrompt(variant: BodyVariant = 'female'): string {
  const male = variant === 'male'

  // The one clause that differs, and the reason the variants exist at all.
  // Female: the mound is named as visible, because §3.2a licenses it and an
  // anchor has to reach the ceiling it anchors. Male: the groin is covered
  // outright, because §3.2a licenses "all other parts of a man" and nothing
  // below that line, so there is no ceiling there for a reference to reach.
  const licensedZone = male
    ? 'The stomach, hip hollows and the line of the lower stomach are visible, ' +
      'with natural chest and stomach hair as it grows on him; ' +
      'a folded cream linen towel is laid flat across the lap and covers the groin completely, ' +
      'and it closes the bottom edge of the frame at mid-thigh. '
    : 'The stomach, hip hollows and pubic mound are visible, with a little natural pubic hair ' +
      'as a small neat triangle confined to the mound itself, stopping at the crease of each thigh; ' +
      'the thighs and legs are smooth and bare with no hair on them anywhere. ' +
      'The closed thighs conceal everything below the mound, and a folded cream linen towel laid flat on the bench ' +
      'closes the bottom edge of the frame at mid-thigh. '

  const stopList = male
    ? 'No genitals of any kind, no penis, no scrotum, no groin and no pubic area visible at any point, ' +
      'the towel never lifts or parts, thighs closed throughout, '
    : 'No labia visible or outlined, no vulva, no cleft, no genital detail of any kind, thighs closed throughout, ' +
      'no pubic hair on the thighs or legs, no stray or floating hair off the mound, '

  return (
    'Keep this exact person: the same skin tone, body hair, and body. ' +
    `Photorealistic anatomical body reference photograph of a fully adult ${male ? 'man' : 'woman'}, ` +
    'with adult facial maturity and adult body proportions throughout. ' +
    'The frame is filled by the head, face, collarbones, chest, ribs, waist and hips of the same person, ' +
    'seated upright and square to the camera on a plain pale oak bench; ' +
    'the whole head and face are visible and the knees close the bottom edge. ' +
    'Bare, with no clothing anywhere in the picture, a fine gold chain at the throat' +
    (male ? '. ' : ' and a fine gold bangle at one wrist. ') +
    `Both arms hang straight down at ${male ? 'his' : 'her'} sides, relaxed, well clear of the torso, ` +
    'so the chest and ribs are unobstructed. ' +
    'Knees and thighs pressed together and angled slightly to one side. ' +
    licensedZone +
    'Flat shadowless overcast studio light, soft and directionless, no direct sun, no window in frame, no cast shadows. ' +
    'Plain wall behind in a very pale desaturated lilac, almost white. ' +
    'Relaxed neutral expression, mouth closed, not smiling, not posed, looking straight ahead. ' +
    'Natural unretouched skin texture, true undistorted anatomy, correct hands with five fingers each, ' +
    'one navel on the front only. Clinical, plain and evenly lit, like a wardrobe fitting reference. ' +
    stopList +
    'nothing youthful, adolescent or childlike in the face or the body, ' +
    'no product, no furniture clutter, ' +
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

  const variantRaw = arg('--variant')
  if (variantRaw && variantRaw !== 'female' && variantRaw !== 'male') {
    throw new Error(`--variant must be "female" or "male", got "${variantRaw}"`)
  }
  const variantOverride = (variantRaw ?? null) as BodyVariant | null

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
    .map(m => ({
      slug: m.slug,
      name: m.name,
      referencePhotoUrl: m.photoUrl,
      variant: resolveVariant(m.description, variantOverride),
    }))

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

  // Print the resolved variant BEFORE any spend, so a misread of the roster
  // description is caught by eye rather than by looking at the wrong ceiling
  // in a finished image.
  console.log('Prompt variant per member:')
  for (const c of candidates) {
    console.log(`  ${c.name.padEnd(8)} ${c.variant}${variantOverride ? ' (--variant override)' : ''}`)
  }
  console.log('')

  if (dryRun) {
    console.log('--dry-run: nothing generated. Prompt(s) that would be sent:\n')
    for (const variant of [...new Set(candidates.map(c => c.variant))]) {
      console.log(`--- ${variant} ---`)
      console.log(buildBodyPrompt(variant))
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
    const { buffers, costKey } = await atlasGenerate({
      prompt: buildBodyPrompt(c.variant),
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
    '  - nothing age-ambiguous; a reference that reads young anchors nothing shippable;\n' +
    '  - women: no labia, no vulva, no cleft visible or outlined. The pubic mound may\n' +
    '    show, per the §3.2a ceiling, and anything below it may not;\n' +
    '  - men: no genitals at all. §3.2a licenses every other part of a man and nothing\n' +
    '    below that line, so the towel must cover the groin completely;\n' +
    '  - arms genuinely down and clear of the torso, so the anchor pre-occludes nothing;\n' +
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
