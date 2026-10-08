/**
 * resolveCastReference (ticket #10336): the shared decision both social-image
 * routes now make. The crop scale picks the reference photo, skinToneNote is
 * stated in the prompt, and a macro/close crop with no approved body reference
 * comes back flagged rather than silently substituting the portrait.
 */
import { describe, expect, it } from 'vitest'
import {
  isCropScale,
  needsBodyReference,
  needsHandReference,
  resolveCastReference,
  withSkinToneNote,
} from './social-cast-reference.server'

const PORTRAIT = 'https://cdn.sanity.io/images/proj/ds/portrait.jpg'
const BODY = 'https://cdn.sanity.io/images/proj/ds/body.jpg'
const HAND = 'https://cdn.sanity.io/images/proj/ds/hand.jpg'
const PROMPT = 'held at the collarbone, window light'

const withBody = {
  name: 'Maya',
  photoUrl: PORTRAIT,
  bodyReferencePhotoUrl: BODY,
  skinToneNote: 'deep brown skin with warm undertones',
  handReferencePhotoUrl: HAND,
}
const withoutBody = { ...withBody, bodyReferencePhotoUrl: null }
const withoutHand = { ...withBody, handReferencePhotoUrl: null }

describe('isCropScale', () => {
  it('accepts the four documented scales and nothing else', () => {
    for (const s of ['macro', 'close', 'medium', 'wide']) expect(isCropScale(s)).toBe(true)
    for (const s of ['MACRO', 'tight', '', undefined, null, 3]) expect(isCropScale(s)).toBe(false)
  })
})

describe('needsBodyReference', () => {
  it('is true only for the on-skin crops', () => {
    expect(needsBodyReference('macro')).toBe(true)
    expect(needsBodyReference('close')).toBe(true)
    expect(needsBodyReference('medium')).toBe(false)
    expect(needsBodyReference('wide')).toBe(false)
    expect(needsBodyReference(undefined)).toBe(false)
  })
})

describe('needsHandReference', () => {
  it('is true only for the held contact modes', () => {
    expect(needsHandReference('self-held')).toBe(true)
    expect(needsHandReference('other-held')).toBe(true)
    expect(needsHandReference('drawn')).toBe(true)
    expect(needsHandReference('resting')).toBe(false)
    expect(needsHandReference('worn')).toBe(false)
    expect(needsHandReference('balanced')).toBe(false)
    expect(needsHandReference(undefined)).toBe(false)
  })
})

describe('withSkinToneNote', () => {
  it('prepends a short plain clause', () => {
    expect(withSkinToneNote(PROMPT, 'fair skin')).toBe(`Skin tone: fair skin. ${PROMPT}`)
  })

  it('does not double the sentence period', () => {
    expect(withSkinToneNote(PROMPT, 'fair skin.')).toBe(`Skin tone: fair skin. ${PROMPT}`)
  })

  it('leaves the prompt alone when there is no note', () => {
    expect(withSkinToneNote(PROMPT, null)).toBe(PROMPT)
    expect(withSkinToneNote(PROMPT, '   ')).toBe(PROMPT)
  })

  it('does not repeat a note the prompt already carries', () => {
    const already = 'fair skin, window light'
    expect(withSkinToneNote(already, 'fair skin')).toBe(already)
  })
})

describe('resolveCastReference', () => {
  it('passes the body reference for a close crop when one exists', () => {
    const r = resolveCastReference({ member: withBody, cropScale: 'close', prompt: PROMPT })
    expect(r.presenterImageUrl).toBe(BODY)
    expect(r.referenceField).toBe('bodyReferencePhoto')
    expect(r.bodyReferenceMissing).toBe(false)
    expect(r.warning).toBeUndefined()
  })

  it('states the skin tone in the prompt', () => {
    const r = resolveCastReference({ member: withBody, cropScale: 'close', prompt: PROMPT })
    expect(r.prompt).toBe(`Skin tone: deep brown skin with warm undertones. ${PROMPT}`)
  })

  it('keeps the portrait for a medium crop', () => {
    const r = resolveCastReference({ member: withBody, cropScale: 'medium', prompt: PROMPT })
    expect(r.presenterImageUrl).toBe(PORTRAIT)
    expect(r.referenceField).toBe('referencePhoto')
    expect(r.bodyReferenceMissing).toBe(false)
  })

  it('flags a macro crop with no approved body reference and still returns a usable reference', () => {
    const r = resolveCastReference({ member: withoutBody, cropScale: 'macro', prompt: PROMPT })
    expect(r.presenterImageUrl).toBe(PORTRAIT)
    expect(r.bodyReferenceMissing).toBe(true)
    expect(r.warning).toContain('bodyReferencePhoto')
    expect(r.warning).toContain('Maya')
  })

  it('does not flag a medium crop with no body reference', () => {
    const r = resolveCastReference({ member: withoutBody, cropScale: 'medium', prompt: PROMPT })
    expect(r.bodyReferenceMissing).toBe(false)
  })

  it('never puts an em-dash in the warning', () => {
    const r = resolveCastReference({ member: withoutBody, cropScale: 'close', prompt: PROMPT })
    expect(r.warning).not.toContain(String.fromCharCode(8212))
  })

  it('attaches the hand reference as an extra reference for a held contact mode', () => {
    const r = resolveCastReference({ member: withBody, cropScale: 'medium', prompt: PROMPT, contactMode: 'self-held' })
    expect(r.extraReferenceUrls).toEqual([HAND])
    expect(r.handReferenceMissing).toBe(false)
    expect(r.warning).toBeUndefined()
    // The extra reference never replaces the presenter reference.
    expect(r.presenterImageUrl).toBe(PORTRAIT)
  })

  it('attaches nothing extra for a non-held contact mode', () => {
    const r = resolveCastReference({ member: withBody, cropScale: 'medium', prompt: PROMPT, contactMode: 'resting' })
    expect(r.extraReferenceUrls).toEqual([])
    expect(r.handReferenceMissing).toBe(false)
  })

  it('attaches nothing extra when contactMode is absent', () => {
    const r = resolveCastReference({ member: withBody, cropScale: 'medium', prompt: PROMPT })
    expect(r.extraReferenceUrls).toEqual([])
  })

  it('flags a held contact mode with no approved hand reference, still returns a usable resolution', () => {
    const r = resolveCastReference({ member: withoutHand, cropScale: 'medium', prompt: PROMPT, contactMode: 'other-held' })
    expect(r.extraReferenceUrls).toEqual([])
    expect(r.handReferenceMissing).toBe(true)
    expect(r.warning).toContain('handReferencePhoto')
    expect(r.warning).toContain('Maya')
  })

  it('combines the body and hand warnings when both are missing', () => {
    const bare = { ...withoutBody, handReferencePhotoUrl: null }
    const r = resolveCastReference({ member: bare, cropScale: 'macro', prompt: PROMPT, contactMode: 'drawn' })
    expect(r.bodyReferenceMissing).toBe(true)
    expect(r.handReferenceMissing).toBe(true)
    expect(r.warning).toContain('bodyReferencePhoto')
    expect(r.warning).toContain('handReferencePhoto')
    expect(r.warning).not.toContain(String.fromCharCode(8212))
  })
})

/**
 * Ticket #13740: instagram-campaigns.md §3.2g item 5 (owner 2026-10-05) now
 * licenses a face entering a close/medium bodyscape at the frame edge, which
 * needs both the body and portrait references at once instead of the single
 * reference every other call wants.
 */
describe('resolveCastReference: faceInFrame (#13740)', () => {
  it('sends both references for a close crop when the member has both', () => {
    const r = resolveCastReference({ member: withBody, cropScale: 'close', prompt: PROMPT, faceInFrame: true })
    expect(r.presenterImageUrl).toBe(BODY)
    expect(r.extraReferenceUrls).toEqual([PORTRAIT])
    expect(r.dualReferenceMissing).toBe(false)
    expect(r.warning).toBeUndefined()
  })

  it('sends both references for a medium crop when the member has both', () => {
    const r = resolveCastReference({ member: withBody, cropScale: 'medium', prompt: PROMPT, faceInFrame: true })
    expect(r.presenterImageUrl).toBe(PORTRAIT)
    expect(r.extraReferenceUrls).toEqual([BODY])
    expect(r.dualReferenceMissing).toBe(false)
  })

  it('does not add an extra reference when faceInFrame is false or omitted', () => {
    const r = resolveCastReference({ member: withBody, cropScale: 'close', prompt: PROMPT })
    expect(r.extraReferenceUrls).toEqual([])
    expect(r.dualReferenceMissing).toBe(false)
  })

  it('sends the one reference that exists and flags dualReferenceMissing when the body reference is absent', () => {
    const r = resolveCastReference({ member: withoutBody, cropScale: 'close', prompt: PROMPT, faceInFrame: true })
    expect(r.presenterImageUrl).toBe(PORTRAIT)
    expect(r.extraReferenceUrls).toEqual([])
    expect(r.dualReferenceMissing).toBe(true)
    expect(r.warning).toContain('bodyReferencePhoto')
    expect(r.warning).not.toContain(String.fromCharCode(8212))
  })

  it('combines with the hand-reference extra when both apply', () => {
    const r = resolveCastReference({
      member: withBody, cropScale: 'close', prompt: PROMPT, faceInFrame: true, contactMode: 'self-held',
    })
    expect(r.extraReferenceUrls).toEqual([HAND, PORTRAIT])
  })
})
