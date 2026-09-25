/**
 * Casting call, part 3 — candidate EDITORIAL references (ticket #10838,
 * closing the data gap ticket #2751 opened and never filled).
 *
 * Why this exists: `studio/schemas/castMemberEditorialFields.js` (ticket
 * #2751) added `castMember.editorialPhoto` because the video-register
 * `referencePhoto`'s wardrobe propagates into every Notebook §0-H composited
 * frame (docs/media-model-routing.md: Maya's deep-V referencePhoto carried
 * its neckline into frames briefed as elevated loungewear). The §0-H
 * compositing path already reads `editorialPhoto ?? referencePhoto`
 * (docs/notebook-team/image-brief.md), but as of 2026-09-22 all 8 approved
 * cast members have `editorialPhoto` null, so the fallback has never once
 * selected an editorial reference and every human hero still inherits
 * video-register wardrobe. This script produces the candidates that close
 * that gap.
 *
 * **Generated FROM each member's approved referencePhoto, never from a
 * description**, same identity-anchoring approach as
 * `generate-cast-body-references.ts`: passing `refImageUrl` routes to
 * `bytedance/seedream-v4.5/edit` so the candidate inherits the real
 * person's face and build instead of the model's guess. The prompt below
 * deliberately says nothing about who the person is, only framing, wardrobe
 * and ground.
 *
 * **Register, per the schema comment and image-brief.md §0-H:** crew-neck,
 * waist-up, plain coral-soft-or-plum-soft-tinted ground. Nothing else about
 * the video-register photo changes — same identity, same general styling
 * energy, just a modest top and a plain editorial backdrop instead of
 * whatever wardrobe/setting the presenting reference carries. Ground colors
 * are described in plain language rather than as brand token names: the
 * body-reference script's round 1 found a token name like "plum-soft"
 * renders as its literal saturated reading (a saturated mauve wall came
 * back for "plum-soft"), so this uses the same "very pale desaturated
 * lilac" / "very pale warm peach-pink" phrasing instead.
 *
 * NOTHING is uploaded to Sanity here, exactly as in the casting-call and
 * body-reference scripts before it. Candidates are written to --out for the
 * owner's review; the one picked per member is uploaded to
 * `castMember.editorialPhoto` by hand. This ticket's own text states no new
 * likeness decision is needed (the cast are already approved, only the
 * wardrobe register changes), but publishing a new photorealistic reference
 * of an established persona across every §0-H Notebook hero is still a
 * one-way door once it starts anchoring compositions, so it follows the
 * established review gate rather than skipping it.
 *
 * Usage:
 *   npx tsx scripts/generate-cast-editorial-references.ts --out /tmp/cast-editorial
 *   npx tsx scripts/generate-cast-editorial-references.ts --looks 3 --only maya,marcus
 *   npx tsx scripts/generate-cast-editorial-references.ts --dry-run
 *
 * Cost: $0.036/image (atlas/seedream-4.5-edit). Eight members x 2 looks is
 * about $0.58, logged to api_token_log under feature 'video-cast'.
 *
 * Requires ATLAS_CLOUD_API_KEY and a Sanity read token. The roster is read
 * live from Sanity (`getApprovedCastMembers`, which already returns
 * `editorialPhotoUrl`), so a member who already has one is skipped by
 * default; pass --force to regenerate anyway.
 */
import 'dotenv/config'

interface Candidate {
  slug: string
  name: string
  referencePhotoUrl: string
}

/**
 * Alternates the two brand-tinted grounds across the roster (index order,
 * not per-member pinned) so eight candidates do not all read as one
 * backdrop. Named in plain language, not as brand tokens — see the module
 * comment on why a literal token name renders wrong.
 */
const GROUNDS = [
  'a very pale warm peach-pink, almost white',
  'a very pale desaturated lilac, almost white',
]

function groundFor(index: number): string {
  return GROUNDS[index % GROUNDS.length]!
}

/**
 * Framing, wardrobe and ground only; nothing about who the person is, for
 * the same reason `generate-cast-body-references.ts` says nothing about it:
 * competing with the reference image on identity is what drifts a face.
 *
 * "Waist-up framing, room on both sides of the subject" is lifted verbatim
 * from image-brief.md §0-H's own instruction for guide-mode camera
 * distance, so this reference anchors compositing at the same distance
 * §0-H already asks for.
 */
function buildEditorialPrompt(ground: string): string {
  return (
    'Keep this exact person: the same face, skin tone, hair and build. ' +
    'Photorealistic editorial portrait photograph of the same adult person, ' +
    'with adult facial maturity and adult proportions throughout. ' +
    'Waist-up framing, room on both sides of the subject, facing the camera, ' +
    'shoulders relaxed and square, a natural unposed stance. ' +
    'Wearing a plain solid-color crew-neck top with a modest round neckline, ' +
    'nothing plunging, sheer, or strapless, sleeves of any length. ' +
    `Plain seamless backdrop in ${ground}, filling the whole frame behind the subject, ` +
    'no texture, no pattern, no window, no furniture, no props. ' +
    'Flat shadowless studio light, soft and directionless, no direct sun, no hard cast shadows. ' +
    'Relaxed natural expression, a soft close-mouthed smile or calm neutral look, not a wide grin, not posed stiffly. ' +
    'Natural unretouched skin texture, true undistorted anatomy, correct hands with five fingers each if visible. ' +
    'Clinical, plain and evenly lit, like an editorial headshot reference. ' +
    'nothing youthful, adolescent or childlike in the face or the body, ' +
    'no jewelry beyond what the reference already shows, no product, ' +
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

  const outDir = arg('--out') ?? '/tmp/cast-editorial-references'
  const looksRaw = Number(arg('--looks') ?? 2)
  const looks = Math.min(Math.max(1, Number.isFinite(looksRaw) ? looksRaw : 2), 4)
  const onlyRaw = arg('--only')
  const only = onlyRaw ? new Set(onlyRaw.split(',').map(s => s.trim()).filter(Boolean)) : null
  const dryRun = process.argv.includes('--dry-run')
  const force = process.argv.includes('--force')

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
      if (!m.photoUrl) {
        console.warn(`  skip ${m.slug}: no referencePhoto to anchor identity to`)
        return false
      }
      if (m.editorialPhotoUrl && !force) {
        console.warn(`  skip ${m.slug}: editorialPhoto already set (--force to regenerate)`)
        return false
      }
      return true
    })
    .map(m => ({
      slug: m.slug,
      name: m.name,
      referencePhotoUrl: m.photoUrl,
    }))

  if (only) {
    for (const slug of only) {
      if (!candidates.some(c => c.slug === slug)) {
        console.warn(`  --only "${slug}" matched no approved cast member needing an editorial reference`)
      }
    }
  }

  const images = candidates.length * looks
  console.log(
    `Editorial reference call: ${candidates.length} cast member(s) x ${looks} look(s) = ${images} image(s), ` +
    `about $${(images * 0.036).toFixed(2)} -> ${outDir}`,
  )
  console.log(`Roster read from Sanity: ${roster.length} approved.\n`)

  if (dryRun) {
    console.log('--dry-run: nothing generated. Prompt(s) that would be sent:\n')
    for (let i = 0; i < GROUNDS.length; i++) {
      console.log(`--- ground ${i + 1} ---`)
      console.log(buildEditorialPrompt(groundFor(i)))
      console.log('')
    }
    console.log('Anchored per member to:')
    candidates.forEach((c, i) => console.log(`  ${c.name.padEnd(8)} ground=${groundFor(i)} ref=${c.referencePhotoUrl}`))
    return
  }

  const { atlasGenerate, atlasConfigured } = await import('../app/lib/atlas.server')
  const { logImageCost } = await import('../app/lib/token-log.server')
  if (!atlasConfigured()) throw new Error('ATLAS_CLOUD_API_KEY is not configured')

  mkdirSync(outDir, { recursive: true })

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    const ground = groundFor(i)
    const { buffers, costKey } = await atlasGenerate({
      prompt: buildEditorialPrompt(ground),
      refImageUrl: c.referencePhotoUrl,
      count: looks,
      imageSize: 'portrait_4_3',
      telemetry: { feature: 'video-cast', caller: 'scripts/generate-cast-editorial-references' },
    })
    buffers.forEach((buf, look) => {
      const file = join(outDir, `editorial-${c.slug}-look${look + 1}.jpg`)
      writeFileSync(file, buf)
      console.log(`  ${c.name}: ${file}`)
    })
    await logImageCost({
      feature: 'video-cast',
      model: costKey,
      count: buffers.length,
      caller: 'scripts/generate-cast-editorial-references',
      refId: `cast-editorial-${c.slug}`,
    })
  }

  console.log(
    '\nDone. Review the candidates. Every one still needs a human pass before it is uploaded:\n' +
    '  - nothing age-ambiguous; a reference that reads young anchors nothing shippable;\n' +
    '  - the top is genuinely modest (crew-neck, not plunging or sheer) so the register\n' +
    '    actually differs from the video-register referencePhoto it exists to replace;\n' +
    '  - correct anatomy, no uncanny face, no merged or duplicated features;\n' +
    "  - the face and build actually match that member's portrait.\n" +
    'Upload the chosen look to castMember.editorialPhoto in Sanity Studio.\n' +
    'Re-run `*[_type==\'castMember\' && approvedForUse==true && !defined(editorialPhoto)]` ' +
    'after each upload; DONE WHEN this ticket cites is 0 remaining.',
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
