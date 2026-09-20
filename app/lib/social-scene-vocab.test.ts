/**
 * The single-source scene vocabulary (ticket #10480). Pure constants and pure
 * functions, so every case here is a direct call.
 */
import { describe, expect, it } from 'vitest'
import {
  BODY_ZONES,
  CONTACT_MODES,
  CROP_SCALES,
  NON_SKIN_SENTINEL,
  hasAllSceneAxes,
  mergeSceneAxes,
  parseSceneAxes,
  parseSceneAxisTags,
  sceneAxisTags,
  validateSceneAxis,
} from './social-scene-vocab'

describe('validateSceneAxis', () => {
  it('accepts every token in the vocabulary', () => {
    for (const zone of BODY_ZONES) expect(validateSceneAxis('bodyZone', zone).ok).toBe(true)
    for (const mode of CONTACT_MODES) expect(validateSceneAxis('contactMode', mode).ok).toBe(true)
    for (const crop of CROP_SCALES) expect(validateSceneAxis('cropScale', crop).ok).toBe(true)
  })

  it('refuses the typo shapes a length-only check used to let through', () => {
    // These are the exact failures #10480 names: both passed
    // `typeof string && length <= 40`, persisted, and then classified as
    // neither ceiling nor mid.
    expect(validateSceneAxis('bodyZone', 'hip_hollow').ok).toBe(false)
    expect(validateSceneAxis('bodyZone', 'Hip-Hollow').ok).toBe(false)
    expect(validateSceneAxis('cropScale', 'tight').ok).toBe(false)
    expect(validateSceneAxis('contactMode', 'held').ok).toBe(false)
  })

  it('carries the "none" sentinel explicitly on the two axes that need it', () => {
    expect(validateSceneAxis('bodyZone', NON_SKIN_SENTINEL).ok).toBe(true)
    expect(validateSceneAxis('contactMode', NON_SKIN_SENTINEL).ok).toBe(true)
    // A crop always exists, so there is nothing for `none` to mean there.
    expect(validateSceneAxis('cropScale', NON_SKIN_SENTINEL).ok).toBe(false)
  })

  it('normalizes a scene location instead of closing the set or refusing prose', () => {
    expect(validateSceneAxis('sceneLocation', 'bedroom-loft')).toEqual({ ok: true, value: 'bedroom-loft' })
    expect(validateSceneAxis('sceneLocation', 'a-room-nobody-has-shot-yet').ok).toBe(true)
    // Casing and separator drift is the same silent-miss class as a
    // Title-Case value compared against lowercase data, so it is coerced:
    // three spellings of one room must not rotate as three locations.
    expect(validateSceneAxis('sceneLocation', 'Bedroom Loft')).toEqual({ ok: true, value: 'bedroom-loft' })
    expect(validateSceneAxis('sceneLocation', 'bedroom_loft')).toEqual({ ok: true, value: 'bedroom-loft' })
    expect(validateSceneAxis('sceneLocation', 'bedroom, late afternoon'))
      .toEqual({ ok: true, value: 'bedroom-late-afternoon' })
    // Still bounded by the column: varchar(80).
    expect(validateSceneAxis('sceneLocation', 'x'.repeat(81)).ok).toBe(false)
    expect(validateSceneAxis('sceneLocation', '///').ok).toBe(false)
  })

  it('trims, so what is validated is what gets persisted', () => {
    const parsed = validateSceneAxis('bodyZone', '  sternum  ')
    expect(parsed).toEqual({ ok: true, value: 'sternum' })
  })
})

describe('parseSceneAxes', () => {
  it('leaves absent axes absent and never demands them', () => {
    // #10479: an omitted axis is backfilled from the asset, never 400'd, or a
    // refusal would strand a frame that has already been generated and billed.
    expect(parseSceneAxes({ tweetText: 'hello' })).toEqual({ ok: true, axes: {} })
  })

  it('treats an empty string as absent rather than as a bad token', () => {
    // "I do not have one" must not 400 a draft whose frame is already billed.
    expect(parseSceneAxes({ bodyZone: '', contactMode: '   ' })).toEqual({ ok: true, axes: {} })
  })

  it('400s on a present but out-of-vocabulary value', () => {
    const parsed = parseSceneAxes({ bodyZone: 'hip_hollow' })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('bodyZone must be one of')
  })

  it('prefixes the field name for the rework path', () => {
    const parsed = parseSceneAxes({ cropScale: 'tight' }, 'rework.')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('rework.cropScale')
  })

  it('collects all four when all four are present and valid', () => {
    const parsed = parseSceneAxes({
      bodyZone: 'hip-hollow', contactMode: 'resting', cropScale: 'medium', sceneLocation: 'bedroom-loft',
    })
    expect(parsed).toEqual({
      ok: true,
      axes: { bodyZone: 'hip-hollow', contactMode: 'resting', cropScale: 'medium', sceneLocation: 'bedroom-loft' },
    })
  })
})

describe('asset tag encoding', () => {
  it('round-trips every axis through the tags column', () => {
    const axes = {
      bodyZone: 'sternum', contactMode: 'drawn', cropScale: 'close', sceneLocation: 'bathroom-spa',
    }
    expect(parseSceneAxisTags(sceneAxisTags(axes))).toEqual(axes)
  })

  it('ignores unrelated tags and drops an out-of-vocabulary value', () => {
    const tags = ['hero', 'axis:bodyZone=hip_hollow', 'axis:cropScale=macro', 'axis:nonsense=1', 'axis:']
    expect(parseSceneAxisTags(tags)).toEqual({ cropScale: 'macro' })
  })

  it('emits nothing for an empty bag, so a row gets no tags column write', () => {
    expect(sceneAxisTags({})).toEqual([])
    expect(parseSceneAxisTags(null)).toEqual({})
  })
})

describe('mergeSceneAxes / hasAllSceneAxes', () => {
  it('lets a supplied value win over the asset, field by field', () => {
    const merged = mergeSceneAxes(
      { bodyZone: 'sternum' },
      { bodyZone: 'hip-hollow', contactMode: 'resting', cropScale: 'macro', sceneLocation: 'bedroom-loft' },
    )
    expect(merged).toEqual({
      bodyZone: 'sternum', contactMode: 'resting', cropScale: 'macro', sceneLocation: 'bedroom-loft',
    })
  })

  it('reports coverage only when all four are present', () => {
    expect(hasAllSceneAxes({ bodyZone: 'sternum', contactMode: 'resting', cropScale: 'macro' })).toBe(false)
    expect(hasAllSceneAxes({
      bodyZone: 'sternum', contactMode: 'resting', cropScale: 'macro', sceneLocation: 'bedroom-loft',
    })).toBe(true)
  })
})
