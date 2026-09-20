/**
 * Cast presenter-reference resolution for the social-image `cast` op
 * (ticket #10336).
 *
 * `presenterPhotoUrlForCrop` shipped with #10270 and `skinToneNote` was
 * fetched from Sanity, but neither reached a prompt: both API routes passed
 * `member.photoUrl` (the portrait) unconditionally. A macro or close crop
 * carries no face, so anchoring it to a portrait means the model invents
 * everything below the neck, including skin tone, under a named persona's
 * name. `scripts/gen-social-image.ts` gained a guard for that (PR #1233); this
 * module is the same decision made once, for the two routes.
 *
 * Difference from the CLI on purpose: the CLI REFUSES when a close crop has no
 * body reference, because a human is reading its stderr. A route cannot refuse
 * without blocking a whole scheduled run, so it generates from the portrait and
 * returns `bodyReferenceMissing: true` plus a warning the routine must surface.
 */
import { presenterPhotoUrlForCrop, type CastMember } from './sanity.server'
import { CROP_SCALES, isCropScaleValue, type CropScale } from './social-scene-vocab'

// Re-exported, not re-declared (ticket #10480). The crop scale is one of the
// four scene axes and its vocabulary now lives in `social-scene-vocab.ts`
// alongside the body zones and contact modes, so the generation route, the
// draft route, the rework parser and the mix report all classify against one
// list. A second hand-typed copy here is exactly the drift that let
// `hip_hollow` persist and match nothing.
export { CROP_SCALES }
export type { CropScale }

export function isCropScale(v: unknown): v is CropScale {
  return isCropScaleValue(v)
}

/** A macro or close crop is the on-skin case that needs the neck-down reference. */
export function needsBodyReference(cropScale: string | null | undefined): boolean {
  return cropScale === 'macro' || cropScale === 'close'
}

export type CastReferenceMember = Pick<
  CastMember,
  'name' | 'photoUrl' | 'bodyReferencePhotoUrl' | 'skinToneNote'
>

export interface CastReferenceResolution {
  /** The reference URL to pass as `presenterImageUrl`. Never empty. */
  presenterImageUrl: string
  /** The prompt with the skin-tone clause prepended when the member has one. */
  prompt: string
  /** Which Sanity field the reference came from. */
  referenceField: 'bodyReferencePhoto' | 'referencePhoto'
  /** True when a macro/close crop had to fall back to the portrait. */
  bodyReferenceMissing: boolean
  /** Human-readable reason, present only when `bodyReferenceMissing`. */
  warning?: string
}

/**
 * State the skin tone rather than let the model invent one. Short and plain by
 * design: the brief names a fact, it does not describe a person.
 */
export function withSkinToneNote(prompt: string, skinToneNote: string | null | undefined): string {
  const note = (skinToneNote ?? '').trim()
  if (!note) return prompt
  if (prompt.toLowerCase().includes(note.toLowerCase())) return prompt
  const clause = /[.!?]$/.test(note) ? `Skin tone: ${note}` : `Skin tone: ${note}.`
  return `${clause} ${prompt}`
}

export function resolveCastReference(opts: {
  member: CastReferenceMember
  cropScale: string | null | undefined
  prompt: string
}): CastReferenceResolution {
  const { member, cropScale, prompt } = opts
  const wantsBody = needsBodyReference(cropScale)
  const bodyReferenceMissing = wantsBody && !member.bodyReferencePhotoUrl
  const presenterImageUrl = presenterPhotoUrlForCrop(member, cropScale)
  return {
    presenterImageUrl,
    prompt: withSkinToneNote(prompt, member.skinToneNote),
    referenceField: wantsBody && member.bodyReferencePhotoUrl ? 'bodyReferencePhoto' : 'referencePhoto',
    bodyReferenceMissing,
    ...(bodyReferenceMissing
      ? {
          warning:
            `${member.name} has no bodyReferencePhoto, so this ${cropScale} crop was generated from the portrait. ` +
            'The body and skin tone below the neck are invented under this persona\'s name, which fails ' +
            'instagram-campaigns.md section 3.7 clause (a). Hold the post and say so in the run summary. ' +
            'To unblock: npx tsx scripts/generate-cast-body-references.ts, owner picks, upload to castMember.bodyReferencePhoto.',
        }
      : {}),
  }
}
