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
  WARDROBE_COVERAGE_CLASSES,
  applyNonSkinAxisDefaults,
  hasAllSceneAxes,
  hasStoryLine,
  isRetiredBodyZone,
  mergeSceneAxes,
  parseSceneAxes,
  parseSceneAxisTags,
  requireSceneAxesForGeneration,
  sceneAxisTags,
  validateSceneAxis,
} from './social-scene-vocab'

// Ticket #13163's own DONE WHEN: this list must match the "Coverage classes"
// section of docs/store-team/cast-wardrobe.md exactly. That doc ships on a
// separate, not-yet-merged docs PR (#1481, ticket #13162), so it does not
// exist in this branch's working tree yet -- reading it here would make this
// test fail on CI ordering rather than on an actual drift. This mirrors the
// doc's list verbatim (confirmed byte-identical against PR #1481's content
// at authoring time) as the next-best check available right now: once #1481
// merges, tighten this to read the file directly (fs.readFileSync +
// extract the fenced list) so a future edit to the doc is caught here
// automatically instead of needing a second manual sync.
const CAST_WARDROBE_DOC_COVERAGE_CLASSES = [
  'bare-jewellery', 'bra', 'bralette', 'briefs-highcut', 'thong', 'garter',
  'bodysuit', 'slip', 'robe', 'shirt-open', 'trousers', 'bedding-on-body',
  'towel', 'bulky',
]

describe('validateSceneAxis', () => {
  it('accepts every token in the vocabulary', () => {
    for (const zone of BODY_ZONES) expect(validateSceneAxis('bodyZone', zone).ok).toBe(true)
    for (const mode of CONTACT_MODES) expect(validateSceneAxis('contactMode', mode).ok).toBe(true)
    for (const crop of CROP_SCALES) expect(validateSceneAxis('cropScale', crop).ok).toBe(true)
    for (const cls of WARDROBE_COVERAGE_CLASSES) expect(validateSceneAxis('wardrobeCoverage', cls).ok).toBe(true)
  })

  it('refuses a wardrobeCoverage value outside the closed enum', () => {
    const parsed = validateSceneAxis('wardrobeCoverage', 'lingerie')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('wardrobeCoverage must be one of')
  })

  it('has no "none" sentinel for wardrobeCoverage: bare-jewellery already names the bare case', () => {
    expect(validateSceneAxis('wardrobeCoverage', NON_SKIN_SENTINEL).ok).toBe(false)
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

  it('reports coverage only when all five are present', () => {
    expect(hasAllSceneAxes({ bodyZone: 'sternum', contactMode: 'resting', cropScale: 'macro' })).toBe(false)
    // Ticket #13163: adding wardrobeCoverage to SCENE_AXIS_KEYS means the
    // original four are no longer sufficient on their own.
    expect(hasAllSceneAxes({
      bodyZone: 'sternum', contactMode: 'resting', cropScale: 'macro', sceneLocation: 'bedroom-loft',
    })).toBe(false)
    expect(hasAllSceneAxes({
      bodyZone: 'sternum', contactMode: 'resting', cropScale: 'macro', sceneLocation: 'bedroom-loft',
      wardrobeCoverage: 'bra',
    })).toBe(true)
  })
})

// Ticket #10501: without this, the routine's Step 5 template (and any direct
// caller of api.team.social-image.tsx) could omit every axis and produce an
// untagged asset, the exact shape that decayed coverage to 0/7 twice already
// (migrations 093, 099).
describe('requireSceneAxesForGeneration', () => {
  it('refuses a call with no sceneLocation at all', () => {
    const result = requireSceneAxesForGeneration({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('sceneLocation')
  })

  it('refuses a wide/medium crop missing sceneLocation even when other axes are present', () => {
    const result = requireSceneAxesForGeneration({ cropScale: 'wide' })
    expect(result.ok).toBe(false)
  })

  it('passes a non-skin generation that supplies only sceneLocation', () => {
    expect(requireSceneAxesForGeneration({ sceneLocation: 'bedroom-loft' })).toEqual({ ok: true })
  })

  it('passes a medium/wide crop with sceneLocation and no bodyZone/contactMode', () => {
    expect(requireSceneAxesForGeneration({ sceneLocation: 'bedroom-loft', cropScale: 'medium' })).toEqual({ ok: true })
    expect(requireSceneAxesForGeneration({ sceneLocation: 'bedroom-loft', cropScale: 'wide' })).toEqual({ ok: true })
  })

  it('refuses a macro crop missing bodyZone and/or contactMode', () => {
    const missingBoth = requireSceneAxesForGeneration({ sceneLocation: 'bedroom-loft', cropScale: 'macro' })
    expect(missingBoth.ok).toBe(false)
    if (!missingBoth.ok) expect(missingBoth.error).toContain('bodyZone and contactMode')

    const missingOne = requireSceneAxesForGeneration({
      sceneLocation: 'bedroom-loft', cropScale: 'macro', bodyZone: 'hip-hollow',
    })
    expect(missingOne.ok).toBe(false)
  })

  it('refuses a close crop the same way it refuses macro', () => {
    const result = requireSceneAxesForGeneration({ sceneLocation: 'bedroom-loft', cropScale: 'close' })
    expect(result.ok).toBe(false)
  })

  it('passes a fully-supplied on-skin generation', () => {
    expect(requireSceneAxesForGeneration({
      sceneLocation: 'bedroom-loft', cropScale: 'close', bodyZone: 'hip-hollow', contactMode: 'resting',
    })).toEqual({ ok: true })
  })

  // Ticket #13739: forearm stays a valid BODY_ZONES member (historical rows
  // still parse) but is rejected here, the one shared pre-spend call site for
  // both api.team.social-image.tsx ops.
  it('refuses the retired forearm body zone even when otherwise fully supplied', () => {
    const result = requireSceneAxesForGeneration({
      sceneLocation: 'bedroom-loft', cropScale: 'close', bodyZone: 'forearm', contactMode: 'resting',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('forearm')
      expect(result.error).toContain('imagery-owner-notes.md entry 3')
    }
  })

  it('still passes a non-retired body zone', () => {
    expect(requireSceneAxesForGeneration({
      sceneLocation: 'bedroom-loft', cropScale: 'close', bodyZone: 'inner-wrist', contactMode: 'resting',
    })).toEqual({ ok: true })
  })
})

describe('isRetiredBodyZone', () => {
  it('flags forearm and nothing else', () => {
    expect(isRetiredBodyZone('forearm')).toBe(true)
    expect(isRetiredBodyZone('inner-wrist')).toBe(false)
    expect(isRetiredBodyZone(undefined)).toBe(false)
    expect(isRetiredBodyZone(null)).toBe(false)
  })
})

describe('hasStoryLine (ticket #13739)', () => {
  const validBrief = [
    'STORY LINE womanizer-next-sage, jade',
    '  Moment: ANTICIPATION. Jade is about to start her evening wind-down.',
    '  Set: her bed, with a warm lamp and a half-folded throw blanket.',
    '  Cue: the lamp light.',
    '  Sensation: pulse-air suction reads as a held breath.',
    '  Gaze: on the product.',
    '  Hand: right hand, side grip, resting at her hip.',
  ].join('\n')

  it('accepts a well-formed STORY LINE block', () => {
    expect(hasStoryLine(validBrief)).toBe(true)
  })

  it('rejects empty, null, or undefined briefs', () => {
    expect(hasStoryLine('')).toBe(false)
    expect(hasStoryLine(null)).toBe(false)
    expect(hasStoryLine(undefined)).toBe(false)
  })

  it('rejects a brief with no STORY LINE header at all', () => {
    expect(hasStoryLine('A cast member holding the product up in her kitchen.')).toBe(false)
  })

  it.each(['Moment', 'Set', 'Cue'])('rejects a STORY LINE block with an empty %s line', (label) => {
    const broken = validBrief.replace(new RegExp(`^  ${label}:.*$`, 'm'), `  ${label}:`)
    expect(hasStoryLine(broken)).toBe(false)
  })

  it('rejects a STORY LINE block missing a required line entirely', () => {
    const missingCue = validBrief.split('\n').filter(l => !l.trim().startsWith('Cue:')).join('\n')
    expect(hasStoryLine(missingCue)).toBe(false)
  })
})

describe('applyNonSkinAxisDefaults (ticket #13096)', () => {
  it('fills bodyZone and contactMode with the none sentinel for a wide crop with neither', () => {
    expect(applyNonSkinAxisDefaults({ sceneLocation: 'bedroom-loft', cropScale: 'wide' })).toEqual({
      sceneLocation: 'bedroom-loft', cropScale: 'wide', bodyZone: NON_SKIN_SENTINEL, contactMode: NON_SKIN_SENTINEL,
    })
  })

  it('does the same for a medium crop', () => {
    expect(applyNonSkinAxisDefaults({ sceneLocation: 'bedroom-loft', cropScale: 'medium' })).toEqual({
      sceneLocation: 'bedroom-loft', cropScale: 'medium', bodyZone: NON_SKIN_SENTINEL, contactMode: NON_SKIN_SENTINEL,
    })
  })

  it('never overrides a value the caller actually supplied', () => {
    expect(applyNonSkinAxisDefaults({
      sceneLocation: 'bedroom-loft', cropScale: 'wide', bodyZone: 'forearm', contactMode: 'self-held',
    })).toEqual({
      sceneLocation: 'bedroom-loft', cropScale: 'wide', bodyZone: 'forearm', contactMode: 'self-held',
    })
  })

  it('fills only the missing one when the caller supplied one of the two', () => {
    expect(applyNonSkinAxisDefaults({ sceneLocation: 'bedroom-loft', cropScale: 'wide', bodyZone: 'forearm' }))
      .toEqual({ sceneLocation: 'bedroom-loft', cropScale: 'wide', bodyZone: 'forearm', contactMode: NON_SKIN_SENTINEL })
  })

  it('leaves a macro/close crop untouched — those still require a real zone, never the sentinel', () => {
    expect(applyNonSkinAxisDefaults({ sceneLocation: 'bedroom-loft', cropScale: 'macro' }))
      .toEqual({ sceneLocation: 'bedroom-loft', cropScale: 'macro' })
    expect(applyNonSkinAxisDefaults({ sceneLocation: 'bedroom-loft', cropScale: 'close' }))
      .toEqual({ sceneLocation: 'bedroom-loft', cropScale: 'close' })
  })

  it('leaves axes with no cropScale at all untouched', () => {
    expect(applyNonSkinAxisDefaults({ sceneLocation: 'bedroom-loft' })).toEqual({ sceneLocation: 'bedroom-loft' })
  })

  it('composes with requireSceneAxesForGeneration so a bare wide/medium call now always passes', () => {
    const defaulted = applyNonSkinAxisDefaults({ sceneLocation: 'bedroom-loft', cropScale: 'wide' })
    expect(requireSceneAxesForGeneration(defaulted)).toEqual({ ok: true })
  })
})

// Ticket #13163's explicit DONE WHEN: "the doc list and the enum match".
describe('WARDROBE_COVERAGE_CLASSES matches docs/store-team/cast-wardrobe.md', () => {
  it('is the same set, in the same order, as the Coverage classes list', () => {
    expect([...WARDROBE_COVERAGE_CLASSES]).toEqual(CAST_WARDROBE_DOC_COVERAGE_CLASSES)
  })
})
