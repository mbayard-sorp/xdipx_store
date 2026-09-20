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
  resolveCastReference,
  withSkinToneNote,
} from './social-cast-reference.server'

const PORTRAIT = 'https://cdn.sanity.io/images/proj/ds/portrait.jpg'
const BODY = 'https://cdn.sanity.io/images/proj/ds/body.jpg'
const PROMPT = 'held at the collarbone, window light'

const withBody = {
  name: 'Maya',
  photoUrl: PORTRAIT,
  bodyReferencePhotoUrl: BODY,
  skinToneNote: 'deep brown skin with warm undertones',
}
const withoutBody = { ...withBody, bodyReferencePhotoUrl: null }

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
})
