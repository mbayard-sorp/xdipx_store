/**
 * presenterPhotoUrlForCrop (ticket #10270): which CastMember reference photo
 * the on-skin generation path should pass as the presenter reference. A
 * macro/close crop carries no face to anchor identity to a portrait, so it
 * needs the neck-down body reference; anything else keeps using the portrait
 * reference the pipeline already relies on for identity consistency.
 */
import { describe, expect, it } from 'vitest'
import { presenterPhotoUrlForCrop } from './sanity.server'

const PORTRAIT = 'https://cdn.sanity.io/images/proj/ds/portrait.jpg'
const BODY = 'https://cdn.sanity.io/images/proj/ds/body.jpg'

describe('presenterPhotoUrlForCrop', () => {
  it('selects the body reference for a macro crop when one exists', () => {
    expect(presenterPhotoUrlForCrop({ photoUrl: PORTRAIT, bodyReferencePhotoUrl: BODY }, 'macro')).toBe(BODY)
  })

  it('selects the body reference for a close crop when one exists', () => {
    expect(presenterPhotoUrlForCrop({ photoUrl: PORTRAIT, bodyReferencePhotoUrl: BODY }, 'close')).toBe(BODY)
  })

  it('falls back to the portrait reference for a medium crop', () => {
    expect(presenterPhotoUrlForCrop({ photoUrl: PORTRAIT, bodyReferencePhotoUrl: BODY }, 'medium')).toBe(PORTRAIT)
  })

  it('falls back to the portrait reference for a wide crop', () => {
    expect(presenterPhotoUrlForCrop({ photoUrl: PORTRAIT, bodyReferencePhotoUrl: BODY }, 'wide')).toBe(PORTRAIT)
  })

  it('falls back to the portrait reference when cropScale is absent', () => {
    expect(presenterPhotoUrlForCrop({ photoUrl: PORTRAIT, bodyReferencePhotoUrl: BODY }, undefined)).toBe(PORTRAIT)
    expect(presenterPhotoUrlForCrop({ photoUrl: PORTRAIT, bodyReferencePhotoUrl: BODY }, null)).toBe(PORTRAIT)
  })

  it('falls back to the portrait reference on a macro/close crop when no body reference is approved yet', () => {
    expect(presenterPhotoUrlForCrop({ photoUrl: PORTRAIT, bodyReferencePhotoUrl: null }, 'macro')).toBe(PORTRAIT)
    expect(presenterPhotoUrlForCrop({ photoUrl: PORTRAIT, bodyReferencePhotoUrl: null }, 'close')).toBe(PORTRAIT)
  })

  it('never returns a falsy value', () => {
    for (const scale of ['macro', 'close', 'medium', 'wide', undefined, null, 'garbage']) {
      expect(presenterPhotoUrlForCrop({ photoUrl: PORTRAIT, bodyReferencePhotoUrl: null }, scale)).toBe(PORTRAIT)
    }
  })
})
